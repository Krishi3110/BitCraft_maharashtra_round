import pytest
from models import ScenarioConfig, ProfileType
from population import generate_population

def test_deterministic_population():
    config = ScenarioConfig(
        population_seed=42,
        scenario_name="Test",
        participant_count=1000,
        human_ratio=0.80,
        bot_ratio=0.20,
        simulator_version="1.0.0",
        profiles={}
    )
    
    pop1 = generate_population(config)
    pop2 = generate_population(config)
    
    assert len(pop1) == 1000
    assert len(pop2) == 1000
    
    for p1, p2 in zip(pop1, pop2):
        assert p1.participant_id == p2.participant_id
        assert p1.profile == p2.profile
        
def test_human_bot_proportions():
    config = ScenarioConfig(
        population_seed=99,
        scenario_name="Test 2",
        participant_count=5000,
        human_ratio=0.60,
        bot_ratio=0.40,
        simulator_version="1.0.0",
        profiles={}
    )
    
    pop = generate_population(config)
    
    humans = sum(1 for p in pop if p.profile == ProfileType.HUMAN)
    bots = len(pop) - humans
    
    assert humans == 3000
    assert bots == 2000
