/**
 * Structured, persistent NPC memory.
 *
 * This is REAL data plumbing, not a stub: events are appended, trust is a
 * persistent scalar, and everything survives reloads via localStorage.
 * What is NOT implemented yet is feeding this into a live LLM — that wiring
 * lives in src/ai/llm.js and stays explicitly unfinished until a provider is
 * configured.
 *
 * Schema (per NPC id):
 * {
 *   trust: number,                // -100 .. 100, starts 0
 *   events: Array<{
 *     t: string,                  // ISO timestamp
 *     type: string,               // 'meeting' | 'conversation' | 'gift' | ...
 *     summary: string,
 *     weight: number              // importance 1..5 (trust impact multiplier)
 *   }>,
 *   conversationLog: Array<{ t, speaker: 'player'|'npc', text }>
 * }
 */

const STORAGE_PREFIX = 'cnpc.memory.';
const TRUST_MIN = -100, TRUST_MAX = 100;

export class MemoryStore {
  constructor(npcId) {
    this.npcId = npcId;
    this.state = this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + this.npcId);
      if (raw) return JSON.parse(raw);
    } catch { /* corrupted storage — start fresh */ }
    return { trust: 0, events: [], conversationLog: [] };
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_PREFIX + this.npcId, JSON.stringify(this.state));
    } catch { /* storage full or blocked — memory becomes session-only */ }
  }

  get trust() { return this.state.trust; }

  adjustTrust(delta, event) {
    this.state.trust = Math.max(TRUST_MIN, Math.min(TRUST_MAX, this.state.trust + delta));
    if (event) this.addEvent(event.type, event.summary, Math.abs(delta) || event.weight || 1);
    this._save();
  }

  addEvent(type, summary, weight = 1) {
    this.state.events.push({
      t: new Date().toISOString(),
      type,
      summary,
      weight,
    });
    // Cap unimportant history so storage stays small.
    if (this.state.events.length > 300) {
      this.state.events.sort((a, b) => (b.weight - a.weight) || (b.t < a.t ? 1 : -1));
      this.state.events.length = 300;
      this.state.events.sort((a, b) => (a.t < b.t ? -1 : 1));
    }
    this._save();
  }

  logExchange(speaker, text) {
    this.state.conversationLog.push({ t: new Date().toISOString(), speaker, text });
    if (this.state.conversationLog.length > 200) this.state.conversationLog.splice(0, this.state.conversationLog.length - 200);
    this._save();
  }

  /** Compactly describe recent events — future input to the LLM prompt. */
  summarize() {
    const e = this.state.events.slice(-20);
    const lines = e.map((ev) => `${ev.t} [${ev.type}] ${ev.summary}`);
    return {
      trust: this.state.trust,
      numEvents: this.state.events.length,
      recentEvents: lines,
    };
  }

  /** Build a system-prompt fragment for a future LLM integration. */
  buildPromptContext(npcName, npcPersona) {
    const s = this.summarize();
    const trustDesc =
      s.trust > 40 ? 'friendly, opens up quickly' :
      s.trust > 10 ? 'warm but a bit reserved' :
      s.trust >= -10 ? 'neutral, polite' :
      s.trust > -40 ? 'guarded and cool' : 'deeply distrustful';
    return [
      `You are ${npcName}. ${npcPersona}`,
      `Current attitude toward the player: ${trustDesc} (trust=${s.trust}).`,
      s.recentEvents.length ? `Recent events you remember:\n- ${s.recentEvents.join('\n- ')}` : 'You have no notable memories yet.',
    ].join('\n\n');
  }

  reset() {
    this.state = { trust: 0, events: [], conversationLog: [] };
    this._save();
  }
}
