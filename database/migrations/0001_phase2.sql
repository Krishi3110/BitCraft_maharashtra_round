-- Migration number: 0001 	 2026-10-03T18:00:00.000Z

-- A1. events
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  venue TEXT,
  starts_at INTEGER,
  description TEXT,
  image_url TEXT,
  created_at INTEGER NOT NULL
);

-- A10. experiments (Created before drops to satisfy drops.experiment_id FK)
CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  drop_id TEXT NOT NULL, -- FK to drops.id but cyclic, will not enforce FK rigidly yet or defer it
  comparison_id TEXT,
  mode TEXT NOT NULL,
  sim_mode TEXT NOT NULL,
  scenario TEXT,
  status TEXT NOT NULL,
  config_json TEXT,
  population_seed TEXT,
  population_hash TEXT,
  labels_hash TEXT,
  simulator_version TEXT,
  server_version TEXT,
  risk_engine_version TEXT,
  started_at INTEGER,
  finished_at INTEGER,
  results_json TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL
);

-- A2. drops
CREATE TABLE IF NOT EXISTS drops (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  experiment_id TEXT REFERENCES experiments(id),
  mode TEXT NOT NULL,
  kind TEXT NOT NULL,
  clock_mode TEXT NOT NULL,
  state TEXT NOT NULL,
  total_inventory INTEGER NOT NULL,
  opens_at INTEGER,
  registration_closes_at INTEGER,
  booking_closes_at INTEGER,
  offer_ttl_ms INTEGER,
  hold_ttl_ms INTEGER,
  config_json TEXT,
  seed_commitment TEXT,
  allocation_algorithm TEXT,
  allocation_committed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_drops_event_state ON drops(event_id, state);
CREATE INDEX idx_drops_experiment_id ON drops(experiment_id);

-- Add fk back from experiments to drops (SQLite doesn't easily support adding constraints after table creation so we rely on app logic or redefine, we just leave it without strict schema FK)
-- Actually SQLite lets us define foreign keys at creation but for cyclic dependencies we can just omit one direction's strict FK.

CREATE INDEX idx_experiments_comparison_id ON experiments(comparison_id);
CREATE INDEX idx_experiments_status_created ON experiments(status, created_at);

-- A3. users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  email_hash TEXT NOT NULL UNIQUE,
  email_display TEXT,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL
);

-- A4. sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  device_id TEXT,
  network_key TEXT,
  user_agent_hash TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  revoke_reason TEXT
);

CREATE INDEX idx_sessions_user_status ON sessions(user_id, status);

-- A5. participants (projection)
-- IMPORTANT: This table is a projection/final-periodic record. It is NOT the authoritative replacement for DropDO live state.
CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  drop_id TEXT NOT NULL REFERENCES drops(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL,
  registered_at INTEGER NOT NULL,
  eligibility_reason TEXT,
  risk_action TEXT,
  risk_score INTEGER,
  rank_key TEXT,
  waitlist_rank INTEGER,
  offer_expires_at INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE(drop_id, user_id)
);

CREATE INDEX idx_participants_drop_status ON participants(drop_id, status);

-- A6. tickets (projection)
-- IMPORTANT: This table is a projection/final-periodic record. It is NOT the authoritative replacement for DropDO live state.
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  drop_id TEXT NOT NULL REFERENCES drops(id),
  holder_participant_id TEXT REFERENCES participants(id),
  seq INTEGER NOT NULL,
  status TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(drop_id, seq)
);

CREATE UNIQUE INDEX idx_tickets_holder ON tickets(drop_id, holder_participant_id) WHERE holder_participant_id IS NOT NULL;

-- A7. allocations
CREATE TABLE IF NOT EXISTS allocations (
  drop_id TEXT NOT NULL REFERENCES drops(id),
  participant_id TEXT NOT NULL REFERENCES participants(id),
  outcome TEXT NOT NULL,
  rank INTEGER NOT NULL,
  rank_key TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (drop_id, participant_id),
  UNIQUE(drop_id, rank)
);

-- A8. reservations (projection)
CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  drop_id TEXT NOT NULL REFERENCES drops(id),
  participant_id TEXT NOT NULL REFERENCES participants(id),
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  status TEXT NOT NULL,
  idempotency_key TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  confirmed_at INTEGER,
  ended_at INTEGER
);

CREATE UNIQUE INDEX idx_reservations_active ON reservations(drop_id, participant_id) WHERE status IN ('HELD', 'CONFIRMED');
CREATE INDEX idx_reservations_drop_status ON reservations(drop_id, status);

-- A9. risk_decisions
CREATE TABLE IF NOT EXISTS risk_decisions (
  id TEXT PRIMARY KEY,
  drop_id TEXT NOT NULL REFERENCES drops(id),
  participant_id TEXT REFERENCES participants(id),
  session_id TEXT REFERENCES sessions(id),
  subject_ref TEXT NOT NULL,
  action TEXT NOT NULL,
  score INTEGER,
  reasons_json TEXT,
  engine_version TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_risk_decisions_drop_action ON risk_decisions(drop_id, action);

-- A11. experiment_metrics
CREATE TABLE IF NOT EXISTS experiment_metrics (
  experiment_id TEXT NOT NULL REFERENCES experiments(id),
  t_ms INTEGER NOT NULL,
  metric_set TEXT NOT NULL,
  values_json TEXT NOT NULL,
  PRIMARY KEY (experiment_id, t_ms, metric_set)
);

-- A12. experiment_artifacts
CREATE TABLE IF NOT EXISTS experiment_artifacts (
  experiment_id TEXT NOT NULL REFERENCES experiments(id),
  kind TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  data TEXT,
  PRIMARY KEY (experiment_id, kind, chunk_index)
);

-- A13. audit_records
CREATE TABLE IF NOT EXISTS audit_records (
  id TEXT PRIMARY KEY,
  drop_id TEXT NOT NULL UNIQUE REFERENCES drops(id),
  experiment_id TEXT REFERENCES experiments(id),
  allocation_algorithm TEXT,
  algorithm_version TEXT,
  seed_commitment TEXT,
  seed_committed_at INTEGER,
  server_seed TEXT,
  revealed_at INTEGER,
  snapshot_hash TEXT,
  eligible_count INTEGER,
  total_inventory INTEGER,
  final_seed TEXT,
  result_hash TEXT,
  winners_hash TEXT,
  allocation_committed_at INTEGER,
  integrity_json TEXT,
  code_version TEXT,
  created_at INTEGER NOT NULL
);

-- SEED DATA for FUTUREFEST 2026
INSERT INTO events (id, name, venue, starts_at, description, image_url, created_at)
VALUES (
  'futurefest-2026',
  'FUTUREFEST 2026',
  'Virtual',
  1793577600000, -- Oct 2026 approx
  'The premier tech conference of the future.',
  'https://example.com/futurefest.png',
  1727956800000
) ON CONFLICT DO NOTHING;

INSERT INTO drops (
  id, event_id, experiment_id, mode, kind, clock_mode, state,
  total_inventory, opens_at, registration_closes_at, booking_closes_at,
  offer_ttl_ms, hold_ttl_ms, config_json, seed_commitment,
  allocation_algorithm, allocation_committed_at, created_at, updated_at
) VALUES (
  'drp_futurefest2026_1',
  'futurefest-2026',
  NULL,
  'FAIR',
  'PUBLIC',
  'WALL',
  'SCHEDULED',
  500,
  1793570400000,
  1793571300000,
  1793574900000,
  600000, -- 10 mins
  300000, -- 5 mins
  '{"rate_limits":{},"risk_thresholds":{}}',
  'c0mm1tm3nt',
  'fairdrop-hmac-rank-v1',
  NULL,
  1727956800000,
  1727956800000
) ON CONFLICT DO NOTHING;
