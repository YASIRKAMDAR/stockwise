import { VoiceModelOutput, type ProposalLine, type VoiceProposal } from '@stockwise/shared';
import type { Config } from '../config.ts';
import type { Db } from '../db/pool.ts';
import { err } from '../errors.ts';
import { requireHotel, rolesAt, visibleHotelIds, type Actor } from '../services/actor.ts';
import { stockMatrix } from '../services/reports.ts';
import { fakeParse, normalizeDigits } from './fake.ts';
import type { CatalogContext } from './prompt.ts';
import type { VoiceProvider } from './provider.ts';
import { warehouseOf } from '../services/requests.ts';

export const ALLOWED_AUDIO = new Set(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/flac', 'audio/mp3']);
const LARGE_QTY = 200;

const norm = (s: string) => normalizeDigits(s.toLowerCase().normalize('NFC')).replace(/[^\p{L}\p{M}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
const singular = (s: string) => s.replace(/(es|s)$/u, '');

export interface InterpretInput { audio: Buffer; mimeType: string; hotelId: string; preferredLanguage?: string; durationMs?: number; scopeAll?: boolean; client?: string; heardText?: string; mode?: 'count' }
const INFO_ACTIONS = new Set(['SHOW_ALERTS', 'SHOW_TRANSFERS', 'SHOW_ROOM_USE', 'SHOW_CHANGES', 'START_COUNT']);

async function loadCatalog(db: Db, orgId: string, hotelId: string) {
  const [products, rooms, hotels] = await Promise.all([
    db.query(`SELECT p.id, p.sku, p.name, p.unit, COALESCE(array_agg(a.alias) FILTER (WHERE a.alias IS NOT NULL), '{}') AS aliases
                FROM products p LEFT JOIN product_aliases a ON a.product_id = p.id WHERE p.organization_id = $1 AND p.active
                 AND (p.room_item OR EXISTS (SELECT 1 FROM stock_balances b0 JOIN stock_locations l0 ON l0.id = b0.location_id WHERE l0.hotel_id = $2 AND b0.product_id = p.id) OR EXISTS (SELECT 1 FROM hotel_product_settings s0 WHERE s0.hotel_id = $2 AND s0.product_id = p.id)) GROUP BY p.id ORDER BY p.name`, [orgId, hotelId]),
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
  // Typed text from the app's text box is accepted from every provider (and used by tests with the fake one).
  const textFixture = mime === 'text/plain';
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
    mode: input.mode,
  };

  const started = Date.now();
  const client = (input.client ?? '').slice(0, 20) || null;
  const inputKind = textFixture ? 'text' : 'audio';
  let fallback: string | null = null;
  const logAttempt = async (status: 'SUCCESS' | 'AMBIGUOUS' | 'FAILED', extra: { proposalId?: string; language?: string; inputTokens?: number | null; outputTokens?: number | null; model?: string; errorCode?: string }) => {
    const cost = ((extra.inputTokens ?? 0) * cfg.VOICE_PRICE_INPUT_PER_M_USD + (extra.outputTokens ?? 0) * cfg.VOICE_PRICE_OUTPUT_PER_M_USD) / 1_000_000;
    await db.query(
      `INSERT INTO voice_parse_attempts (organization_id, user_id, hotel_id, proposal_id, model_name, language_detected, duration_ms, audio_bytes, input_tokens, output_tokens, cost_usd, latency_ms, status, error_code, client, input_kind, fallback)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [actor.orgId, actor.userId, input.hotelId, extra.proposalId ?? null, extra.model ?? provider.name, extra.language ?? null, input.durationMs ?? null, input.audio.length,
       extra.inputTokens ?? null, extra.outputTokens ?? null, cost, Date.now() - started, status, extra.errorCode ?? null, client, inputKind, fallback],
    );
  };

  let result;
  try {
    result = await provider.extract(input.audio, textFixture ? 'text/plain' : mime, ctx);
  } catch (e: any) {
    // Google is slow or down. If the phone heard words, the rules parser answers from those instead of failing.
    const heard = textFixture ? input.audio.toString('utf8') : (input.heardText ?? '').trim();
    if (heard && provider.name !== 'fake') {
      fallback = 'rules';
      result = { raw: fakeParse(heard, ctx), inputTokens: 0, outputTokens: 0, model: 'fake-rule-parser', simulated: true };
    } else {
      await logAttempt('FAILED', { errorCode: e?.code ?? 'PROVIDER_ERROR' });
      throw e?.code ? e : err('TEMPORARY_UNAVAILABLE', "We couldn't understand that recording. Try again or enter it manually.");
    }
  }
  const parsed = VoiceModelOutput.safeParse(result.raw);
  if (!parsed.success) {
    await logAttempt('FAILED', { errorCode: 'SCHEMA_INVALID', model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens });
    throw err('TEMPORARY_UNAVAILABLE', "We couldn't understand that recording. Try again or enter it manually.");
  }
  const out = parsed.data;
  const warnings: string[] = [];
  if (result.simulated && !fallback) warnings.push('SIMULATED_PROVIDER');
  if (fallback) warnings.push('FALLBACK_RULES');
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
    if (it.quantity == null || (it.quantity === 0 && out.action !== 'COUNT_ENTRY')) issues.push('MISSING_QUANTITY');
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
  if (out.action === 'REQUEST_FROM_WAREHOUSE') {
    const wh = await warehouseOf(db, actor.orgId);
    if (!wh) warnings.push('NO_WAREHOUSE');
    else if (wh.id === input.hotelId) warnings.push('SAME_HOTEL');
  }
  if (out.action === 'TRANSFER_DISPATCH') {
    if (!targetHotel) warnings.push('CHOOSE_DESTINATION_HOTEL');
    else if (targetHotel.id === input.hotelId) warnings.push('SAME_HOTEL');
  }

  let status: VoiceProposal['status'] = 'READY_TO_CONFIRM';
  let queryResult: unknown;
  let proposal_question: string | null = null;
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
  } else if (out.action === 'COUNT_ENTRY') {
    // Physical counts read out during the weekly count. The app writes them to the count sheet; this proposal is never confirmed as a movement.
    status = lines.length && lines.every((l) => l.productId && (l.quantity != null || out.notes === 'same')) ? 'COUNT_ENTRY' : 'NEEDS_CLARIFICATION';
    if (status === 'NEEDS_CLARIFICATION' && !out.clarificationQuestion) proposal_question = lines.some((l) => !l.productId) ? 'Which item?' : 'How many?';
  } else if (out.action === 'TRANSFER_RECEIPT') {
    status = 'NEEDS_CLARIFICATION';
    warnings.push('USE_INCOMING_TRANSFERS');
  } else if (out.action === 'UNKNOWN' || out.clarificationNeeded || !lines.length || lines.some((l) => l.issues.some((i) => i !== 'CHECK_QUANTITY')) || warnings.includes('CHOOSE_DESTINATION_HOTEL') || warnings.includes('SAME_HOTEL')) {
    status = 'NEEDS_CLARIFICATION';
  }

  const expiresAt = new Date(Date.now() + cfg.VOICE_PROPOSAL_TTL_MINUTES * 60_000);
  const proposal: Omit<VoiceProposal, 'proposalId'> = {
    status, detectedLanguage: out.language, transcript: out.transcript, action: out.action, targetHotelId: targetHotel?.id ?? null,
    lines, warnings, clarificationQuestion: out.clarificationQuestion ?? proposal_question, expiresAt: expiresAt.toISOString(), queryResult,
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

/** Voice health for the last N days: success rate and latency, by day, by language and by app, plus the most recent attempts (never audio). */
export async function voiceHealth(db: Db, orgId: string, days: number) {
  const where = `organization_id = $1 AND created_at > now() - ($2 || ' days')::interval`;
  const agg = `count(*)::int AS attempts,
       count(*) FILTER (WHERE status='SUCCESS')::int AS success, count(*) FILTER (WHERE status='AMBIGUOUS')::int AS ambiguous, count(*) FILTER (WHERE status='FAILED')::int AS failed,
       count(*) FILTER (WHERE fallback IS NOT NULL)::int AS fallback,
       COALESCE(sum(cost_usd),0)::float AS cost_usd,
       COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms),0)::int AS p50_ms,
       COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms),0)::int AS p95_ms`;
  const args = [orgId, String(days)];
  const [total, byDay, byLang, byClient, recent] = await Promise.all([
    db.query(`SELECT ${agg} FROM voice_parse_attempts WHERE ${where}`, args),
    db.query(`SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, ${agg} FROM voice_parse_attempts WHERE ${where} GROUP BY 1 ORDER BY 1 DESC`, args),
    db.query(`SELECT COALESCE(language_detected,'unknown') AS language, ${agg} FROM voice_parse_attempts WHERE ${where} GROUP BY 1 ORDER BY attempts DESC`, args),
    db.query(`SELECT COALESCE(client,'unknown') AS client, ${agg} FROM voice_parse_attempts WHERE ${where} GROUP BY 1 ORDER BY attempts DESC`, args),
    db.query(`SELECT a.created_at, a.status, a.error_code, a.language_detected AS language, a.client, a.input_kind, a.fallback, a.latency_ms, a.duration_ms, u.display_name AS user, p.proposal->>'transcript' AS transcript, p.proposal->>'action' AS action, (p.consumed_event_id IS NOT NULL) AS confirmed
         FROM voice_parse_attempts a JOIN users u ON u.id = a.user_id LEFT JOIN voice_proposals p ON p.id = a.proposal_id
        WHERE a.organization_id = $1 AND a.created_at > now() - ($2 || ' days')::interval ORDER BY a.created_at DESC LIMIT 25`, args),
  ]);
  return { total: total.rows[0], byDay: byDay.rows, byLanguage: byLang.rows, byClient: byClient.rows, recent: recent.rows };
}

/** A staff member's own recent attempts, so they (or whoever is testing with them) can see what the app heard. Never audio. */
export async function myVoiceAttempts(db: Db, userId: string, limit = 5) {
  const r = await db.query(
    `SELECT a.created_at, a.status, a.error_code, a.language_detected AS language, a.client, a.input_kind, a.fallback, a.latency_ms,
            p.proposal->>'transcript' AS transcript, p.proposal->>'action' AS action, (p.consumed_event_id IS NOT NULL) AS confirmed
       FROM voice_parse_attempts a LEFT JOIN voice_proposals p ON p.id = a.proposal_id
      WHERE a.user_id = $1 ORDER BY a.created_at DESC LIMIT $2`, [userId, limit]);
  return r.rows;
}
