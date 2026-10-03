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

class MockTransport(TransportInterface):
    async def connect(self):
        print("MockTransport connected")
    async def close(self):
        print("MockTransport closed")
    async def register_participant(self, p: Participant):
        return {"status": "mock_success", "participant_id": p.participant_id}

class HTTPTransport(TransportInterface):
    def __init__(self, base_url: str):
        self.base_url = base_url
        self.session: Optional[aiohttp.ClientSession] = None
        
    async def connect(self):
        connector = aiohttp.TCPConnector(limit=5000)
        self.session = aiohttp.ClientSession(base_url=self.base_url, connector=connector)
        
    async def close(self):
        if self.session:
            await self.session.close()

    async def register_participant(self, p: Participant):
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
            pass # We will fail below if token is None
            
        if not token:
            return {"status": 401, "error": "Auth failed"}
            
        headers = {"Authorization": f"Bearer {token}"}
        payload = {} 
        
        retries = p.retry_behavior if p.retry_behavior > 0 else 1
        
        for attempt in range(retries):
            try:
                # 2. Join the Drop using the Bearer token
                # async with self.session.post("/api/v1/drops/ev_123/join", json=payload, headers=headers) as resp:
                #    latency_ms = (time.time() - start) * 1000
                #    return {"status": resp.status, "latency_ms": latency_ms}
                
                # MOCK RESPONSE (until Krishi's /join is pushed)
                await asyncio.sleep(0.01) # fake network delay
                latency_ms = (time.time() - start) * 1000
                return {"status": 200, "latency_ms": latency_ms}
            
            except Exception as e:
                if attempt == retries - 1:
                    return {"status": 500, "error": str(e)}
                await asyncio.sleep(0.5 * (2 ** attempt)) # exponential backoff
        
        return {"status": 500}

async def fire_participant(transport: TransportInterface, p: Participant, start_time: float):
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
            
        print(f"Firing {len(tasks)} requests with physics constraints...")
        
        results = await asyncio.gather(*tasks)
        
        successes = sum(1 for r in results if r.get('status') == 200)
        print(f"Completed! Successes: {successes}/{len(results)}")
        
    finally:
        await transport.close()
