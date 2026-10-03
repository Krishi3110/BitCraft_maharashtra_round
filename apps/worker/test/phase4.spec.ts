import { describe, it, expect } from "vitest";
import { allocate, computeHash } from "shared";
import { env } from "cloudflare:test";

describe("Phase 4 - Fair Allocation Engine", () => {
  it("1. Deterministic repeatability - identical inputs yield identical allocation", async () => {
    const participants = ["userA", "userC", "userB", "userX"];
    const seed = "test-server-seed-001";
    
    const result1 = await allocate([...participants], seed, 2);
    const result2 = await allocate([...participants], seed, 2);
    
    expect(result1.snapshotHash).toBe(result2.snapshotHash);
    expect(result1.winners).toEqual(result2.winners);
    expect(result1.waitlist).toEqual(result2.waitlist);
    expect(result1.finalSeed).toBe(result2.finalSeed);
  });

  it("2. Input-order independence", async () => {
    const seed = "test-server-seed-002";
    
    const result1 = await allocate(["A", "B", "C"], seed, 2);
    const result2 = await allocate(["C", "A", "B"], seed, 2);
    
    expect(result1.winners).toEqual(result2.winners);
    expect(result1.waitlist).toEqual(result2.waitlist);
  });

  it("3. Duplicate registration handling", async () => {
    const seed = "test-server-seed-003";
    
    const resultWithDupes = await allocate(["A", "B", "A", "C", "B"], seed, 2);
    const resultNoDupes = await allocate(["A", "B", "C"], seed, 2);
    
    expect(resultWithDupes.eligibleCount).toBe(3);
    expect(resultWithDupes.winners).toEqual(resultNoDupes.winners);
  });

  it("4. Empty participant population", async () => {
    const result = await allocate([], "seed", 10);
    expect(result.eligibleCount).toBe(0);
    expect(result.winners).toEqual([]);
    expect(result.waitlist).toEqual([]);
  });

  it("5. Fewer participants than tickets", async () => {
    const result = await allocate(["user1", "user2"], "seed", 100);
    expect(result.winners.length).toBe(2);
    expect(result.waitlist.length).toBe(0);
  });

  it("6. More participants than tickets", async () => {
    const participants = Array.from({length: 100}).map((_, i) => `user${i}`);
    const result = await allocate(participants, "seed", 10);
    
    expect(result.winners.length).toBe(10);
    expect(result.waitlist.length).toBe(90);
  });

  it("7. Stable tie-breaking", async () => {
    const result = await allocate(["a", "A", "b", "B"], "collision-seed-test", 2);
    expect(result.winners.length).toBe(2);
  });

  it("7b. Canonical serialization avoids delimiter collisions", async () => {
    const result1 = await allocate(["a,b", "c"], "seed", 2);
    const result2 = await allocate(["a", "b,c"], "seed", 2);
    expect(result1.snapshotHash).not.toBe(result2.snapshotHash);
  });

  it("8. Golden test vector", async () => {
    const seed = "golden-seed-42";
    const participants = ["alice", "bob", "charlie", "dave", "eve"];
    const result = await allocate(participants, seed, 2);
    
    expect(result.eligibleCount).toBe(5);
    expect(result.snapshotHash).toBe("08e3e74a73650a45006541e41dde2aa227e85fbc250f6194d96cc67e87875efc");
    expect(result.finalSeed).toBe("c073c97dd1c305e6808ac8ef3f919617875a34dca5168a739ac1d77a8c3e41a0");
    expect(result.winners).toEqual(["eve", "charlie"]);
    expect(result.waitlist).toEqual(["bob", "alice", "dave"]);
    expect(result.resultHash).toBe("f9e076b4b0568407da642a50bf61d0907a664d1f9fac7a07702bb1eae72598d4");
    
    const secondResult = await allocate(participants, seed, 2);
    expect(result).toEqual(secondResult);
  });

  it("9. Lifecycle transition correctness and DO Allocation Atomicity", async () => {
    const dropId = "drp_test_phase4";
    const dropNameId = env.DROP_DO.idFromName(dropId);
    const stub = env.DROP_DO.get(dropNameId);
    const now = Date.now();
    
    const config = {
      mode: "FAIR",
      kind: "PUBLIC",
      clock_mode: "VIRTUAL",
      total_inventory: 2,
      opens_at: now + 1000,
      registration_closes_at: now + 2000,
      booking_closes_at: now + 3000,
      offer_ttl_ms: 60000,
      hold_ttl_ms: 60000,
      config_json: {}
    };

    await stub.fetch("http://do/config", { method: "POST", body: JSON.stringify(config) });
    await stub.fetch("http://do/transition", { method: "POST", body: JSON.stringify({ to: "SCHEDULED", virtual_now: now }) });
    await stub.fetch("http://do/advance", { method: "POST", body: JSON.stringify({ virtual_now: config.opens_at }) });
    
    await stub.fetch("http://do/test/register", { method: "POST", body: JSON.stringify({ participant_key: "user1" }) });
    await stub.fetch("http://do/test/register", { method: "POST", body: JSON.stringify({ participant_key: "user2" }) });
    await stub.fetch("http://do/test/register", { method: "POST", body: JSON.stringify({ participant_key: "user3" }) });

    await stub.fetch("http://do/advance", { method: "POST", body: JSON.stringify({ virtual_now: config.registration_closes_at }) });

    const stateRes = await stub.fetch("http://do/state");
    const state = await stateRes.json<any>();
    
    expect(state.state).toBe("BOOKING_OPEN");
    expect(state.snapshot_hash).toBeDefined();
    expect(state.result_hash).toBeDefined();
    expect(state.allocation_committed_at).toBe(config.registration_closes_at);
  });

  it("10. Benchmark 50,000 allocations (within DO CPU budget)", async () => {
    const participants = Array.from({length: 50000}).map((_, i) => `user_${i}`);
    const start = performance.now();
    const result = await allocate(participants, "benchmark-seed", 100);
    const time = performance.now() - start;
    
    expect(result.eligibleCount).toBe(50000);
    expect(result.winners.length).toBe(100);
    expect(time).toBeLessThan(15000); 
  });

  it("11. Seed redaction and reveal", async () => {
    const dropId = "drp_test_redact";
    const stub = env.DROP_DO.get(env.DROP_DO.idFromName(dropId));
    const now = Date.now();
    await stub.fetch("http://do/config", { method: "POST", body: JSON.stringify({ mode: "FAIR", clock_mode: "VIRTUAL", total_inventory: 2, opens_at: now+1000, registration_closes_at: now+2000, booking_closes_at: now+3000 }) });
    await stub.fetch("http://do/transition", { method: "POST", body: JSON.stringify({ to: "SCHEDULED", virtual_now: now }) });
    let stateRes = await stub.fetch("http://do/state");
    let state = await stateRes.json<any>();
    expect(state.state).toBe("SCHEDULED");
    expect(state.seed_commitment).toBeDefined();
    expect(state.server_seed).toBeUndefined(); // Redacted

    await stub.fetch("http://do/advance", { method: "POST", body: JSON.stringify({ virtual_now: now+1000 }) }); // REG_OPEN
    await stub.fetch("http://do/test/register", { method: "POST", body: JSON.stringify({ participant_key: "user1" }) });
    
    stateRes = await stub.fetch("http://do/state");
    state = await stateRes.json<any>();
    expect(state.server_seed).toBeUndefined(); // Still redacted

    await stub.fetch("http://do/advance", { method: "POST", body: JSON.stringify({ virtual_now: now+2000 }) }); // BOOKING_OPEN
    stateRes = await stub.fetch("http://do/state");
    state = await stateRes.json<any>();
    expect(state.state).toBe("BOOKING_OPEN");
    expect(state.server_seed).toBeDefined(); // Revealed!
  });

  it("12. Concurrent allocation attempts", async () => {
    const dropId = "drp_test_concurrent";
    const stub = env.DROP_DO.get(env.DROP_DO.idFromName(dropId));
    const now = Date.now();
    await stub.fetch("http://do/config", { method: "POST", body: JSON.stringify({ mode: "FAIR", clock_mode: "VIRTUAL", total_inventory: 2, opens_at: now+1000, registration_closes_at: now+2000, booking_closes_at: now+3000 }) });
    await stub.fetch("http://do/transition", { method: "POST", body: JSON.stringify({ to: "SCHEDULED", virtual_now: now }) });
    await stub.fetch("http://do/advance", { method: "POST", body: JSON.stringify({ virtual_now: now+1000 }) }); 
    await stub.fetch("http://do/test/register", { method: "POST", body: JSON.stringify({ participant_key: "user1" }) });
    
    // Send two concurrent advances to registration_closes_at
    const p1 = stub.fetch("http://do/advance", { method: "POST", body: JSON.stringify({ virtual_now: now+2000 }) });
    const p2 = stub.fetch("http://do/advance", { method: "POST", body: JSON.stringify({ virtual_now: now+2000 }) });
    await Promise.all([p1, p2]);
    
    const stateRes = await stub.fetch("http://do/state");
    const state = await stateRes.json<any>();
    expect(state.state).toBe("BOOKING_OPEN");
    expect(state.snapshot_hash).toBeDefined();
  });
});
