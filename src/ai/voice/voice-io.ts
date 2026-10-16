/**
 * Voice layer for COGNITIVE NPC.
 *
 * REAL browser-side implementation — no fake audio, no fake transcripts:
 *   - Speech-to-text: Web Speech API (SpeechRecognition) — works in Chrome/
 *     Edge out of the box; other browsers may not implement it, and we
 *     surface that honestly instead of faking transcripts.
 *   - Text-to-speech: Web Speech API speechSynthesis (first option per the
 *     spec), muted/replay/stop controls, persona-shaped pitch.
 *   - A hosted STT/TTS service is NOT required for this game; the
 *     `cnpc.tts` config seam below is where one like ElevenLabs/Azure would
 *     plug in. No network call is made until the user configures one, and no
 *     fake audio is produced.
 *
 * No API keys are hardcoded. Any key lives in localStorage or a future
 * server-side proxy — never in this file.
 */

const TTS_CONFIG_KEY = 'cnpc.tts';
const MUTE_KEY = 'cnpc.voice.muted';

export function loadTtsConfig() {
  try { return JSON.parse(localStorage.getItem(TTS_CONFIG_KEY) ?? 'null'); }
  catch { return null; }
}

/** What the UI should show right now. */
export type VoicePhase = 'idle' | 'listening' | 'speaking';

export class VoiceIO {
  stt: SpeechRecognitionLike | null;
  listening: boolean;
  speaking: boolean;
  muted: boolean;
  /** Last text sent to TTS — powers the Replay control. */
  lastSpoken: string | null;
  permission: 'unknown' | 'granted' | 'denied' | 'unsupported';
  /** Fired whenever listening/speaking/muted change (GameClient re-pushes UI). */
  onStateChange: (() => void) | null = null;
  private _cancelRequested: boolean;
  private _activeUtterance: SpeechSynthesisUtterance | null;

  constructor() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.stt = SR ? new SR() : null;
    if (this.stt) {
      this.stt.continuous = false;
      this.stt.interimResults = false;
      this.stt.lang = navigator.language || 'en-US';
    }
    this.listening = false;
    this.speaking = false;
    this.muted = localStorage.getItem(MUTE_KEY) === '1';
    this.lastSpoken = null;
    this.permission = 'unknown'; // unknown | granted | denied | unsupported
    this._cancelRequested = false;
    this._activeUtterance = null;
  }

  get phase(): VoicePhase {
    if (this.listening) return 'listening';
    if (this.speaking) return 'speaking';
    return 'idle';
  }

  get capability() {
    return {
      stt: !!this.stt,
      tts: 'speechSynthesis' in window,
      apiTts: !!loadTtsConfig(), // external TTS configured?
    };
  }

  private _emit() { this.onStateChange?.(); }

  /**
   * Request mic access and listen once. Resolves with transcript text.
   * Throws readable errors for: unsupported browser, denied permission,
   * missing mic, no speech heard, network trouble, or a cancel.
   */
  async listenOnce() {
    const stt = this.stt;
    if (!stt) {
      throw new Error('Speech recognition is not supported in this browser (try Chrome or Edge).');
    }
    if (this.listening) throw new Error('Already listening.');
    if (this.speaking) this.stopSpeaking(); // never talk over the NPC

    // Explicit getUserMedia permission step (gives a precise denied-permission
    // error path; Chrome also treats this as user activation for SR).
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      this.permission = 'granted';
    } catch (err: any) {
      this.permission = err.name === 'NotAllowedError' || err.name === 'SecurityError' ? 'denied' : 'unsupported';
      throw new Error(this.permission === 'denied'
        ? 'Microphone permission denied — enable it in your browser settings (the 🔒 icon in the address bar) and try again.'
        : `Could not access microphone: ${err.message ?? err}`);
    }

    return new Promise<string>((resolve, reject) => {
      this.listening = true;
      this._cancelRequested = false;
      this._emit();

      // Exactly-one settlement: whichever handler fires first wins; later
      // events (e.g. onend after onresult) become no-ops.
      let settled = false;
      const flip = () => { if (this.listening) { this.listening = false; this._emit(); } };
      const settleOk = (text: string) => { if (settled) return; settled = true; flip(); resolve(text); };
      const settleErr = (msg: string) => { if (settled) return; settled = true; flip(); reject(new Error(msg)); };

      stt.onresult = (e) => {
        const text = (e.results?.[0]?.[0]?.transcript ?? '').trim();
        if (this._cancelRequested || settled) { settleOk(''); return; }
        if (text) settleOk(text);
        else settleErr('Nothing was heard — try again and speak clearly.');
      };
      stt.onerror = (e) => {
        const code = (e as { error?: string }).error ?? 'unknown';
        if (this._cancelRequested || code === 'aborted') { settleOk(''); return; }
        const friendly: Record<string, string> = {
          'not-allowed': 'Microphone permission denied — enable it in your browser settings and try again.',
          'service-not-allowed': 'Speech recognition was blocked by the browser.',
          'no-speech': 'Nothing was heard — try again and speak clearly.',
          'audio-capture': 'No microphone found — check your input device.',
          network: 'Speech recognition network error — check your connection.',
          language: 'Speech recognition language is unavailable in this browser.',
        };
        settleErr(friendly[code] ?? `Speech recognition error: ${code}`);
      };
      // onend without a result: cancelled → silent empty, else report honestly.
      stt.onend = () => {
        if (settled) return;
        if (this._cancelRequested) settleOk('');
        else settleErr('Nothing was heard — try again and speak clearly.');
      };
      try { stt.start(); }
      catch (err: any) { settleErr(`Could not start recognition: ${err.message}`); }
    });
  }

  /** Abort an in-flight listen (panel's cancel-while-listening control). */
  cancelListening() {
    if (!this.listening) return;
    this._cancelRequested = true;      try { this.stt?.abort?.(); } catch { /* already stopped */ }
    // onend/onerror will flip `listening` and resolve('') via the guards above;
    // if the browser never reports back, force the state after a beat.
    setTimeout(() => {
      if (this.listening) { this.listening = false; this._emit(); }
    }, 800);
  }

  /**
   * Speak text aloud with the browser speechSynthesis (first option), pitch
   * shaped by the NPC persona. Cancels any current speech first so replies
   * can never overlap. When muted, the text is still recorded (so Replay
   * works after unmuting) but no audio plays. Returns 'done' | 'muted' |
   * 'unsupported' | 'failed'.
   */
  speak(text: string, { pitch = 1 }: { pitch?: number } = {}): 'done' | 'muted' | 'unsupported' | 'failed' {
    this.lastSpoken = text;
    if (!('speechSynthesis' in window)) return 'unsupported';
    try {
      window.speechSynthesis.cancel(); // hard stop: no queued overlap
      if (this.muted) return 'muted';
      const u = new SpeechSynthesisUtterance(text);
      u.pitch = Math.max(0.4, Math.min(1.8, pitch));
      u.rate = 1.02;
      u.volume = 0.9;
      // Identity-guarded finish: a STALE utterance's late onend/onerror must
      // never clear the state of the utterance that replaced it (that race
      // left audio playing while the UI showed 'idle').
      const finish = () => {
        if (this._activeUtterance !== u) return;
        this.speaking = false;
        this._activeUtterance = null;
        this._emit();
      };
      u.onend = finish;
      u.onerror = finish; // interrupted / no voice installed — never wedge the state
      this._activeUtterance = u;
      window.speechSynthesis.speak(u);
      // Optimistic: playback begins with speak(); onend/watchdog clear it.
      // (Waiting for onstart left a visible gap where audio played but the
      // status/Stop button still showed idle.)
      this.speaking = true;
      this._emit();
      // Watchdog: if the engine never actually starts (no voices installed),
      // don't claim 'speaking' forever.
      setTimeout(() => { if (this._activeUtterance === u && !window.speechSynthesis.speaking) finish(); }, 1500);
      return 'done';
    } catch {
      this.speaking = false;
      this._activeUtterance = null;
      return 'failed';
    }
  }

  stopSpeaking() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    if (this.speaking) { this.speaking = false; this._activeUtterance = null; this._emit(); }
  }

  /** Re-speak the last NPC line. Returns false when there's nothing to replay. */
  replay({ pitch = 1 }: { pitch?: number } = {}): boolean {
    if (!this.lastSpoken) return false;
    this.speak(this.lastSpoken, { pitch });
    return true;
  }

  /** Toggle mute (persisted). Returns the new value. */
  toggleMute(): boolean {
    this.muted = !this.muted;
    localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    if (this.muted) this.stopSpeaking();
    this._emit();
    return this.muted;
  }
}
