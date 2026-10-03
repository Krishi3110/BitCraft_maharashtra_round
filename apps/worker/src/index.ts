import { DropDO } from "./drop/DropDO";

export interface Env {
  DB: D1Database;
  DROP_DO: DurableObjectNamespace;
  ASSETS: Fetcher;
}

export { DropDO };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

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

    // Public read drop state
    if (url.pathname.startsWith("/api/v1/drops/") && request.method === "GET") {
      const parts = url.pathname.split('/');
      const dropId = parts[4];
      const stub = env.DROP_DO.get(env.DROP_DO.idFromName(dropId));
      const res = await stub.fetch("http://do/state");
      return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json" } });
    }

    return env.ASSETS.fetch(request);
  },
};
