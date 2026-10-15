import { NPCS } from '../core/constants.js';
import { MemoryStore } from './cognitive/memory.js';
import { personaFor } from './cognitive/persona.js';

const CONFIG_KEY = 'cnpc.llm';

/** Loads/validates the user-supplied model config. Returns null if unset. */
export function loadLlmConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw);
    if (!cfg.endpoint) return null;
    return cfg;
  } catch { return null; }
}

export function saveLlmConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

function createProvider(cfg) {
  return cfg ? new OpenAICompatibleProvider(cfg) : new PlaceholderProvider();
}

class OpenAICompatibleProvider {
  constructor(cfg) {
    this.endpoint = cfg.endpoint;
    this.model = cfg.model;
    this.key = cfg.key || '';
  }
  get label() {
    return `Connected: ${this.model || 'default model'} via ${this.endpoint} — first message tests the connection`;
  }
  get isPlaceholder() { return false; }
  async talk(messages) {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.key ? { Authorization: `Bearer ${this.key}` } : {}),
      },
      body: JSON.stringify({ model: this.model, messages, temperature: 0.8, max_tokens: 180 }),
    });
    if (!res.ok) throw new Error(`LLM endpoint returned HTTP ${res.status}`);
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('LLM returned an empty reply');
    return text;
  }
}

class PlaceholderProvider {
  get label() {
    return 'No AI model configured — replies are PLACEHOLDER text (see README to connect one).';
  }
  get isPlaceholder() { return true; }
  async talk(_messages, { memory, playerMessage }) {
    await new Promise((r) => setTimeout(r, 350 + Math.random() * 450));
    const trust = memory?.trust ?? 0;
    const stance =
      trust > 50 ? `It's genuinely good to see you again.` :
      trust > 20 ? `Great to see you!` :
      trust > -10 ? `Hello there.` :
      trust > -40 ? `Oh... it's you.` :
      `I'd rather you didn't linger.`;
    return `${stance} [placeholder — ${memory?.numMemories ?? 0} memories on file; connect an LLM for real conversation]`;
  }
}

/**
 * Drives one NPC conversation. Each NPC owns a private MemoryStore, so
 * Maya's memories never bleed into Victor's or Rosa's. The engine owns its
 * message list and notifies the UI (via onUpdate after every change).
 */
export class DialogueEngine {
  constructor(npcDef, hooks = {}) {
    this.def = NPCS.find((n) => n.id === npcDef.id) ?? npcDef;
    this.persona = personaFor(npcDef.id) ?? { ...npcDef, name: npcDef.name, role: npcDef.role };
    this.memory = new MemoryStore(this.def.id);
    this.hooks = hooks; // { onUpdate, onGesture, onReply }
    this.provider = createProvider(loadLlmConfig());
    this.messages = [];   // { id, who: 'player'|'npc'|'system', text, badge }
    this.pending = false;
    this._seq = 0;
    this._greeted = this.memory.state.events.some((e) => e.type === 'meeting');
  }

  _notify() {
    this.hooks.onUpdate?.({
      npc: {
        name: this.persona.name, role: this.persona.role, color: this.persona.color,
        trust: this.memory.trust, memEventCount: this.memory.state.events.length,
      },
      messages: this.messages,
      pending: this.pending,
      status: this.provider.label,
      warn: this.provider.isPlaceholder,
      sttSupported: this.hooks.sttSupported,
    });
  }

  greeting() {
    const type = this._greeted ? 'reunion' : 'meeting';
    this._greeted = true;
    const summaries = {
      meeting: `Player met ${this.persona.name} for the first time.`,
      reunion: `Player visited ${this.persona.name} again.`,
    };
    this.memory.addEvent(type, summaries[type], type === 'meeting' ? 3 : 1, ['visit', 'meeting']);
    const line = this._greetingText();
    this._pushMsg('npc', line);
    this.memory.logExchange('npc', line);
  }

  _greetingText() {
    const trust = this.memory.trust;
    return trust > 50 ? `My friend! I was hoping you'd stop by.` :
      trust > 20 ? `Good to see you again — what can I do for you?` :
      trust > -10 ? `Hello. Can I help you with something?` :
      `...`;
  }

  async submit(playerText) {
    if (this.pending || !playerText?.trim()) return;
    const text = playerText.trim();
    this.pending = true;
    this._pushMsg('player', text);
    this.memory.logExchange('player', text);
    const typingId = this._pushMsg('typing', '…');
    this._notify();

    try {
      const systemPrompt = this.memory.buildSystemPrompt({ ...this.persona, lastPlayerMessage: text });
      const history = this.messages
        .filter((m) => m.who === 'player' || m.who === 'npc')
        .slice(-8, -1) // everything except the message we just appended as the live turn
        .map((m) => ({ role: m.who === 'player' ? 'user' : 'assistant', content: m.text }));
      const reply = await this.provider.talk(
        [
          { role: 'system', content: systemPrompt },
          ...history,
          { role: 'user', content: text },
        ],
        { memory: { trust: this.memory.trust, numMemories: this.memory.state.events.length }, playerMessage: text },
      );

      this._replaceMsg(typingId, 'npc', reply, this.provider.isPlaceholder ? 'placeholder' : null);
      this.memory.logExchange('npc', reply);
      this._applyReaction(text, reply);
      this.hooks.onGesture?.();
      this.hooks.onReply?.(reply);
    } catch (err) {
      this._replaceMsg(typingId, 'system', `Model call failed — ${err?.message || err}`);
    } finally {
      this.pending = false;
      this._notify();
    }
  }

  /** Memory-driven reaction to what the player said. */
  _applyReaction(playerText, reply) {
    const t = playerText.toLowerCase();
    if (/help|thank|please|gift|friend|welcome/.test(t)) {
      this.memory.adjustTrust(+3);
      this.memory.addEvent('kindness', `Player was kind: "${playerText}"`, 3, ['kindness']);
    } else if (/rude|stupid|hate|shut up|leave me/.test(t)) {
      this.memory.adjustTrust(-5);
      this.memory.addEvent('offense', `Player was rude: "${playerText}"`, 4, ['offense']);
    }
    if (!this.provider.isPlaceholder) {
      // Only a real model's words may further shift trust — heuristically.
      if (/thank you|friend|glad|welcome/i.test(reply)) this.memory.adjustTrust(+2);
      if (/leave me|go away|never talk to me/i.test(reply)) this.memory.adjustTrust(-2);
    }
  }

  _pushMsg(who, text, badge = null) {
    const m = { id: ++this._seq, who, text, badge };
    this.messages.push(m);
    if (who === 'npc') this._notify();
    return m.id;
  }

  _replaceMsg(id, who, text, badge = null) {
    const i = this.messages.findIndex((m) => m.id === id);
    if (i >= 0) this.messages[i] = { id, who, text, badge };
    this._notify();
  }

  closeSession() { /* everything already persisted */ }
}
