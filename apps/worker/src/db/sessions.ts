export async function createSession(
  db: D1Database,
  id: string,
  userId: string,
  nowMs: number,
  expiresAtMs: number,
  deviceInfo: { deviceId?: string; networkKey?: string; userAgentHash?: string } = {}
) {
  await db.prepare(`
    INSERT INTO sessions (id, user_id, device_id, network_key, user_agent_hash, created_at, last_seen_at, expires_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
  `).bind(
    id,
    userId,
    deviceInfo.deviceId || null,
    deviceInfo.networkKey || null,
    deviceInfo.userAgentHash || null,
    nowMs,
    nowMs,
    expiresAtMs
  ).run();
}

export async function getSession(db: D1Database, id: string) {
  return db.prepare("SELECT * FROM sessions WHERE id = ?").bind(id).first<{
    id: string;
    user_id: string;
    status: string;
    expires_at: number;
  }>();
}

export async function revokeSession(db: D1Database, id: string, reason: string) {
  await db.prepare(`
    UPDATE sessions
    SET status = 'REVOKED', revoke_reason = ?
    WHERE id = ? AND status = 'ACTIVE'
  `).bind(reason, id).run();
}

export async function recoverSession(db: D1Database, id: string, nowMs: number) {
  const session = await getSession(db, id);
  if (!session) return null;
  if (session.status !== 'ACTIVE' || session.expires_at < nowMs) {
    return null;
  }
  
  // Note: we might update last_seen_at here, but keeping it simple for the test
  return session;
}
