import asyncio
import aiohttp
import time
import sys
import random
from collections import Counter

BASE_URL = "http://localhost:8787"
ADMIN_SECRET = "local_test_secret"

# Global metrics
metrics = {
    "total_requests": 0,
    "successful_requests": 0,
    "failed_requests": 0,
    "http_4xx": 0,
    "http_5xx": 0,
    "join_success": 0,
    "confirmed_bookings": 0,
}

latencies = []

class MetricsSession:
    def __init__(self, session):
        self.session = session

    async def _track(self, method, *args, **kwargs):
        metrics["total_requests"] += 1
        start = time.time()
        try:
            async with method(*args, **kwargs) as res:
                end = time.time()
                latencies.append(end - start)
                status = res.status
                if 200 <= status < 300:
                    metrics["successful_requests"] += 1
                elif 400 <= status < 500:
                    metrics["http_4xx"] += 1
                    metrics["failed_requests"] += 1
                elif 500 <= status < 600:
                    metrics["http_5xx"] += 1
                    metrics["failed_requests"] += 1
                
                await res.read() # drain
                return res, status, await res.text()
        except Exception as e:
            metrics["failed_requests"] += 1
            raise e

    async def post(self, *args, **kwargs):
        return await self._track(self.session.post, *args, **kwargs)

    async def get(self, *args, **kwargs):
        return await self._track(self.session.get, *args, **kwargs)


async def setup_drop(session: MetricsSession, drop_id: str, tickets: int):
    print(f"\n[1] Setting up drop {drop_id} with {tickets} tickets...")
    headers = {"Authorization": f"Bearer {ADMIN_SECRET}"}
    
    config = {
        "mode": "FAIR",
        "kind": "EXPERIMENT",
        "clock_mode": "VIRTUAL",
        "total_inventory": tickets,
        "hold_ttl_ms": 300000,
        "config_json": {}
    }
    
    res, status, text = await session.post(f"{BASE_URL}/api/v1/admin/drops/{drop_id}/publish", headers=headers, json=config)
    print(f"    Publish Status: {status} -> {text}")
    if status not in (200, 201):
        raise Exception("Failed to publish drop")

async def transition_state(session: MetricsSession, drop_id: str, to_state: str):
    print(f"\n[*] Admin Transitioning state to {to_state}...")
    headers = {"Authorization": f"Bearer {ADMIN_SECRET}"}
    payload = {"to": to_state}
    
    res, status, text = await session.post(f"{BASE_URL}/api/v1/admin/drops/{drop_id}/transition", headers=headers, json=payload)
    print(f"    Transition Status: {status}")
    await asyncio.sleep(2)
    return status

async def participant_flow(session: MetricsSession, drop_id: str, p_id: int, sem: asyncio.Semaphore):
    async with sem:
        # 1. Auth
        res, status, text = await session.post(f"{BASE_URL}/api/v1/auth/session", json={"client_type": "simulator"})
        if status != 201:
            return False
        import json
        auth_data = json.loads(text)
        token = auth_data.get("token")
            
        headers = {"Authorization": f"Bearer {token}"}
        
        # 2. Join
        res, status, text = await session.post(f"{BASE_URL}/api/v1/drops/{drop_id}/join", headers=headers, json={})
        if status not in (200, 201, 202):
            return False
        
        metrics["join_success"] += 1
        return headers

async def participant_checkout(session: MetricsSession, drop_id: str, p_id: int, headers: dict, sem: asyncio.Semaphore):
    import json
    async with sem:
        # 3. Check Status
        for attempt in range(8):
            res, status, text = await session.get(f"{BASE_URL}/api/v1/drops/{drop_id}/status", headers=headers)
            stat_data = json.loads(text) if status == 200 else {}
            if status == 200 and stat_data.get("status") == "ALLOCATED":
                break
            await asyncio.sleep(2)
        else:
            return False
            
        # 4. Reserve
        res, status, text = await session.post(f"{BASE_URL}/api/v1/drops/{drop_id}/reserve", headers=headers, json={})
        res_data = json.loads(text)
        if not (status == 200 and res_data.get("reservation_status") == "HELD"):
            return False
            
        # 5. Confirm
        res, status, text = await session.post(f"{BASE_URL}/api/v1/drops/{drop_id}/confirm", headers=headers, json={})
        conf_data = json.loads(text)
        if status == 200 and conf_data.get("status") == "CONFIRMED":
            metrics["confirmed_bookings"] += 1
            return True
        return False

async def main():
    if len(sys.argv) != 3:
        print("Usage: python demo_run.py <participants> <tickets>")
        sys.exit(1)
        
    num_participants = int(sys.argv[1])
    num_tickets = int(sys.argv[2])
    drop_id = f"ev_stress_{int(time.time())}_{random.randint(1000,9999)}"
    
    print("=====================================================")
    print(f"   FAIR DROP STRESS TEST - {num_participants} Users / {num_tickets} Tickets   ")
    print("=====================================================")
    
    connector = aiohttp.TCPConnector(limit=500)
    sem = asyncio.Semaphore(100) # Control concurrency for requests
    
    async with aiohttp.ClientSession(connector=connector) as aio_session:
        session = MetricsSession(aio_session)
        
        t0 = time.time()
        
        # Step 1: Admin configures drop
        await setup_drop(session, drop_id, tickets=num_tickets)
        
        # Step 2: Open Registration
        await transition_state(session, drop_id, "REGISTRATION_OPEN")
        
        # Step 3: Participants join
        print(f"\n[2] Spawning {num_participants} participants to join...")
        join_tasks = [participant_flow(session, drop_id, i, sem) for i in range(num_participants)]
        auth_headers = await asyncio.gather(*join_tasks)
        
        valid_headers = [(i, h) for i, h in enumerate(auth_headers) if h]
        print(f"    {len(valid_headers)} participants successfully joined.")
        
        # Step 4: Close Registration and Trigger Allocation
        await transition_state(session, drop_id, "REGISTRATION_CLOSED")
        await transition_state(session, drop_id, "BOOKING_OPEN")
        
        # Step 5: Participants race to checkout
        print(f"\n[3] Participants checking status and checking out...")
        checkout_tasks = [participant_checkout(session, drop_id, i, h, sem) for i, h in valid_headers]
        results = await asyncio.gather(*checkout_tasks)
        
        t1 = time.time()
        
        # Metrics Calculation
        total_time = t1 - t0
        successful_bookings = metrics["confirmed_bookings"]
        sorted_latencies = sorted(latencies)
        p50 = sorted_latencies[int(len(sorted_latencies) * 0.5)] if sorted_latencies else 0
        p95 = sorted_latencies[int(len(sorted_latencies) * 0.95)] if sorted_latencies else 0
        p99 = sorted_latencies[int(len(sorted_latencies) * 0.99)] if sorted_latencies else 0
        throughput = metrics["total_requests"] / total_time if total_time > 0 else 0
        
        print("\n=====================================================")
        print(f" TEST COMPLETE! ")
        print(f" Participants: {num_participants}")
        print(f" Total Tickets: {num_tickets}")
        print(f" Successful Bookings: {successful_bookings}")
        print("-----------------------------------------------------")
        print(f" Total Requests: {metrics['total_requests']}")
        print(f" Successful (2xx): {metrics['successful_requests']}")
        print(f" Failed (4xx/5xx/err): {metrics['failed_requests']}")
        print(f" HTTP 4xx: {metrics['http_4xx']}")
        print(f" HTTP 5xx: {metrics['http_5xx']}")
        print("-----------------------------------------------------")
        print(f" Throughput: {throughput:.2f} req/s")
        print(f" P50 Latency: {p50 * 1000:.2f} ms")
        print(f" P95 Latency: {p95 * 1000:.2f} ms")
        print(f" P99 Latency: {p99 * 1000:.2f} ms")
        print("=====================================================")
        
        if successful_bookings <= num_tickets:
            print(" [PASS] SYSTEM PASSED: Did not oversell tickets!")
        else:
            print(" [FAIL] SYSTEM FAILED: Oversold tickets!")

if __name__ == "__main__":
    asyncio.run(main())
