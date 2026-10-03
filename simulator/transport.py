import os
import asyncio
import aiohttp
import time
from typing import List, Dict, Any, Optional
from models import Participant, ScenarioConfig

class TransportInterface:
    async def connect(self):
        pass
    async def close(self):
        pass
    async def create_experiment(self, config: ScenarioConfig):
        pass
    async def register_participant(self, p: Participant):
        pass
    async def send_behavioral_batch(self, p: Participant, token: str, drop_id: str = "ev_123"):
        pass

class MockTransport(TransportInterface):
    async def connect(self):
        print("MockTransport connected")
    async def close(self):
        print("MockTransport closed")
    async def register_participant(self, p: Participant):
        return {"status": 200, "latency_ms": 10, "participant_id": p.participant_id}

class HTTPTransport(TransportInterface):
    def __init__(self, base_url: str):
        self.base_url = base_url
        self.session: Optional[aiohttp.ClientSession] = None
        
    async def connect(self):
        # Limit to 1000 to prevent Windows socket exhaustion (WSAENOBUFS)
        connector = aiohttp.TCPConnector(limit=1000)
        self.session = aiohttp.ClientSession(base_url=self.base_url, connector=connector)
        
    async def close(self):
        if self.session:
            await self.session.close()

    async def create_experiment(self, config: ScenarioConfig, drop_id: str = "ev_123"):
        """Initialize the drop using the Admin endpoint"""
        if not self.session:
            raise RuntimeError("Transport not connected")
            
        admin_secret = os.getenv("ADMIN_SECRET", "mock_secret")
        headers = {"Authorization": f"Bearer {admin_secret}"}
        
        try:
            # POST to config or publish depending on the worker routing
            print(f"Creating experiment {drop_id}...")
            async with self.session.post(f"/api/v1/admin/drops/{drop_id}/publish", headers=headers, json={"config": config.profiles}) as res:
                return await res.text()
        except Exception as e:
            print(f"Error creating experiment: {e}")
            return None

    async def send_behavioral_batch(self, p: Participant, token: str, drop_id: str = "ev_123"):
        if not self.session:
            return
            
        headers = {"Authorization": f"Bearer {token}"}
        payload = {
            "window_ms": 10000,
            "mouse_moves": int(p.telemetry_profile.mouse_moves_per_sec * 10),
            "clicks": int(p.telemetry_profile.clicks_per_sec * 10),
            "scrolls": int(p.telemetry_profile.scrolls_per_sec * 10),
            "dwell_time_ms": p.telemetry_profile.dwell_time_ms
        }
        
        try:
            async with self.session.post(f"/api/v1/drops/{drop_id}/telemetry", headers=headers, json=payload) as resp:
                await resp.read()
        except Exception:
            pass # Telemetry is fire-and-forget in stress tests

    async def register_participant(self, p: Participant, drop_id: str = "ev_123"):
        if not self.session:
            raise RuntimeError("Transport not connected")
            
        start = time.time()
        
        # 1. Obtain authenticated session
        auth_payload = {"client_type": "simulator"}
        token = None
        try:
            async with self.session.post("/api/v1/auth/session", json=auth_payload) as auth_res:
                if auth_res.status == 201:
                    data = await auth_res.json()
                    token = data.get("token")
        except Exception:
            pass # Handled below
            
        if not token:
            latency_ms = (time.time() - start) * 1000
            return {"status": 401, "error": "Auth failed", "latency_ms": latency_ms}
            
        headers = {"Authorization": f"Bearer {token}"}
        payload = {} # Empty payload, backend derives ID from session per our contract
        
        retries = p.retry_behavior if p.retry_behavior > 0 else 1
        
        for attempt in range(retries):
            try:
                # 2. Real Network Request to Join Drop
                join_start = time.time()
                async with self.session.post(f"/api/v1/drops/{drop_id}/join", json=payload, headers=headers) as resp:
                    latency_ms = (time.time() - join_start) * 1000
                    status = resp.status
                    
                    # 5xx and 429 errors trigger exponential backoff for bots
                    if status >= 500 or status == 429:
                        if attempt < retries - 1:
                            await asyncio.sleep(0.5 * (2 ** attempt))
                            continue
                    
                    # 3. Fire-and-forget telemetry batch if joined successfully
                    if status in (200, 201, 202):
                        asyncio.create_task(self.send_behavioral_batch(p, token, drop_id))
                        
                    return {"status": status, "latency_ms": latency_ms}
            
            except Exception as e:
                if attempt == retries - 1:
                    latency_ms = (time.time() - start) * 1000
                    return {"status": 500, "error": str(e), "latency_ms": latency_ms}
                await asyncio.sleep(0.5 * (2 ** attempt)) # exponential backoff
        
        latency_ms = (time.time() - start) * 1000
        return {"status": 500, "latency_ms": latency_ms}

async def fire_participant(transport: TransportInterface, p: Participant, start_time: float):
    # Enforce realistic arrival timings (flash crowd simulation)
    current_offset = (time.time() - start_time) * 1000
    if p.arrival_timing_ms > current_offset:
        delay = (p.arrival_timing_ms - current_offset) / 1000.0
        await asyncio.sleep(delay)
        
    res = await transport.register_participant(p)
    return res

async def run_http_mode(participants: List[Participant], base_url: str = None):
    url = base_url or os.getenv('FAIRDROP_API_BASE_URL', 'http://localhost:8787')
    transport = HTTPTransport(url)
    await transport.connect()
    
    start_time = time.time()
    
    try:
        tasks = []
        for p in participants:
            tasks.append(asyncio.create_task(fire_participant(transport, p, start_time)))
            
        print(f"Firing {len(tasks)} requests with real HTTP network physics...")
        
        results = await asyncio.gather(*tasks)
        
        # Aggregate real metrics
        successes = sum(1 for r in results if r.get('status') in (200, 201, 202, 409))
        failures = sum(1 for r in results if r.get('status') >= 500)
        rate_limited = sum(1 for r in results if r.get('status') == 429)
        latencies = [r.get('latency_ms', 0) for r in results if 'latency_ms' in r]
        avg_latency = sum(latencies) / len(latencies) if latencies else 0
        
        print(f"--- EXPERIMENT RESULTS ---")
        print(f"Total Requests: {len(results)}")
        print(f"Success/Joined: {successes}")
        print(f"Rate Limited (429): {rate_limited}")
        print(f"Failures (5xx): {failures}")
        print(f"Average Latency: {avg_latency:.2f}ms")
        
    finally:
        await transport.close()
