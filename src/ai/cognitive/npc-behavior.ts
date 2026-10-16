import { DECISION } from '../../core/constants';
import type { MemoryStore } from './memory';

export interface NpcState {
  id: string;
  name: string;
  role: string;
  personality: string;
  trust: number;
  mood: number; // -100 (angry/sad) to 100 (happy)
  alertness: number; // 0-100
  currentActivity: string;
  currentGoal: string | null;
  busy: boolean;
  lastInteractionTime: number;
  lastDecisionTime: number;
  decisionCooldown: number; // ms
  routine: 'morning' | 'work' | 'afternoon' | 'evening' | 'rest';
  lastActivityChange: number;
  socialNeed: number; // 0-100, decreases over time, increases when lonely
  lastConversation: number;
  inConversation: boolean;
  conversationPartner: string | null;
}

export interface EnvironmentContext {
  distanceToPlayer: number;
  playerNearby: boolean;
  inRestrictedArea: boolean;
  nearOtherNpcs: boolean;
  timeOfDay: number; // 0-24
  hasWitnessedPlayerAction: boolean;
}

export interface DecisionResult {
  decision: string;
  reason: string;
  confidence: number;
  shouldInitiate: boolean;
  targetAction: 'approach' | 'avoid' | 'greet' | 'confront' | 'shout' | 'wait' | 'ignore' | 'cooperate' | 'refuse';
}

export class NpcBehavior {
  memory: MemoryStore;
  state: NpcState;
  decisionHistory: string[] = [];

  constructor(memory: MemoryStore, npcDef: any) {
    this.memory = memory;
    this.state = {
      id: npcDef.id,
      name: npcDef.name,
      role: npcDef.role,
      personality: npcDef.personality,
      trust: memory.trust || npcDef.memorySeed?.trust || 0,
      mood: 0,
      alertness: 30,
      currentActivity: 'idle',
      currentGoal: null,
      busy: false,
      lastInteractionTime: 0,
      lastDecisionTime: 0,
      decisionCooldown: 2000, // 2 seconds between decisions
      routine: 'morning',
      lastActivityChange: Date.now(),
      socialNeed: 50,
      lastConversation: 0,
      inConversation: false,
      conversationPartner: null,
    };
  }

  updateState(_context: EnvironmentContext) {
    this.state.trust = this.memory.trust;
    this.state.lastInteractionTime = Date.now();
    this._updateRoutine();
    // Update social need
    const timeSinceConv = Date.now() - this.state.lastConversation;
    if (timeSinceConv > 600000) { // 10 min
      this.state.socialNeed = Math.min(100, this.state.socialNeed + 1);
    } else {
      this.state.socialNeed = Math.max(0, this.state.socialNeed - 0.5);
    }
  }

  _updateRoutine() {
    const hour = new Date().getHours(); // use real time or can be game time
    if (hour >= 6 && hour < 9) this.state.routine = 'morning';
    else if (hour >= 9 && hour < 17) this.state.routine = 'work';
    else if (hour >= 17 && hour < 20) this.state.routine = 'evening';
    else this.state.routine = 'rest';
  }

  makeDecision(context: EnvironmentContext): DecisionResult {
    const now = Date.now();
    if (now - this.state.lastDecisionTime < this.state.decisionCooldown) {
      return {
        decision: DECISION.WAIT,
        reason: 'Decision cooldown',
        confidence: 0.5,
        shouldInitiate: false,
        targetAction: 'wait',
      };
    }
    this.state.lastDecisionTime = now;

    const { distanceToPlayer, playerNearby, inRestrictedArea } = context;
    const trust = this.state.trust;
    const mems = this.memory.retrieve('', 3);
    
    // Rule-based decision making combining memories, trust, mood, distance
    // High trust NPCs more likely to cooperate/greet
    // Low trust more likely to avoid/confront
    // Busy NPCs less likely to approach

    // Check for recent negative events
    const hasNegativeEvent = mems.some(m => 
      m.type === 'disappointment' || m.type === 'broken_agreement' || m.type === 'suspicion'
    );
    
    // Check for recent positive events
    const hasPositiveEvent = mems.some(m => 
      m.type === 'favor' || m.type === 'help' || m.type === 'politeness' || m.type === 'friendship'
    );

    // Guard behavior (ravi)
    if (this.state.id === 'ravi') {
      if (inRestrictedArea && playerNearby) {
        if (trust < 0) {
          return {
            decision: DECISION.CONFRONT,
            reason: 'Suspicious player near restricted area',
            confidence: 0.9,
            shouldInitiate: true,
            targetAction: 'confront',
          };
        } else if (trust >= 10) {
          return {
            decision: DECISION.COOPERATE,
            reason: 'Trusts player, will allow or explain',
            confidence: 0.7,
            shouldInitiate: true,
            targetAction: 'cooperate',
          };
        } else {
          return {
            decision: DECISION.CONFRONT,
            reason: 'Player near restricted area, will warn',
            confidence: 0.8,
            shouldInitiate: true,
            targetAction: 'confront',
          };
        }
      }
      if (playerNearby && distanceToPlayer < 15) {
        if (trust < 0) return {
          decision: DECISION.WAIT,
          reason: 'Watches suspicious player',
          confidence: 0.7,
          shouldInitiate: false,
          targetAction: 'wait',
        };
      }
    }

    // Arjun/shopkeeper behavior
    if (this.state.id === 'arjun') {
      if (hasNegativeEvent && trust < 0 && playerNearby) {
        return {
          decision: DECISION.AVOID,
          reason: 'Still upset about broken promise',
          confidence: 0.8,
          shouldInitiate: false,
          targetAction: 'avoid',
        };
      }
      if (trust > 10 && playerNearby && distanceToPlayer < 12) {
        return {
          decision: DECISION.APPROACH,
          reason: 'Trust improved, willing to talk about promise',
          confidence: 0.8,
          shouldInitiate: true,
          targetAction: 'approach',
        };
      }
    }

    // Dev/merchant - holds grudges
    if (this.state.id === 'dev') {
      if (trust < -10 && playerNearby) {
        return {
          decision: DECISION.REFUSE,
          reason: 'Refuses business due to broken agreement',
          confidence: 0.9,
          shouldInitiate: playerNearby && distanceToPlayer < 10,
          targetAction: 'refuse',
        };
      }
      if (trust > 0 && playerNearby && distanceToPlayer < 10) {
        return {
          decision: DECISION.COOPERATE,
          reason: 'Opinion improved',
          confidence: 0.7,
          shouldInitiate: true,
          targetAction: 'cooperate',
        };
      }
    }

    // Friendly NPCs (maya, leela, sana, imran) - more likely to approach/greet
    const friendlyIds = ['maya', 'leela', 'sana', 'imran', 'rosa'];
    if (friendlyIds.includes(this.state.id)) {
      if (playerNearby && distanceToPlayer < 10 && !this.state.busy) {
        if (hasPositiveEvent || trust > 5) {
          return {
            decision: DECISION.APPROACH,
            reason: 'Positive history, friendly',
            confidence: 0.8,
            shouldInitiate: true,
            targetAction: 'approach',
          };
        } else {
          return {
            decision: DECISION.GREET,
            reason: 'Polite acknowledgment from distance',
            confidence: 0.6,
            shouldInitiate: true,
            targetAction: 'greet',
          };
        }
      }
    }

    // Kabir - curious but cautious
    if (this.state.id === 'kabir') {
      if (playerNearby && distanceToPlayer < 12 && trust >= 0) {
        return {
          decision: DECISION.APPROACH,
          reason: 'Curious about player and rumors',
          confidence: 0.7,
          shouldInitiate: true,
          targetAction: 'approach',
        };
      } else if (playerNearby && trust < 0) {
        return {
          decision: DECISION.WAIT,
          reason: 'Cautious, observing',
          confidence: 0.6,
          shouldInitiate: false,
          targetAction: 'wait',
        };
      }
    }

    // General cases
    if (playerNearby && distanceToPlayer < 5 && trust < -20) {
      return {
        decision: DECISION.AVOID,
        reason: 'Strong distrust, avoiding close contact',
        confidence: 0.8,
        shouldInitiate: false,
        targetAction: 'avoid',
      };
    }

    if (playerNearby && distanceToPlayer < 8 && trust > 30 && !this.state.busy) {
      return {
        decision: DECISION.APPROACH,
        reason: 'High trust, wants to interact',
        confidence: 0.9,
        shouldInitiate: true,
        targetAction: 'approach',
      };
    }

    if (playerNearby && distanceToPlayer < 6 && hasNegativeEvent && trust < 0) {
      return {
        decision: DECISION.CONFRONT,
        reason: 'Negative history prompts confrontation',
        confidence: 0.7,
        shouldInitiate: true,
        targetAction: 'confront',
      };
    }

    // Default: ignore if far away, wait if nearby
    if (playerNearby && distanceToPlayer < 15) {
      return {
        decision: DECISION.WAIT,
        reason: 'Observing player',
        confidence: 0.5,
        shouldInitiate: false,
        targetAction: 'wait',
      };
    }

    // Social: chat with nearby NPCs when social need is high and not busy
    if (this.state.socialNeed > 70 && !this.state.busy && !this.state.inConversation) {
      return {
        decision: DECISION.COOPERATE,
        reason: 'Looking to chat with someone',
        confidence: 0.6,
        shouldInitiate: false,
        targetAction: 'wait',
      };
    }

    return {
      decision: DECISION.IGNORE,
      reason: 'Continuing current activity',
      confidence: 0.6,
      shouldInitiate: false,
      targetAction: 'ignore',
    };
  }
}
