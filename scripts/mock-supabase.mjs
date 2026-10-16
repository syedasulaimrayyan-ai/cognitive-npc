/* LOCAL test double for the Supabase backend (dev only — like mock-llm.mjs).
 *
 * Implements just enough of the Supabase wire contract to exercise the real
 * frontend path (anonymous auth + functions.invoke) without a cloud project:
 *   POST /auth/v1/signup                    -> anonymous session
 *   POST /auth/v1/token?grant_type=refresh… -> session refresh
 *   GET  /auth/v1/user                      -> current user
 *   POST /functions/v1/npc-dialogue         -> the Edge Function contract
 *
 * The dialogue logic mirrors supabase/functions/npc-dialogue/index.ts
 * (persona, memory extraction, retrieval, trust) but replies are scripted
 * MOCK lines — this is a plumbing test double, NOT an AI. The real backend
 * uses Gemini.
 *
 * Persistence: .tmp-assets/mock-supabase.json (survives restarts, so the
 * "reload the game" memory test works against stable data).
 *
 * Usage: node scripts/mock-supabase.mjs [port]   (default 8789)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PORT = Number(process.argv[2] ?? 8789);
const DB_FILE = path.join(process.cwd(), '.tmp-assets', 'mock-supabase.json');

function loadDb() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { users: {}, sessions: {}, memories: [], relationships: [], players: {} }; }
}
const db = loadDb();
function saveDb() {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

const PERSONAS = {
  maya: { name: 'Maya Chen', role: 'shopkeeper' },
  victor: { name: 'Victor Hale', role: 'carpenter' },
  rosa: { name: 'Rosa Delgado', role: 'dancer' },
};

function makeSession(userId) {
  const token = 'mock-' + crypto.randomBytes(16).toString('hex');
  const refresh = 'mockr-' + crypto.randomBytes(16).toString('hex');
  db.sessions[token] = { userId, refresh };
  db.sessions['r:' + refresh] = { userId };
  return {
    access_token: token, token_type: 'bearer', expires_in: 3600,
    refresh_token: refresh, user: { id: userId, aud: 'authenticated', role: 'authenticated' },
  };
}

function retrieve(playerId, npcId, query) {
  const now = Date.now();
  const q = String(query).toLowerCase();
  return db.memories
    .filter((m) => m.player_id === playerId && m.npc_id === npcId)
    .map((m) => {
      const ageH = (now - new Date(m.created_at).getTime()) / 3.6e6;
      const decay = Math.pow(0.5, ageH / 24);
      const kw = (m.keywords ?? []).filter((k) => q.includes(String(k).toLowerCase())).length;
      return { m, score: m.salience * decay + kw * 2 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((s) => s.m);
}

/* Mock reply generation: memory-aware but scripted. Extracts name/promise
 * the same way the real schema asks Gemini to, so the client contract
 * (reply/trust/memories) is exercised identically. */
function mockDialogue(playerId, npcId, message) {
  const text = String(message);
  const memories = [];
  let trustDelta = 0;
  let playerName = '';

  const nameMatch = text.match(/my name is ([A-Za-z][\w'-]{0,30})/i);
  if (nameMatch) {
    playerName = nameMatch[1];
    memories.push({ type: 'identity', summary: `The player's name is ${playerName}.`, salience: 5, keywords: ['name', 'identity'] });
  }
  // Only a forward-looking promise counts ("I promise to…") — a question
  // like "what did I promise?" is retrieval, not a new promise.
  if (/i promise/i.test(text) && !/did i|what.*promise/i.test(text)) {
    memories.push({ type: 'promise', summary: `Player promised: "${text.slice(0, 120)}"`, salience: 5, keywords: ['promise', 'crate', 'supply', 'help'] });
    trustDelta += 4;
  }
  if (/thank|please|friend/i.test(text)) trustDelta += 2;
  if (/stupid|hate you|shut up/i.test(text)) {
    trustDelta -= 6;
    memories.push({ type: 'offense', summary: `Player was rude: "${text.slice(0, 90)}"`, salience: 4, keywords: ['offense', 'rude'] });
  }
  if (/i (lied|broke (your|the) promise|take it back)/i.test(text)) {
    trustDelta -= 10;
    memories.push({ type: 'event', summary: 'Player admitted breaking their promise.', salience: 5, keywords: ['promise', 'broke', 'lied'] });
  }

  const prior = retrieve(playerId, npcId, text);
  const promises = prior.filter((m) => m.type === 'promise');
  const identity = prior.find((m) => m.type === 'identity');

  let reply;
  if (/what did i promise/i.test(text)) {
    reply = promises.length
      ? `You promised: "${promises[0].summary.replace(/^Player promised: /, '')}" — I'm holding you to that, ${identity ? identity.summary.replace("The player's name is ", '').replace('.', '') : 'friend'}.`
      : `You haven't promised me anything… yet.`;
  } else if (/what('s| is) my name/i.test(text)) {
    reply = identity ? `You told me your name is ${identity.summary.replace("The player's name is ", '').replace('.', '')}.` : `We haven't properly met — what should I call you?`;
  } else if (nameMatch) {
    reply = `${nameMatch[1]}! Good to meet you properly. I'll remember that.`;
  } else if (/lied|broke|never help/i.test(text)) {
    reply = `…I see. That promise was the only thing I was counting on. We're done here for now.`;
  } else if (/promise/i.test(text)) {
    reply = `You have my word too — find that crate and everything changes.`;
  } else {
    const p = PERSONAS[npcId] ?? { name: '_NPC' };
    const memLine = prior.length ? ` I remember — ${prior[0].summary}` : '';
    reply = `(${p.name} considers this, mock reply) Noted.${memLine}`;
  }
  return { reply, trustDelta, playerName, memories };
}

const server = http.createServer((req, res) => {
  // Echo the browser's requested headers so supabase-js custom headers
  // (e.g. x-supabase-api-version) always pass the preflight.
  const reqHeaders = req.headers['access-control-request-headers'];
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': reqHeaders ?? 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
  const send = (status, body) => {
    res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    try {
      // --- anonymous auth ---------------------------------------------------
      if (url.pathname === '/auth/v1/signup' && req.method === 'POST') {
        const userId = crypto.randomUUID();
        db.users[userId] = { id: userId };
        saveDb();
        return send(200, makeSession(userId));
      }
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
        const body = JSON.parse(raw || '{}');
        const entry = db.sessions['r:' + body.refresh_token];
        if (!entry) return send(400, { error: 'invalid_grant', error_description: 'refresh token not found' });
        return send(200, makeSession(entry.userId));
      }
      if (url.pathname === '/auth/v1/user' && req.method === 'GET') {
        const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
        const entry = db.sessions[token];
        if (!entry) return send(401, { error: 'invalid_token' });
        return send(200, { id: entry.userId, aud: 'authenticated', role: 'authenticated' });
      }

      // --- the Edge Function contract ---------------------------------------
      if (url.pathname === '/functions/v1/npc-dialogue' && req.method === 'POST') {
        const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
        const entry = db.sessions[token];
        if (!entry) return send(401, { error: { code: 'invalid_token', message: 'Session is invalid or expired.' } });
        const playerId = entry.userId;

        const body = JSON.parse(raw || '{}');
        const npcId = String(body.npcId ?? '');
        const message = String(body.message ?? '').trim();
        if (!PERSONAS[npcId]) return send(400, { error: { code: 'unknown_npc', message: `Unknown npcId "${npcId}".` } });
        if (!message || message.length > 600) return send(400, { error: { code: 'bad_message', message: 'message must be 1-600 characters.' } });

        const out = mockDialogue(playerId, npcId, message);
        for (const m of out.memories) {
          db.memories.push({ id: crypto.randomUUID(), player_id: playerId, npc_id: npcId, ...m, created_at: new Date().toISOString() });
        }
        const rel = db.relationships.find((r) => r.player_id === playerId && r.npc_id === npcId);
        const current = rel?.trust ?? 0;
        const newTrust = Math.max(-100, Math.min(100, current + out.trustDelta));
        if (rel) rel.trust = newTrust; else db.relationships.push({ player_id: playerId, npc_id: npcId, trust: newTrust });
        if (out.playerName) db.players[playerId] = { display_name: out.playerName };
        saveDb();

        return send(200, {
          reply: out.reply, trust: newTrust, trustDelta: out.trustDelta,
          memoriesStored: out.memories.length,
          stored: out.memories.map((m) => ({ type: m.type, summary: m.summary })),
          model: 'mock-scripted',
        });
      }

      return send(404, { error: { code: 'not_found', message: `No mock for ${req.method} ${url.pathname}` } });
    } catch (e) {
      return send(500, { error: { code: 'mock_error', message: String(e?.message ?? e) } });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Mock Supabase backend on http://localhost:${PORT}`);
  console.log(`Point the game at it:`);
  console.log(`  localStorage.setItem('cnpc.cloud', JSON.stringify({ url: 'http://localhost:${PORT}', anonKey: 'mock-anon' })); location.reload();`);
  console.log(`DB: ${DB_FILE}`);
});
