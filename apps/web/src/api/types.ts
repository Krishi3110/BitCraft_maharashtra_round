import { DropMeta, JoinDropResponse, AllocationStatusResponse } from 'shared';

export interface EventDetails {
  id: string;
  name: string;
  totalTickets: number;
}

export type DropStateResponse = DropMeta;
export type { JoinDropResponse, AllocationStatusResponse };

export interface ApiClient {
  getEventDetails(): Promise<EventDetails>;
  getDropState(dropId: string): Promise<DropStateResponse>;
  joinDrop(dropId: string, participantData: any): Promise<JoinDropResponse>;
  getAllocationStatus(dropId: string): Promise<AllocationStatusResponse>;
}
