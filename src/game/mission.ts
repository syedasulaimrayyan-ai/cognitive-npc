/**
 * Mission state machine for "THE MISSING SUPPLY".
 *
 * Pure logic: no Three.js, no React. GameClient owns an instance and feeds it
 * dialogue events; React reads `snapshot()` (serialisable — that's the whole
 * state, so persistence is just localStorage of this JSON).
 *
 * Stages: INTRO → ASKED → CLUE → CRATE → DONE (monotonic).
 * Decisions recorded here shape NPC dialogue (knowledge.js reads them) and
 * the completion epilogue.
 */
import { STAGE } from '../core/constants';

const KEY = 'cnpc2.mission';

const OBJECTIVES = {
  [STAGE.INTRO]: 'Ask Maya Chen about her missing supply crate.',
  [STAGE.ASKED]: 'Question Rosa by the fountain — she was dancing here all morning.',
  [STAGE.CLUE]: 'Find the crate behind the old storehouse (east side of the street).',
  [STAGE.CRATE]: 'Bring the crate back to Maya at the market stall.',
  [STAGE.DONE]: 'The crate is back. Millbrook owes you one.',
};

// Decision flags, each shaped by a real player choice:
const DEFAULT_DECISIONS = {
  askedMaya: false,        // Maya told the player about the crate
  toldRosaAboutMaya: false, // player said Maya is worried (warmth cue for Rosa)
  suspicionPlanted: false,  // player accused Victor to Maya (Maya's unease)
  toldVictorAccused: false, // player repeated the accusation to Victor (triggers confession)
  toldMayaVictor: false,    // player told Maya it was Victor (affects ending)
  clueGiven: false,         // Rosa has revealed the location
  foundWithoutClue: false,  // crate found before Rosa was ever asked (Rosa offended)
  victimized: false,        // player insulted someone in the mission chain
  accusations: 0,           // times the player accused Victor (2 → he snaps)
};

export class Mission {
  constructor() {
    const loaded = this._load();
    this.state = loaded ?? {
      stage: STAGE.INTRO,
      decisions: { ...DEFAULT_DECISIONS },
      completedAt: null,
      epilogue: null,
    };
  }

  _load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (typeof s?.stage !== 'number') return null;
      s.decisions = { ...DEFAULT_DECISIONS, ...s.decisions };
      return s;
    } catch { return null; }
  }

  _save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch { /* quota */ }
  }

  get stage() { return this.state.stage; }
  get decisions() { return this.state.decisions; }

  /** Advance monotonically. Returns true if the stage actually changed. */
  setStage(stage, { force = false } = {}) {
    if (!force && stage <= this.state.stage) return false;
    this.state.stage = stage;
    this._save();
    return true;
  }

  /** Record a dialogue-derived decision. Returns true if newly set. */
  decide(flag, value = true) {
    if (this.state.decisions[flag] === value) return false;
    this.state.decisions[flag] = value;
    this._save();
    return true;
  }

  /**
   * Map an incoming dialogue event (from knowledge.js classification) onto the
   * stage machine. Pure derivation — the caller applies the returned patch.
   * @param {string} npcId
   * @param {Set<string>} intents
   * @param {number} trust
   * @returns {{ stage: number, decisions: object, changed: boolean, notify?: string }}
   */
  reactToDialogue(npcId, intents) {
    const d = { ...this.state.decisions };
    let stage = this.state.stage;
    const has = (i) => intents.has(i);
    let notify;

    if (npcId === 'maya') {
      if (has('crate') || has('witness') || has('greet')) {
        if (stage === STAGE.INTRO) {
          d.askedMaya = true;
          // Maya sends the player to Rosa → unlock the ASKED objective.
          if (stage < STAGE.ASKED) { stage = STAGE.ASKED; notify = 'New objective: question Rosa by the fountain.'; }
        }
      }
      if (has('accuse')) {
        d.suspicionPlanted = true;
      }
      if (has('tellwitness') && stage >= STAGE.ASKED) d.toldMayaVictor = true;
    }

    if (npcId === 'rosa') {
      if ((has('crate') || has('witness')) && stage === STAGE.ASKED && !d.clueGiven) {
        d.clueGiven = true;
        if (stage < STAGE.CLUE) { stage = STAGE.CLUE; notify = 'New objective: search behind the old storehouse.'; }
      }
      if (has('tellwitness')) d.toldRosaAboutMaya = true;
      if (has('insult')) d.victimized = true;
    }

    if (npcId === 'victor') {
      // Accusations are counted so his trust-gated confession
      // (knowledge.victorAdmits: 2nd accusation snaps) is reproducible.
      if (has('accuse')) { d.accusations = (d.accusations || 0) + 1; d.toldVictorAccused = true; }
      if (has('insult')) d.victimized = true;
    }

    const changed = stage !== this.state.stage;
    if (changed) this.state.stage = stage;
    // Merge decisions even when stage didn't move (e.g. accusation flag).
    this.state.decisions = d;
    this._save();
    return { stage: this.state.stage, decisions: this.state.decisions, changed, notify };
  }

  /** Called when the player physically picks up the crate. */
  collectCrate() {
    return this.setStage(STAGE.CRATE, { force: true }) || this.state.stage === STAGE.CRATE;
  }

  /** Called when the player hands the crate back to Maya. Returns the epilogue. */
  complete() {
    if (this.state.stage < STAGE.CRATE) return null;
    const d = this.state.decisions;
    let epilogue;
    if (d.victimized) {
      epilogue = 'CRATE RETURNED — ROUGHLY. Rosa vouched for you and Maya forgave the sharp tongue, but this town has a long memory. Trust here is earned slowly. Victor, for his part, is still muttering about manners.';
    } else if (d.suspicionPlanted && !d.toldMayaVictor) {
      epilogue = 'CRATE RETURNED — WITH A CLOUD OVER IT. The crate is home safe, but your accusation against Victor still hangs in the air. Maya wants to believe you. Victor knows he\'s being watched. The truth will out — one way or another.';
    } else if (d.toldMayaVictor) {
      epilogue = 'CRATE RETURNED — AND THE AIR CLEARED. Maya knows it was Victor\'s moving, not stealing, and Victor got to explain himself before resentment set in. Millbrook\'s suspicion lasted exactly as long as it took you to carry a box across town.';
    } else {
      epilogue = 'CRATE RETURNED. Maya counted every last seed packet. Victor grunted something that might have been an apology. The fountain kept dancing, as fountains do.';
    }
    this.state.stage = STAGE.DONE;
    this.state.completedAt = Date.now();
    this.state.epilogue = epilogue;
    this._save();
    return epilogue;
  }

  /** Full reset (also called by the debug handle). */
  reset() {
    this.state = {
      stage: STAGE.INTRO,
      decisions: { ...DEFAULT_DECISIONS },
      completedAt: null,
      epilogue: null,
    };
    this._save();
  }

  objective() { return OBJECTIVES[this.state.stage] ?? ''; }

  /** Serialisable state for React. */
  snapshot() {
    return {
      stage: this.state.stage,
      title: 'THE MISSING SUPPLY',
      objective: this.objective(),
      done: this.state.stage >= STAGE.DONE,
      epilogue: this.state.epilogue,
      completedAt: this.state.completedAt,
      decisions: { ...this.state.decisions },
    };
  }
}
