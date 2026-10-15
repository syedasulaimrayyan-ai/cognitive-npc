import * as THREE from 'three';
import { createProvider, loadLlmConfig } from '../ai/llm.js';
import { VoiceIO } from '../ai/voice.js';

/**
 * Dialogue panel: text I/O, provider selection, camera framing during chat,
 * and honest status reporting for the not-yet-integrated AI/voice layers.
 */
export class DialogueUI {
  constructor(npc) {
    this.npc = npc;
    this.root = document.getElementById('dialogue');
    this.logEl = document.getElementById('dialogue-log');
    this.form = document.getElementById('dialogue-form');
    this.input = document.getElementById('dialogue-input');
    this.metaEl = document.getElementById('npc-meta');
    this.statusEl = document.getElementById('status-strip');
    this.nameEl = document.getElementById('npc-name');
    this.micBtn = document.getElementById('mic-btn');
    this._open = false;
    this._pending = false;

    this.voice = new VoiceIO();
    this.provider = createProvider();

    this.micBtn.setAttribute('title', `Microphone input — planned for a later step.\nVoiceIO status: ${this.voice.statusText}`);
    this.micBtn.addEventListener('click', () => {
      // Never silently pretends to listen: shows the honest status instead.
      this._pushStatus(`${this.voice.statusText} — mic capture is not wired yet (src/ai/voice.js).`);
    });

    this.form.addEventListener('submit', (e) => this._onSubmit(e));
    document.getElementById('dialogue-close').addEventListener('click', () => this._onClosedByUser?.());

    this._drawPortrait();
    this._updateMeta();
  }

  isOpen() { return this._open; }

  /** Hook set by Game when the user closes the panel via Esc/✕. */
  set onClosed(fn) { this._onClosedByUser = fn; }

  open(npc) {
    this.npc = npc;
    this._open = true;
    // Enable lock/borderless look.
    this.root.classList.remove('hidden');
    this.nameEl.textContent = npc.displayName;
    npc.onConversationStart(); // memory writes immediately

    // Re-evaluate provider from latest stored config.
    this.provider = createProvider();
    this._pushStatus(this.provider.label + (this.provider.isPlaceholder
      ? ' — replies are placeholder text, not an AI model'
      : ' (connected — untested against your server)'));

    this._pushLog('npc', this._greetingLine());
    this._renderAssistantAvatar(); // draw portrait again for NPC change
    this.input.focus();
  }

  close() {
    this._open = false;
    this.root.classList.add('hidden');
  }

  _greetingLine() {
    const t = this.npc.trust;
    if (t <= -40) return '...';
    if (t <= 10) return 'Hello. Can I help you?';
    if (t <= 40) return `${'Good to see you'} — what brings you back?`;
    return 'My friend! I was hoping you would come by.';
  }

  async _onSubmit(e) {
    e.preventDefault();
    const text = this.input.value.trim();
    if (!text || this._pending) return;
    this.input.value = '';

    this._pushLog('player', text);
    this.npc.memory.logExchange('player', text);

    this._pending = true;
    const typing = this._pushTyping();
    try {
      const reply = await this._requestReply(text);
      typing.remove();
      this._pushLog('npc', reply, this.provider.isPlaceholder ? 'placeholder' : '');
    if (!this.provider.isPlaceholder) {
      this.npc.memory.logExchange('npc', reply);
        // Placeholder model won't produce consistent sentiment, so only a live
        // model gets to slowly influence trust. Placeholder exchanges don't.
        this._scoreReplyForTrust(reply);
      }
      this._updateMeta();
      this.voice.speak(reply); // no-op: reports 'voice: planned'
    } catch (err) {
      typing.remove();
      this._pushLog('system', `Reply failed: ${err.message}. The provider responded with an error — check ${this.provider.label}.`);
    } finally {
      this._pending = false;
      this.input.focus();
    }
  }

  async _requestReply(text) {
    const ctx = this.npc.memory.buildPromptContext(
      this.npc.displayName,
      'A townsperson with their own daily life, cautious by default, curious about the player.',
    );
    const history = this.npc.memory.state.conversationLog.slice(-10).map((m) => ({
      role: m.speaker === 'player' ? 'user' : 'assistant',
      content: m.text,
    }));
    const messages = [
      { role: 'system', content: ctx },
      ...history,
      { role: 'user', content: text },
    ];
    return this.provider.talk(messages, { memory: this.npc.memory.state });
  }

  /** Heuristic sentiment nudge — only used while a real model is connected. */
  _scoreReplyForTrust(reply) {
    if (/thank|friend|glad|happy/i.test(reply)) this.npc.memory.adjustTrust(2);
    else if (/leave|stop|never|angry|away/i.test(reply)) this.npc.memory.adjustTrust(-2);
  }

  _updateMeta() {
    const ev = this.npc.memory.state.events.length;
    this.metaEl.textContent = `trust ${this.npc.trust > 0 ? '+' : ''}${this.npc.trust} · ${ev} memory event${ev === 1 ? '' : 's'}`;
    this.metaEl.classList.toggle('unfriendly', this.npc.trust < -10);
  }

  _pushLog(who, text, badgeClass = '') {
    const entry = document.createElement('div');
    entry.className = `message ${who}`;
    const body = document.createElement('span');
    body.className = 'body';
    body.textContent = text;
    entry.appendChild(body);
    if (badgeClass === 'placeholder') {
      const b = document.createElement('b');
      b.className = 'badge';
      b.textContent = 'placeholder';
      entry.setAttribute('data-note', 'placeholder reply (no model connected)');
      entry.prepend(b);
    }
    this.logEl.appendChild(entry);
    this.logEl.scrollTop = this.logEl.scrollHeight;
    if (this.logEl.children.length > 60) this.logEl.firstChild.remove();
  }

  _pushTyping() {
    const t = document.createElement('div');
    t.className = 'message npc typing';
    t.textContent = '…';
    this.logEl.appendChild(t);
    this.logEl.scrollTop = this.logEl.scrollHeight;
    return t;
  }

  _pushStatus(text) {
    this.statusEl.textContent = text;
    this.statusEl.classList.remove('hidden');
    this.statusEl.classList.toggle('warn', /placeholder|failed|error/i.test(text));
  }

  /** Naive pixel portrait so the panel feels like a conversation, not a form. */
  _drawPortrait() {
    const c = document.getElementById('npc-portrait');
    const g = c.getContext('2d');
    g.clearRect(0, 0, 72, 72);
    g.fillStyle = '#efe6d8';
    g.fillRect(0, 0, 72, 72);
    g.fillStyle = '#d9a37a';
    g.beginPath(); g.arc(36, 34, 18, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#9a4b3f';
    g.fillRect(18, 10, 36, 14);
    g.fillStyle = '#3a2a20';
    g.fillRect(28, 30, 4, 4); g.fillRect(42, 30, 4, 4);
    g.strokeStyle = '#7a4a34';
    g.beginPath(); g.arc(36, 42, 7, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  }
  _renderAssistantAvatar() { this._drawPortrait(); }

  /**
   * During conversation: move the camera to a gentle over-the-shoulder view
   * looking at the NPC (Game calls this while the dialogue panel is open).
   */
  updateFraming(camera, dt) {
    const npcPos = this.npc.root.position;
    const target = new THREE.Vector3(npcPos.x, npcPos.y + 1.55, npcPos.z);
    const dir = new THREE.Vector3().subVectors(camera.position, target).setY(2.6).setLength(3.4);
    const desired = target.clone().add(dir);
    camera.position.lerp(desired, 1 - Math.pow(0.002, dt));
    camera.lookAt(target);
  }
}
