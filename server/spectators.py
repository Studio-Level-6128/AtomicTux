"""Read-only same-origin spectator endpoints. Only explicit public files are served."""
import asyncio
import http
import json
from functools import lru_cache
from pathlib import Path

from websockets.datastructures import Headers
from websockets.http11 import Response

ROOT = Path(__file__).resolve().parent
WEB = ROOT / 'web'
ASSETS = ROOT.parent / 'assets'
FILES = {'/': (WEB / 'index.html', 'text/html; charset=utf-8'),
         '/watch.js': (WEB / 'watch.js', 'text/javascript'),
         '/arena.js': (WEB / 'arena.js', 'text/javascript'),
         '/watch.css': (WEB / 'watch.css', 'text/css'),
         '/studio-level-6128.png': (ASSETS / 'art/studio-level-6128.png', 'image/png'),
         '/tux.png': (ASSETS / 'art/tux.png', 'image/png')}
for kind in ('bomb', 'fire', 'speed', 'kick', 'shield', 'atomic'):
    FILES[f'/{kind}.svg'] = (ASSETS / f'icons/{kind}.svg', 'image/svg+xml')
for kind in ('boom', 'place', 'shield', 'pickup'):
    FILES[f'/{kind}.wav'] = (WEB / f'sound-{kind}.wav', 'audio/wav')


def response(body, mime, cache):
    return Response(200, 'OK', Headers({'Content-Type': mime, 'Content-Length': str(len(body)),
                    'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff'}), body)


@lru_cache(maxsize=len(FILES))
def asset(path):
    file, mime = FILES[path]
    return file.read_bytes(), mime


def http_page(game, connection, request):
    path = request.path
    if 'websocket' in (v.lower() for v in request.headers.get_all('Upgrade')):
        if path == '/' or (path.startswith('/watch/') and path[7:] in game.rooms):
            return None
    elif path in FILES:
        return response(*asset(path), 'no-cache')
    elif path == '/api/lobby':
        rooms = [dict(id=r.id, name=r.name, state=r.state, round=r.round,
                      players=[p.name for p in r.members.values()]) for r in game.rooms.values()]
        return response(json.dumps(dict(rooms=rooms, leaders=game.ratings.leaders())).encode(),
                        'application/json', 'no-store')
    return connection.respond(http.HTTPStatus.NOT_FOUND, 'Not found\n')


class Feed:
    """Latest frame only: slow browsers cannot queue snapshots or block the game loop."""
    def __init__(self):
        self.changed = asyncio.Event()
        self.frame = None
        self.viewers = 0
        self.closed = False

    def publish(self, message):
        if self.viewers:
            self.frame = json.dumps(message, separators=(',', ':'))
            self.changed.set()
            self.changed = asyncio.Event()

    async def stream(self, ws, room):
        self.viewers += 1
        try:
            changed = self.changed
            if self.closed:
                await ws.send('{"type":"closed"}')
                return
            initial = (dict(type='waiting') if room.state == 'waiting' else
                       dict(type='snapshot', state=room.match.snapshot(), countdown=room.countdown, events=[]))
            await ws.send(json.dumps(initial))
            while True:
                await changed.wait()
                changed = self.changed
                closed = self.closed
                await asyncio.wait_for(ws.send(self.frame), 5)
                if closed:
                    return
        finally:
            self.viewers -= 1
            if not self.viewers:
                self.frame = None