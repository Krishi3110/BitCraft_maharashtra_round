import { DropState, DropConfig, DropMeta, AllocationResult } from "shared";

export class StateMachine {
  constructor(private sql: any, private dropId: string) {}

  // Read the full meta state
  getMeta(): DropMeta {
    const cursor = this.sql.exec("SELECT k, v_json FROM meta");
    const meta: Partial<DropMeta> = {};
    for (const row of cursor) {
      meta[(row as any).k as keyof DropMeta] = JSON.parse((row as any).v_json);
    }
    
    return {
      state: meta.state || 'DRAFT',
      config: meta.config || null,
      server_seed: meta.server_seed || null,
      seed_commitment: meta.seed_commitment || null,
      snapshot_hash: meta.snapshot_hash || null,
      result_hash: meta.result_hash || null,
      allocation_committed_at: meta.allocation_committed_at || null,
    };
  }

  // Update a specific meta key
  private updateMeta(k: string, v: any) {
    this.sql.exec("INSERT INTO meta (k, v_json) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v_json = excluded.v_json", k, JSON.stringify(v));
  }
  
  private updateParticipant(participantKey: string, status: string, now: number) {
    this.sql.exec("UPDATE participants SET status = ?, updated_at = ?, version = version + 1 WHERE participant_key = ?", status, now, participantKey);
    const row = this.sql.exec("SELECT version FROM participants WHERE participant_key = ?", participantKey).next().value;
    if (row) {
      const eventId = crypto.randomUUID();
      this.sql.exec(
        "INSERT INTO outbox2 (event_id, drop_id, participant_id, participant_version, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        eventId, this.dropId, participantKey, (row as any).version, 'STATUS_UPDATED', JSON.stringify({ status }), now
      );
    }
  }

  // Apply allocation results atomically
  applyAllocation(result: AllocationResult, now: number) {
    // 1. Mark winners as ALLOCATED
    for (const participantId of result.winners) {
      this.updateParticipant(participantId, 'ALLOCATED', now);
    }
    // 2. Mark losers as WAITLISTED
    for (let i = 0; i < result.waitlist.length; i++) {
      const participantId = result.waitlist[i];
      // We could also store waitlist rank, but for Phase 4 we just mark them WAITLISTED.
      this.updateParticipant(participantId, 'WAITLISTED', now);
    }
    // 3. Update meta with audit values
    this.updateMeta('snapshot_hash', result.snapshotHash);
    this.updateMeta('result_hash', result.resultHash);
    this.updateMeta('allocation_committed_at', now);
  }

  // Transition logic
  transition(to: DropState, now: number, payload?: any): boolean {
    const meta = this.getMeta();
    const from = meta.state;
    
    if (from === to) return true; // Idempotent

    // Guard matrix and side-effects
    if (from === 'DRAFT' && to === 'SCHEDULED') {
      if (!meta.config || meta.config.total_inventory <= 0) {
        throw new Error("Invalid configuration for SCHEDULED");
      }
      if (!payload?.server_seed || !payload?.seed_commitment) {
        throw new Error("Missing cryptographic seed payload for SCHEDULED");
      }
      
      this.updateMeta('state', 'SCHEDULED');
      
      const count = meta.config.total_inventory;
      let values = [];
      for (let i = 1; i <= count; i++) {
        values.push(`(${i}, 'AVAILABLE', ${now})`);
      }
      if (values.length > 0) {
        this.sql.exec(`INSERT OR IGNORE INTO tickets (seq, status, updated_at) VALUES ${values.join(',')}`);
      }
      
      this.updateMeta('server_seed', payload.server_seed);
      this.updateMeta('seed_commitment', payload.seed_commitment);
      
      this.sql.exec("INSERT INTO outbox (payload_json) VALUES (?)", JSON.stringify({ type: 'TRANSITION', to }));
      
      return true;
    }
    
    if (from === 'SCHEDULED' && to === 'REGISTRATION_OPEN') {
      if (meta.config?.mode !== 'FAIR') throw new Error("Only FAIR mode supports registration");
      this.updateMeta('state', 'REGISTRATION_OPEN');
      this.sql.exec("INSERT INTO outbox (payload_json) VALUES (?)", JSON.stringify({ type: 'TRANSITION', to }));
      return true;
    }
    
    if (from === 'SCHEDULED' && to === 'BOOKING_OPEN') {
      if (meta.config?.mode !== 'NAIVE') throw new Error("Only NAIVE mode jumps to booking directly");
      this.updateMeta('state', 'BOOKING_OPEN');
      this.sql.exec("INSERT INTO outbox (payload_json) VALUES (?)", JSON.stringify({ type: 'TRANSITION', to }));
      return true;
    }

    if (from === 'REGISTRATION_OPEN' && to === 'REGISTRATION_CLOSED') {
      this.updateMeta('state', 'REGISTRATION_CLOSED');
      this.sql.exec("INSERT INTO outbox (payload_json) VALUES (?)", JSON.stringify({ type: 'TRANSITION', to }));
      return true;
    }

    if (from === 'REGISTRATION_CLOSED' && to === 'BOOKING_OPEN') { // ALLOCATING merged into BOOKING_OPEN
      if (!payload?.allocationResult) throw new Error("Missing allocation result");
      
      this.applyAllocation(payload.allocationResult, now);
      
      this.updateMeta('state', 'BOOKING_OPEN');
      this.sql.exec("INSERT INTO outbox (payload_json) VALUES (?)", JSON.stringify({ type: 'TRANSITION', to }));
      return true;
    }

    if (from === 'BOOKING_OPEN' && to === 'CLOSED') {
      this.updateMeta('state', 'CLOSED');
      this.sql.exec("INSERT INTO outbox (payload_json) VALUES (?)", JSON.stringify({ type: 'TRANSITION', to }));
      return true;
    }
    
    if ((from === 'DRAFT' || from === 'SCHEDULED') && to === 'CANCELLED') {
      this.updateMeta('state', 'CANCELLED');
      this.sql.exec("INSERT INTO outbox (payload_json) VALUES (?)", JSON.stringify({ type: 'TRANSITION', to }));
      return true;
    }

    if (to === 'HALTED') {
      this.updateMeta('state', 'HALTED');
      this.sql.exec("INSERT INTO outbox (payload_json) VALUES (?)", JSON.stringify({ type: 'CRITICAL', reason: payload?.reason || "Invariant breach" }));
      return true;
    }

    if (from === 'HALTED' && to === 'CLOSED') {
      this.updateMeta('state', 'CLOSED');
      this.sql.exec("INSERT INTO outbox (payload_json) VALUES (?)", JSON.stringify({ type: 'TRANSITION', to }));
      return true;
    }

    return false; // Illegal transition
  }
}
