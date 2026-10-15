import { Game } from './core/game.js';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('game-canvas'));
const game = new Game(canvas);
// Debug/testing handle (also lets you poke at the game from the console).
window.__cnpc = game;

document.getElementById('start-btn')?.addEventListener('click', () => game.requestPointerLock());
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'KeyE') game.toggleDialogue();
  if (e.code === 'Escape') game.closeDialogue();
});
