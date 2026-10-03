-- Migration number: 0000 	 2026-10-03T00:00:00.000Z
CREATE TABLE IF NOT EXISTS _phase1_ping (
  id INTEGER PRIMARY KEY,
  val TEXT
);
INSERT INTO _phase1_ping (id, val) VALUES (1, 'pong') ON CONFLICT DO NOTHING;
