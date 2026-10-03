import random
import hashlib
from typing import List
from models import Participant, ProfileType, TelemetryProfile, ScenarioConfig

def generate_telemetry_profile(rng: random.Random, profile: ProfileType) -> TelemetryProfile:
    if profile == ProfileType.HUMAN:
        return TelemetryProfile(
            mouse_moves_per_sec=rng.uniform(0.5, 5.0),
            clicks_per_sec=rng.uniform(0.1, 1.0),
            scrolls_per_sec=rng.uniform(0.1, 2.0),
            keyboards_per_sec=rng.uniform(0.0, 1.0),
            dwell_time_ms=int(rng.uniform(5000, 120000))
        )
    elif profile == ProfileType.HUMAN_LIKE_BOT:
        return TelemetryProfile(
            mouse_moves_per_sec=rng.uniform(0.5, 4.0),
            clicks_per_sec=rng.uniform(0.1, 0.8),
            scrolls_per_sec=rng.uniform(0.1, 1.5),
            keyboards_per_sec=0.0,
            dwell_time_ms=int(rng.uniform(2000, 30000))
        )
    else:
        # Bots typically lack rich telemetry
        return TelemetryProfile(
            mouse_moves_per_sec=0.0,
            clicks_per_sec=0.0,
            scrolls_per_sec=0.0,
            keyboards_per_sec=0.0,
            dwell_time_ms=0
        )

def get_bot_profile(rng: random.Random, mixed: bool = False) -> ProfileType:
    if not mixed:
        return rng.choice([
            ProfileType.SIMPLE_BOT,
            ProfileType.FLOOD_BOT, 
            ProfileType.RETRY_BOT,
            ProfileType.SLOW_BOT,
            ProfileType.MULTI_SESSION_BOT,
            ProfileType.HUMAN_LIKE_BOT
        ])
    return ProfileType.MIXED_ATTACK

def generate_population(config: ScenarioConfig) -> List[Participant]:
    rng = random.Random(config.population_seed)
    
    participants = []
    
    human_count = int(config.participant_count * config.human_ratio)
    bot_count = config.participant_count - human_count
    
    # We create a list of profile types
    profiles_to_assign = [ProfileType.HUMAN] * human_count
    
    for _ in range(bot_count):
        bot_type = get_bot_profile(rng)
        profiles_to_assign.append(bot_type)
        
    rng.shuffle(profiles_to_assign)
    
    for i, p_type in enumerate(profiles_to_assign):
        p_id = f"p_{hashlib.md5(f'{config.population_seed}_{i}'.encode()).hexdigest()[:12]}"
        acc_id = f"acc_{hashlib.md5(f'acc_{config.population_seed}_{i}'.encode()).hexdigest()[:12]}"
        
        # Profile specific params
        session_count = 1
        req_amp = 1
        retry_behavior = 0
        arrival_timing_ms = int(rng.expovariate(1.0 / 10000.0)) # avg 10s arrival
        
        if p_type == ProfileType.MULTI_SESSION_BOT:
            session_count = rng.randint(5, 20)
        elif p_type == ProfileType.FLOOD_BOT:
            req_amp = rng.randint(10, 100)
        elif p_type == ProfileType.RETRY_BOT:
            retry_behavior = rng.randint(5, 50)
            
        telemetry = generate_telemetry_profile(rng, p_type)
        
        p = Participant(
            participant_id=p_id,
            account_id=acc_id,
            profile=p_type,
            session_count=session_count,
            arrival_timing_ms=arrival_timing_ms,
            request_amplification=req_amp,
            retry_behavior=retry_behavior,
            telemetry_profile=telemetry
        )
        participants.append(p)
        
    return participants
