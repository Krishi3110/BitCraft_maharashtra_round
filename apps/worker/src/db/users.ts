export async function createUser(
  db: D1Database,
  id: string,
  emailHash: string,
  displayName: string,
  nowMs: number
) {
  try {
    await db.prepare(`
      INSERT INTO users (id, email_hash, display_name, created_at, status)
      VALUES (?, ?, ?, ?, 'ACTIVE')
    `).bind(id, emailHash, displayName, nowMs).run();
    return true;
  } catch (e: any) {
    if (e.message.includes("UNIQUE constraint failed")) {
      return false; // deduplicated/rejected
    }
    throw e;
  }
}

export async function getUser(db: D1Database, id: string) {
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
}
