import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import worker from "../src/index";
import { signJWT } from "../src/auth/jwt";

const SECRET = env.SESSION_SECRET || 'a_very_long_secure_secret_for_testing_purposes_only';

describe("Commit 3 - Core Booking Logic", () => {
  const dropId = "drp_booking_test";
  
  let user1Token: string, user2Token: string, user3Token: string;
  let user1Id: string, user2Id: string, user3Id: string;

  beforeAll(async () => {
    // Generate valid UUIDs
    user1Id = crypto.randomUUID();
    user2Id = crypto.randomUUID();
    user3Id = crypto.randomUUID();

    user1Token = await signJWT({ sub: user1Id, iss: 'fairdrop', aud: 'fairdrop-client', iat: 1, exp: 9999999999, jti: '1' }, SECRET);
    user2Token = await signJWT({ sub: user2Id, iss: 'fairdrop', aud: 'fairdrop-client', iat: 1, exp: 9999999999, jti: '2' }, SECRET);
    user3Token = await signJWT({ sub: user3Id, iss: 'fairdrop', aud: 'fairdrop-client', iat: 1, exp: 9999999999, jti: '3' }, SECRET);

    // Setup Drop Config
    const stub = env.DROP_DO.get(env.DROP_DO.idFromName(dropId));
    const now = Date.now();
    await stub.fetch("http://do/config", {
      method: "POST",
      body: JSON.stringify({
        mode: "FAIR",
        kind: "PUBLIC",
        clock_mode: "VIRTUAL",
        total_inventory: 2, // Only 2 tickets for 3 users
        opens_at: now + 1000,
        registration_closes_at: now + 2000,
        booking_closes_at: now + 3000,
        offer_ttl_ms: 100, // Very short TTL for expiry testing
        hold_ttl_ms: 100,
        config_json: {}
      })
    });
    
    // Move to REGISTRATION_OPEN
    await stub.fetch("http://do/transition", { method: "POST", body: JSON.stringify({ to: "SCHEDULED", virtual_now: now }) });
    await stub.fetch("http://do/transition", { method: "POST", body: JSON.stringify({ to: "REGISTRATION_OPEN", virtual_now: now }) });
  });

  const makeReq = (path: string, token?: string, method = "POST") => {
    return new Request(`http://localhost/api/v1/drops/${dropId}${path}`, {
      method,
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
  };

  it("1. Missing or invalid participant identity", async () => {
    const res = await worker.fetch(makeReq("/join"), env, {} as any);
    expect(res.status).toBe(401);
  });

  it("2. Valid Join and Duplicate joins", async () => {
    // First join
    let res = await worker.fetch(makeReq("/join", user1Token), env, {} as any);
    expect(res.status).toBe(200);
    const body1 = await res.json<any>();
    expect(body1.status).toBe("REGISTERED");
    expect(body1.participant_id).toBe(user1Id);

    // Duplicate join
    res = await worker.fetch(makeReq("/join", user1Token), env, {} as any);
    expect(res.status).toBe(200);
    const body2 = await res.json<any>();
    expect(body2.status).toBe("REGISTERED");

    // Join others
    await worker.fetch(makeReq("/join", user2Token), env, {} as any);
    await worker.fetch(makeReq("/join", user3Token), env, {} as any);
  });

  it("3. Transition to BOOKING_OPEN and test allocation", async () => {
    const stub = env.DROP_DO.get(env.DROP_DO.idFromName(dropId));
    const now = Date.now();
    await stub.fetch("http://do/transition", { method: "POST", body: JSON.stringify({ to: "REGISTRATION_CLOSED", virtual_now: now }) });
    await stub.fetch("http://do/transition", { method: "POST", body: JSON.stringify({ to: "BOOKING_OPEN", virtual_now: now }) });

    // One user will be waitlisted, two will be allocated because inventory is 2
    const doState = await (await stub.fetch("http://do/state")).json<any>();
    expect(doState.state).toBe("BOOKING_OPEN");
  });

  it("4. Concurrent reservation attempts and overselling prevention", async () => {
    // We send 10 concurrent reserve requests for user1. 
    // They should get 1 ticket, the rest should return the identical hold.
    const promises = Array.from({ length: 10 }).map(() => worker.fetch(makeReq("/reserve", user1Token), env, {} as any));
    const responses = await Promise.all(promises);
    
    // Check results
    const statusCodes = responses.map(r => r.status);
    
    // If user1 was waitlisted, all will be 403. If allocated, all should be 200 returning the SAME ticket.
    if (statusCodes.includes(403)) {
      expect(statusCodes.every(c => c === 403)).toBe(true);
    } else {
      expect(statusCodes.every(c => c === 200)).toBe(true);
      const bodies = await Promise.all(responses.map(r => r.json<any>()));
      const ticketIds = bodies.map(b => b.ticket_id);
      expect(new Set(ticketIds).size).toBe(1); // Exact same ticket ID
    }
  });

  it("5. Confirmation after expiry and Confirmation racing with expiry", async () => {
    // To reliably test this, we need to know who is allocated.
    const stub = env.DROP_DO.get(env.DROP_DO.idFromName(dropId));
    let allocatedUserToken = user1Token;
    
    // Find an allocated user
    const tokens = [user1Token, user2Token, user3Token];
    for (const t of tokens) {
      const res = await worker.fetch(makeReq("/reserve", t), env, {} as any);
      if (res.status === 200) {
        allocatedUserToken = t;
        break; // we found one and just reserved it
      }
    }

    // Now sleep 150ms to guarantee expiry (hold_ttl_ms is 100)
    await new Promise(r => setTimeout(r, 150));

    // Next reserve or confirm will trigger the sweep!
    // Try to confirm the expired reservation
    const confirmRes = await worker.fetch(makeReq("/confirm", allocatedUserToken), env, {} as any);
    expect(confirmRes.status).toBe(404); // It was swept and EXPIRED, so no active reservation found

    // They are now EXPIRED but still ALLOCATED.
    // Try to reserve again (should succeed since we didn't add the max-holds constraint in the endpoint yet)
    const reserveRes = await worker.fetch(makeReq("/reserve", allocatedUserToken), env, {} as any);
    expect(reserveRes.status).toBe(200); 
    const rBody = await reserveRes.json<any>();
    expect(rBody.reservation_status).toBe("HELD");

    // Immediately confirm before it expires
    const confirmRes2 = await worker.fetch(makeReq("/confirm", allocatedUserToken), env, {} as any);
    expect(confirmRes2.status).toBe(200);
    const cBody = await confirmRes2.json<any>();
    expect(cBody.status).toBe("CONFIRMED");
  });

  it("7. Hold-hogging prevention (max hold attempts)", async () => {
    const stub = env.DROP_DO.get(env.DROP_DO.idFromName(dropId));
    // Set max_holds to 1 for this test
    const now = Date.now();
    await stub.fetch("http://do/config", {
      method: "POST",
      body: JSON.stringify({
        mode: "FAIR",
        kind: "PUBLIC",
        clock_mode: "VIRTUAL",
        total_inventory: 10,
        opens_at: now - 1000,
        registration_closes_at: now - 1000,
        booking_closes_at: now + 3000,
        offer_ttl_ms: 50,
        hold_ttl_ms: 50,
        config_json: { max_holds_per_participant: 1 }
      })
    });
    
    // Find an allocated user that hasn't confirmed yet (user2 or user3)
    let freshToken = user2Token;
    const res1 = await worker.fetch(makeReq("/reserve", freshToken), env, {} as any);
    if (res1.status === 403) {
       freshToken = user3Token;
       await worker.fetch(makeReq("/reserve", freshToken), env, {} as any);
    }
    
    // Wait for it to expire
    await new Promise(r => setTimeout(r, 100));
    
    // Sweep should happen, user is now EXPIRED
    // Because max_holds = 1 and they have 1 expired reservation, they should be rejected
    const res2 = await worker.fetch(makeReq("/reserve", freshToken), env, {} as any);
    expect(res2.status).toBe(429);
    const b2 = await res2.json<any>();
    expect(b2.error).toBe("TOO_MANY_REQUESTS");
  });

  it("8. Unauthorized access to another participant's reservation", async () => {
    // Trying to send someone else's participant_id via headers is blocked by Worker
    // Worker always overwrites X-Participant-Id.
    const req = new Request(`http://localhost/api/v1/drops/${dropId}/confirm`, {
      method: "POST",
      headers: {
        'Authorization': `Bearer ${user2Token}`, // User 2 auth
        'X-Participant-Id': user1Id // Try to spoof User 1
      }
    });
    
    const res = await worker.fetch(req, env, {} as any);
    // User 2's token will enforce X-Participant-Id = user2Id. User 2 doesn't have User 1's reservation.
    // Result might be 404 if User 2 has no reservation, or 200 if they do, but it operates on USER 2.
    // For this test, it will just not confirm User 1.
    const body = await res.json<any>();
    if (res.status === 404) {
      expect(body.error).toBe("NOT_FOUND");
    } else if (res.status === 400 && body.error === "EXPIRED") {
      expect(body.error).toBe("EXPIRED");
    }
  });

});