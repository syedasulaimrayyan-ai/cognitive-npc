export class HUD {
  constructor() {
    this.hintEl = document.getElementById('crosshair-hint');
    this.overlayEl = document.getElementById('controls-overlay');
    this._hintTimer = null;
  }

  /** Persistent "Press E to talk" affordance (null hides it). */
  showHint(text) {
    if (!text) { this.hideHint(); return; }
    this.hintEl.textContent = text;
    this.hintEl.classList.remove('hidden');
  }
  hideHint() {
    this.hintEl.classList.add('hidden');
  }

  /** Transient centered message (auto-hides). */
  showNotice(text, ms = 3500) {
    this.showHint(text);
    clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => this.hideHint(), ms);
  }

  hideControlsOverlay() {
    this.overlayEl.classList.add('hidden');
  }
  showControlsOverlay() {
    this.overlayEl.classList.remove('hidden');
  }
}

export const OVERLAY_HINTS = {
  controls: 'Click to play — mouse look, WASD to move, Shift to run, E talk, Esc release mouse.',
};
