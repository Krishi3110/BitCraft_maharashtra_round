from enum import Enum
from dataclasses import dataclass
from typing import List, Optional

class ProfileType(Enum):
    HUMAN = "HUMAN"
    SIMPLE_BOT = "SIMPLE_BOT"
    FLOOD_BOT = "FLOOD_BOT"
    RETRY_BOT = "RETRY_BOT"
    SLOW_BOT = "SLOW_BOT"
    MULTI_SESSION_BOT = "MULTI_SESSION_BOT"
    HUMAN_LIKE_BOT = "HUMAN_LIKE_BOT"
    MIXED_ATTACK = "MIXED_ATTACK"

@dataclass
class TelemetryProfile:
    mouse_moves_per_sec: float
    clicks_per_sec: float
    scrolls_per_sec: float
    keyboards_per_sec: float
    dwell_time_ms: int

@dataclass
class Participant:
    participant_id: str
    account_id: str
    profile: ProfileType
    session_count: int
    arrival_timing_ms: int
    request_amplification: int
    retry_behavior: int
    telemetry_profile: TelemetryProfile

@dataclass
class ScenarioConfig:
    population_seed: int
    scenario_name: str
    participant_count: int
    human_ratio: float
    bot_ratio: float
    simulator_version: str
    profiles: dict
