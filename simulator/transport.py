import asyncio
import aiohttp
from typing import List, Dict, Any
from models import Participant, ScenarioConfig

class Transport:
    def __init__(self, base_url: str):
        self.base_url = base_url
        self.session = None
        
    async def connect(self):
        self.session = aiohttp.ClientSession(base_url=self.base_url)
        
    async def close(self):
        if self.session:
            await self.session.close()

    async def register_participant(self, p: Participant):
        if not self.session:
            raise RuntimeError("Transport not connected")
        
        # Example payload
        payload = {
            "participant_id": p.participant_id,
            "account_id": p.account_id,
            "profile": p.profile.value,
            "telemetry": {
                "mouse_moves": p.telemetry_profile.mouse_moves_per_sec,
                "clicks": p.telemetry_profile.clicks_per_sec,
                "scrolls": p.telemetry_profile.scrolls_per_sec,
                "dwell_time": p.telemetry_profile.dwell_time_ms
            }
        }
        
        # In a real scenario, this would send an HTTP request:
        # async with self.session.post("/api/v1/event/join", json=payload) as resp:
        #    return await resp.json()
        
        # We are just an abstraction for now.
        return {"status": "mock_success", "participant_id": p.participant_id}

async def run_http_mode(participants: List[Participant], base_url: str):
    transport = Transport(base_url)
    await transport.connect()
    
    try:
        tasks = []
        for p in participants:
            # We would normally schedule this based on p.arrival_timing_ms
            tasks.append(transport.register_participant(p))
            
        results = await asyncio.gather(*tasks)
        print(f"Sent {len(results)} registration requests.")
    finally:
        await transport.close()
