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
