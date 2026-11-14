import { z } from 'zod';

// ---------- Enums ----------
export const ROLES = ['STAFF', 'MANAGER', 'OWNER'] as const;
export type Role = (typeof ROLES)[number];

/** Actions accepted by POST /transactions. Transfers have dedicated endpoints. */
export const TX_ACTIONS = [
  'SUPPLIER_RECEIPT',
  'CHECKOUT_TO_STAFF',
  'PLACE_IN_ROOM',
  'RETURN_TO_STORE',
  'WASTE',
  'STOCK_ADJUSTMENT',
  'OPENING_BALANCE',
] as const;
export type TxAction = (typeof TX_ACTIONS)[number];

export const ALL_EVENT_ACTIONS = [
  ...TX_ACTIONS,
  'TRANSFER_DISPATCH',
  'TRANSFER_RECEIPT',
  'TRANSFER_RESOLUTION',
  'REVERSAL',
] as const;
export type EventAction = (typeof ALL_EVENT_ACTIONS)[number];

export const VOICE_ACTIONS = [
  'SUPPLIER_RECEIPT',
  'CHECKOUT_TO_STAFF',
  'PLACE_IN_ROOM',
  'RETURN_TO_STORE',
  'TRANSFER_DISPATCH',
  'TRANSFER_RECEIPT',
  'STOCK_QUERY',
  // Requests from managers/owners that open a screen; never change stock.
  'SHOW_ALERTS',
  'SHOW_TRANSFERS',
  'SHOW_ROOM_USE',
  'SHOW_CHANGES',
  'START_COUNT',
  'UNKNOWN',
] as const;
export const NAVIGATE_ACTIONS = ['SHOW_ALERTS', 'SHOW_TRANSFERS', 'SHOW_ROOM_USE', 'SHOW_CHANGES', 'START_COUNT'] as const;
export type VoiceAction = (typeof VOICE_ACTIONS)[number];

export const TRANSFER_STATUSES = ['IN_TRANSIT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'DISCREPANCY', 'RESOLVED'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export const ERROR_CODES = [
  'INVALID_INPUT',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'HOTEL_NOT_ALLOWED',
  'INVALID_ROOM_OR_PRODUCT',
  'INSUFFICIENT_STOCK',
  'STALE_COUNT_SNAPSHOT',
  'TRANSFER_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'IDEMPOTENCY_KEY_REQUIRED',
  'PROPOSAL_EXPIRED',
  'TEMPORARY_UNAVAILABLE',
  'RATE_LIMITED',
  'NOT_FOUND',
  'DEVICE_NOT_ENROLLED',
  'ACCOUNT_LOCKED',
  'UNSUPPORTED_AUDIO',
  'VOICE_DISABLED',
  'BUDGET_EXCEEDED',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

// ---------- Primitives ----------
export const uuid = z.string().uuid();
/** Positive whole number of units — rejects 0, fractions, negatives. */
export const qty = z.number().int().positive().max(100000);

// ---------- Auth ----------
export const StaffLoginBody = z.object({
  employeeCode: z.string().min(1).max(40),
  pin: z.string().regex(/^\d{4,8}$/),
  /** Optional: a phone set up by a manager pins the session to that hotel. Without it staff sign in with code + passcode alone. */
  deviceId: uuid.optional(),
  deviceSecret: z.string().min(16).max(200).optional(),
  hotelId: uuid.optional(),
});
export const PasswordLoginBody = z.object({
  employeeCode: z.string().min(1).max(40),
  password: z.string().min(10).max(200),
});
export const EnrollDeviceBody = z.object({ label: z.string().min(1).max(60), hotelId: uuid });

// ---------- Transactions ----------
export const TxLine = z.object({
  productId: uuid,
  quantity: qty,
  /** 'STORE' | 'MY_STOCK' — resolved to a location server-side. Client never supplies raw location ids for source. */
  source: z.enum(['STORE', 'MY_STOCK']).optional(),
  roomId: uuid.optional(),
  /** For STOCK_ADJUSTMENT: +/- direction */
  direction: z.enum(['IN', 'OUT']).optional(),
});
export type TxLine = z.infer<typeof TxLine>;

export const CreateTxBody = z.object({
  action: z.enum(TX_ACTIONS),
  hotelId: uuid,
  lines: z.array(TxLine).min(1).max(50),
  note: z.string().max(500).optional(),
  reason: z.string().max(200).optional(),
  proposalId: uuid.optional(),
});
export type CreateTxBody = z.infer<typeof CreateTxBody>;

export const ReversalBody = z.object({ reason: z.string().min(3).max(300) });

// ---------- Transfers ----------
export const CreateTransferBody = z.object({
  fromHotelId: uuid,
  toHotelId: uuid,
  lines: z.array(z.object({ productId: uuid, quantity: qty })).min(1).max(50),
  note: z.string().max(500).optional(),
  proposalId: uuid.optional(),
});
export const ReceiveTransferBody = z.object({
  lines: z.array(z.object({ productId: uuid, receivedQuantity: z.number().int().min(0).max(100000) })).min(1),
  note: z.string().max(500).optional(),
  /** true = "this is everything that arrived"; any shortfall becomes a DISCREPANCY for a manager to resolve. */
  final: z.boolean().optional(),
});
export const ResolveTransferBody = z.object({
  reason: z.enum(['LOST', 'DAMAGED', 'COUNTING_ERROR', 'OTHER']),
  note: z.string().max(500).optional(),
});

// ---------- Counts ----------
export const VARIANCE_REASONS = ['COUNTING_ERROR', 'DAMAGED', 'UNRECORDED_ISSUE', 'RECEIPT_OVERSIGHT', 'EXPIRED', 'OTHER'] as const;
export const StartCountBody = z.object({ hotelId: uuid });
export const PatchCountLinesBody = z.object({
  lines: z
    .array(
      z.object({
        productId: uuid,
        physicalQty: z.number().int().min(0).max(100000).nullable(),
        reason: z.enum(VARIANCE_REASONS).nullable().optional(),
      }),
    )
    .min(1),
});

// ---------- Catalog admin ----------
export const CreateProductBody = z.object({
  sku: z.string().regex(/^[A-Z0-9_]{2,40}$/),
  name: z.string().min(1).max(80),
  unit: z.string().min(1).max(20).default('pcs'),
  aliases: z.array(z.object({ locale: z.string().max(10), alias: z.string().min(1).max(60) })).default([]),
});
export const PatchProductBody = z.object({
  name: z.string().min(1).max(80).optional(),
  unit: z.string().min(1).max(20).optional(),
  active: z.boolean().optional(),
  aliases: z.array(z.object({ locale: z.string().max(10), alias: z.string().min(1).max(60) })).optional(),
});
export const CreateRoomsBody = z.object({ hotelId: uuid, roomNumbers: z.array(z.string().regex(/^[A-Za-z0-9-]{1,10}$/)).min(1).max(500) });
export const ThresholdBody = z.object({ reorderThreshold: z.number().int().min(0), suggestedReorderQty: z.number().int().min(0).optional() });
export const CreateUserBody = z.object({
  employeeCode: z.string().regex(/^[A-Za-z0-9_-]{2,40}$/),
  displayName: z.string().min(1).max(80),
  role: z.enum(['STAFF', 'MANAGER']),
  hotelIds: z.array(uuid).min(1),
  pin: z.string().regex(/^\d{4,8}$/).optional(),
  password: z.string().min(10).max(200).optional(),
  preferredLanguage: z.enum(['en', 'hi', 'gu']).default('en'),
});

// ---------- Voice (model output contract — mirrors backend/voice_intent_schema.json) ----------
export const VoiceModelItem = z
  .object({
    spokenProduct: z.string().max(80),
    quantity: z.number().int().min(1).max(100000).nullable(),
    roomNumber: z.string().max(12).nullable(),
    targetHotelCode: z.string().max(20).nullable(),
    sourceHint: z.enum(['STORE', 'MY_STOCK']).nullable(),
  })
  .strict();
export const VoiceModelOutput = z
  .object({
    language: z.enum(['gu-IN', 'hi-IN', 'en-IN', 'mixed', 'unknown']),
    action: z.enum(VOICE_ACTIONS),
    transcript: z.string().max(1000),
    items: z.array(VoiceModelItem).max(30),
    clarificationNeeded: z.boolean(),
    clarificationQuestion: z.string().max(300).nullable(),
    notes: z.string().max(300).nullable(),
  })
  .strict();
export type VoiceModelOutput = z.infer<typeof VoiceModelOutput>;

export interface ProposalLine {
  productId: string | null;
  productName: string | null;
  spokenProduct: string;
  quantity: number | null;
  roomId: string | null;
  roomNumber: string | null;
  source: 'STORE' | 'MY_STOCK' | null;
  candidates?: { productId: string; name: string }[];
  issues: string[];
}
export interface VoiceProposal {
  proposalId: string;
  status: 'READY_TO_CONFIRM' | 'NEEDS_CLARIFICATION' | 'QUERY_RESULT' | 'NAVIGATE';
  detectedLanguage: string;
  transcript: string;
  action: VoiceAction;
  targetHotelId: string | null;
  lines: ProposalLine[];
  warnings: string[];
  clarificationQuestion: string | null;
  expiresAt: string;
  queryResult?: unknown;
}

export interface ApiError {
  error: { code: ErrorCode; message: string; details?: unknown };
}
