import { z } from 'zod';

export const DropStateEnum = z.enum([
  'DRAFT',
  'SCHEDULED',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'ALLOCATING',
  'BOOKING_OPEN',
  'CLOSED',
  'CANCELLED',
  'HALTED'
]);
export type DropState = z.infer<typeof DropStateEnum>;

export const TransitionRequestSchema = z.object({
  to: DropStateEnum,
  reason: z.string().optional(),
  virtual_now: z.number().optional()
});

export const DropConfigSchema = z.object({
  mode: z.enum(['FAIR', 'NAIVE']),
  kind: z.enum(['PUBLIC', 'EXPERIMENT']),
  clock_mode: z.enum(['WALL', 'VIRTUAL']),
  total_inventory: z.number().int().positive(),
  opens_at: z.number().int(),
  registration_closes_at: z.number().int(),
  booking_closes_at: z.number().int(),
  offer_ttl_ms: z.number().int().positive(),
  hold_ttl_ms: z.number().int().positive(),
  config_json: z.any()
});
export type DropConfig = z.infer<typeof DropConfigSchema>;

export interface DropMeta {
  state: DropState;
  config: DropConfig | null;
  server_seed: string | null;
  seed_commitment: string | null;
  snapshot_hash: string | null;
  result_hash: string | null;
  allocation_committed_at: number | null;
}

// ==========================================
// PHASE 4/5 API CONTRACT SCHEMAS
// ==========================================

export const ParticipantStatusEnum = z.enum([
  'REGISTERED',
  'ALLOCATED',
  'WAITLISTED',
  'CONFIRMED',
  'EXPIRED'
]);
export type ParticipantStatus = z.infer<typeof ParticipantStatusEnum>;

// POST /api/v1/drops/:id/join
// IDEMPOTENCY: Repeated join requests from the same authenticated session and drop 
// MUST return the existing registration rather than create duplicates.
// IDENTITY: Backend derives participant identity from a validated server-issued session.
export const JoinDropRequestSchema = z.object({
  turnstile_token: z.string().max(4096).optional(),
  challenge_response: z.string().max(4096).optional()
});
export type JoinDropRequest = z.infer<typeof JoinDropRequestSchema>;

export const JoinDropResponseSchema = z.object({
  status: ParticipantStatusEnum,
  participant_id: z.string(),
  session_expires_at: z.number().int().optional()
});
export type JoinDropResponse = z.infer<typeof JoinDropResponseSchema>;

// GET /api/v1/drops/:id/status
export const AllocationStatusResponseSchema = z.object({
  status: ParticipantStatusEnum,
  ticket_id: z.string().optional(),
  expires_at: z.number().int().optional()
});
export type AllocationStatusResponse = z.infer<typeof AllocationStatusResponseSchema>;

// POST /api/v1/telemetry
// Strict bounds on telemetry payload to prevent abuse/OOM
export const TelemetryBatchSchema = z.object({
  window_ms: z.number().int().min(100).max(60000),
  mouse_moves: z.number().int().nonnegative().max(50000),
  clicks: z.number().int().nonnegative().max(5000),
  scrolls: z.number().int().nonnegative().max(10000),
  dwell_time_ms: z.number().int().nonnegative().max(60000)
});
export type TelemetryBatch = z.infer<typeof TelemetryBatchSchema>;
