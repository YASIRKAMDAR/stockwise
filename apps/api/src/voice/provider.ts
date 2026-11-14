import type { Config } from '../config.ts';
import { err } from '../errors.ts';
import { contextText, RESPONSE_JSON_SCHEMA, SYSTEM_PROMPT, type CatalogContext } from './prompt.ts';
import { fakeParse } from './fake.ts';

export interface ExtractResult { raw: unknown; inputTokens: number | null; outputTokens: number | null; model: string; simulated: boolean }
export interface VoiceProvider { readonly name: string; extract(audio: Buffer, mimeType: string, ctx: CatalogContext): Promise<ExtractResult> }

/** Server-only Gemini adapter: direct audio → structured JSON proposal. Never touches the database. */
export class GeminiProvider implements VoiceProvider {
  readonly name = 'gemini';
  constructor(private cfg: Config, private fetchImpl: typeof fetch = fetch) {}
  async extract(audio: Buffer, mimeType: string, ctx: CatalogContext): Promise<ExtractResult> {
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: contextText(ctx) }, mimeType === 'text/plain'
        // Typed in the app's text box instead of spoken: same extraction, from text.
        ? { text: `The user typed this instead of speaking. Treat it exactly like a transcript:\n${audio.toString('utf8').slice(0, 500)}` }
        : { inlineData: { mimeType, data: audio.toString('base64') } }] }],
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: RESPONSE_JSON_SCHEMA, temperature: 0, maxOutputTokens: 2048 },
    };
    const url = `${this.cfg.GEMINI_API_BASE}/models/${encodeURIComponent(this.cfg.GEMINI_MODEL)}:generateContent`;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) { // one bounded retry on timeout/5xx; never loops into writes
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), this.cfg.GEMINI_TIMEOUT_MS);
      try {
        const res = await this.fetchImpl(url, {
          method: 'POST', signal: ctl.signal,
          headers: { 'content-type': 'application/json', 'x-goog-api-key': this.cfg.GEMINI_API_KEY! },
          body: JSON.stringify(body),
        });
        if (res.status >= 500 || res.status === 429) { lastErr = new Error(`provider ${res.status}`); continue; }
        if (!res.ok) throw err('TEMPORARY_UNAVAILABLE', `Voice provider rejected request (${res.status})`);
        const json: any = await res.json();
        const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '';
        let raw: unknown;
        try { raw = JSON.parse(text); } catch { throw err('TEMPORARY_UNAVAILABLE', 'Voice provider returned invalid JSON'); }
        return { raw, inputTokens: json?.usageMetadata?.promptTokenCount ?? null, outputTokens: json?.usageMetadata?.candidatesTokenCount ?? null, model: this.cfg.GEMINI_MODEL, simulated: false };
      } catch (e: any) {
        if (e?.code && e?.status) throw e;
        lastErr = e;
      } finally {
        clearTimeout(t);
      }
    }
    throw err('TEMPORARY_UNAVAILABLE', 'Voice service is unavailable. Please enter it manually.', { cause: String(lastErr) });
  }
}

/**
 * FAKE provider for CI/dev only. If the uploaded "audio" is UTF-8 text (test fixture), it runs a
 * small rule-based parser; real audio returns UNKNOWN. It is NOT speech recognition.
 */
export class FakeProvider implements VoiceProvider {
  readonly name = 'fake';
  async extract(audio: Buffer, mimeType: string, ctx: CatalogContext): Promise<ExtractResult> {
    const text = mimeType.startsWith('text/') ? audio.toString('utf8') : '';
    return { raw: fakeParse(text, ctx), inputTokens: 0, outputTokens: 0, model: 'fake-rule-parser', simulated: true };
  }
}

export function createProvider(cfg: Config): VoiceProvider | null {
  if (cfg.VOICE_PROVIDER === 'gemini') return new GeminiProvider(cfg);
  if (cfg.VOICE_PROVIDER === 'fake') return new FakeProvider();
  return null;
}
