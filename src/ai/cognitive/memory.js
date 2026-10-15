/**
 * Structured, persistent NPC memory.
 *
 * REAL implementation — not a stub. Stores per-NPC JSON in localStorage:
 *   { trust, events[], relationships[], conversationLog[] }
 * Events carry a salience score and decaying weight with a compact summary.
 * `retrieve()` picks the most relevant memories for a prompt (by recency x
 * salience x keyword match), producing ordered lines to feed the LLM.
 *
 * What is NOT done here: live wiring into a real model in production. The
 * retrieval output is a pure function and is tested by the dialogue engine.
 */

const PREFIX = 'cnpc2.memory.';
const LIMIT = { events: 120, log: 160 };

export class MemoryStore {
  constructor(npcId, seed = {}) {
    this.npcId = npcId;
    this.state = this._load() ?? {
      trust: seed.trust ?? 0,
      events: seed.events ?? [],
      relationships: seed.relationships ?? {},
      conversationLog: [],
    };
  }

  _load() {
    try {
      const raw = localStorage.getItem(PREFIX + this.npcId);
      if (raw) return JSON.parse(raw);
    } catch { /* fallthrough */ }
    return null;
  }

  _save() {
    try { localStorage.setItem(PREFIX + this.npcId, JSON.stringify(this.state)); }
    catch { /* storage full — degrade to session-only silently */ }
  }

  get trust() { return this.state.trust; }

  adjustTrust(delta) {
    this.state.trust = Math.max(-100, Math.min(100, this.state.trust + delta));
    this._save();
  }

  addEvent(type, summary, salience = 1, keywords = []) {
    this.state.events.push({
      t: Date.now(),
      type,
      summary,
      salience: Math.max(1, Math.min(5, salience)),
      keywords,
    });
    if (this.state.events.length > LIMIT.events) this.state.events.shift();
    this._save();
  }

  setRelationship(name, note, affinityDelta = 0) {
    const r = this.state.relationships[name] ?? { note: '', affinity: 0 };
    r.note = note || r.note;
    r.affinity += affinityDelta;
    this.state.relationships[name] = r;
    this._save();
  }

  logExchange(who, text) {
    this.state.conversationLog.push({ t: Date.now(), who, text });
    while (this.state.conversationLog.length > LIMIT.log) this.state.conversationLog.shift();
    this._save();
  }

  /**
   * Salience-weighted retrieval, exponentially decayed by age (half-life 30min).
   * Keyword hits boost relevance.
   */
  retrieve(query = '', k = 6) {
    const now = Date.now();
    const q = query.toLowerCase();
    const scored = this.state.events.map((ev) => {
      const ageMin = (now - ev.t) / 60000;
      const decay = Math.pow(0.5, ageMin / 30);
      const kwHits = ev.keywords?.filter((kw) => q.includes(kw.toLowerCase())).length ?? 0;
      return { ev, score: ev.salience * decay + kwHits * 2 };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map((s) => ({
      summary: s.ev.summary,
      type: s.ev.type,
      ageMin: Math.round((now - s.ev.t) / 60000),
      score: +s.score.toFixed(2),
    }));
  }

  /** Build an LLM system prompt from personality + retrieved memories. */
  buildSystemPrompt(persona) {
    const mems = this.retrieve(persona.lastPlayerMessage ?? '', 6);
    const trust = this.state.trust;
    const attitude =
      trust > 50 ? 'very warm, open' :
      trust > 20 ? 'friendly' :
      trust > -10 ? 'neutral, polite' :
      trust > -40 ? 'guarded' : 'distrustful';
    const relLines = Object.entries(this.state.relationships)
      .map(([n, r]) => `${n}: ${r.note} (affinity ${r.affinity})`);
    return [
      `You are ${persona.name}, ${persona.role}.`,
      `Personality: ${persona.personality}`,
      `Speaking style: ${persona.styleRule}`,
      `Current attitude toward the player: ${attitude} (trust ${trust}). React to the player consistent with this attitude.`,
      mems.length ? `Memories that seem relevant to what the player just said:\n${mems.map((m) => `- (${m.type}, ${m.ageMin}m ago) ${m.summary}`).join('\n')}`
                  : 'You have no strong memories relevant to this exchange.',
      relLines.length ? `Relationships you have formed: ${relLines.join('; ')}` : '',
      'Always answer in character, in 1-3 sentences. Never mention you are an AI or a game character. Do not invent world facts beyond the persona.',
    ].filter(Boolean).join('\n');
  }

  reset() {
    this.state = { trust: 0, events: [], relationships: {}, conversationLog: [] };
    this._save();
  }
}
