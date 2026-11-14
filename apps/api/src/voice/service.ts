import { VoiceModelOutput, type ProposalLine, type VoiceProposal } from '@stockwise/shared';
import type { Config } from '../config.ts';
import type { Db } from '../db/pool.ts';
import { err } from '../errors.ts';
import { requireHotel, rolesAt, visibleHotelIds, type Actor } from '../services/actor.ts';
import { stockMatrix } from '../services/reports.ts';
import { normalizeDigits } from './fake.ts';
import type { CatalogContext } from './prompt.ts';
import type { VoiceProvider } from './provider.ts';

export const ALLOWED_AUDIO = new Set(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/flac', 'audio/mp3']);
const LARGE_QTY = 200;

const norm = (s: string) => normalizeDigits(s.toLowerCase().normalize('NFC')).replace(/[^\p{L}\p{M}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
const singular = (s: string) => s.replace(/(es|s)$/u, '');

export interface InterpretInput { audio: Buffer; mimeType: string; hotelId: string; preferredLanguage?: string; durationMs?: number; scopeAll?: boolean }
const INFO_ACTIONS = new Set(['SHOW_ALERTS', 'SHOW_TRANSFERS', 'SHOW_ROOM_USE', 'SHOW_CHANGES', 'START_COUNT']);

async function loadCatalog(db: Db, orgId: string, hotelId: string) {
  const [products, rooms, hotels] = await Promise.all([
    db.query(`SELECT p.id, p.sku, p.name, p.unit, COALESCE(array_agg(a.alias) FILTER (WHERE a.alias IS NOT NULL), '{}') AS aliases
                FROM products p LEFT JOIN product_aliases a ON a.product_id = p.id WHERE p.organization_id = $1 AND p.active GROUP BY p.id ORDER BY p.name`, [orgId]),
    db.query(`SELECT id, room_number FROM rooms WHERE hotel_id = $1 AND active ORDER BY room_number`, [hotelId]),
    db.query(`SELECT id, code, name FROM hotels WHERE organization_id = $1 AND active ORDER BY code`, [orgId]),
  ]);
  return { products: products.rows as { id: string; sku: string; name: string; unit: string; aliases: string[] }[], rooms: rooms.rows as { id: string; room_number: string }[], hotels: hotels.rows as { id: string; code: string; name: string }[] };
}

function resolveProduct(spoken: string, products: { id: string; sku: string; name: string; aliases: string[] }[]) {
  const s = norm(spoken);
  const matches = products.filter((p) => {
    const keys = [p.name, p.sku.replace(/_/g, ' '), ...p.aliases].map(norm);
    return keys.some((k) => k === s || singular(k) === singular(s));
  });
  return matches;
}

/** Hotel by code, by trailing digit in code/name ("2" -> H2 / "Hotel 2"), or by name. Unequivocal only. */
function resolveHotel(code: string | null, hotels: { id: string; code: string; name: string }[]) {
  if (!code) return null;
  const c = norm(code);
  const m = hotels.filter((h) => norm(h.code) === c || norm(h.name) === c || (/^\d+$/.test(c) && (norm(h.code).replace(/\D/g, '') === c || norm(h.name).match(/(\d+)$/)?.[1] === c)));
  return m.length === 1 ? m[0] : null;
}

export async function interpret(db: Db, cfg: Config, provider: VoiceProvider | null, actor: Actor, input: InterpretInput): Promise<VoiceProposal> {
  if (!provider) throw err('VOICE_DISABLED', 'Voice entry is turned off. Please enter it manually.');
  const hotel = await requireHotel(db, actor, input.hotelId);
  const mime = input.mimeType.split(';')[0].trim().toLowerCase();
  const textFixture = provider.name === 'fake' && mime === 'text/plain';
  if (!ALLOWED_AUDIO.has(mime) && !textFixture) throw err('UNSUPPORTED_AUDIO', 'Unsupported recording format');
  if (input.audio.length === 0) throw err('UNSUPPORTED_AUDIO', 'Empty recording');
  if (input.audio.length > cfg.VOICE_MAX_BYTES) throw err('UNSUPPORTED_AUDIO', `Recording too large. Keep it under ${cfg.VOICE_MAX_SECONDS} seconds or split it.`);
  if (input.durationMs && input.durationMs > cfg.VOICE_MAX_SECONDS * 1000 + 1500) throw err('UNSUPPORTED_AUDIO', `Recording too long. Keep it under ${cfg.VOICE_MAX_SECONDS} seconds.`);

  const spent = await db.query(`SELECT COALESCE(sum(cost_usd), 0) AS usd FROM voice_parse_attempts WHERE organization_id = $1 AND created_at >= date_trunc('day', now())`, [actor.orgId]);
  if (Number(spent.rows[0].usd) >= cfg.VOICE_DAILY_LIMIT_USD) throw err('BUDGET_EXCEEDED', 'Daily voice budget reached. Please enter it manually.');

  const cat = await loadCatalog(db, actor.orgId, input.hotelId);
  const ctx: CatalogContext = {
    hotelCode: hotel.code,
    hotels: cat.hotels.map((h) => ({ code: h.code, name: h.name })),
    products: cat.products.map((p) => ({ sku: p.sku, name: p.name, unit: p.unit, aliases: p.aliases })),
    rooms: cat.rooms.length <= 300 ? cat.rooms.map((r) => r.room_number) : null,
    preferredLanguage: input.preferredLanguage,
  };

  const started = Date.now();
  const logAttempt = async (status: 'SUCCESS' | 'AMBIGUOUS' | 'FAILED', extra: { proposalId?: string; language?: string; inputTokens?: number | null; outputTokens?: number | null; model?: string; errorCode?: string }) => {
    const cost = ((extra.inputTokens ?? 0) * cfg.VOICE_PRICE_INPUT_PER_M_USD + (extra.outputTokens ?? 0) * cfg.VOICE_PRICE_OUTPUT_PER_M_USD) / 1_000_000;
    await db.query(
      `INSERT INTO voice_parse_attempts (organization_id, user_id, hotel_id, proposal_id, model_name, language_detected, duration_ms, audio_bytes, input_tokens, output_tokens, cost_usd, latency_ms, status, error_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [actor.orgId, actor.userId, input.hotelId, extra.proposalId ?? null, extra.model ?? provider.name, extra.language ?? null, input.durationMs ?? null, input.audio.length,
       extra.inputTokens ?? null, extra.outputTokens ?? null, cost, Date.now() - started, status, extra.errorCode ?? null],
    );
  };

  let result;
  try {
    result = await provider.extract(input.audio, textFixture ? 'text/plain' : mime, ctx);
  } catch (e: any) {
    await logAttempt('FAILED', { errorCode: e?.code ?? 'PROVIDER_ERROR' });
    throw e?.code ? e : err('TEMPORARY_UNAVAILABLE', "We couldn't understand that recording. Try again or enter it manually.");
  }
  const parsed = VoiceModelOutput.safeParse(result.raw);
  if (!parsed.success) {
    await logAttempt('FAILED', { errorCode: 'SCHEMA_INVALID', model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens });
    throw err('TEMPORARY_UNAVAILABLE', "We couldn't understand that recording. Try again or enter it manually.");
  }
  const out = parsed.data;
  const warnings: string[] = [];
  if (result.simulated) warnings.push('SIMULATED_PROVIDER');
  if (out.notes) warnings.push(`MODEL_NOTE:${out.notes.slice(0, 120)}`);

  // Resolve against canonical catalog. Model output is untrusted.
  const roomByNumber = new Map(cat.rooms.map((r) => [norm(r.room_number), r]));
  const targetHotel = resolveHotel(out.items.find((i) => i.targetHotelCode)?.targetHotelCode ?? (out.notes?.startsWith('hotel:') ? out.notes.slice(6) : null), cat.hotels);

  let bag = new Map<string, number>();
  if (out.action === 'PLACE_IN_ROOM') {
    const r = await db.query(
      `SELECT b.product_id, b.quantity FROM stock_balances b JOIN stock_locations sl ON sl.id = b.location_id WHERE sl.type='STAFF_BAG' AND sl.hotel_id=$1 AND sl.owner_user_id=$2`,
      [input.hotelId, actor.userId]);
    bag = new Map(r.rows.map((x) => [x.product_id, x.quantity]));
  }

  const lines: ProposalLine[] = out.items.map((it) => {
    const issues: string[] = [];
    const matches = resolveProduct(it.spokenProduct, cat.products);
    const product = matches.length === 1 ? matches[0] : null;
    if (!matches.length) issues.push('UNKNOWN_PRODUCT');
    if (matches.length > 1) issues.push('AMBIGUOUS_PRODUCT');
    if (it.quantity == null) issues.push('MISSING_QUANTITY');
    else if (it.quantity > LARGE_QTY) issues.push('CHECK_QUANTITY');
    let room: { id: string; room_number: string } | null = null;
    if (out.action === 'PLACE_IN_ROOM') {
      if (!it.roomNumber) issues.push('MISSING_ROOM');
      else if (!(room = roomByNumber.get(norm(it.roomNumber)) ?? null)) issues.push('UNKNOWN_ROOM');
    }
    let source: 'STORE' | 'MY_STOCK' | null = it.sourceHint;
    return {
      productId: product?.id ?? null, productName: product?.name ?? null, spokenProduct: it.spokenProduct, quantity: it.quantity,
      roomId: room?.id ?? null, roomNumber: room?.room_number ?? it.roomNumber, source,
      candidates: matches.length > 1 ? matches.map((m) => ({ productId: m.id, name: m.name })) : undefined, issues,
    };
  });

  // Source for room placements: default My stock only if the bag covers every line; otherwise force explicit choice.
  if (out.action === 'PLACE_IN_ROOM') {
    const need = new Map<string, number>();
    for (const l of lines) if (l.productId && l.quantity && !l.source) need.set(l.productId, (need.get(l.productId) ?? 0) + l.quantity);
    for (const l of lines) {
      if (l.source) continue;
      if (l.productId && (bag.get(l.productId) ?? 0) >= (need.get(l.productId) ?? Infinity)) l.source = 'MY_STOCK';
      else l.issues.push('CHOOSE_SOURCE');
    }
  }
  if (out.action === 'TRANSFER_DISPATCH') {
    if (!targetHotel) warnings.push('CHOOSE_DESTINATION_HOTEL');
    else if (targetHotel.id === input.hotelId) warnings.push('SAME_HOTEL');
  }

  let status: VoiceProposal['status'] = 'READY_TO_CONFIRM';
  let queryResult: unknown;
  if (out.action === 'STOCK_QUERY') {
    status = 'QUERY_RESULT';
    let qHotels = [targetHotel?.id ?? input.hotelId];
    if (!targetHotel && input.scopeAll && actor.authMethod === 'PASSWORD') qHotels = await visibleHotelIds(db, actor);
    else if (qHotels[0] !== input.hotelId && !rolesAt(actor, qHotels[0]).size) { warnings.push('OTHER_HOTEL_NOT_VISIBLE'); qHotels = [input.hotelId]; }
    const ids = lines.map((l) => l.productId).filter(Boolean) as string[];
    const m = (await stockMatrix(db, actor.orgId, qHotels)).filter((r) => !ids.length || ids.includes(r.productId));
    queryResult = m.map((r) => ({ hotelId: r.hotelId, hotelName: r.hotelName, low: r.low, productId: r.productId, name: r.name, unit: r.unit, store: r.store, staffHeld: r.staffHeld, inTransit: r.inTransitOut + r.inTransitIn }));
  } else if (INFO_ACTIONS.has(out.action)) {
    // Opens a screen in the app; nothing is written. targetHotelId (if spoken) narrows the screen.
    status = 'NAVIGATE';
  } else if (out.action === 'TRANSFER_RECEIPT') {
    status = 'NEEDS_CLARIFICATION';
    warnings.push('USE_INCOMING_TRANSFERS');
  } else if (out.action === 'UNKNOWN' || out.clarificationNeeded || !lines.length || lines.some((l) => l.issues.some((i) => i !== 'CHECK_QUANTITY')) || warnings.includes('CHOOSE_DESTINATION_HOTEL') || warnings.includes('SAME_HOTEL')) {
    status = 'NEEDS_CLARIFICATION';
  }

  const expiresAt = new Date(Date.now() + cfg.VOICE_PROPOSAL_TTL_MINUTES * 60_000);
  const proposal: Omit<VoiceProposal, 'proposalId'> = {
    status, detectedLanguage: out.language, transcript: out.transcript, action: out.action, targetHotelId: targetHotel?.id ?? null,
    lines, warnings, clarificationQuestion: out.clarificationQuestion, expiresAt: expiresAt.toISOString(), queryResult,
  };
  const saved = await db.query(
    `INSERT INTO voice_proposals (organization_id, user_id, hotel_id, proposal, expires_at) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [actor.orgId, actor.userId, input.hotelId, JSON.stringify(proposal), expiresAt],
  );
  const proposalId = saved.rows[0].id;
  await logAttempt(status === 'NEEDS_CLARIFICATION' ? 'AMBIGUOUS' : 'SUCCESS', { proposalId, language: out.language, inputTokens: result.inputTokens, outputTokens: result.outputTokens, model: result.model });
  return { proposalId, ...proposal };
}

export async function voiceUsage(db: Db, orgId: string, days: number) {
  const r = await db.query(
    `WITH a AS (
       SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*)::int AS attempts,
              count(*) FILTER (WHERE status='SUCCESS')::int AS success, count(*) FILTER (WHERE status='AMBIGUOUS')::int AS ambiguous,
              count(*) FILTER (WHERE status='FAILED')::int AS failed,
              COALESCE(sum(input_tokens),0)::int AS input_tokens, COALESCE(sum(output_tokens),0)::int AS output_tokens,
              COALESCE(sum(cost_usd),0) AS cost_usd, COALESCE(avg(duration_ms),0)::int AS avg_duration_ms
         FROM voice_parse_attempts WHERE organization_id = $1 AND created_at > now() - ($2 || ' days')::interval GROUP BY 1),
     c AS (
       SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*)::int AS confirmed
         FROM voice_proposals WHERE organization_id = $1 AND consumed_event_id IS NOT NULL AND created_at > now() - ($2 || ' days')::interval GROUP BY 1)
     SELECT a.*, COALESCE(c.confirmed, 0) AS confirmed FROM a LEFT JOIN c USING (day) ORDER BY a.day DESC`,
    [orgId, String(days)],
  );
  return r.rows;
}
