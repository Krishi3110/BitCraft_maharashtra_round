import { env, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

describe("Phase 1 - Health & Bindings", () => {
  it("DropDO ping test directly via env", async () => {
    const id = env.DROP_DO.idFromName("test");
    const stub = env.DROP_DO.get(id);
    const resp = await stub.fetch("http://do/ping");
    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe("pong");
  });

  it("D1 ping test directly via env", async () => {
    // Note: D1 migrations are automatically applied by the vitest plugin
    // if we had them, but for now we just verify SELECT 1
    const { results } = await env.DB.prepare("SELECT 1 AS val").all();
    expect(results).toBeDefined();
    expect(results?.[0]?.val).toBe(1);
  });

  it("health route test via worker integration", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/health");
    expect(response.status).toBe(200);
    const json: any = await response.json();
    expect(json.worker).toBe("ok");
    expect(json.d1).toBe("ok");
    expect(json.do).toBe("ok");
  });
});
