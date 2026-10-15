import { NPCS } from '../core/constants.js';
import { MemoryStore } from './cognitive/memory.js';
import { personaFor } from './cognitive/persona.js';
import { classifyIntent, promptFacts, fallbackReply, greetingLine } from './cognitive/knowledge.js';

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
  return cfg ? new OpenAICompatibleProvider(cfg) : new MissionAwareFallback();
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

/**
 * No-LLM conversation path. NOT a rubber stamp: replies come from the same
 * cognitive knowledge base the LLM prompt uses (knowledge.js) — stage-aware,
 * trust-aware, decision-aware. The mission is completable with this provider;
 * the UI keeps marking its lines "placeholder" so nothing is pretended.
 */
class MissionAwareFallback {
  get label() {
    return 'No AI model configured — mission-aware placeholder replies (see README to connect a model).';
  }
  get isPlaceholder() { return true; }
  async talk(_messages, { npcId, persona, playerMessage, intents, missionCtx } = {}) {
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 400)); // simulate latency
    return fallbackReply({
      npcId, persona, text: playerMessage,
      intents: intents ?? classifyIntent(playerMessage),
      ctx: missionCtx ?? {},
    });
  }
}

/**
 * Drives one NPC conversation. Each NPC owns a private MemoryStore, so Maya's
 * memories never bleed into Victor's or Rosa's. Mission knowledge flows in via
 * hooks (GameClient owns the Mission instance):
 *   hooks.getMissionCtx() -> { stage, decisions, trust, reunion, memCount }
 *   hooks.onWorldEvent(kind, payload) -> mission reacts to what was SAID
 *                                        (stage changes, decision flags)
 */
export class DialogueEngine {
  constructor(npcDef, hooks = {}) {
    this.def = NPCS.find((n) => n.id === npcDef.id) ?? npcDef;
    this.persona = personaFor(npcDef.id) ?? { ...npcDef, name: npcDef.name, role: npcDef.role };
    this.memory = new MemoryStore(this.def.id);
    this.hooks = hooks; // { onUpdate, onGesture, onReply, getMissionCtx, onWorldEvent }
    this.provider = createProvider(loadLlmConfig());
    this.messages = [];   // { id, who: 'player'|'npc'|'system', text, badge }
    this.pending = false;
    this._seq = 0;
    this._greeted = this.memory.state.events.some((e) => e.type === 'meeting');
  }

  /** Fresh mission context at call time (stage may have moved). */
  _missionCtx() {
    const ctx = this.hooks.getMissionCtx?.() ?? {};
    return {
      stage: ctx.stage ?? 0,
      decisions: ctx.decisions ?? {},
      trust: this.memory.trust,
      // "Reunion" means met in a PREVIOUS conversation (or session), not
      // "already exchanged pleasantries in this one".
      reunion: this._reunionOnEntry ?? this._greeted,
      memCount: this.memory.state.events.length,
    };
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
    const ctx = this._missionCtx();
    this._reunionOnEntry = this._greeted; // freeze the flag for this session
    this._greeted = true;
    const summaries = {
      meeting: `Player met ${this.persona.name} for the first time.`,
      reunion: `Player visited ${this.persona.name} again. (mission stage: ${ctx.stage})`,
    };
    this.memory.addEvent(type, summaries[type], type === 'meeting' ? 3 : 1, ['visit', 'meeting']);
    const line = this._greetingText(ctx);
    this._pushMsg('npc', line);
    this.memory.logExchange('npc', line);
  }

  _greetingText(ctx) {
    const trust = this.memory.trust;
    // Mission-authored opening line (knowledge.js) takes priority — it is
    // stage- and decision-aware; otherwise fall back to trust ladder.
    const missionLine = greetingLine(this.def.id, ctx);
    if (missionLine) return missionLine;
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
      // 1. What did the player actually say/do? (mission reacts to THIS, not
      //    to the model's paraphrase — real models can dodge, fallback can't.)
      const intents = classifyIntent(text);
      const ctxBefore = this._missionCtx();
      if (intents.size) {
        this.hooks.onWorldEvent?.('dialogue', { npcId: this.def.id, intents: [...intents] });
      }
      const ctx = this._missionCtx(); // post-event (stage/flags may have moved)

      // 2. System prompt: persona + retrieved memories + knowledge boundaries.
      const systemPrompt = [
        this.memory.buildSystemPrompt({ ...this.persona, lastPlayerMessage: text }),
        '',
        ...promptFacts(this.def.id, ctx),
      ].join('\n');

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
        {
          memory: { trust: this.memory.trust, numMemories: this.memory.state.events.length },
          playerMessage: text,
          npcId: this.def.id,
          persona: this.persona,
          intents,
          missionCtx: ctxBefore,
        },
      );

      this._replaceMsg(typingId, 'npc', reply, this.provider.isPlaceholder ? 'placeholder' : null);
      this.memory.logExchange('npc', reply);
      this._applyReaction(text, reply, intents);
      this.hooks.onGesture?.();
      this.hooks.onReply?.(reply);
    } catch (err) {
      // AI service failed mid-conversation: surface the error visibly AND keep
      // the mission playable by falling back to the offline branch for this turn.
      this._replaceMsg(typingId, 'system', `Model call failed — ${err?.message || err}`);
      try {
        const intents = classifyIntent(text);
        const ctx = this._missionCtx();
        const offline = fallbackReply({
          npcId: this.def.id, persona: this.persona, text, intents, ctx,
        });
        this._pushMsg('npc', `${offline}`, 'placeholder');
        this.memory.logExchange('npc', offline);
      } catch { /* fallback is pure — if it throws, the error message above stands */ }
    } finally {
      this.pending = false;
      this._notify();
    }
  }

  /** Memory-driven reaction to what the player said (intent-based). */
  _applyReaction(playerText, reply, intents = classifyIntent(playerText)) {
    if (intents.has('insult')) {
      this.memory.adjustTrust(-5);
      this.memory.addEvent('offense', `Player was rude: "${playerText}"`, 4, ['offense']);
    } else if (/thank|please|friend|welcome|appreciate/i.test(playerText)) {
      this.memory.adjustTrust(+3);
      this.memory.addEvent('kindness', `Player was kind: "${playerText}"`, 3, ['kindness']);
    }
    // Mission-relevant exchanges are remembered with topic keywords so later
    // retrieval can resurface them.
    if (intents.has('crate') || intents.has('witness') || intents.has('accuse')) {
      const topic = intents.has('accuse') ? 'accusation' : intents.has('witness') ? 'witness-talk' : 'crate-talk';
      this.memory.addEvent(topic, `Player discussed the missing crate ("${playerText.slice(0, 90)}")`, 4,
        ['crate', 'supply', 'missing', 'witness', 'victor']);
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
