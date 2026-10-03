import { ApiClient, EventDetails, DropStateResponse, JoinDropResponse, AllocationStatusResponse } from './types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export class RealApiClient implements ApiClient {
  async getEventDetails(): Promise<EventDetails> {
    return { id: 'ev_123', name: 'FUTUREFEST 2026', totalTickets: 500 };
  }

  async getDropState(dropId: string): Promise<DropStateResponse> {
    const res = await fetch(`${API_BASE_URL}/api/v1/drops/${dropId}`, {
      credentials: 'omit'
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch drop state: ${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  async initSession(): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit' // We don't send cookies, but we want the Set-Cookie response
    });
    if (!res.ok) {
      throw new Error(`Session init failed: ${res.status}`);
    }
  }

  async joinDrop(dropId: string, payload: any): Promise<JoinDropResponse> {
    const res = await fetch(`${API_BASE_URL}/api/v1/drops/${dropId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include' // Must include session cookie!
    });
    if (!res.ok) {
      throw new Error(`Join Drop failed: ${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  async getAllocationStatus(dropId: string, participantId: string): Promise<AllocationStatusResponse> {
    const res = await fetch(`${API_BASE_URL}/api/v1/drops/${dropId}/status`, {
      credentials: 'include' // Must include session cookie!
    });
    if (!res.ok) {
      throw new Error(`Allocation status failed: ${res.status} ${res.statusText}`);
    }
    return res.json();
  }
}
