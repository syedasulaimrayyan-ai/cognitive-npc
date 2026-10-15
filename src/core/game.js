import * as THREE from 'three';
import { buildTown } from '../world/town.js';
import { Player } from '../player/player.js';
import { NPC } from '../npc/npc.js';
import { DialogueUI } from '../ui/dialogue.js';
import { HUD, OVERLAY_HINTS } from '../ui/hud.js';

export class Game {
  constructor(canvas) {
    this.active = false;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9ec7e8);
    this.scene.fog = new THREE.Fog(0x9ec7e8, 60, 160);

    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 300);

    buildTown(this.scene);
    this.player = new Player(this.scene, new THREE.Vector3(4, 0, 14));
    this.npcs = [new NPC(this.scene, new THREE.Vector3(6, 0, 2), 'Maya')];

    this.dialogue = new DialogueUI(this.npcs[0]);
    this.hud = new HUD();

    this.clock = new THREE.Clock();
    this._bindEvents();
    this.renderer.setAnimationLoop(() => this._tick());
  }

  requestPointerLock() {
    this.renderer.domElement.requestPointerLock();
    this.hud.hideControlsOverlay();
  }

  toggleDialogue() {
    if (!this.active) return;
    if (this.dialogue.isOpen()) {
      this.closeDialogue();
      return;
    }
    // Only enter conversation from a standing interaction with the NPC.
    const near = this._nearestNpc();
    this.hud.showHint(near ? 'Talking with ' + near.name : 'No one nearby — walk closer (press Esc, then click to play)');
    if (!near) return;
    this.dialogue.open(near);
    document.exitPointerLock();
    this.player.input.reset();
  }

  closeDialogue() {
    if (this.dialogue.isOpen()) {
      this.dialogue.close();
      this.hud.hideHint();
      this.renderer.domElement.requestPointerLock();
    }
  }

  _nearestNpc() {
    let best = null;
    let bestD = Infinity;
    for (const npc of this.npcs) {
      const d = npc.root.position.distanceTo(this.player.group.position);
      if (d < bestD) { bestD = d; best = npc; }
    }
    return bestD < 3.2 ? best : null;
  }

  _bindEvents() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
    document.addEventListener('pointerlockchange', () => {
      this.active = document.pointerLockElement === this.renderer.domElement;
      if (!this.active) this.hud.showControlsOverlay();
    });
    document.addEventListener('mousemove', (e) => {
      if (this.active && !this.dialogue.isOpen()) this.player.cameraControls.onMouseMove(e.movementX, e.movementY);
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  _tick() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const talking = this.dialogue.isOpen();

    if (!talking) {
      this.player.update(dt, this.active);
      const near = this._nearestNpc();
      this.hud.showHint(near ? 'Press E to talk' : null);
      for (const npc of this.npcs) {
        npc.lookAtWhileIdle(
          near === npc
            ? this.player.group.position
            : null,
          dt,
        );
      }
    }

    // Third-person camera orbit around the player.
    this.player.cameraControls.updateCamera(this.camera, this.player.headAnchor(dt), dt);

    if (talking) {
      // While chatting, gently frame the conversation partner.
      this.dialogue.updateFraming(this.camera, dt);
    }

    this.renderer.render(this.scene, this.camera);
  }
}
