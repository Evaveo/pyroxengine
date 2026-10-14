// ---------- Environnement de scène : ciel, brouillard, éclairage global ----------
// Équivalent du WorldEnvironment de Godot, par scène. Édité dans l'inspecteur
// quand AUCUN objet n'est sélectionné. Sérialisé avec la scène et exporté.
import { backgroundForCamera } from './sky-camera.js';
import { applySkyFraming, skyBackgroundFor } from './environment-map.js';
import { assets } from './assets.js';
import { applyProbes } from './probes.js';
import { hemi, scene, sun } from './scene.js';

export const ENV_DEFAULT = {
  // Un ciel CLAIR par défaut, en dégradé : le défaut précédent (#14161a, quasi noir) donnait
  // une scène neuve indistinguable d'un rendu raté — on cherchait le bug avant de penser au
  // réglage de ciel.
  sky:'gradient',         // 'color' | 'gradient' | 'image' (panorama équirectangulaire)
  skyColor:'#9fc4e8',
  skyTop:'#6ea8dc',
  skyBottom:'#dfe9f2',
  skyAsset:null,            // id d'un asset texture du panneau Projet (PNG/JPG, ou HDRI .hdr/.exr)
  // Rotation (degrés, autour de la verticale) et exposition du panorama — le « Rotation » et
  // l'« Exposure » du Skybox/Panoramic d'Unity (js/environment-map.js, applySkyFraming). Champs
  // ajoutés avec le ciel HDRI : une scène plus ancienne les reçoit de ce défaut, sans migration.
  skyRotation:0,
  skyExposure:1,
  brouillard:true,
  brouillardColor:'#cdd9e4',
  brouillardNear:40,
  brouillardLoin:90,
  ambiante:0.4,
  ambianteColor:'#bfd4ff',
  // Couleur du SOL de la lumière hémisphérique (le ciel est `ambianteColor`). Champ ajouté en
  // v0.189.0 : une scène plus ancienne le reçoit du défaut à la relecture, sans migration.
  ambientGroundColor:'#30281e',
  sun:0.55,
  // Le ciel sert de sonde de réflexion par défaut à toute la scène (js/probes.js), comme
  // dans Unity. Sans ce repli, un métal ne reflète RIEN tant qu'on n'a pas
  // posé une sonde à la main — et on accuse le matériau, pas l'absence de sonde.
  skyReflets:true,
  skyRefletsIntensity:1,
  post:null                  // réglages de post-traitement (voir POST_DEFAULT), par scène
};
// Clés de l'outil configure_environment (anglaises) → clés du format (en partie françaises,
// sérialisées : ne pas les renommer sans migration). Une clé absente d'ici est la même des deux côtés.
export const ENV_TOOL_KEYS = {
  fog: 'brouillard', fogColor: 'brouillardColor', fogNear: 'brouillardNear', fogFar: 'brouillardLoin',
  ambient: 'ambiante', ambientColor: 'ambianteColor',
  skyReflections: 'skyReflets', skyReflectionsIntensity: 'skyRefletsIntensity'
};
export let env = JSON.parse(JSON.stringify(ENV_DEFAULT));
export let skyTexture = null;      // texture de fond fabriquée ici (dégradé ou panorama cloné)

// Fabrique le FOND de scène : une couleur unie, ou une texture équirectangulaire (dégradé
// ou panorama) destinée à `scene.background`.
//
// C'était un dôme : une sphère de rayon 140 centrée sur l'origine. Deux défauts mesurés —
// dès que la caméra sortait de la sphère (ou que le décor la dépassait), le ciel
// disparaissait et il ne restait que le noir du fond ; et le dôme s'intercalait entre la
// caméra et les objets lointains. `scene.background` est rendu à l'infini, derrière tout,
// quelle que soit la position de la caméra : c'est vraiment le fond de la caméra.
//
// Isolé de applyEnvironment parce que probes.js le refabrique à l'identique pour cuire le
// reflet de ciel. Deux fabrications séparées auraient divergé en silence : le reflet aurait
// montré un autre ciel que la vue, et personne ne compare un reflet à un fond à l'œil nu.
export function buildSkyBackground(e){
  return skyBackgroundFor(e, skyTextureOfAsset);
}

/** La texture d'un asset texture du projet, ou null. */
export function skyTextureOfAsset(id){
  const a = assets.find(function(x){ return x.id === id && x.kind === 'texture'; });
  return a ? a.texture : null;
}

/**
 * Ce qui change le CONTENU du ciel sans changer ses réglages : la texture de l'asset (une HDRI
 * lue en remplace une provisoire, un réimport en pose une neuve) et l'arrivée de son image. Entre
 * dans la signature du reflet de ciel (keySky, js/probes.js) : sans lui, un panorama chargé après
 * la première cuisson laissait le reflet sur l'image vide.
 */
export function skySourceStamp(e){
  if(!e || e.sky !== 'image' || !e.skyAsset) return '';
  const a = assets.find(function(x){ return x.id === e.skyAsset && x.kind === 'texture'; });
  if(!a || !a.texture) return '';
  return a.texture.uuid + (a.imageSource ? ':1' : ':0');
}

/**
 * Une texture vient de finir de charger : si c'est le ciel de la scène, le refaire (fond ET
 * reflet). Appelé par assets.js au décodage d'une image ou à la lecture d'une HDRI. Rend vrai
 * quand le ciel a été refait.
 */
export function refreshSkyOfAsset(a){
  if(!a || env.sky !== 'image' || env.skyAsset !== a.id) return false;
  applyEnvironment();
  return true;
}

/** Le fond tel que l'a fabriqué applyEnvironment, avant adaptation à la caméra. */
export let skyBackground = null;

export function applyEnvironment(fresh){
  // Ciel, brouillard, exposition changent l'image : cadence pleine (js/render-throttle.js).
  if(typeof globalThis.requestRender === 'function') globalThis.requestRender();
  if(fresh) env = Object.assign(JSON.parse(JSON.stringify(ENV_DEFAULT)),
                                  JSON.parse(JSON.stringify(fresh)));
  // le ciel est le fond de la caméra, pas un objet de la scène : rien à ajouter dans
  // `objects`, rien à raycaster, rien à sérialiser.
  if(skyTexture){
    if(skyTexture.userData.flat) skyTexture.userData.flat.dispose();
    skyTexture.dispose();
    skyTexture = null;
  }
  const fond = buildSkyBackground(env);
  skyBackground = fond;
  globalThis.skyBackground = fond;
  scene.background = fond;
  applySkyFraming(scene, env);
  if(fond && fond.isTexture) skyTexture = fond;

  scene.fog = env.brouillard
    ? new THREE.Fog(new THREE.Color(env.brouillardColor), env.brouillardNear, env.brouillardLoin)
    : null;

  hemi.intensity = env.ambiante;
  hemi.color.set(env.ambianteColor);
  if(hemi.groundColor) hemi.groundColor.set(env.ambientGroundColor || ENV_DEFAULT.ambientGroundColor);
  sun.intensity = env.sun;

  // Changer le ciel change les reflets des objets qu'aucune sonde ne couvre : sans cet
  // appel, le repli sur le ciel resterait figé sur l'ancien ciel jusqu'à la prochaine
  // cuisson manuelle. probes.js est chargé APRÈS ce fichier, d'où le typeof.
  if(typeof applyProbes === 'function') applyProbes();
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.applyEnvironment = applyEnvironment;
globalThis.refreshSkyOfAsset = refreshSkyOfAsset;
globalThis.env = env;
globalThis.skyTexture = skyTexture;