import { DurableObject } from "cloudflare:workers";
import { Env } from "../index";
import { StateMachine } from "./lifecycle/StateMachine";
import { DropState } from "shared";

export class DropDO extends DurableObject {
  private sm: StateMachine;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sm = new StateMachine(this.ctx.storage.sql);
    this.initializeSchema();
  }

  private initializeSchema() {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v_json TEXT);
      CREATE TABLE IF NOT EXISTS participants (id TEXT PRIMARY KEY, participant_key TEXT UNIQUE NOT NULL, status TEXT NOT NULL, registered_at INTEGER NOT NULL, device_id TEXT, network_key TEXT);
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

  private async advanceClock(now: number) {
    const meta = this.sm.getMeta();
    if (meta.state === 'HALTED') return; // Cannot advance clock on a halted drop
    
    const config = meta.config;
    if (!config) return;

    this.ctx.storage.transactionSync(() => {
      let changed = false;
      if (meta.state === 'SCHEDULED' && now >= config.opens_at) {
        if (config.mode === 'FAIR') {
          this.sm.transition('REGISTRATION_OPEN', now);
        } else {
          this.sm.transition('BOOKING_OPEN', now);
        }
        changed = true;
      }
      
      const currentState = this.sm.getMeta().state;
      
      if (currentState === 'REGISTRATION_OPEN' && now >= config.registration_closes_at) {
        this.sm.transition('REGISTRATION_CLOSED', now);
        this.sm.transition('BOOKING_OPEN', now);
        changed = true;
      } else if (currentState === 'BOOKING_OPEN' && now >= config.booking_closes_at) {
        this.sm.transition('CLOSED', now);
        changed = true;
      }

      if (changed) {
        this.scheduleNextAlarm(now);
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ping") return new Response("pong");
    
    if (url.pathname === "/state") {
      const meta = this.sm.getMeta();
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
        this.ctx.storage.transactionSync(() => {
          success = this.sm.transition(body.to, now, body);
          if (success) {
            this.scheduleNextAlarm(now);
          }
        });
      } catch (err: any) {
        // 409 INVALID_STATE semantic for guard failures
        if (err.message.includes("Only FAIR mode") || 
            err.message.includes("Only NAIVE mode") || 
            err.message.includes("Invalid configuration") || 
            err.message.includes("No snapshot")) {
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
    
    // Testing route
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
