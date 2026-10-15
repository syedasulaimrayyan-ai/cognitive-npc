/**
 * Voice input/output layer — PLANNED, NOT IMPLEMENTED.
 *
 * This module is the single wiring point for three later steps:
 *   1. Microphone capture:      VoiceIO._captureAudio()
 *   2. Speech-to-text:          VoiceIO._transcribe(blob) -> text
 *   3. Text-to-speech:          VoiceIO.speak(text) -> audio playback
 *
 * Current state: it only detects what the browser *supports* (Web Speech API,
 * MediaRecorder, speechSynthesis) and reports an honest status string. It does
 * NOT capture, transcribe or speak. The dialogue UI keeps the mic button
 * disabled and shows this module's status next to it, so no one can mistake
 * voice features for finished functionality.
 */

export class VoiceIO {
  constructor() {
    const speechApi = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
    this.capabilities = {
      micCapture: !!navigator.mediaDevices?.getUserMedia,
      speechRecognition: speechApi,
      speechSynthesis: 'speechSynthesis' in window,
    };
    this.enabled = false; // flip to true only once step 1–3 are actually wired
    this.recognition = null;
    this._audioCtx = null;
  }

  get statusText() {
    if (!this.enabled) return 'voice: planned — not wired yet';
    return 'voice: active';
  }

  get isSupportedEnough() {
    return this.capabilities.speechRecognition && this.capabilities.speechSynthesis;
  }

  /**
   * Step 1 (future): request a getUserMedia stream and keep it in this._stream.
   * Step 2 (future): feed the stream to SpeechRecognition or an external STT
   *                  service, resolve with the transcript string.
   * Today this intentionally rejects so callers can't rely on a fake result.
   */
  async listen() {
    throw new Error('VoiceIO.listen: not implemented yet (see src/ai/voice.js TODO steps).');
  }

  /**
   * Step 3 (future): speak text through speechSynthesis or an external TTS.
   * Today this is a no-op that reports being disabled.
   * @returns {'disabled'} always 'disabled' for now.
   */
  speak() {
    console.info('[voice] speak(): not implemented yet — see src/ai/voice.js.');
    return 'disabled';
  }

  dispose() {
    if (this._audioCtx) this._audioCtx.close().catch(() => {});
    this._audioCtx = null;
  }
}
