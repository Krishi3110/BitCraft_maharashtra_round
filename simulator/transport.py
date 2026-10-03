import os
import asyncio
import aiohttp
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
    async def send_participant_action(self, p: Participant, action: str):
        pass
    async def send_behavioral_batch(self, p: Participant):
        pass
    async def query_status(self, drop_id: str, p: Participant):
        pass
    async def query_allocation(self, drop_id: str, p: Participant):
        pass
    async def finalize_experiment(self, drop_id: str):
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
        self.session = aiohttp.ClientSession(base_url=self.base_url)
        
    async def close(self):
        if self.session:
            await self.session.close()

    async def create_experiment(self, config: ScenarioConfig):
        # Pending integration
        pass

    async def register_participant(self, p: Participant):
        if not self.session:
            raise RuntimeError("Transport not connected")
        
        payload = {
            "participant_id": p.participant_id,
            "account_id": p.account_id,
        }
        
        # PENDING backend endpoint implementation
        # async with self.session.post("/api/v1/drops/ev_123/join", json=payload) as resp:
        #    return await resp.json()
        
        return {"status": "mock_success", "participant_id": p.participant_id}

    async def send_behavioral_batch(self, p: Participant):
        # PENDING Phase 7 backend implementation
        pass

async def run_http_mode(participants: List[Participant], base_url: str = None):
    url = base_url or os.getenv('FAIRDROP_API_BASE_URL', 'http://localhost:8787')
    transport = HTTPTransport(url)
    await transport.connect()
    
    try:
        tasks = []
        for p in participants:
            tasks.append(transport.register_participant(p))
            
        results = await asyncio.gather(*tasks)
        print(f"Sent {len(results)} registration requests to {url}.")
    finally:
        await transport.close()
