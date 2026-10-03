import { ApiClient, EventDetails, DropStateResponse, JoinDropResponse, AllocationStatusResponse } from './types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export class RealApiClient implements ApiClient {
  async getEventDetails(): Promise<EventDetails> {
    // There is no dedicated event endpoint in API contract, simulate one for now
    // or return a hardcoded one matching FUTUREFEST 2026.
    return { id: 'ev_123', name: 'FUTUREFEST 2026', totalTickets: 500 };
  }

  async getDropState(dropId: string): Promise<DropStateResponse> {
    const res = await fetch(`${API_BASE_URL}/api/v1/drops/${dropId}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch drop state: ${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  async joinDrop(dropId: string, participantData: any): Promise<JoinDropResponse> {
    const res = await fetch(`${API_BASE_URL}/api/v1/drops/${dropId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(participantData),
    });
    if (!res.ok) {
      throw new Error(`Join Drop failed: ${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  async getAllocationStatus(dropId: string): Promise<AllocationStatusResponse> {
    const res = await fetch(`${API_BASE_URL}/api/v1/drops/${dropId}/status`);
    if (!res.ok) {
      throw new Error(`Allocation status failed: ${res.status} ${res.statusText}`);
    }
    return res.json();
  }
}
