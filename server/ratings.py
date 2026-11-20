"""Persistent pairwise Elo for completed rounds (identities are display names)."""
import sqlite3


class Ratings:
    def __init__(self, path):
        self.db = sqlite3.connect(path)
        self.db.execute('CREATE TABLE IF NOT EXISTS players '
                        '(name TEXT PRIMARY KEY, rating REAL NOT NULL, rounds INTEGER NOT NULL)')

    def record(self, players, winner):
        names = list(players.values())
        if len(names) < 2 or len(set(names)) != len(names):
            return
        with self.db:
            scores = {}
            for name in names:
                row = self.db.execute('SELECT rating FROM players WHERE name=?', (name,)).fetchone()
                scores[name] = row[0] if row else 1200.
            for slot, name in players.items():
                delta = 0.
                for other, opponent in players.items():
                    if other == slot:
                        continue
                    actual = 1 if slot == winner else 0 if other == winner else .5
                    expected = 1 / (1 + 10 ** ((scores[opponent] - scores[name]) / 400))
                    delta += actual - expected
                rating = scores[name] + 32 * delta / (len(names) - 1)
                self.db.execute('INSERT INTO players VALUES (?,?,1) ON CONFLICT(name) '
                                'DO UPDATE SET rating=excluded.rating, rounds=rounds+1', (name, rating))

    def leaders(self):
        return [dict(name=name, rating=round(score), rounds=count) for name, score, count in
                self.db.execute('SELECT name,rating,rounds FROM players ORDER BY rating DESC,name LIMIT 100')]