export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = new Set();
    this.pointerLocked = false;
    this.mouseDX = 0;
    this.mouseDY = 0;
    // One-shot edge events consumed once per frame.
    this.jumpPressed = false;
    this.interactPressed = false;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.jumpPressed = true;
      if (e.code === 'KeyE') this.interactPressed = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.dom;
      if (!this.pointerLocked) this.keys.clear();
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
  }

  moveAxis() {
    let x = 0, y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    return { x, y };
  }

  running() {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  /** Per-frame consume; returns mouse look delta in radians-ready scale. */
  consumeMouseDelta() {
    const d = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = this.mouseDY = 0;
    return d;
  }

  consumeJump() {
    const j = this.jumpPressed;
    this.jumpPressed = false;
    return j;
  }

  consumeInteract() {
    const i = this.interactPressed;
    this.interactPressed = false;
    return i;
  }
}
