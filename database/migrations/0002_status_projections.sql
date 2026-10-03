CREATE TABLE IF NOT EXISTS status_projections (
    drop_id TEXT NOT NULL,
    participant_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    status TEXT NOT NULL,
    payload JSON,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (drop_id, participant_id)
);
