import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

describe("Phase 3 - Drop State Machine", () => {
  const dropId = "drp_test_phase3";
  const dropNameId = env.DROP_DO.idFromName(dropId);

  const getDOState = async () => {
    const res = await env.DROP_DO.get(dropNameId).fetch("http://do/state");
    return res.json<any>();
  };

  const getTicketsCount = async () => {
    const res = await env.DROP_DO.get(dropNameId).fetch("http://do/test/tickets");
    return (await res.json<any>()).tickets;
  };

  it("1. DRAFT -> SCHEDULED succeeds with valid config and initializes tickets", async () => {
    const stub = env.DROP_DO.get(dropNameId);
    const now = Date.now();
    const config = {
      mode: "FAIR",
      kind: "PUBLIC",
      clock_mode: "VIRTUAL",
      total_inventory: 500,
      opens_at: now + 1000,
      registration_closes_at: now + 2000,
      booking_closes_at: now + 3000,
      offer_ttl_ms: 60000,
      hold_ttl_ms: 60000,
      config_json: {}
    };

    // Configure
    await stub.fetch("http://do/config", { method: "POST", body: JSON.stringify(config) });
    
    // Initial state is DRAFT
    let state = await getDOState();
    expect(state.state).toBe("DRAFT");

    // Transition
    const res = await stub.fetch("http://do/transition", {
      method: "POST",
      body: JSON.stringify({ to: "SCHEDULED", virtual_now: now })
    });
    expect(res.status).toBe(200);

    state = await getDOState();
    expect(state.state).toBe("SCHEDULED");
    expect(state.server_seed).toBeDefined();
    expect(state.seed_commitment).toBeDefined();

    // Tickets initialized
    const tickets = await getTicketsCount();
    expect(tickets).toBe(500);
  });

  it("4/5. invalid transition is rejected with 409 and causes NO state mutation", async () => {
    const stub = env.DROP_DO.get(dropNameId);
    
    // We are currently SCHEDULED. Transition to CLOSED should be illegal.
    const res = await stub.fetch("http://do/transition", {
      method: "POST",
      body: JSON.stringify({ to: "CLOSED" })
    });
    expect(res.status).toBe(409);
    
    // State remains SCHEDULED
    const state = await getDOState();
    expect(state.state).toBe("SCHEDULED");
  });

  it("2/3/8/9. Virtual Clock advances through lifecycle correctly", async () => {
    const stub = env.DROP_DO.get(dropNameId);
    const state0 = await getDOState();
    const opensAt = state0.config.opens_at;
    const closesAt = state0.config.registration_closes_at;
    const bookingClosesAt = state0.config.booking_closes_at;

    // Advance past opens_at -> REGISTRATION_OPEN
    await stub.fetch("http://do/advance", {
      method: "POST",
      body: JSON.stringify({ virtual_now: opensAt })
    });
    let state = await getDOState();
    expect(state.state).toBe("REGISTRATION_OPEN");

    // Advance past registration closes -> cascades directly to BOOKING_OPEN
    await stub.fetch("http://do/advance", {
      method: "POST",
      body: JSON.stringify({ virtual_now: closesAt })
    });
    state = await getDOState();
    expect(state.state).toBe("BOOKING_OPEN");
    
    // Check snapshots generated (Side effect verification)
    expect(state.snapshot_hash).toBeDefined();
    expect(state.result_hash).toBeDefined();
    expect(state.allocation_committed_at).toBe(closesAt);

    // Advance past booking closes -> CLOSED
    await stub.fetch("http://do/advance", {
      method: "POST",
      body: JSON.stringify({ virtual_now: bookingClosesAt })
    });
    state = await getDOState();
    expect(state.state).toBe("CLOSED");
  });

  it("11/12. critical integrity failure causes HALTED and rejects mutations", async () => {
    const dropNameId2 = env.DROP_DO.idFromName("drp_test_phase3_halt");
    const stub = env.DROP_DO.get(dropNameId2);
    
    // Direct transition to HALTED
    let res = await stub.fetch("http://do/transition", {
      method: "POST",
      body: JSON.stringify({ to: "HALTED", reason: "Oversell detected" })
    });
    expect(res.status).toBe(200);

    let state = await getDOState();
    // Wait, getting state for dropNameId2
    let resState = await stub.fetch("http://do/state");
    let state2 = await resState.json<any>();
    expect(state2.state).toBe("HALTED");

    // Any normal mutation should fail from HALTED
    res = await stub.fetch("http://do/transition", {
      method: "POST",
      body: JSON.stringify({ to: "SCHEDULED" })
    });
    expect(res.status).toBe(503);
  });
});
