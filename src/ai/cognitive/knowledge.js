/**
 * Cognitive knowledge layer for "THE MISSING SUPPLY".
 *
 * Three jobs, all provider-independent:
 *  1. classifyIntent(text)     — detects what the PLAYER is asking/doing in a
 *     line of dialogue. Mission triggers fire from this regardless of which
 *     engine (real LLM or fallback) wrote the reply.
 *  2. promptFacts(npcId, ctx)  — what THIS npc knows and, just as important,
 *     what they explicitly do NOT know right now. Injected into the LLM system
 *     prompt so a real model respects knowledge boundaries: the witness never
 *     knows the shopkeeper's private conversations, nobody knows what's inside
 *     a crate they never opened, etc.
 *  3. fallbackReply(...)       — the no-LLM conversation path: in-character,
 *     mission-aware, trust- and memory-driven replies, so the mission stays
 *     completable offline. The UI badges these "placeholder" as before.
 *
 * NOTE: mission.js imports THIS file, so nothing here imports mission.js.
 * `ctx` is plain data: { stage, decisions, trust, reunion, memCount }.
 */
import { STAGE } from '../../core/constants.js';

// ---------------------------------------------------------------------------
// 1. Intent classification (what the player said)
// ---------------------------------------------------------------------------

const RULES = [
  ['crate', /\b(crate|box|supply|supplies|shipment|missing|lost|stolen|steal|theft|thief|took|disappear\w*|order|what happened|any news|where is it|where'd it go)\b/],
  ['witness', /\b(saw|see|seen|witness\w*|notice\w*|clue|happen\w*|this morning|earlier (today|on)|watch\w*|did you watch|anything odd|anything strange|anything unusual|any idea)\b/],
  ['accuse', /\b(victor|handyman|he|him|that man)\b[^?.]{0,40}\b(took|stole|steal|stolen|grabbed|pinched|guilty|thief|suspicious|accuse\w*|blame)\b|\b(did you take|did you steal|you took|you stole|you moved it|you're the thief|are the thief|accuse)\b/],
  ['tellwitness', /\b(maya|shopkeeper)\b[^?.]{0,40}\b(worried|concerned|missing|lost|looking for|searching|sent me|asking about|upset)\b|\b(told|telling)\b[^?.]{0,20}\bmaya\b/],
  ['why', /\bwhy\b/],
  ['contents', /\b(inside|inside it|contain\w*|what was in|what's in|what is in)\b/],
  ['name', /\b(who are you|your name|what.?s your name|introduce yourself|about yourself|who am i talking)\b/],
  ['greet', /^(hi|hey|hello|yo|greetings|good (morning|afternoon|evening))\b/],
  ['thanks', /\b(thank|thanks|appreciate|cheers|grateful)\b/],
  ['insult', /\b(stupid|idiot|shut up|hate you|moron|useless|fool|get lost)\b/],
  ['directions', /\b(where is|where'?s|how do i|which way|directions|how to get|how can i find)\b/],
];

/** @returns {Set<string>} intents detected in a player message */
export function classifyIntent(text) {
  const t = String(text || '').toLowerCase();
  const hits = new Set();
  for (const [name, re] of RULES) if (re.test(t)) hits.add(name);
  return hits;
}

// ---------------------------------------------------------------------------
// Knowledge bases — facts are stage-aware and decision-aware
// ---------------------------------------------------------------------------

/** Victor only comes clean under specific, documented conditions:
 *  crate already recovered (stage), earned trust, or pressed twice. */
export function victorAdmits({ stage, trust, accusations = 0 }) {
  return stage >= STAGE.CRATE || trust >= 15 || accusations >= 2;
}

function factsFor(npcId, ctx) {
  const { stage = STAGE.INTRO, decisions = {}, trust = 0 } = ctx;
  const knows = [];
  const doesnt = [];

  if (npcId === 'maya') {
    knows.push(
      'Your supply crate — the season\'s seed stock and stall supplies — went missing from your stall this morning. You set it down before opening and it was gone when you turned around.',
      'You have searched the market and the fountain square and found nothing. You do not know who took it or where it is.',
      'Rosa Delgado dances by the fountain every morning and sees everything that happens in the square.',
    );
    if (stage >= STAGE.CLUE && stage < STAGE.DONE) knows.push('The player is chasing a lead about the crate — you are desperate for any news.');
    if (stage >= STAGE.CRATE && stage < STAGE.DONE) knows.push('The player has recovered the crate and is bringing it to you.');
    if (stage >= STAGE.DONE) knows.push('The player returned your crate. The crisis is over and you are deeply grateful.');
    if (decisions.suspicionPlanted) knows.push('The player accused Victor Osei of taking the crate. You are uneasy: you\'ve known Victor for years and don\'t want to believe it, but the doubt is planted. You are NOT accusing him yourself — you want proof.');
    doesnt.push(
      'You were at your stall all morning — you did not see what happened in the square. Rosa did.',
      'You do not know what Rosa or Victor said to the player, or what the player told them. Each conversation is private.',
    );
  } else if (npcId === 'rosa') {
    knows.push(
      'This morning, while dancing by the fountain, you saw Victor Osei (the handyman) drag the crate from beside Maya\'s stall across the street to BEHIND THE OLD STOREHOUSE — east side of the main street, the building with the blue door — around mid-morning. He was struggling with its weight.',
      'You saw WHERE he took it, not WHY. You cannot say whether he stole it or was moving it.',
      'You don\'t know what was inside the crate. Maya runs the plant stall and you two are friendly.',
    );
    if (decisions.toldRosaAboutMaya) knows.push('The player told you Maya is worried about her missing crate. You care about Maya and genuinely want to help.');
    if (decisions.foundWithoutClue) knows.push('The player found the crate WITHOUT asking you what you saw. You are a little offended — you had the best view in the square.');
    if (stage >= STAGE.DONE) knows.push('The player found the crate and returned it; the square is still buzzing about the whole affair.');
    doesnt.push(
      'You do not know what\'s inside the crate and you never opened it.',
      'You weren\'t part of any conversation between the player and Maya — never claim to know what was said there.',
    );
  } else if (npcId === 'victor') {
    knows.push(
      'You are guarded with strangers. You move things around town; that is your job.',
    );
    if (victorAdmits(ctx)) {
      knows.push(
        'You came clean: this morning Maya\'s crate was blocking the walkway behind her stall, so you dragged it behind the old storehouse (east side, blue door) and left a note on her table — the wind must have taken the note.',
        'You never opened the crate and you took nothing. You were tidying the street, as always.',
      );
    } else {
      doesnt.push(
        'You have NOT admitted anything about the crate. Deny involvement (\"haven\'t touched any crates\") unless the player has earned your trust, the crate has already been found, or they have accused you twice and you lose your temper.',
        'You don\'t know what was inside the crate — you never opened it.',
        'You don\'t know what Rosa saw or what anyone else has told the player.',
      );
    }
  }

  return { knows, doesnt };
}

/**
 * Facts for the LLM system prompt: KNOWS / DOES NOT KNOW, stage-aware.
 * @returns {string[]}
 */
export function promptFacts(npcId, ctx = {}) {
  const { knows, doesnt } = factsFor(npcId, ctx);
  return [
    `MISSING SUPPLY CRATE — what you personally know:`,
    ...knows.map((k) => `- ${k}`),
    `What you do NOT know:`,
    ...doesnt.map((d) => `- ${d}`),
    'Answer ONLY from these facts plus your persona and memories. If asked something they do not cover, say you don\'t know. Never claim knowledge that belongs to another character and never invent world events.',
  ];
}

// ---------------------------------------------------------------------------
// 2. Fallback conversation (no LLM configured) — still cognitive
// ---------------------------------------------------------------------------

function warmth(trust) {
  if (trust > 40) return 'friend';
  if (trust > 15) return 'friend';
  if (trust > -10) return null;
  if (trust > -40) return null;
  return null;
}

const MAYA_CRATE_INTRO = [
  'This morning I set my supply crate down right here before opening — and by the time I turned around it was gone.',
  'It vanished. One minute it was beside the stall, the next — nothing.',
];
const MAYA_HINT = 'Rosa was dancing by the fountain all morning — that girl misses nothing. Ask her what she saw.';

/** Mission-aware opening line, layered on the engine's trust greeting. */
export function greetingLine(npcId, ctx = {}) {
  const { stage = STAGE.INTRO, decisions = {} } = ctx;
  if (npcId === 'maya') {
    if (stage >= STAGE.DONE) return 'I still can\'t thank you enough — you just made my whole season.';
    if (stage >= STAGE.CRATE) return 'Is that — my CRATE? You found it! Bring it here, quickly, before I drop dead of relief!';
    if (stage === STAGE.INTRO && !decisions.askedMaya) return 'Oh — thank goodness someone\'s stopped by. Please, if you have a moment.';
  }
  if (npcId === 'rosa' && stage === STAGE.ASKED) {
    return 'You\'ve got that look — everyone\'s got it today. What, you lost something too?';
  }
  if (npcId === 'victor' && stage >= STAGE.CRATE) {
    return 'Before you say anything: if you\'re here about a crate, I already said I don\'t know anything.';
  }
  return null;
}

/**
 * Full fallback reply.
 * @param {{ npcId, persona, text, intents, ctx }} args
 * @returns {string} an in-character reply (UI marks it "placeholder")
 */
export function fallbackReply({ npcId, persona, text, intents = new Set(), ctx = {} }) {
  const { stage = STAGE.INTRO, decisions = {}, trust = 0, reunion = false } = ctx;
  const has = (i) => intents.has(i);
  const t = String(text || '').trim();

  // Shared, low-effort branches ------------------------------------------------
  if (has('name')) {
    return npcId === 'maya'
      ? 'Maya Chen — nine years behind this stall. Seed, seedlings, whatever the town needs to keep things growing. Lately, mostly worry.'
      : npcId === 'rosa'
        ? 'Rosa Delgado — dancer, spectator, and unofficial historian of this fountain. Ask me anything about this square.'
        : 'Victor Osei. I fix what this town breaks, which is most of it.';
  }
  if (has('insult')) {
    return npcId === 'maya'
      ? 'That isn\'t necessary. I\'m trying to help you, and you\'re trying to find my crate. Let\'s not do this.'
      : npcId === 'rosa'
        ? 'Wow. And I was about to tell you what I saw. Some people.'
        : 'Say that again and we\'re done. I\'ve got work.';
  }
  if (has('thanks') && !has('crate') && !has('witness')) {
    return npcId === 'maya'
      ? (trust > 15 ? 'Of course — thank YOU for listening. Now, about that crate…' : 'You\'re welcome. Now, if you\'ll excuse me, I should keep looking.')
      : npcId === 'rosa'
        ? 'Anytime! Now if you\'ll excuse me, the fountain audience awaits.'
        : 'Mm. Don\'t mention it.';
  }

  // Mission-critical branches ---------------------------------------------------
  if (npcId === 'maya') {
    if (has('crate') || has('witness')) {
      if (stage >= STAGE.DONE) {
        return 'The crate — back where it belongs: seed stock, twine, all of it. I still don\'t know how it wandered off, but I know who brought it back. That was you.';
      }
      if (stage >= STAGE.CRATE) {
        return 'You have it? Then stop talking and hand it over — I\'m only half joking!';
      }
      if (stage >= STAGE.CLUE) {
        return 'You have a lead? Then don\'t stand here gaping — go! I\'ll be right here, refusing to relax until it\'s back.';
      }
      const opener = MAYA_CRATE_INTRO[Math.abs(hash(t)) % MAYA_CRATE_INTRO.length];
      let out = `${reunion ? 'It\'s you again — good. ' : ''}${opener} Seed stock and stall supplies for the season. I\'ve searched every stall and the whole square. Not a trace.`;
      if (stage <= STAGE.ASKED && !decisions.clueGiven) out += ` ${MAYA_HINT}`;
      if (decisions.suspicionPlanted) out += ' And I\'m still turning over what you said about Victor. I\'ve known that man for years — I hope you\'re wrong. I\'d rather have proof than suspicions.';
      if (trust > 40) out += ' I trust you\'re the one person who\'ll actually tell me the truth.';
      return out;
    }
    if (has('accuse')) {
      return 'Victor? He\'s gruff, he moves things that aren\'t his — but a thief? If you\'re right I\'ll never hear the end of it, and if you\'re wrong, neither will you. Bring me proof before I go throwing accusations around.';
    }
    if (has('directions')) {
      return 'Down the main street to the fountain square — Rosa\'s usually twirling right in the middle of it. My stall is here, west side, you can\'t miss the greenery.';
    }
    if (has('greet')) {
      return stage === STAGE.INTRO && !decisions.askedMaya
        ? 'Hello — sorry, I\'m a little distracted. A crate of supplies vanished off my stall this morning. You haven\'t happened to ask about it, have you?'
        : 'Hello again. Still no peace and quiet in this square.';
    }
    return stage === STAGE.INTRO && !decisions.askedMaya
      ? 'Sorry — my mind\'s half gone with that crate. Lost supplies, lost season. If you hear of anything, I\'ll be here, worrying loudly.'
      : trust > 15
        ? 'You know, you\'re all right. This town\'s better with someone who actually stops to talk.'
        : 'Mm. Lovely weather for a lost crate, anyway.';
  }

  if (npcId === 'rosa') {
    if (has('crate') || has('witness')) {
      if (stage >= STAGE.DONE) {
        return decisions.foundWithoutClue
          ? 'The famous crate hunter — who found it WITHOUT me. I had the best view in the square and nobody asked! Fine, fine, I\'m glad it\'s back.'
          : 'The famous crate hunter! Everyone in the square is still talking about it. Best morning we\'ve had in months — all thanks to you.';
      }
      if (decisions.clueGiven) {
        return 'I already told you — behind the old storehouse, east side, the blue door. Go look already!';
      }
      const warm = trust > 15 || decisions.toldRosaAboutMaya;
      const base = warm
        ? 'Okay, listen up — this morning I was mid-pirouette when I saw Victor Osei hauling Maya\'s crate off. He dragged it across the street and wedged it BEHIND THE OLD STOREHOUSE — east side, blue door. He was huffing like it weighed the world!'
        : trust > -10
          ? 'Fine. I saw Victor drag a crate over to behind the old storehouse — east side of the street. Around mid-morning. That\'s all I know; I dance, I don\'t interrogate.'
          : 'Hmph. Behind the east-side storehouse. That\'s what you get for asking nicely.';
      let out = warm ? `${base}` : base;
      if (warm && decisions.toldRosaAboutMaya) out += ' And don\'t you worry about Maya — if she\'s fretting, I want to help. Go find it!';
      if (has('why')) out += ' As for WHY he took it — no idea. I saw where, not why. Ask Victor himself, if he\'ll deign to answer.';
      return out;
    }
    if (has('contents')) {
      return 'No clue — I never opened someone else\'s crate. That would be terribly rude!';
    }
    if (has('tellwitness')) {
      return 'Maya\'s worried? Oh, the poor thing — and I just stood here dancing. If I see one more suspicious thing today, I\'m sprinting to her stall. Promise.';
    }
    if (has('accuse')) {
      return 'Steal? I don\'t know about steal — I saw him MOVE it, that\'s all. He\'s always shifting things around the square. Whether he nicked it or not, you\'ll have to ask him yourself.';
    }
    if (has('directions')) {
      return 'The fountain\'s the heart of it all — market stalls west, old storehouse east side of the street. Everything worth seeing happens in earshot of that fountain.';
    }
    if (has('greet')) {
      return stage === STAGE.ASKED && !decisions.clueGiven
        ? 'Hey yourself! Fresh air, free show, me dancing — what a morning. You look like you\'re hunting for something, though. Just ask; I saw plenty today.'
        : 'Hey! Back again? The fountain missed you.';
    }
    return trust < -10
      ? 'Hmph. Some manners this one has. Ask me properly next time.'
      : decisions.clueGiven
        ? 'You\'re still here? The storehouse is that way — east! Off you go!'
        : 'You know, most people at least say hello before hovering. What\'s on your mind?';
  }

  // victor ---------------------------------------------------------------------
  if (npcId === 'victor') {
    const admits = victorAdmits({ stage, trust, accusations: decisions.accusations ?? 0 });
    if (has('crate') || has('witness')) {
      if (stage >= STAGE.DONE) {
        return 'So it\'s back. And my note\'s still nowhere to be found — typical. …You did all right, I suppose.';
      }
      if (admits) {
        let out = 'Alright, enough. I MOVED it — it was blocking the walkway behind Maya\'s stall, so I dragged it behind the old storehouse and left a note on her table. The wind took the note, not my honesty.';
        if (has('accuse')) out += ' And I did NOT steal it. Say that again and find your own tools next time.';
        return out;
      }
      return 'Crates? Haven\'t touched any crates. I fix things — that\'s all I do. Ask somebody who was standing still.';
    }
    if (has('accuse')) {
      return admits
        ? 'So now I\'m the thief? I MOVE things. It\'s what this town pays me for. Go ahead — ask Maya what I do all day, then come back and apologize.'
        : 'Get off my case. I don\'t owe you an answer, and I sure don\'t owe you a crate.';
    }
    if (has('contents')) {
      return 'Wouldn\'t know. I don\'t open boxes, I move them.';
    }
    if (has('directions')) {
      return 'Street goes where street goes. East side\'s got the old storehouse, west side\'s got the market. Can\'t miss either.';
    }
    if (has('greet')) {
      return reunion && trust > 15
        ? 'You again. What do you need? — And before you ask: fine, you\'re alright.'
        : 'Mm. Say what you came to say, I\'ve got a broken gate waiting.';
    }
    return trust > 15
      ? '…What? Speak up. I\'m listening, that\'s more than most get.'
      : 'Tools don\'t polish themselves. Neither do conversations — say your piece.';
  }

  // Should not happen (unknown npc) — stay honest.
  return `${persona?.name ?? 'They'} shrugs. [no fallback branch matched — connect an LLM for open conversation]`;
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
