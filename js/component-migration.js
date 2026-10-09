// moteur/js/component-migration.js
// Les composants Mesh/Light/Camera s'attachent déjà automatiquement dans
// makePrimitive/makeLight/makeCamera (Lot Noeud+Component).
// Les composants Collider/Physics/Terrain/Particles/Reflection/ScriptJS se
// contentent de MIROTER les bags userData.collider/phys/terr/part/sonde/scripts
// déjà lus/écrits par le moteur existant (physics.js, terrain.js, particles.js,
// probes.js, scripts.js) — voir leurs fichiers composants respectifs.
//
// Une scène sauvegardée avant ce lot (ou reconstruite par rebuildTree, qui
// écrit ces bags directement dans userData sans passer par addComponent) n'a donc
// pas encore d'entrée correspondante dans userData.components. Cette fonction
// comble l'écart après coup : appelée sur un Noeud déjà construit, elle attache
// le composant missing pour chaque bag userData déjà présent, sans dupliquer un
// composant déjà attaché (cas Mesh/Light/Camera, déjà à jour).
// Ce que l'objet EST, déduit de son type. La table sert deux appelants très différents :
//
//  - l'ÉDITEUR, où les fabriques (makePrimitive, makeLight…) ont déjà attaché le
//    composant — sauf pour un modèle importé, cloné depuis un template, et sauf pour un objet
//    venu d'un plugin ;
//  - le JEU PUBLIÉ, où buildList (game-runtime.js) construit les Object3D à la main avec
//    les constructeurs THREE : là, AUCUN composant n'est attaché, et c'est cette table qui fait
//    que les Systèmes du runtime retrouvent leurs entités dans le même Registry que l'éditeur.
import { ed } from './component-data.js';
import { NodeShells } from './component-registry.js';
import { faceCameraToPlane } from './components/component-camera.js';
import { applyNodeMixin } from './node.js';

export const COMPONENT_BY_TYPE = {
  mesh: 'Mesh',
  model: 'Model',
  camera: 'Camera',
  terrain: 'Terrain',
  particles: 'Particles',
  probe: 'Reflection',
  subScene: 'SubScene',
  point: 'Light',
  spot: 'Light',
  directional: 'Light'
};

// Les champs du composant Light, relus sur la THREE.Light DÉJÀ construite quand il y en a
// une. Sans ça, un composant attaché après coup repartirait de ses défauts et l'inspecteur
// afficherait une couleur et une intensité qui ne sont pas celles de la lumière réelle.
export function dataLightFrom(o) {
  const d = { subType: o.userData.type };
  const lum = ed(o).light;
  if (!lum) return d;
  d.color = lum.color.getHex();
  d.intensity = lum.intensity;
  if (lum.distance !== undefined) d.range = lum.distance;
  if (lum.angle !== undefined) d.angle = lum.angle;
  if (lum.penumbra !== undefined) d.penumbra = lum.penumbra;
  return d;
}

/**
 * Le sac `userData` que possède chaque composant — LA SORTIE DU DOUBLE STOCKAGE
 * (docs/REVUE_2026-09-14.md § 2 cause 2, § 5 points 1 et 4, plan point 6).
 *
 * Le format écrivait ces treize données DEUX FOIS : à plat sur le nœud, et dans l'entrée du
 * composant qui les possède. Rien ne réconciliait les deux le jour où elles diffèrent — un
 * fichier édité à la main, une fusion de scènes, une migration à moitié faite. Au rechargement,
 * la reconstruction posait le sac PUIS le composant, qui l'écrasait par `mergeIntoBag` — mais
 * seulement CLÉ PAR CLÉ : toute clé présente dans le sac périmé et absente des données du
 * composant survivait, et l'inspecteur montrait alors un objet que la simulation ne lisait pas.
 *
 * La décision : LE COMPOSANT EST LA SEULE VÉRITÉ. `serializeObject` n'écrit plus ces sacs.
 * Ils restent RELUS pour les projets d'avant la refonte ECS, dont le fichier ne nomme aucun
 * composant — et seulement pour ceux-là, ce que garantit `bagsOverriddenBy()`.
 */
export const BAG_BY_COMPONENT = {
  Physics: 'phys',
  Collider: 'collider',
  ScriptJS: 'scripts',
  AudioSource: 'audio',
  Particles: 'part',
  UIDocument: 'uiDoc',
  AnimatorController: 'animator',
  SpriteRenderer: 'sprite2d',
  SpriteAnimator: 'animSprite',
  Rigidbody2D: 'body2d',
  Collider2D: 'collider2d',
  CharacterController2D: 'controller2d',
  Events: 'events'
};

/**
 * Les noms de sacs qu'une entrée sérialisée NOMME déjà par ses composants.
 *
 * Appelée par les deux reconstructions — l'éditeur (`rebuildTree`) et le jeu publié
 * (`buildList`) — avant de recopier un sac à plat. Un sac de cette liste ne doit PAS être
 * recopié : son composant porte la valeur à jour, et le sac vient forcément d'un fichier plus
 * ancien que lui. Les deux moteurs relisent ainsi par la même règle, ce qui est la seule façon
 * qu'un projet se comporte pareil dans l'éditeur et une fois publié.
 */
export function bagsOverriddenBy(components) {
  const ignores = Object.create(null);
  (components || []).forEach(function (e) {
    const sac = e && e.type ? BAG_BY_COMPONENT[e.type] : null;
    if (sac) ignores[sac] = true;
  });
  return ignores;
}

export function syncComponents(o) {
  if (!o || typeof o.addComponent !== 'function') return;

  // Ce que l'objet EST vient d'abord : les autres composants s'y greffent.
  const typeName = COMPONENT_BY_TYPE[o.userData.type];
  if (typeName && !o.getComponent(typeName)) {
    o.addComponent(typeName, typeName === 'Light' ? dataLightFrom(o) : {});
  }
  if (o.userData.collider && !o.getComponent('Collider')) {
    o.addComponent('Collider', o.userData.collider);
  }
  if (o.userData.phys && !o.getComponent('Physics')) {
    o.addComponent('Physics', o.userData.phys);
  }
  if (o.userData.terr && !o.getComponent('Terrain')) {
    o.addComponent('Terrain', o.userData.terr);
  }
  if (o.userData.part && !o.getComponent('Particles')) {
    o.addComponent('Particles', o.userData.part);
  }
  if (o.userData.animator && !o.getComponent('AnimatorController')) {
    o.addComponent('AnimatorController', o.userData.animator);
  }
  if (o.userData.sprite2d && !o.getComponent('SpriteRenderer')) {
    o.addComponent('SpriteRenderer', o.userData.sprite2d);
  }
  if (o.userData.tilemap2d && !o.getComponent('Tilemap')) {
    // Les noms du sac d'avant la refonte (`l`, `h`, `tile`, `cases`) deviennent ceux du
    // composant. C'est la seule occasion : un projet rouvert plus tard n'aura plus ce sac.
    const m = o.userData.tilemap2d;
    o.addComponent('Tilemap', { width: m.l, height: m.h, cellSize: m.tile,
      originX: m.origineX, originY: m.origineY, cells: m.cases,
      layer: m.layer, order: m.order });
    delete o.userData.tilemap2d;
  }
  if (o.userData.animSprite && !o.getComponent('SpriteAnimator')) {
    o.addComponent('SpriteAnimator', o.userData.animSprite);
  }
  // LES QUATRE COMPOSANTS 2D QUI MANQUAIENT ICI. Leurs données survivaient très bien à un
  // enregistrement — `corps2d`, `collider2d`, `controleur2d`, `cam2d` sont sérialisés — mais aucun
  // composant n'était recréé au chargement. La physique 2D continuait donc de tourner (elle lit
  // `userData` directement), et l'inspecteur, lui, n'affichait plus RIEN : le personnage bougeait,
  // ses réglages étaient devenus invisibles et donc immodifiables. C'est la forme la plus
  // désorientante du défaut, parce que le jeu a l'air d'aller bien.
  if (o.userData.body2d && !o.getComponent('Rigidbody2D')) {
    o.addComponent('Rigidbody2D', o.userData.body2d);
  }
  if (o.userData.collider2d && !o.getComponent('Collider2D')) {
    o.addComponent('Collider2D', o.userData.collider2d);
  }
  if (o.userData.controller2d && !o.getComponent('CharacterController2D')) {
    o.addComponent('CharacterController2D', o.userData.controller2d);
  }
  // LA CAMÉRA PRINCIPALE, d'un stockage à l'autre. Le drapeau vivait sur `userData.game.main`
  // (écrit par l'inspecteur, lu par le runtime) alors que le composant `Camera` porte son
  // propre `main`, seul sérialisé dans `components[]`. La source est désormais le composant
  // (camera-framing.js) : un projet enregistré avant doit donc voir son drapeau REMONTER, sans
  // quoi sa caméra principale serait oubliée au premier rechargement après la correction.
  // L'ancien champ est retiré pour qu'il ne reste pas une seconde réponse, qui divergerait.
  if (o.userData.game && o.userData.game.main !== undefined) {
    const cam = o.getComponent('Camera');
    if (cam && o.userData.game.main) cam.main = true;
    delete o.userData.game.main;
  }
  // Le sac `cam2d` d'avant la refonte porte DEUX choses distinctes : la projection (Camera) et
  // le suivi (CameraFollow). Les séparer ici est la seule occasion : un projet rouvert plus tard
  // n'aurait plus ce sac.
  if (o.userData.cam2d && !o.getComponent('Camera')) {
    const r = o.userData.cam2d;
    o.addComponent('Camera', { projection: 'orthographic', pixelPerfect: true,
      ppu: r.ppu, mode: r.mode, widthLevel: r.widthLevel, ratio: r.ratio });
    if (r.suit) {
      o.addComponent('CameraFollow', { targetName: r.suit, topOfView: r.topOfView,
        snapPixel: r.snapPixel, xMin: r.xMin, xMax: r.xMax, yMin: r.yMin, yMax: r.yMax });
    }
    // Le nœud est retourné vers le plan XY : avant la refonte, une caméra orthographique
    // filmait vers son -Z, et les projets d'alors ont donc des nœuds laissés à l'identité.
    // Sans ce demi-tour, leur décor passerait derrière la caméra à la réouverture.
    faceCameraToPlane(o);
    delete o.userData.cam2d;
  }
  // La source audio est devenue un composant. Sans cette ligne, un projet enregistré avant garderait
  // son son — le runtime lit `userData.audio` directement — mais l'inspecteur n'aurait plus RIEN à
  // montrer : un objet qui joue un son sans qu'on puisse ni le voir ni le régler. C'est le défaut
  // qu'on a mesuré sur les quatre composants 2D, et il se reproduit à chaque migration oubliée.
  if (o.userData.audio && !o.getComponent('AudioSource')) {
    o.addComponent('AudioSource', o.userData.audio);
  }
  if (o.userData.probe && !o.getComponent('Reflection')) {
    o.addComponent('Reflection', o.userData.probe);
  }
  if (o.userData.game && (o.userData.game.tag || '').trim() && !o.getComponent('Tag')) {
    o.addComponent('Tag', {});
  }
  if (o.userData.events && o.userData.events.length && !o.getComponent('Events')) {
    o.addComponent('Events', o.userData.events);
  }
  // (le bloc `AudioSource` était écrit DEUX fois, ici et vingt lignes plus haut. Sans effet
  //  grâce à la garde `!getComponent`, mais du code mort dans la fonction la plus sensible du
  //  chargement — voir docs/REVUE_2026-09-10.md § 1.5.)
  if (o.userData.uiDoc && !o.getComponent('UIDocument')) {
    o.addComponent('UIDocument', o.userData.uiDoc);
  }
  if (o.userData.scripts && o.userData.scripts.length) {
    const dejaAttaches = o.getComponents('ScriptJS').length;
    // n'attache que les entrées qui n'ont pas encore de composant correspondant
    // (rebuildTree écrit tout le tableau d'un coup ; on ne le rejoue qu'une fois)
    if (dejaAttaches < o.userData.scripts.length) {
      const raw = o.userData.scripts.slice(dejaAttaches);
      o.userData.scripts.length = dejaAttaches; // ScriptJS.onAdd re-pousse chaque entrée
      // `s.valeurs` et non {} : ce sont les variables @expose réglées dans l'inspecteur,
      // relues telles quelles depuis la scène. Les écraser par un objet vide ici les
      // perdait à chaque rechargement de projet, sans le moindre message.
      // `scriptId` et non `code` : l'entrée référence son asset script, elle ne le recopie plus.
      // Une entrée d'un projet d'avant la référence n'a pas de `scriptId` — le composant est
      // posé quand même, et s'affiche « script manquant » : il faut le voir pour le réparer,
      // alors qu'un composant non posé aurait fait disparaître le script de l'inspecteur en silence.
      raw.forEach((s) => o.addComponent('ScriptJS',
        { scriptId: s.scriptId || null, active: s.active, values: s.values || {} }));
    }
  }
}

/**
 * Pose sur un nœud reconstruit les composants écrits dans le fichier (`d.components`).
 *
 * C'est le chemin de relecture du format à COMPOSANTS, en remplacement de `syncComponents` —
 * qui reste pour les fichiers enregistrés avant ce format, et pour les objets d'un plugin, qui
 * posent leurs sacs `userData` sans passer par `addComponent`.
 *
 * La différence tient en une phrase : `syncComponents` DEVINE quels composants poser en
 * regardant les sacs présents (sa table a `userData.type` pour clé), alors qu'ici le fichier
 * les NOMME. C'est ce qui permettra de retirer `userData.type` du format : plus rien n'aura à
 * deviner ce qu'un nœud est.
 *
 * Deux cas par entrée :
 *  - le composant manque → on le pose avec ses données ;
 *  - la fabrique l'a déjà posé (un maillage, une lumière, une caméra sont construits AVEC leur
 *    composant, sur des valeurs par défaut) → on le relit sur place, `hydrate` puis `onAdd`,
 *    exactement la séquence qu'`addComponent` aurait jouée. Le reposer en créerait un second.
 */
export function applyComponents(o, list) {
  if (!o || typeof o.addComponent !== 'function' || !Array.isArray(list)) return;
  // ScriptJS.onAdd POUSSE son entrée dans `userData.scripts`, et `rebuildTree` vient d'y écrire
  // le tableau du fichier : sans cette purge, chaque script relu compterait double — le nœud
  // exécuterait deux fois le même code, et l'inspecteur montrerait deux blocs identiques.
  // C'est le seul composant qui alimente ainsi un sac déjà rempli par la reconstruction.
  if (list.some(function (e) { return e && e.type === 'ScriptJS'; }) && o.userData.scripts) {
    o.userData.scripts.length = 0;
  }
  // Combien d'exemplaires de chaque type ont déjà été traités. Plusieurs composants du MÊME
  // type cohabitent sur un nœud (plusieurs scripts, notamment) : `getComponent` rend toujours
  // le premier, si bien que sans ce compteur le deuxième script du fichier écraserait le
  // premier au lieu d'être posé.
  const rangs = {};
  list.forEach(function (entree) {
    if (!entree || !entree.type) return;
    const rang = rangs[entree.type] || 0;
    rangs[entree.type] = rang + 1;
    const data = Object.assign({}, entree.data || {});
    if (entree.active !== undefined) data.active = entree.active;
    const dejaLa = o.getComponents(entree.type)[rang] || null;
    if (!dejaLa) {
      // Un composant inconnu (venu d'une version plus récente de l'éditeur, ou d'un plugin
      // absent) ne doit pas interrompre la reconstruction du nœud, ni celle des suivants.
      try {
        o.addComponent(entree.type, data);
      } catch (e) {
        if (typeof logConsole === 'function') {
          logConsole('warn', '« ' + (o.name || '?') + ' » : composant « ' + entree.type
            + ' » non reposé — ' + e.message, null);
        }
      }
      return;
    }
    if (entree.active !== undefined && dejaLa.active !== entree.active) {
      dejaLa.active = entree.active;
      dejaLa.onActiveChange(entree.active);
    }
    dejaLa.hydrate(data);
    dejaLa.onAdd();
  });
}

/**
 * Le nœud à construire pour une entrée sérialisée : son porteur, décidé par ses COMPOSANTS.
 *
 * Partagé par l'éditeur (rebuildTree) et par le jeu publié (buildList), qui reconstruisaient
 * chacun leur cascade sur un type stocké — deux copies de la même connaissance, dont une seule
 * était tenue à jour, et un format de projet obligé de porter ce type.
 *
 * Un nœud dont aucun composant ne réclame de porteur est un Group nu : c'est le cas d'un nœud
 * d'organisation, d'un porteur de sprite, d'une caméra 2D.
 */
export function nodeOfComponents(d, ctx){
  const fait = NodeShells.make(d.components, ctx);
  if(fait.object3d) return fait;
  // Le porteur a manqué (l'asset d'un modèle a disparu du projet) : on rend quand même un nœud.
  // Sauter l'entrée emporterait toute sa descendance, qui perdrait son parent — exactement la
  // disparition silencieuse que ce lot ferme.
  const o = new THREE.Group();
  if(typeof applyNodeMixin === 'function') applyNodeMixin(o);
  return { object3d: o, missing: fait.missing };
}
