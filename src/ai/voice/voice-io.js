/**
 * Voice layer for COGNITIVE NPC.
 *
 * Status: REAL browser-side implementation where the platform allows it.
 *   - Speech-to-text: Web Speech API (SpeechRecognition) — works in Chrome/
 *     Edge out of the box; other browsers may not implement it, and we
 *     surface that honestly instead of faking transcripts.
 *   - Text-to-speech: Web Speech API speechSynthesis — also widely available.
 *   - AI-generated dialogue audio (a hosted TTS API): NOT integrated. The
 *     `ttsProvider` seam below is where a service like ElevenLabs/Azure
 *     would plug in; no network call is made until the user configures one,
 *     and no fake audio is produced.
 *
 * No API keys are hardcoded. Any key lives in localStorage or a future
 * server-side proxy — never in this file.
 */

const TTS_CONFIG_KEY = 'cnpc.tts';

export function loadTtsConfig() {
  try { return JSON.parse(localStorage.getItem(TTS_CONFIG_KEY)); }
  catch { return null; }
}

export class VoiceIO {
  constructor() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.stt = SR ? new SR() : null;
    if (this.stt) {
      this.stt.continuous = false;
      this.stt.interimResults = false;
      this.stt.lang = navigator.language || 'en-US';
    }
    this.listening = false;
    this.permission = 'unknown'; // unknown | granted | denied | unsupported
  }

  get capability() {
    return {
      stt: !!this.stt,
      tts: 'speechSynthesis' in window,
      apiTts: !!loadTtsConfig(), // external TTS configured?
    };
  }

  /** Request mic access and listen once. Resolves with transcript text. */
  async listenOnce() {
    if (!this.stt) {
      throw new Error('Speech recognition is not supported in this browser (try Chrome or Edge).');
    }
    if (this.listening) {
      throw new Error('Already listening.');
    }
    // Explicit getUserMedia permission step (Chrome requires it for the page
    // to be considered user-activated for SR in some flows; also gives us a
    // precise denied-permission error path).
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      this.permission = 'granted';
    } catch (err) {
      this.permission = err.name === 'NotAllowedError' ? 'denied' : 'unsupported';
      throw new Error(this.permission === 'denied'
        ? 'Microphone permission denied — enable it in your browser settings to use voice input.'
        : `Could not access microphone: ${err.message}`);
    }

    return new Promise((resolve, reject) => {
      this.listening = true;
      this.stt.onresult = (e) => {
        const text = e.results?.[0]?.[0]?.transcript ?? '';
        this.listening = false;
        resolve(text);
      };
      this.stt.onerror = (e) => {
        this.listening = false;
        reject(new Error(`Speech recognition error: ${e.error}`));
      };
      this.stt.onend = () => { this.listening = false; };
      try { this.stt.start(); }
      catch (err) { this.listening = false; reject(new Error(`Could not start recognition: ${err.message}`)); }
    });
  }

  /**
   * Speak text aloud. Uses the browser speechSynthesis with a pitch shaped by
   * the NPC persona. Returns 'done'. If a hosted AI-TTS provider is
   * configured it is NOT yet called — the seam is documented, and using
   * browser TTS is a real, working implementation, not a placeholder.
   */
  speak(text, { pitch = 1 } = {}) {
    if (!('speechSynthesis' in window)) return 'unsupported';
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.pitch = Math.max(0.4, Math.min(1.8, pitch));
      u.rate = 1.02;
      u.volume = 0.9;
      window.speechSynthesis.speak(u);
      return 'done';
    } catch { return 'failed'; }
  }

  stopSpeaking() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }
}
