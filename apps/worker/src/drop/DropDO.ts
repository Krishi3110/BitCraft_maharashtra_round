import { DurableObject } from "cloudflare:workers";
import { Env } from "../index";
import { StateMachine } from "./lifecycle/StateMachine";
import { DropState } from "shared";
import { generateServerSeed, computeSeedCommitment, allocate } from "shared";

export class DropDO extends DurableObject {
  private sm: StateMachine;
  private activeTransitions = new Map<DropState, Promise<boolean>>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sm = new StateMachine(this.ctx.storage.sql);
    this.initializeSchema();
  }

  private initializeSchema() {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v_json TEXT);
      CREATE TABLE IF NOT EXISTS participants (id TEXT PRIMARY KEY, participant_key TEXT UNIQUE NOT NULL, status TEXT NOT NULL, registered_at INTEGER NOT NULL, device_id TEXT, network_key TEXT, updated_at INTEGER);
      CREATE INDEX IF NOT EXISTS idx_do_participants_status ON participants(status);
      CREATE TABLE IF NOT EXISTS participant_chunks (chunk_index INTEGER PRIMARY KEY, data_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tickets (seq INTEGER PRIMARY KEY, status TEXT NOT NULL, holder_participant_id TEXT, updated_at INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_do_tickets_holder ON tickets(holder_participant_id) WHERE holder_participant_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, participant_id TEXT NOT NULL, ticket_id TEXT NOT NULL, status TEXT NOT NULL, expires_at INTEGER NOT NULL, confirmed_at INTEGER);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_do_reservations_active ON reservations(participant_id) WHERE status IN ('HELD', 'CONFIRMED');
      CREATE INDEX IF NOT EXISTS idx_do_reservations_status_expires ON reservations(status, expires_at);
      CREATE TABLE IF NOT EXISTS idempotency (participant_id TEXT NOT NULL, key TEXT NOT NULL, response_json TEXT NOT NULL, PRIMARY KEY (participant_id, key));
      CREATE TABLE IF NOT EXISTS outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, payload_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS risk_state (subject_ref TEXT PRIMARY KEY, last_action TEXT NOT NULL, updated_at INTEGER NOT NULL);
    `);
  }

  private scheduleNextAlarm(now: number) {
    const meta = this.sm.getMeta();
    const config = meta.config;
    if (!config || config.clock_mode === 'VIRTUAL') {
      return; 
    }

    let nextTick = null;
    if (meta.state === 'SCHEDULED' && config.opens_at > now) {
      nextTick = config.opens_at;
    } else if (meta.state === 'REGISTRATION_OPEN' && config.registration_closes_at > now) {
      nextTick = config.registration_closes_at;
    } else if (meta.state === 'BOOKING_OPEN' && config.booking_closes_at > now) {
      nextTick = config.booking_closes_at;
    }

    if (nextTick) {
      this.ctx.storage.setAlarm(nextTick);
    }
  }

  async alarm() {
    const now = Date.now();
    await this.advanceClock(now);
  }
  
  private async triggerTransition(to: DropState, now: number, payload?: any): Promise<boolean> {
    if (this.activeTransitions.has(to)) {
      return this.activeTransitions.get(to)!;
    }
    const p = this._triggerTransition(to, now, payload);
    this.activeTransitions.set(to, p);
    try {
      return await p;
    } finally {
      this.activeTransitions.delete(to);
    }
  }

  private async _triggerTransition(to: DropState, now: number, payload?: any): Promise<boolean> {
    // Check if it's DRAFT -> SCHEDULED, we need async crypto logic outside transactionSync
    let enhancedPayload = payload || {};
    if (to === 'SCHEDULED' && this.sm.getMeta().state === 'DRAFT') {
       const server_seed = await generateServerSeed();
       const seed_commitment = await computeSeedCommitment(server_seed);
       enhancedPayload = { ...enhancedPayload, server_seed, seed_commitment };
    }
    
    // Check if it's REGISTRATION_CLOSED -> BOOKING_OPEN, we need async allocation
    if (to === 'BOOKING_OPEN' && this.sm.getMeta().state === 'REGISTRATION_CLOSED') {
       const meta = this.sm.getMeta();
       if (!meta.config) throw new Error("No config");
       
       // Sync fetch participants
       const participantsCursor = this.ctx.storage.sql.exec("SELECT participant_key FROM participants WHERE status = 'REGISTERED'");
       const participantKeys: string[] = [];
       for (const row of participantsCursor) {
         participantKeys.push((row as any).participant_key);
       }
       
       if (!meta.server_seed) throw new Error("No server seed found");
       
       // Async allocate
       const allocationResult = await allocate(participantKeys, meta.server_seed, meta.config.total_inventory);
       enhancedPayload = { ...enhancedPayload, allocationResult };
    }

    let success = false;
    this.ctx.storage.transactionSync(() => {
      // Final atomic compare-and-commit within the transaction
      success = this.sm.transition(to, now, enhancedPayload);
      if (success) {
        this.scheduleNextAlarm(now);
      }
    });
    return success;
  }

  private async advanceClock(now: number) {
    const meta = this.sm.getMeta();
    if (meta.state === 'HALTED') return; 
    
    const config = meta.config;
    if (!config) return;

    let currentState = meta.state;
    let changed = false;

    if (currentState === 'SCHEDULED' && now >= config.opens_at) {
      if (config.mode === 'FAIR') {
        await this.triggerTransition('REGISTRATION_OPEN', now);
        currentState = 'REGISTRATION_OPEN';
      } else {
        await this.triggerTransition('BOOKING_OPEN', now);
        currentState = 'BOOKING_OPEN';
      }
      changed = true;
    }
      
    if (currentState === 'REGISTRATION_OPEN' && now >= config.registration_closes_at) {
      await this.triggerTransition('REGISTRATION_CLOSED', now);
      currentState = 'REGISTRATION_CLOSED';
      changed = true;
    }
    
    // Automatic cascade from CLOSED to ALLOCATING (BOOKING_OPEN)
    if (currentState === 'REGISTRATION_CLOSED') {
      await this.triggerTransition('BOOKING_OPEN', now);
      currentState = 'BOOKING_OPEN';
      changed = true;
    }
    
    if (currentState === 'BOOKING_OPEN' && now >= config.booking_closes_at) {
      await this.triggerTransition('CLOSED', now);
      currentState = 'CLOSED';
      changed = true;
    }

    if (changed) {
      this.scheduleNextAlarm(now);
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ping") return new Response("pong");
    
    if (url.pathname === "/state") {
      const meta = this.sm.getMeta() as any;
      
      // SEED REDACTION LOGIC
      // server_seed is only revealed when allocation is committed (BOOKING_OPEN or later)
      if (meta.state !== 'BOOKING_OPEN' && meta.state !== 'CLOSED') {
        delete meta.server_seed;
      }
      
      return new Response(JSON.stringify(meta), { headers: { "Content-Type": "application/json" }});
    }

    if (url.pathname === "/config" && request.method === "POST") {
      const payload = await request.json<any>();
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec("INSERT INTO meta (k, v_json) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v_json = excluded.v_json", 'config', JSON.stringify(payload));
      });
      return new Response("OK");
    }

    if (url.pathname === "/transition" && request.method === "POST") {
      const body = await request.json<{to: DropState, virtual_now?: number, reason?: string}>();
      const now = body.virtual_now ?? Date.now();
      const currentState = this.sm.getMeta().state;
      
      // 503 HALTED semantic
      if (currentState === 'HALTED' && body.to !== 'CLOSED' && body.to !== 'HALTED') {
        return new Response(JSON.stringify({error: "HALTED", details: "Drop is halted"}), { status: 503 });
      }

      let success = false;
      try {
        success = await this.triggerTransition(body.to, now, body);
      } catch (err: any) {
        // 409 INVALID_STATE semantic for guard failures
        if (err.message.includes("Only FAIR mode") || 
            err.message.includes("Only NAIVE mode") || 
            err.message.includes("Invalid configuration") || 
            err.message.includes("No snapshot") ||
            err.message.includes("Missing cryptographic")) {
          return new Response(JSON.stringify({error: "INVALID_STATE", details: err.message}), { status: 409 });
        }
        // Generic exceptions should be 500
        return new Response(JSON.stringify({error: "INTERNAL_ERROR", details: err.message}), { status: 500 });
      }

      // 409 INVALID_STATE for missing transitions (from/to mismatch)
      if (!success) {
        return new Response(JSON.stringify({error: "INVALID_STATE", details: "Illegal transition"}), { status: 409 });
      }
      
      return new Response("OK");
    }

    if (url.pathname === "/advance" && request.method === "POST") {
      const body = await request.json<{virtual_now: number}>();
      await this.advanceClock(body.virtual_now);
      return new Response("OK");
    }
    
    // Test endpoint to add participants manually to DO state
    if (url.pathname === "/test/register" && request.method === "POST") {
      const body = await request.json<{participant_key: string}>();
      
      // Concurrency/Correctness guard: Registration must be closed before snapshot finalized.
      // Re-enforce strictly that no test registrations can occur unless OPEN.
      if (this.sm.getMeta().state !== 'REGISTRATION_OPEN') {
        return new Response(JSON.stringify({error: "INVALID_STATE", details: "Registration is not open"}), { status: 409 });
      }

      this.ctx.storage.transactionSync(() => {
        const id = "p_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
        this.ctx.storage.sql.exec("INSERT OR IGNORE INTO participants (id, participant_key, status, registered_at, updated_at) VALUES (?, ?, 'REGISTERED', ?, ?)", id, body.participant_key, Date.now(), Date.now());
      });
      return new Response("OK");
    }

    if (url.pathname === "/test/state") {
      const tickets = this.ctx.storage.sql.exec("SELECT COUNT(*) as c FROM tickets").next().value;
      const tablesCursor = this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table'");
      const tables = [...tablesCursor].map((r: any) => r.name);
      return new Response(JSON.stringify({ tickets: (tickets as any)?.c || 0, tables }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/test/tickets") {
      const tickets = this.ctx.storage.sql.exec("SELECT COUNT(*) as c FROM tickets").next().value;
      return new Response(JSON.stringify({ tickets: (tickets as any)?.c || 0 }));
    }

    return new Response("Not found", { status: 404 });
  }
}
