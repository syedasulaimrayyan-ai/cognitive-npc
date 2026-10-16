// npc-dialogue — Supabase Edge Function (Deno)
//
// One round of conversation with one NPC:
//   1. Authenticate the player (their anonymous-sign-in JWT).
//   2. Load THEIR memories of THIS npc_id + relationship trust (RLS-scoped:
//      the function carries the player's own JWT, never a service-role key).
//   3. Build the system prompt: server-side persona + retrieved memories +
//      trust-shaped attitude. The client cannot spoof who the NPC is.
//   4. Call Gemini (GEMINI_API_KEY — a Supabase secret, never shipped to the
//      browser) with a JSON response schema:
//        { reply, trustDelta, playerName?, memories: [...] }
//   5. Persist extracted memories + trust, return the reply.
//
// Errors are typed JSON: { error: { code, message } } with proper HTTP status
// (400 input, 401 auth, 429 quota, 502 upstream, 504 timeout, 503 misconfig).

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const TIMEOUT_MS = 20_000;

/**
 * Server-side personas (source of truth — the client only sends npcId).
 * Kept in sync with src/ai/cognitive/persona.ts by hand; the game is the
 * only consumer and the set of NPCs is small and stable.
 */
const PERSONAS: Record<string, { name: string; role: string; personality: string; styleRule: string; knows: string[] }> = {
  maya: {
    name: 'Maya Chen',
    role: 'shopkeeper who runs the market stall',
    personality:
      'Practical, warm but stressed; speaks plainly, worries out loud about her missing supply crate and the stall.',
    styleRule: 'Short, direct sentences. Sometimes trails off into worry.',
    knows: [
      'Her supply crate went missing near the old storehouse (east side of the street).',
      'She asked the player to help find it.',
      'She knows the town folk: Rosa dances by the fountain, Victor is a carpenter who hangs around the storehouse.',
      'She does NOT know who took the crate or what is inside it.',
    ],
  },
  victor: {
    name: 'Victor Hale',
    role: 'carpenter',
    personality:
      'Curmudgeonly but fair; gruff short answers, defensive about the storehouse, respects directness and dislikes accusations.',
    styleRule: 'Gruff, clipped sentences. Dry humour.',
    knows: [
      'He works out of the old storehouse and moved some crates around — he insists it was ordinary tidying.',
      'He saw Rosa near the fountain that morning.',
      'He does NOT know where Maya\'s specific crate is unless the player has already found it.',
    ],
  },
  rosa: {
    name: 'Rosa Delgado',
    role: 'dancer who practices by the fountain',
    personality:
      'Bright, chatty, observant; remembers faces and feelings more than facts, dislikes cruelty.',
    styleRule: 'Lively, warm, sometimes rambles.',
    knows: [
      'She was dancing by the fountain all morning and saw Victor wheeling a crate toward the storehouse.',
      'She worries Maya is upset.',
      'She does NOT know why Victor moved the crate.',
    ],
  },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
function err(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

interface MemoryRow {
  type: string;
  summary: string;
  salience: number;
  keywords: string[];
  created_at: string;
}

function attitudeFor(trust: number): string {
  return trust > 50 ? 'very warm, open' :
    trust > 20 ? 'friendly' :
    trust > -10 ? 'neutral, polite' :
    trust > -40 ? 'guarded' : 'distrustful';
}

/** Score memories for the prompt: recency (half-life 24h) + salience + keyword overlap. */
function retrieveMemories(memories: MemoryRow[], query: string, k = 8): MemoryRow[] {
  const now = Date.now();
  const q = query.toLowerCase();
  const scored = memories.map((m) => {
    const ageHours = (now - new Date(m.created_at).getTime()) / 3.6e6;
    const decay = Math.pow(0.5, ageHours / 24);
    const kwHits = m.keywords?.filter((kw) => q.includes(String(kw).toLowerCase())).length ?? 0;
    return { m, score: m.salience * decay + kwHits * 2 };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((s) => s.m);
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'In-character reply, 1-3 sentences.' },
    trustDelta: { type: 'integer', minimum: -10, maximum: 10 },
    playerName: { type: 'string', description: 'Player name if they introduced/used one, else empty.' },
    memories: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['identity', 'promise', 'fact', 'feeling', 'event', 'kindness', 'offense'] },
          summary: { type: 'string' },
          salience: { type: 'integer', minimum: 1, maximum: 5 },
          keywords: { type: 'array', items: { type: 'string' }, maxItems: 6 },
        },
        required: ['type', 'summary', 'salience', 'keywords'],
      },
    },
  },
  required: ['reply', 'trustDelta', 'memories'],
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return err(405, 'method_not_allowed', 'POST only.');

  // --- configuration ---------------------------------------------------------
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
  if (!SUPABASE_URL || !ANON_KEY) {
    return err(503, 'misconfigured', 'Supabase env vars missing in the Edge Function environment.');
  }
  if (!GEMINI_API_KEY) {
    return err(503, 'gemini_not_configured',
      'GEMINI_API_KEY is not set. Run: supabase secrets set GEMINI_API_KEY=... — the game will offer labelled demo replies until then.');
  }

  // --- auth: the player's own JWT (never service-role) -----------------------
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return err(401, 'no_token', 'Missing Authorization header.');

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await db.auth.getUser(token);
  if (userErr || !userData?.user) {
    return err(401, 'invalid_token', 'Session is invalid or expired — the game should sign you in again.');
  }
  const playerId = userData.user.id;

  // --- input -----------------------------------------------------------------
  let body: { npcId?: string; message?: string; history?: { role: string; content: string }[] };
  try { body = await req.json(); } catch { return err(400, 'bad_json', 'Request body must be JSON.'); }
  const npcId = String(body.npcId ?? '');
  const message = String(body.message ?? '').trim();
  if (!PERSONAS[npcId]) return err(400, 'unknown_npc', `Unknown npcId "${npcId}".`);
  if (!message || message.length > 600) return err(400, 'bad_message', 'message must be 1-600 characters.');
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((h) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
    .slice(-10)
    .map((h) => ({ role: h.role, content: h.content.slice(0, 600) }));

  // --- load memory + relationship (player-scoped by RLS) ---------------------
  const [memRes, relRes] = await Promise.all([
    db.from('npc_memories')
      .select('type, summary, salience, keywords, created_at')
      .eq('npc_id', npcId)
      .order('created_at', { ascending: false })
      .limit(120),
    db.from('npc_relationships').select('trust').eq('npc_id', npcId).maybeSingle(),
  ]);
  if (memRes.error) return err(502, 'db_read_failed', `Memory read failed: ${memRes.error.message}`);
  const trust = relRes.data?.trust ?? 0;
  const retrieved = retrieveMemories((memRes.data ?? []) as MemoryRow[], message);

  // --- system prompt (persona lives server-side) -----------------------------
  const persona = PERSONAS[npcId];
  const systemPrompt = [
    `You are ${persona.name}, the ${persona.role} in the small town of Millbrook.`,
    `Personality: ${persona.personality}`,
    `Speaking style: ${persona.styleRule}`,
    `Current attitude toward the player: ${attitudeFor(trust)} (trust ${trust}). Stay consistent with it.`,
    'What you know:',
    ...persona.knows.map((k) => `- ${k}`),
    retrieved.length
      ? `Your memories of this player:\n${retrieved.map((m) => `- (${m.type}) ${m.summary}`).join('\n')}`
      : 'You have no memories of this player yet.',
    'ALWAYS:',
    '- Answer in character, 1-3 sentences. Never mention being an AI, a model, or a game.',
    '- If the player tells you their name, a promise, or anything personal, extract it as memories.',
    '- Set trustDelta: positive for kindness/promises kept, negative for insults, accusations or broken promises. Small numbers.',
    '- Never invent facts beyond "What you know" and your memories.',
  ].join('\n');

  // --- call Gemini -----------------------------------------------------------
  let geminiRes: Response;
  try {
    geminiRes = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        contents: [
          ...history.map((h) => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.content }] })),
          { role: 'user', parts: [{ text: message }] },
        ],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          temperature: 0.85,
          maxOutputTokens: 400,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });
  } catch (e) {
    if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      return err(504, 'gemini_timeout', `Gemini did not answer within ${TIMEOUT_MS / 1000}s.`);
    }
    return err(502, 'gemini_unreachable', `Could not reach Gemini: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!geminiRes.ok) {
    const text = await geminiRes.text().catch(() => '');
    if (geminiRes.status === 429) {
      return err(429, 'gemini_quota', 'Gemini API quota/rate limit exceeded — try again in a minute.');
    }
    if (geminiRes.status === 400 || geminiRes.status === 403) {
      return err(502, 'gemini_key_invalid', `Gemini rejected the request (HTTP ${geminiRes.status}). Check GEMINI_API_KEY. ${text.slice(0, 200)}`);
    }
    return err(502, 'gemini_error', `Gemini returned HTTP ${geminiRes.status}. ${text.slice(0, 200)}`);
  }

  let parsed: {
    reply?: string; trustDelta?: number; playerName?: string;
    memories?: { type: string; summary: string; salience: number; keywords: string[] }[];
  };
  try {
    const data = await geminiRes.json();
    parsed = JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}');
  } catch {
    return err(502, 'gemini_bad_reply', 'Gemini returned an unreadable reply.');
  }
  const reply = typeof parsed.reply === 'string' && parsed.reply.trim() ? parsed.reply.trim() : '…';
  const trustDelta = Math.max(-10, Math.min(10, Math.round(parsed.trustDelta ?? 0)));
  const newTrust = Math.max(-100, Math.min(100, trust + trustDelta));
  const memories = (Array.isArray(parsed.memories) ? parsed.memories : [])
    .filter((m) => m && typeof m.summary === 'string' && m.summary.trim())
    .slice(0, 4)
    .map((m) => ({
      npc_id: npcId,
      type: String(m.type || 'fact').slice(0, 40),
      summary: m.summary.trim().slice(0, 500),
      salience: Math.max(1, Math.min(5, Math.round(m.salience ?? 3))),
      keywords: (Array.isArray(m.keywords) ? m.keywords : []).slice(0, 6).map((k) => String(k).slice(0, 40)),
    }));

  // --- persist (player-scoped by RLS; failures don't lose the reply) ---------
  let memoriesStored = 0;
  if (memories.length) {
    const ins = await db.from('npc_memories').insert(memories.map((m) => ({ ...m, player_id: playerId })));
    if (!ins.error) memoriesStored = memories.length;
  }
  const relUpsert = await db.from('npc_relationships').upsert(
    { player_id: playerId, npc_id: npcId, trust: newTrust, updated_at: new Date().toISOString() },
    { onConflict: 'player_id,npc_id' },
  );
  if (parsed.playerName && typeof parsed.playerName === 'string' && parsed.playerName.trim()) {
    const name = parsed.playerName.trim().slice(0, 80);
    await db.from('players').upsert({ id: playerId, display_name: name, updated_at: new Date().toISOString() });
    // Also mirror into this NPC's memory so "what's my name?" works next session.
    await db.from('npc_memories').insert({
      player_id: playerId, npc_id: npcId, type: 'identity',
      summary: `The player's name is ${name}.`, salience: 5, keywords: ['name', 'identity'],
    });
    memoriesStored += 1;
  }

  return json({
    reply,
    trust: newTrust,
    trustDelta,
    memoriesStored,
    stored: memories.map((m) => ({ type: m.type, summary: m.summary })),
    model: GEMINI_MODEL,
  });
});
