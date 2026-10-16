/**
 * SupabaseGeminiProvider — talks to the `npc-dialogue` Edge Function.
 *
 * Security model:
 *   - Browser holds only the publishable anon key + the player's own
 *     anonymous-sign-in session JWT (localStorage `sb-…`, Supabase default).
 *   - The Edge Function verifies that JWT, loads the player's memories under
 *     RLS, and calls Gemini with the server-held GEMINI_API_KEY.
 *   - No service-role key, no Gemini key, no privileged credential of any
 *     kind ever reaches this file, the bundle, or localStorage.
 *
 * Failures are surfaced as readable Error messages (quota / auth / network /
 * timeout / misconfig) — the dialogue engine shows them and falls back to the
 * labelled demo path for that turn.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { CloudConfig } from './cloud-config';

export interface CloudTurnResult {
  reply: string;
  trust: number;
  trustDelta: number;
  memoriesStored: number;
  /** Memories the backend extracted this turn (for local mirror/UI). */
  stored: { type: string; summary: string }[];
}

export class SupabaseGeminiProvider {
  readonly isPlaceholder = false;
  private client: SupabaseClient;
  private model: string | null = null;

  /** Reflects the actual model name once the backend answers. */
  get label() {
    return this.model
      ? `Gemini via Supabase Edge (${this.model}) — memories persist server-side`
      : this.baseLabel;
  }

  constructor(cfg: CloudConfig) {
    this.client = createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }

  private baseLabel = 'Gemini via Supabase Edge (connecting… first message confirms the session)';

  /** Ensures an anonymous session exists (one-time per browser). */
  async ensureSession(): Promise<string> {
    const { data } = await this.client.auth.getSession();
    if (data.session) return data.session.access_token;
    const { data: signed, error } = await this.client.auth.signInAnonymously();
    if (error || !signed.session) {
      throw new Error(
        `Could not start a Supabase session (${error?.message ?? 'no session returned'}). ` +
        'Check that Anonymous sign-ins are enabled in your Supabase Auth settings.'
      );
    }
    return signed.session.access_token;
  }

  /**
   * One dialogue turn. `history` is prior turns (user/assistant), oldest first.
   * Returns the reply plus the server's authoritative trust + stored memories.
   */
  async talk(npcId: string, message: string, history: { role: 'user' | 'assistant'; content: string }[]): Promise<CloudTurnResult> {
    await this.ensureSession();
    const { data, error } = await this.client.functions.invoke('npc-dialogue', {
      body: { npcId, message, history },
    });
    if (error) {
      // FunctionsHttpError carries the typed { error: { code, message } } body.
      const context = (error as any)?.context;
      let detail = error.message ?? 'request failed';
      if (context && typeof context.json === 'function') {
        try {
          const body = await context.json();
          if (body?.error?.message) detail = body.error.message;
        } catch { /* keep generic message */ }
      } else if (context?.status === 401) {
        // Stale session — clear it so the next turn re-signs-in.
        await this.client.auth.signOut().catch(() => {});
        detail = 'Session expired — it will be renewed on the next message.';
      }
      throw new Error(detail);
    }
    const body = data ?? {};
    if (typeof body.reply !== 'string') throw new Error('Backend returned an unexpected payload.');
    if (typeof body.model === 'string') this.model = body.model;
    return {
      reply: body.reply,
      trust: typeof body.trust === 'number' ? body.trust : 0,
      trustDelta: typeof body.trustDelta === 'number' ? body.trustDelta : 0,
      memoriesStored: typeof body.memoriesStored === 'number' ? body.memoriesStored : 0,
      stored: Array.isArray(body.stored)
        ? body.stored
            .filter((m: any) => m && typeof m.summary === 'string')
            .map((m: any) => ({ type: String(m.type ?? 'fact'), summary: String(m.summary) }))
        : [],
    };
  }

  /** Current player id (anon UUID) — for local bookkeeping/debug only. */
  async playerId(): Promise<string | null> {
    const { data } = await this.client.auth.getUser();
    return data.user?.id ?? null;
  }
}
