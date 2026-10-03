import { DropDO } from "./drop/DropDO";
import { signJWT } from "./auth/jwt";
import { authenticate } from "./auth/middleware";

export interface Env {
  DB: D1Database;
  DROP_DO: DurableObjectNamespace;
  ASSETS: Fetcher;
  SESSION_SECRET: string;
  ADMIN_SECRET: string;
}

export { DropDO };

function adminAuthenticate(request: Request, env: Env): Response | null {
  if (!env.ADMIN_SECRET) {
    return new Response(JSON.stringify({ error: "Server misconfiguration: missing ADMIN_SECRET" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  const token = authHeader.slice(7).trim();
  if (!token || token !== env.ADMIN_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  return null;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Identity/Session Endpoint
    // Rate Limiting: In production, wrap this route with Cloudflare Rate Limiting rules 
    // and validate a Turnstile token before generating a session to prevent bot farming.
    if (url.pathname === "/api/v1/auth/session" && request.method === "POST") {
      try {
        if (!env.SESSION_SECRET) {
          return new Response(JSON.stringify({ error: "Server misconfiguration: missing SESSION_SECRET" }), { status: 500 });
        }
        
        const participantId = crypto.randomUUID();
        const now = Math.floor(Date.now() / 1000);
        // Expiration: 48 hours
        const exp = now + 48 * 3600;
        
        const token = await signJWT({
          sub: participantId,
          iss: 'fairdrop',
          aud: 'fairdrop-client',
          iat: now,
          exp,
          jti: crypto.randomUUID()
        }, env.SESSION_SECRET);

        const isSecure = url.protocol === 'https:' ? 'Secure;' : '';
        const cookie = `session=${token}; HttpOnly; ${isSecure} SameSite=Strict; Path=/; Max-Age=${48 * 3600}`;

        const reqBody = await request.clone().json<any>().catch(() => ({}));
        const isSimulator = reqBody.client_type === 'simulator';

        const resPayload: any = { status: 'OK' };
        if (isSimulator) {
          resPayload.token = token;
          resPayload.participant_id = participantId;
        }

        return new Response(JSON.stringify(resPayload), {
          status: 201,
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": cookie
          }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
      }
    }

    if (url.pathname === "/api/v1/health") {
      try {
        const d1Res = await env.DB.prepare("SELECT 1 AS val").first();
        const d1Ok = d1Res?.val === 1 ? "ok" : "fail";
        const stub = env.DROP_DO.get(env.DROP_DO.idFromName("health-check"));
        const doRes = await stub.fetch("http://do/ping");
        const doOk = doRes.ok ? await doRes.text() : "fail";
        return new Response(JSON.stringify({ worker: "ok", d1: d1Ok, do: doOk === "pong" ? "ok" : "fail" }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ worker: "ok", error: String(err) }), { status: 500 });
      }
    }

    // Enforce Admin Authentication boundary
    if (url.pathname.startsWith("/api/v1/admin/")) {
      const authError = adminAuthenticate(request, env);
      if (authError) return authError;
    }

    // Admin endpoint: Publish Drop (DRAFT -> SCHEDULED)
    if (url.pathname.startsWith("/api/v1/admin/drops/") && url.pathname.endsWith("/publish") && request.method === "POST") {
      const parts = url.pathname.split('/');
      const dropId = parts[5];
      const stub = env.DROP_DO.get(env.DROP_DO.idFromName(dropId));
      
      // Admin auth would go here
      const reqConfig = await request.clone().json<any>().catch(() => null);
      if (reqConfig) {
        await stub.fetch("http://do/config", { method: "POST", body: JSON.stringify(reqConfig) });
      }
      
      const transitionRes = await stub.fetch("http://do/transition", {
        method: "POST",
        body: JSON.stringify({ to: "SCHEDULED" })
      });
      return new Response(transitionRes.body, { status: transitionRes.status });
    }

    // Admin endpoint: Transition
    if (url.pathname.startsWith("/api/v1/admin/drops/") && url.pathname.endsWith("/transition") && request.method === "POST") {
      const parts = url.pathname.split('/');
      const dropId = parts[5];
      const stub = env.DROP_DO.get(env.DROP_DO.idFromName(dropId));
      
      // Payload: { to: "CANCELLED"|"HALTED"|"CLOSED", reason, virtual_now }
      const payload = await request.text();
      const transitionRes = await stub.fetch("http://do/transition", {
        method: "POST",
        body: payload
      });
      return new Response(transitionRes.body, { status: transitionRes.status });
    }
    
    if (url.pathname.startsWith("/api/v1/admin/drops/") && url.pathname.endsWith("/advance") && request.method === "POST") {
      const parts = url.pathname.split('/');
      const dropId = parts[5];
      const stub = env.DROP_DO.get(env.DROP_DO.idFromName(dropId));
      
      const payload = await request.text();
      const res = await stub.fetch("http://do/advance", { method: "POST", body: payload });
      return new Response(res.body, { status: res.status });
    }

    // Public booking endpoints
    const bookingMatch = url.pathname.match(new RegExp("^/api/v1/drops/([^/]+)/(join|reserve|confirm)$"));
    if (bookingMatch && request.method === "POST") {
      const dropId = bookingMatch[1];
      const action = bookingMatch[2];
      try {
        const authCtx = await authenticate(request, env.SESSION_SECRET);
        const stub = env.DROP_DO.get(env.DROP_DO.idFromName(dropId));
        
        // Strip client headers and inject trusted identity
        const fwdReq = new Request(`http://do/${action}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Participant-Id": authCtx.participantId
          },
          body: await request.clone().text().catch(() => "{}")
        });
        
        const res = await stub.fetch(fwdReq);
        return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json" } });
      } catch (err: any) {
        if (err.message.includes('Missing authentication') || err.message.includes('expired') || err.message.includes('signature')) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }
        return new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 });
      }
    }

    // Public read drop state
    if (url.pathname.match(new RegExp("^/api/v1/drops/[^/]+/status$")) && request.method === "GET") {
      const parts = url.pathname.split('/');
      const dropId = parts[4];
      
      try {
        const authCtx = await authenticate(request, env.SESSION_SECRET);
        
        const cache = caches.default;
        const cacheKey = new Request(`${url.origin}/cache/drops/${dropId}/status/${authCtx.participantId}`, { method: 'GET' });
        
        let response = await cache.match(cacheKey);
        
        if (!response) {
          const row = await env.DB.prepare("SELECT status, payload FROM status_projections WHERE drop_id = ? AND participant_id = ?")
            .bind(dropId, authCtx.participantId)
            .first();
            
          if (!row) {
            response = new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers: { "Content-Type": "application/json" } });
          } else {
            response = new Response(JSON.stringify(
              Object.assign({ status: row.status }, row.payload ? JSON.parse(row.payload as string) : {})
            ), {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "Cache-Control": "s-maxage=5, max-age=5"
              }
            });
          }
          
          if (response.status === 200 || response.status === 404) {
             ctx.waitUntil(cache.put(cacheKey, response.clone()));
          }
        }
        
        return response;
      } catch (err: any) {
        if (err.message.includes('Missing authentication') || err.message.includes('expired') || err.message.includes('signature')) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }
        console.error("Status endpoint error:", err);
        return new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 });
      }
    }

    if (url.pathname.match(new RegExp("^/api/v1/drops/[^/]+$")) && request.method === "GET") {
      const parts = url.pathname.split('/');
      const dropId = parts[4];
      const stub = env.DROP_DO.get(env.DROP_DO.idFromName(dropId));
      const res = await stub.fetch("http://do/state");
      return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json" } });
    }

    return env.ASSETS.fetch(request);
  },
};
