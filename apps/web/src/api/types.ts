export interface EventDetails {
  id: string;
  name: string;
  totalTickets: number;
}

export interface DropStateResponse {
  state: string;
  config: any;
  server_seed: string | null;
  seed_commitment: string | null;
  snapshot_hash: string | null;
  result_hash: string | null;
  allocation_committed_at: number | null;
}

export interface JoinDropResponse {
  status: string;
  participantId?: string;
}

export interface AllocationStatusResponse {
  status: 'allocated' | 'waitlisted' | 'not_selected' | 'pending';
}

export interface ApiClient {
  getEventDetails(): Promise<EventDetails>;
  getDropState(dropId: string): Promise<DropStateResponse>;
  joinDrop(dropId: string, participantData: any): Promise<JoinDropResponse>;
  getAllocationStatus(dropId: string, participantId: string): Promise<AllocationStatusResponse>;
}
