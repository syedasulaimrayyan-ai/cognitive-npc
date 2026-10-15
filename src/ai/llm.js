/**
 * Modular conversational-model layer.
 *
 * STATUS: intentionally NOT a finished AI integration. What exists:
 *   1. A provider interface (talk(messages) -> async reply string).
 *   2. A ready `OpenAICompatibleProvider` that works with any server exposing
 *      the /chat/completions shape (OpenAI, LM Studio, Ollama's /v1, llama.cpp…).
 *   3. An `OfflinePlaceholderProvider` that is used ONLY when no credentials
 *      exist. Its replies are always visibly marked as placeholder text — it
 *      never pretends to be a real AI model.
 *
 * To connect a real model, run in the browser console (or pre-populate):
 *   localStorage.setItem('cnpc.llm', JSON.stringify({
 *     endpoint: 'http://localhost:1234/v1/chat/completions', // LM Studio example
 *     model:   'whatever-your-server-lists',
 *     key:     '' // add 'nonempty' for e.g. OpenRouter; blank works for local servers
 *   }));
 * then reload. Note: browser CORS may block remote providers; a local server
 * or a thin proxy is recommended for this prototype.
 */

const CONFIG_KEY = 'cnpc.llm';

export function loadLlmConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

export function saveLlmConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

export function createProvider(config = loadLlmConfig()) {
  return config && config.endpoint
    ? new OpenAICompatibleProvider(config)
    : new OfflinePlaceholderProvider();
}

export class OpenAICompatibleProvider {
  /** @param {{ endpoint: string, model: string, key?: string }} config */
  constructor(config) {
    this.endpoint = config.endpoint;
    this.model = config.model;
    this.key = config.key || '';
  }

  get label() {
    return `model: ${this.model || 'default'} @ ${this.endpoint}`;
  }

  /**
   * messages: [{ role: 'system'|'user'|'assistant', content: string }]
   * Returns the assistant reply string. Throws on network/server errors so
   * the dialogue UI can surface a visible failure instead of faking a reply.
   */
  async talk(messages) {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.key ? { Authorization: `Bearer ${this.key}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.8,
        max_tokens: 220,
      }),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || '(empty reply)';
  }
}

export class OfflinePlaceholderProvider {
  get label() {
    return 'offline placeholder (no model connected)';
  }

  get isPlaceholder() { return true; }

  /**
   * Deterministic stand-in reply. The UI prefixes every reply with a
   * placeholder badge, and this provider never invents world knowledge.
   */
  async talk(_messages, { memory = null } = {}) {
    const trust = memory?.trust ?? 0;
    const founded = memory?.numEvents || 0;
    const trustDesc =
      trust > 40 ? `I'm warming up to you.` :
      trust > 10 ? `Nice to see you again.` :
      trust >= -10 ? `Hello.` :
      `I don't know you well enough yet.`;
    await new Promise((r) => setTimeout(r, 350 + Math.random() * 450)); // simulate latency, like a real model call
    return `${trustDesc} (placeholder reply — memory events so far: ${founded}, trust: ${trust}. Connect a model to replace me — see src/ai/llm.js.)`;
  }
}
