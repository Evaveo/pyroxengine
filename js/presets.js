// moteur/js/presets.js
// Couche additive au-dessus de createObject()/TYPES_CREATABLE (objects.js) : un
// preset décrit un Noeud empty + la liste de composants à y attacher. Les types
// natifs (cube, point, camera…) continuent de passer par createObject(), qui
// attache déjà leurs composants via les fabriquerX() des lots précédents —
// PRESETS existe pour les futurs presets composés (plusieurs composants sur un
// même Noeud empty) et pour l'extensibilité plugin (Editor.enregistrerPreset).
import { makeGroup } from './objects.js';

export const PRESETS = [];

export function createFromPreset(namePreset) {
  const preset = PRESETS.find((p) => p.name === namePreset);
  if (!preset) throw new Error('Preset inconnu : ' + namePreset);
  const o = makeGroup();
  preset.components.forEach((c) => o.addComponent(c.type, c.data));
  return o;
}
