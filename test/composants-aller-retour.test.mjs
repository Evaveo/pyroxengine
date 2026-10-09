// moteur/test/composants-aller-retour.test.mjs
//
// LE TEST MANQUANT N°1 de docs/REVUE_2026-09-14.md (« Trous de test », plan d'action point 7),
// au grain où la donnée se perd RÉELLEMENT : la symétrie `serialize()` / `hydrate()` de CHAQUE
// composant déclaré.
//
// Ce que la suite couvrait déjà : la mémoire (`project-roundtrip`) et l'écriture brute de
// fichiers (`dossierProjet`). Ce qu'elle ne couvrait pas : le milieu — ce qu'un composant écrit
// et ce qu'il relit. C'est exactement là que vivent les six patrons de stockage concurrents
// relevés au § 4, et le double stockage sac/composant du § 5.
//
// LA FORME DU TEST EST UN COMPTEUR, comme `composants-descripteurs.test.mjs` : tout composant
// déclaré passe l'aller-retour, ou il est nommé dans `HORS_ALLER_RETOUR` avec sa RAISON. Un
// composant ajouté demain sans `serialize`/`hydrate` symétriques fait échouer le test sans que
// personne ait à y penser — c'est la brèche par laquelle les régressions de septembre sont
// passées, la suite restant verte pendant que l'éditeur perdait des données.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerContexte } from './engine-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Les composants dont l'état ne vit PAS dans leur propre sac, avec la raison. Ce sont les
 * patrons 3, 4 et 5 du § 4 de la revue : chacun est une dette identifiée, pas un oubli.
 * Retirer une entrée d'ici est le geste qui clôt cette dette — le test dira si c'est vrai.
 */
const HORS_ALLER_RETOUR = {
  Mesh: 'référence directe à l\'objet THREE : six sources pour un seul serialize() (§ 4, patron 3)',
  SkinnedMeshRenderer: 'même patron que Mesh — l\'état vit dans le nœud three.js',
  Model: 'provenance transitoire seule (§ 4, patron 4)',
  SubScene: 'provenance transitoire seule — le contenu est régénéré depuis la scène source',
  Tag: 'index pur, sans sérialisation propre (§ 4, patron 5)'
};

/** Une donnée de test par composant : des valeurs DISTINCTES des défauts, sinon rien n'est mesuré. */
const DONNEES = {
  AnimatorController: {assetId: 'a42'},
  AudioSource: {asset: 'a7', volume: 0.42},
  Camera: {fov: 71, near: 0.11, far: 1234},
  CameraFollow: {targetName: 'Heros', xMin: -8.5, topOfView: 4.25},
  TeamColor: {color: '#12ab34', material: 'Equipe'},
  FogOfWar: {origin: [-4, -6], cellSize: 2, cols: 40, rows: 30, team: 2, allies: [3], exploredOpacity: 0.4},
  Vision: {radius: 7.5, team: 2, remember: true},
  XROrigin: {sessionMode: 'immersive-ar', referenceSpace: 'local', showControllers: false,
             teleport: false, snapTurn: 30, moveSpeed: 1.5, handTracking: false},
  XRGrabbable: {radius: 0.25, throwable: false, keepOffset: false},
  XRTeleportArea: {maxSlope: 12},
  CharacterController2D: {speed: 9.5},
  Collider: {radius: 2.75},
  Collider2D: {radius: 1.75},
  Events: {regles: [{when: 'clic', actions: [{type: 'log'}]}]},
  Synthesizer: {volume: 0.35, voices: [{id: 'do', label: 'Do', wave: 'sine', frequency: 261.63, duration: 0.7, attack: 0.02, decay: 0.1, sustain: 0.5, release: 0.3, gain: 0.9, detune: 0, vibratoRate: 5, vibratoDepth: 12, glide: 0.5, glideTime: 0.3, meta: {color: '#ff3355', shape: 'star'}, overtones: [{ratio: 2, gain: 0.25}]}]},
  TouchControls: {opacity: 0.55, buttons: [{id: 'wave', label: 'Onde', action: 'jump', side: 'left'}]},
  Light: {intensity: 3.5, color: '#ff8800', range: 12.5},
  Particles: {rate: 55},
  Physics: {mass: 7.5},
  PostVolume: {profileId: 'a9'},
  Reflection: {resolution: 512},
  Rigidbody2D: {mass: 3.5},
  ScriptJS: {scriptId: 'a3', values: {vitesse: 5}},
  SpriteAnimator: {spriteId: 'a5'},
  SpriteRenderer: {spriteId: 'a5', order: 7},
  Terrain: {size: 128},
  Tilemap: {paletteId: 'a8', width: 40, height: 25, layer: 'Décor'},
  UIDocument: {documentUIId: 'a1'}
};

function contexte(){
  // `creerContexte` fournit ce que les composants attendent du moteur : THREE, un DOM minimal,
  // `assets`, `ed()`… Le bac nu de `ecs-registre.test.mjs` ne suffit pas ici — la moitié des
  // composants touchent un objet three.js dans leur `hydrate()`.
  const fichiers = ['js/component-registry.js', 'js/component.js', 'js/node.js',
    // `ed()`, `ensureAnimator()`, `ensureAudio()`, `ensureBody2d()`… : les sacs que les
    // composants posent, et `encodeCells` pour la tilemap. Sans eux, la moitié des `onAdd()`
    // lève un ReferenceError — ce serait un défaut du harnais, pas du moteur.
    'js/component-data.js', 'js/tilemap.js', 'js/audio.js', 'js/world-2d.js', 'js/synth.js', 'js/touch-input.js', 'js/fog-grid.js']
    .concat(readdirSync(path.join(root, 'js', 'components')).filter((f) => f.endsWith('.js'))
      .map((f) => 'js/components/' + f));
  return creerContexte(fichiers);
}

const env = contexte();
const TYPES = Array.from(env.Registry.classesByType.keys()).sort();

// Un VRAI Object3D : Camera et Light appellent `o.add(...)` dans leur `onAdd()`. Un objet
// simple suffirait aux composants à sac, mais pas à ceux qui greffent un enfant three.js.
function noeud(){
  const o = new env.THREE.Object3D();
  o.name = 'Test';
  env.applyNodeMixin(o);
  return o;
}

test('tout composant déclaré est soit couvert, soit nommé avec sa raison', () => {
  assert.ok(TYPES.length >= 20, 'le registre doit être peuplé — trouvé ' + TYPES.length);
  const orphelins = TYPES.filter((t) => !DONNEES[t] && !HORS_ALLER_RETOUR[t]);
  assert.deepEqual(orphelins, [],
    'ces composants n\'ont ni donnée de test ni exemption motivée. En ajouter une des deux : '
    + 'un composant dont personne ne mesure l\'aller-retour est un composant qui perdra des '
    + 'données en silence.');
});

test('les exemptions désignent des composants qui existent vraiment', () => {
  // Une exemption pour un composant disparu est une dette qu'on croit encore ouverte.
  const fantomes = Object.keys(HORS_ALLER_RETOUR).filter((t) => TYPES.indexOf(t) === -1);
  assert.deepEqual(fantomes, [], 'exemptions périmées, à retirer');
});

TYPES.filter((t) => DONNEES[t]).forEach(function(typeName){
  test('aller-retour de ' + typeName + ' : ce qui est écrit est relu, champ par champ', () => {
    const attendu = DONNEES[typeName];

    // ALLER : un composant fabriqué avec ces valeurs, sérialisé comme le fait serializeObject.
    const source = noeud();
    const c = source.addComponent(typeName, JSON.parse(JSON.stringify(attendu)));
    assert.ok(c, typeName + ' : addComponent n\'a rien rendu');
    const ecrit = JSON.parse(JSON.stringify(c.serialize() || {}));

    // RETOUR : un nœud NEUF, comme au rechargement d'un projet — surtout pas le même, sinon
    // l'alias `this.data` ↔ `userData` ferait passer le test sans que rien ne transite.
    //
    // Le chemin exact d'`applyComponents` : `addComponent(type, données)`, donc
    // `Component.restore()` (constructeur + `hydrate`) PUIS `onAdd()`. Hydrater après coup un
    // composant déjà posé ne serait pas le chemin de relecture, et mesurerait autre chose.
    const cible = noeud();
    const c2 = cible.addComponent(typeName, JSON.parse(JSON.stringify(ecrit)));
    const relu = JSON.parse(JSON.stringify(c2.serialize() || {}));

    Object.keys(attendu).forEach(function(k){
      assert.deepEqual(relu[k], attendu[k],
        typeName + '.' + k + ' : écrit ' + JSON.stringify(attendu[k])
        + ', relu ' + JSON.stringify(relu[k])
        + ' — un champ qui ne survit pas à l\'aller-retour est une donnée perdue à chaque '
        + 'réouverture de projet, sans le moindre message');
    });
  });
});

test('un fichier sans données pour un composant reste relisible', () => {
  // Le symétrique de l'aller-retour, et le vrai piège du § 5 : un composant qui REMPLACE son sac
  // en bloc perd les défauts, un composant qui FUSIONNE ressuscite des valeurs que le fichier
  // avait volontairement mises à zéro. On mesure seulement qu'aucun des deux ne plante — le
  // choix entre les deux est la décision du point 10 du plan.
  TYPES.filter((t) => DONNEES[t]).forEach(function(typeName){
    const o = noeud();
    const c = o.addComponent(typeName, {});
    assert.doesNotThrow(() => JSON.stringify(c.serialize() || {}),
      typeName + ' : un fichier sans données pour ce composant doit rester relisible');
  });
});
