import { NPCS } from '../../core/constants';

/** Persona index for dialogue + memory reset support. Keyed by NPC id. */
export const PERSONAS = Object.fromEntries(
  NPCS.map((def) => [
    def.id,
    {
      id: def.id,
      name: def.name,
      role: def.role,
      personality: def.personality,
      styleRule: def.styleRule,
      color: def.color,
      voicePitch: def.voicePitch,
      avatarKey: def.model,
      idleClip: def.idleClip,
      gestureClip: def.gestureClip,
    },
  ]),
);

export function personaFor(id) {
  return PERSONAS[id] ?? null;
}
