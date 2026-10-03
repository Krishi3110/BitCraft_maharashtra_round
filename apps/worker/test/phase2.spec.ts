import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { createUser } from "../src/db/users";
import { createSession, recoverSession, revokeSession } from "../src/db/sessions";
import sql0 from "../../../database/migrations/0000_init.sql?raw";
import sql1 from "../../../database/migrations/0001_phase2.sql?raw";

function stripCommentsAndRun(sql: string) {
  const statements = sql
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);
  
  const batch = statements.map(s => env.DB.prepare(s));
  return env.DB.batch(batch);
}

describe("Phase 2 - Data Model & Persistence", () => {
  beforeAll(async () => {
    // Run D1 migrations manually for the test database
    await stripCommentsAndRun(sql0);
    await stripCommentsAndRun(sql1);
  });

  it("FUTUREFEST seed exists in D1", async () => {
    const event = await env.DB.prepare("SELECT * FROM events WHERE id = 'futurefest-2026'").first();
    expect(event).toBeDefined();
    expect(event?.name).toBe("FUTUREFEST 2026");

    const drop = await env.DB.prepare("SELECT * FROM drops WHERE id = 'drp_futurefest2026_1'").first();
    expect(drop).toBeDefined();
    expect(drop?.total_inventory).toBe(500);
    expect(drop?.mode).toBe("FAIR");
  });

  it("User constraints: one account per normalized email", async () => {
    const emailHash = "hash123";
    const res1 = await createUser(env.DB, "usr_1", emailHash, "Alice", Date.now());
    expect(res1).toBe(true);

    const res2 = await createUser(env.DB, "usr_2", emailHash, "Alice Dup", Date.now());
    expect(res2).toBe(false); // rejected/deduplicated
  });

  it("Session persistence and revocation flow", async () => {
    const userId = "usr_1"; // created in previous test
    const sessionId = "ses_1";
    const now = Date.now();
    const expires = now + 86400000;

    // create session
    await createSession(env.DB, sessionId, userId, now, expires);

    // recover session
    const recovered = await recoverSession(env.DB, sessionId, now);
    expect(recovered).toBeDefined();
    expect(recovered?.id).toBe(sessionId);

    // revoke session
    await revokeSession(env.DB, sessionId, "user_logout");

    // request again -> verify revoked state is rejected
    const recoveredAfterRevoke = await recoverSession(env.DB, sessionId, now);
    expect(recoveredAfterRevoke).toBeNull();
  });

  it("DropDO live state persists across separate DO requests/instances", async () => {
    const id = env.DROP_DO.idFromName("drp_futurefest2026_1");
    
    // First request
    let stub = env.DROP_DO.get(id);

    // In Phase 3, tickets are initialized on DRAFT -> SCHEDULED, so we must trigger it.
    await stub.fetch("http://do/config", { method: "POST", body: JSON.stringify({ total_inventory: 500 }) });
    await stub.fetch("http://do/transition", { method: "POST", body: JSON.stringify({ to: "SCHEDULED" }) });

    let resp = await stub.fetch("http://do/test/state");
    expect(resp.status).toBe(200);
    let json: any = await resp.json();
    
    expect(json.tables).toContain("participants");
    expect(json.tables).toContain("tickets");
    expect(json.tickets).toBe(500); // verify inventory = 500

    // Second request to same ID (proves persistence/schema works)
    stub = env.DROP_DO.get(id);
    resp = await stub.fetch("http://do/test/state");
    json = await resp.json();
    expect(json.tickets).toBe(500);
  });
});
