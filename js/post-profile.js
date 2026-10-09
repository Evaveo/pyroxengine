// moteur/js/post-profile.js
//
// Le genre d'asset "postProfile" : un jeu d'effets de post-traitement réutilisable, posé sur
// un PostVolume (js/components/component-postvolume.js, pas encore écrit) et mélangé par
// js/post-volume-blend.js. Même famille que les matériaux (js/materials.js,
// createAssetMaterial) : un asset en mémoire, une entrée ASSET_CREATORS, une écriture disque
// dédiée dans js/serialization.js.

// Un effet par clé, chacun avec son flag `overridden` (façon Unity : un profil ne définit que
// ce qu'il override) et ses champs propres. C'est aussi la forme neutre utilisée par
// js/post-volume-blend.js — les DEUX doivent rester synchronisés si un effet ou un champ est
// ajouté plus tard.
export const POST_PROFILE_DEFAULT_EFFECTS = {
  bloom: {overridden:false, threshold:0.8, intensity:0.7, radius:1},
  vignette: {overridden:false, amount:0.25},
  grain: {overridden:false, amount:0},
  toneMapping: {overridden:false, mode:'aces'},
  colorGrading: {overridden:false, contrast:1, saturation:1, temperature:0, exposure:1}
};
// Pas de `fxaa` : l'effet a été retiré (v0.135.0). Un profil d'avant qui porte encore la clé est
// relu sans erreur — `ensurePostProfileDefaults` ne recopie que les clés de cette table.

/**
 * Complète un objet `effects` partiel (fichier disque édité à la main, ancienne version avec
 * moins de champs) avec les défauts neutres — jamais d'exception sur un fichier incomplet.
 */
export function ensurePostProfileDefaults(effects){
  const src = effects || {};
  const out = {};
  Object.keys(POST_PROFILE_DEFAULT_EFFECTS).forEach(function(cle){
    out[cle] = Object.assign({}, POST_PROFILE_DEFAULT_EFFECTS[cle], src[cle] || {});
  });
  return out;
}

export function createAssetPostProfile(){
  const n = assets.filter(function(x){ return x.kind === 'postProfile'; }).length + 1;
  const a = {id:'a'+(nextAssetId()), kind:'postProfile', name:'Profil ' + n, folder:folderCurrent,
             effects: JSON.parse(JSON.stringify(POST_PROFILE_DEFAULT_EFFECTS))};
  assets.push(a);
  updateProject();
  return a;
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.ensurePostProfileDefaults = ensurePostProfileDefaults;