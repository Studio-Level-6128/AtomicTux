"""Spectator transport, room lifecycle, and persistent Elo regressions."""
import asyncio
import json
from pathlib import Path
import tempfile
import unittest
from urllib.request import urlopen

from websockets.asyncio.client import connect
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

from server.ratings import Ratings
from server.server import Client, GameServer
from server.spectators import FILES


class RatingTests(unittest.TestCase):
    def test_pairwise_and_persistence(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)/'ratings.sqlite3'
            ratings = Ratings(path)
            ratings.record({0:'Ada'}, 0)
            ratings.record({0:'Ada', 1:'Ada'}, 1)
            self.assertEqual(ratings.leaders(), [])
            players = {0:'Ada', 1:'Bo', 3:'Cam'}
            ratings.record(players, 3)
            self.assertEqual([p['rating'] for p in ratings.leaders()], [1216,1192,1192])
            ratings.record(players, -1)
            rows = ratings.leaders()
            self.assertLess(rows[0]['rating'], 1216)
            self.assertEqual(rows[0]['name'], 'Cam')
            self.assertTrue(all(p['rounds'] == 2 for p in rows))
            ratings.db.close()
            reopened = Ratings(path)
            self.assertEqual(reopened.leaders(), rows)
            reopened.db.close()


class SpectatorTests(unittest.IsolatedAsyncioTestCase):
    async def test_web_and_round_lifecycle(self):
        game = GameServer(round_seconds=.1)
        self.addCleanup(game.ratings.db.close)
        owner, guest = Client(None), Client(None)
        owner.send = guest.send = lambda message: None  # Only the spectator transport is under test.
        owner.name, guest.name = 'Ada', 'Bo'
        game.command(owner, dict(type='create', name='<Arena>'))
        room = owner.room
        game.command(guest, dict(type='join', room=room.id))
        async with serve(game.handler,'127.0.0.1',0,process_request=game.http_request) as listener:
            addr = '127.0.0.1:' + str(listener.sockets[0].getsockname()[1])
            async def get(path):
                def read():
                    with urlopen(f'http://{addr}{path}', timeout=3) as r:
                        return r.read()
                return await asyncio.to_thread(read)

            for path in FILES:
                self.assertTrue(await get(path), path)
            async def lobby(): return json.loads(await get('/api/lobby'))
            self.assertEqual((await lobby())['rooms'][0]['state'], 'waiting')
            watch = f'ws://{addr}/watch/{room.id}'
            async with connect(watch) as ws:
                async def frame(): return json.loads(await asyncio.wait_for(ws.recv(), 5))
                self.assertEqual(await frame(), {'type':'waiting'})
                async with connect(watch) as rogue:
                    await rogue.send('{"type":"start"}')
                    with self.assertRaises(ConnectionClosed):
                        while True: await rogue.recv()
                self.assertEqual(room.state, 'waiting')
                game.command(owner, dict(type='start'))
                self.assertEqual((await lobby())['rooms'][0]['state'], 'playing')
                self.assertEqual((await frame())['state']['humans'], [0,1])
                async with connect(watch) as late:
                    snapshot = json.loads(await late.recv())
                    self.assertEqual(snapshot['type'], 'snapshot')
                    self.assertEqual(snapshot['events'], [])
                room.match.place(0)
                while True:
                    msg = await frame()
                    if {'type':'place','actor':0} in msg['events']: break
                    self.assertFalse(msg['state']['finished'])
                game.leave(guest)  # AI replacement cannot claim a win.
                while not (await frame())['state']['finished']: pass
                result = await lobby()
                self.assertEqual(result['rooms'][0]['state'], 'finished')
                self.assertEqual(len(result['leaders']), 2)
                game.command(owner, dict(type='ready'))
                self.assertEqual(await frame(), {'type':'waiting'})
                game.command(owner, dict(type='start'))
                self.assertEqual((await frame())['state']['humans'], [0])
                game.leave(owner)
                self.assertEqual(await frame(), {'type':'closed'})
                self.assertEqual((await lobby())['rooms'], [])
                self.assertEqual((await lobby())['leaders'], result['leaders'])