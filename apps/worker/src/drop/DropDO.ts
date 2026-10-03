import { DurableObject } from "cloudflare:workers";
import { Env } from "../index";
import { StateMachine } from "./lifecycle/StateMachine";
import { DropState } from "shared";
import { generateServerSeed, computeSeedCommitment, allocate } from "shared";

export class DropDO extends DurableObject {
  private sm: StateMachine;
  private activeTransitions = new Map<DropState, Promise<boolean>>();
  private dropId: string;
  private flushActive = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.dropId = (this.ctx.id as any).name || this.ctx.id.toString();
    this.sm = new StateMachine(this.ctx.storage.sql, this.dropId);
    this.initializeSchema();
    this.checkPendingOutbox();
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

      CREATE TABLE IF NOT EXISTS outbox2 (
        event_id TEXT PRIMARY KEY, 
        drop_id TEXT NOT NULL, 
        participant_id TEXT NOT NULL, 
        participant_version INTEGER NOT NULL, 
        event_type TEXT NOT NULL, 
        payload TEXT NOT NULL, 
        created_at INTEGER NOT NULL
      );
    `);

    try {
      this.ctx.storage.sql.exec("ALTER TABLE participants ADD COLUMN version INTEGER NOT NULL DEFAULT 1");
    } catch (e) {
      // Ignored if column already exists
    }
  }

  private checkPendingOutbox() {
    const row = this.ctx.storage.sql.exec("SELECT 1 FROM outbox2 LIMIT 1").next().value;
    if (row) {
      this.triggerFlush();
    }
  }

  private triggerFlush() {
    if (!this.flushActive) {
      this.flushActive = true;
      this.ctx.waitUntil(this.flushOutbox());
    }
  }

  private async flushOutbox() {
    try {
      while (true) {
        const rows = [...this.ctx.storage.sql.exec("SELECT * FROM outbox2 ORDER BY created_at ASC LIMIT 100")];
        if (rows.length === 0) break;

        const statements: any[] = [];
        for (const r of rows as any[]) {
          statements.push(
            (this.env as Env).DB.prepare(
              `INSERT INTO status_projections (drop_id, participant_id, version, status, payload, updated_at)
               VALUES (?, ?, ?, ?, ?, datetime('now'))
               ON CONFLICT(drop_id, participant_id) DO UPDATE SET
                 status = excluded.status,
                 payload = excluded.payload,
                 version = excluded.version,
                 updated_at = excluded.updated_at
               WHERE excluded.version > status_projections.version`
            ).bind(r.drop_id, r.participant_id, r.participant_version, JSON.parse(r.payload).status || 'REGISTERED', r.payload)
          );
        }

        await (this.env as Env).DB.batch(statements);

        const eventIds = rows.map((r: any) => `'${r.event_id}'`).join(',');
        this.ctx.storage.transactionSync(() => {
          this.ctx.storage.sql.exec(`DELETE FROM outbox2 WHERE event_id IN (${eventIds})`);
        });
      }
    } catch (err) {
      console.error("Outbox flush failed", err);
      // Alarm based retry
      this.ctx.storage.setAlarm(Date.now() + 5000);
    } finally {
      this.flushActive = false;
    }
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

  private expireStaleReservations(now: number) {
    const expiredCursor = this.ctx.storage.sql.exec("SELECT id, participant_id, ticket_id FROM reservations WHERE status = 'HELD' AND expires_at < ? LIMIT 100", now);
    let expiredCount = 0;
    
    for (const row of expiredCursor) {
      expiredCount++;
      const { id, participant_id, ticket_id } = row as any;
      
      this.ctx.storage.sql.exec("UPDATE reservations SET status = 'EXPIRED' WHERE id = ?", id);
      this.ctx.storage.sql.exec("UPDATE tickets SET status = 'AVAILABLE', holder_participant_id = NULL, updated_at = ? WHERE status = 'RESERVED' AND holder_participant_id = ?", now, participant_id);
      
      this.ctx.storage.sql.exec("UPDATE participants SET updated_at = ?, version = version + 1 WHERE participant_key = ?", now, participant_id);
      const pRow = this.ctx.storage.sql.exec("SELECT version FROM participants WHERE participant_key = ?", participant_id).next().value;
      
      const payloadObj = {
        status: 'ALLOCATED',
        reservation_status: 'EXPIRED'
      };
      
      const eventId = crypto.randomUUID();
      this.ctx.storage.sql.exec(
        "INSERT INTO outbox2 (event_id, drop_id, participant_id, participant_version, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        eventId, this.dropId, participant_id, (pRow as any).version, 'STATUS_UPDATED', JSON.stringify(payloadObj), now
      );
    }
    
    if (expiredCount > 0) {
      this.triggerFlush();
      if (expiredCount === 100) {
        this.ctx.storage.setAlarm(Date.now() + 100);
      }
    }
  }

  async alarm() {
    const row = this.ctx.storage.sql.exec("SELECT 1 FROM outbox2 LIMIT 1").next().value;
    if (row) {
      this.triggerFlush();
    }
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.expireStaleReservations(now);
    });
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
    
    // Always trigger flush after transition sync, as it might have created outbox events
    this.triggerFlush();
    
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
    
    if (url.pathname === "/join" && request.method === "POST") {
      const participantId = request.headers.get("X-Participant-Id");
      if (!participantId) return new Response("Unauthorized", { status: 401 });

      if (this.sm.getMeta().state !== 'REGISTRATION_OPEN') {
        return new Response(JSON.stringify({ error: "INVALID_STATE", details: "Registration is not open" }), { status: 409 });
      }

      const now = Date.now();
      let status = 'REGISTERED';
      this.ctx.storage.transactionSync(() => {
        const row = this.ctx.storage.sql.exec("SELECT status FROM participants WHERE participant_key = ?", participantId).next().value;
        if (row) {
          status = (row as any).status;
        } else {
          const id = crypto.randomUUID();
          this.ctx.storage.sql.exec(
            "INSERT INTO participants (id, participant_key, status, registered_at, updated_at, version) VALUES (?, ?, 'REGISTERED', ?, ?, 1)",
            id, participantId, now, now
          );
          const eventId = crypto.randomUUID();
          this.ctx.storage.sql.exec(
            "INSERT INTO outbox2 (event_id, drop_id, participant_id, participant_version, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            eventId, this.dropId, participantId, 1, 'STATUS_UPDATED', JSON.stringify({ status: 'REGISTERED' }), now
          );
        }
      });
      this.triggerFlush();
      return new Response(JSON.stringify({ status, participant_id: participantId }), { headers: { "Content-Type": "application/json" } });
    }

    if (url.pathname === "/reserve" && request.method === "POST") {
      const participantId = request.headers.get("X-Participant-Id");
      if (!participantId) return new Response("Unauthorized", { status: 401 });

      const meta = this.sm.getMeta();
      if (meta.state !== 'BOOKING_OPEN') {
        return new Response(JSON.stringify({ error: "INVALID_STATE", details: "Booking is not open" }), { status: 409 });
      }

      let resPayload: any = null;
      let status = 400;

      const now = Date.now();
      let shouldArmAlarm = false;
      let alarmTime = 0;

      this.ctx.storage.transactionSync(() => {
        this.expireStaleReservations(now);

        const pRow = this.ctx.storage.sql.exec("SELECT status, version FROM participants WHERE participant_key = ?", participantId).next().value;
        if (!pRow) {
          status = 404;
          resPayload = { error: "NOT_FOUND", details: "Participant not found" };
          return;
        }
        if ((pRow as any).status !== 'ALLOCATED') {
          status = 403;
          resPayload = { error: "FORBIDDEN", details: "Participant is not ALLOCATED" };
          return;
        }

        const rRow = this.ctx.storage.sql.exec("SELECT ticket_id, status, expires_at FROM reservations WHERE participant_id = ? AND status IN ('HELD', 'CONFIRMED')", participantId).next().value;
        if (rRow) {
          status = 200;
          resPayload = {
            status: 'ALLOCATED',
            ticket_id: (rRow as any).ticket_id,
            reservation_status: (rRow as any).status,
            expires_at: (rRow as any).expires_at
          };
          return;
        }

        // Enforce configurable maximum hold-attempt policy to limit hold-hogging
        const expiredCountCursor = this.ctx.storage.sql.exec("SELECT count(*) as c FROM reservations WHERE participant_id = ? AND status = 'EXPIRED'", participantId).next().value;
        const expiredCount = (expiredCountCursor as any)?.c || 0;
        const maxHolds = meta.config?.config_json?.max_holds_per_participant || 3;
        
        if (expiredCount >= maxHolds) {
          status = 429;
          resPayload = { error: "TOO_MANY_REQUESTS", details: "Maximum hold attempts exceeded." };
          return;
        }

        const tRow = this.ctx.storage.sql.exec("SELECT seq FROM tickets WHERE status = 'AVAILABLE' ORDER BY seq ASC LIMIT 1").next().value;
        if (!tRow) {
          status = 409;
          resPayload = { error: "SOLD_OUT", details: "No tickets available" };
          return;
        }
        
        const ticketSeq = (tRow as any).seq;
        const ticketId = `tkt_${ticketSeq}`;
        const holdTtl = meta.config?.hold_ttl_ms || 900000;
        const expiresAt = now + holdTtl;
        const resId = crypto.randomUUID();

        this.ctx.storage.sql.exec("UPDATE tickets SET status = 'RESERVED', holder_participant_id = ?, updated_at = ? WHERE seq = ?", participantId, now, ticketSeq);
        this.ctx.storage.sql.exec(
          "INSERT INTO reservations (id, participant_id, ticket_id, status, expires_at) VALUES (?, ?, ?, 'HELD', ?)",
          resId, participantId, ticketId, expiresAt
        );

        this.ctx.storage.sql.exec("UPDATE participants SET updated_at = ?, version = version + 1 WHERE participant_key = ?", now, participantId);
        const newVersion = (pRow as any).version + 1;
        
        const payloadObj = {
          status: 'ALLOCATED',
          ticket_id: ticketId,
          reservation_status: 'HELD',
          expires_at: expiresAt
        };
        
        const eventId = crypto.randomUUID();
        this.ctx.storage.sql.exec(
          "INSERT INTO outbox2 (event_id, drop_id, participant_id, participant_version, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          eventId, this.dropId, participantId, newVersion, 'STATUS_UPDATED', JSON.stringify(payloadObj), now
        );

        status = 200;
        resPayload = payloadObj;
        shouldArmAlarm = true;
        alarmTime = expiresAt;
      });
      
      this.triggerFlush();
      if (shouldArmAlarm) {
        // Simple alarm arming
        this.ctx.storage.setAlarm(alarmTime);
      }
      return new Response(JSON.stringify(resPayload), { status, headers: { "Content-Type": "application/json" } });
    }

    if (url.pathname === "/confirm" && request.method === "POST") {
      const participantId = request.headers.get("X-Participant-Id");
      if (!participantId) return new Response("Unauthorized", { status: 401 });

      let resPayload: any = null;
      let status = 400;

      const now = Date.now();
      this.ctx.storage.transactionSync(() => {
        this.expireStaleReservations(now);

        const rRow = this.ctx.storage.sql.exec("SELECT id, status, expires_at FROM reservations WHERE participant_id = ? AND status IN ('HELD', 'CONFIRMED')", participantId).next().value;
        if (!rRow) {
          status = 404;
          resPayload = { error: "NOT_FOUND", details: "No active reservation" };
          return;
        }

        if ((rRow as any).status === 'CONFIRMED') {
          status = 200;
          resPayload = { status: 'CONFIRMED' };
          return;
        }

        if (now > (rRow as any).expires_at) {
          status = 400;
          resPayload = { error: "EXPIRED", details: "Reservation has expired" };
          return;
        }

        const resId = (rRow as any).id;
        
        this.ctx.storage.sql.exec("UPDATE reservations SET status = 'CONFIRMED', confirmed_at = ? WHERE id = ?", now, resId);
        this.ctx.storage.sql.exec("UPDATE tickets SET status = 'SOLD', updated_at = ? WHERE holder_participant_id = ?", now, participantId);
        this.ctx.storage.sql.exec("UPDATE participants SET status = 'CONFIRMED', updated_at = ?, version = version + 1 WHERE participant_key = ?", now, participantId);
        
        const pRow = this.ctx.storage.sql.exec("SELECT version FROM participants WHERE participant_key = ?", participantId).next().value;
        
        const payloadObj = { status: 'CONFIRMED' };
        
        const eventId = crypto.randomUUID();
        this.ctx.storage.sql.exec(
          "INSERT INTO outbox2 (event_id, drop_id, participant_id, participant_version, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          eventId, this.dropId, participantId, (pRow as any).version, 'STATUS_UPDATED', JSON.stringify(payloadObj), now
        );

        status = 200;
        resPayload = payloadObj;
      });

      this.triggerFlush();
      return new Response(JSON.stringify(resPayload), { status, headers: { "Content-Type": "application/json" } });
    }
    
    // Test endpoint to add participants manually to DO state
    if (url.pathname === "/test/register" && request.method === "POST") {
      const body = await request.json<{participant_key: string}>();
      
      // Concurrency/Correctness guard: Registration must be closed before snapshot finalized.
      // Re-enforce strictly that no test registrations can occur unless OPEN.
      if (this.sm.getMeta().state !== 'REGISTRATION_OPEN') {
        return new Response(JSON.stringify({error: "INVALID_STATE", details: "Registration is not open"}), { status: 409 });
      }

      const now = Date.now();
      this.ctx.storage.transactionSync(() => {
        const id = "p_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
        this.ctx.storage.sql.exec("INSERT OR IGNORE INTO participants (id, participant_key, status, registered_at, updated_at, version) VALUES (?, ?, 'REGISTERED', ?, ?, 1)", id, body.participant_key, now, now);
        
        // Push outbox2 event
        const eventId = crypto.randomUUID();
        this.ctx.storage.sql.exec(
          "INSERT INTO outbox2 (event_id, drop_id, participant_id, participant_version, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          eventId, this.dropId, body.participant_key, 1, 'STATUS_UPDATED', JSON.stringify({ status: 'REGISTERED' }), now
        );
      });
      
      this.triggerFlush();
      
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

