import { ApiClient, EventDetails, DropStateResponse, JoinDropResponse, AllocationStatusResponse } from './types';

export class MockApiClient implements ApiClient {
  async initSession(): Promise<void> { console.log('Mock session initialized'); }

  async getEventDetails(): Promise<EventDetails> {
    return { id: 'ev_123', name: 'FUTUREFEST 2026', totalTickets: 500 };
  }

  async getDropState(_dropId: string): Promise<DropStateResponse> {
    return {
      state: 'REGISTRATION_OPEN',
      config: {
        mode: 'FAIR',
        kind: 'PUBLIC',
        clock_mode: 'WALL',
        total_inventory: 500,
        opens_at: Date.now() - 10000,
        registration_closes_at: Date.now() + 60000,
        booking_closes_at: Date.now() + 120000,
        offer_ttl_ms: 300000,
        hold_ttl_ms: 300000,
        config_json: {}
      },
      server_seed: null,
      seed_commitment: null,
      snapshot_hash: null,
      result_hash: null,
      allocation_committed_at: null
    };
  }

  async joinDrop(_dropId: string, _participantData: any): Promise<JoinDropResponse> {
    return { status: 'REGISTERED', participant_id: 'p_mock_123' };
  }

  async getAllocationStatus(_dropId: string): Promise<AllocationStatusResponse> {
    return { status: 'ALLOCATED' };
  }
}
