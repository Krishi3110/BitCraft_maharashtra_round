import asyncio
import time
from population import generate_population
from models import ScenarioConfig
from transport import run_http_mode

def run_logical_mode(config: ScenarioConfig):
    print(f"Running LOGICAL mode for scenario: {config.scenario_name}")
    start_time = time.time()
    participants = generate_population(config)
    end_time = time.time()
    
    humans = sum(1 for p in participants if p.profile.value == "HUMAN")
    bots = len(participants) - humans
    
    print(f"Generated {len(participants)} logical participants in {end_time - start_time:.4f}s.")
    print(f"Humans: {humans}")
    print(f"Bots: {bots}")
    print("Logical simulation complete. No HTTP requests sent.")

async def main():
    config = ScenarioConfig(
        population_seed=12345,
        scenario_name="Stress Test 1",
        participant_count=50000,
        human_ratio=0.70,
        bot_ratio=0.30,
        simulator_version="1.0.0",
        profiles={}
    )
    
    print("--- FAIR DROP SIMULATOR ---")
    print("1. Logical Mode")
    print("2. HTTP Mode")
    
    mode = "logical" 
    
    if mode == "logical":
        run_logical_mode(config)
    else:
        print("Running HTTP mode...")
        participants = generate_population(config)
        
        # Sort participants by arrival time so we fire them in realistic order
        participants.sort(key=lambda p: p.arrival_timing_ms)
        print(f"Prepared {len(participants)} requests with simulated arrival delays.")
        
        await run_http_mode(participants, "http://localhost:3000")

if __name__ == "__main__":
    asyncio.run(main())
