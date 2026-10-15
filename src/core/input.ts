export interface MoveAxis {
  x: number;
  y: number;
}

export interface MouseDelta {
  dx: number;
  dy: number;
}

export class Input {
  dom: HTMLElement;
  keys = new Set<string>();
  pointerLocked = false;
  // Fallback mode: when the browser refuses pointer lock (sandboxed iframe,
  // kiosk policies), the player can still look around by dragging the mouse.
  fallbackLook = false;
  dragging = false;
  mouseDX = 0;
  mouseDY = 0;
  // One-shot edge events consumed once per frame.
  jumpPressed = false;
  interactPressed = false;

  constructor(domElement: HTMLElement) {
    this.dom = domElement;

    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.jumpPressed = true;
      if (e.code === 'KeyE') this.interactPressed = true;
    });
    window.addEventListener('keyup', (e: KeyboardEvent) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.dom;
      if (!this.pointerLocked) this.keys.clear();
    });
    document.addEventListener('mousemove', (e: MouseEvent) => {
      // Pointer lock: always accumulate. Fallback: only while dragging.
      if (!this.pointerLocked && !(this.fallbackLook && this.dragging)) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('mousedown', (e: MouseEvent) => {
      if (this.fallbackLook && e.button === 0 && e.target === this.dom) this.dragging = true;
    });
    window.addEventListener('mouseup', () => { this.dragging = false; });
  }

  /** Whether gameplay input (movement/look) should be processed at all. */
  get active(): boolean {
    return this.pointerLocked || this.fallbackLook;
  }

  moveAxis(): MoveAxis {
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    return { x, y };
  }

  running(): boolean {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  /** Per-frame consume; returns mouse look delta in radians-ready scale. */
  consumeMouseDelta(): MouseDelta {
    const d = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  consumeJump(): boolean {
    const j = this.jumpPressed;
    this.jumpPressed = false;
    return j;
  }

  consumeInteract(): boolean {
    const i = this.interactPressed;
    this.interactPressed = false;
    return i;
  }
}
