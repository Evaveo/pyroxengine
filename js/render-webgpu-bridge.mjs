// moteur/js/render-webgpu-bridge.mjs
// Point d'entrée ESM unique : three.js ne publie plus de build UMD/global pour
// WebGPURenderer/TSL depuis ~r160 (contrairement à vendor/three.min.js, classique,
// toujours utilisé pour tout le reste). Ce module importe WebGPURenderer + TSL et les
// expose sur window.THREE/window.TSL, pour que tout le code existant (scripts
// classiques, portée globale) continue de fonctionner sans changement.
//
// "three/webgpu" et "three/tsl" sont des spécificateurs NUS (pas relatifs) — résolus
// via la balise <script type="importmap"> d'editor.html vers moteur/vendor-esm/.
//
// Un script type="module" est TOUJOURS différé (exécuté après le parsing du DOM, dans
// le même ordre relatif que les scripts classiques marqués `defer`) : voir
// 2026-08-06-fondation-webgpu-tsl-design.md pour pourquoi TOUS les <script src="js/...">
// d'editor.html doivent aussi être `defer` — sinon ce module s'exécuterait APRÈS
// scene.js, qui construit `new THREE.WebGPURenderer(...)` dès son chargement.
import * as THREE_WEBGPU from 'three/webgpu';
import * as TSL from 'three/tsl';

// Priorité au paquet webgpu pour tout ce qu'il définit (Object3D, Mesh, Material, Light,
// Scene... — son propre coeur three.js, superset du classique) : WebGPURenderer a besoin
// de reconnaître les instances qu'il traite depuis SON PROPRE bundle en interne — mélanger
// avec les classes du THREE classique (vendor/three.min.js) rend les lumières inertes
// (constaté : objets rendus noirs même sans post-traitement). Seuls les addons ABSENTS du
// paquet webgpu (GLTFLoader, FBXLoader, TransformControls — vendorisés à la main dans
// vendor/three.min.js) restent pris depuis le THREE classique.
//
// On NE MUTE PAS l'objet THREE existant (`window.THREE[cle] = ...`) : le bundle UMD de
// vendor/three.min.js expose certaines constantes via des accesseurs get-only
// (`Object.defineProperty`, sans setter) — une simple affectation lève TypeError
// ("has only a getter") et interrompt tout le module avant même de poser WebGPURenderer,
// ce qui a fait planter le moteur en entier (constaté : hiérarchie vide, viewport noir).
// On construit donc un NOUVEL objet et on réaffecte `window.THREE` en bloc — ça ne lit que
// les propriétés de l'ancien (aucune restriction sur la lecture d'un accesseur get-only).
// UNE SEULE INSTANCE (v0.173.2) : vendor/three.min.js n'est plus charge, window.THREE est vide
// ici. Les addons (vendor/three-addons.min.js) s'y accrochent JUSTE APRES ce module, et les
// decodeurs apres eux. Un objet neuf plutot que l'espace de noms du module : ce dernier est
// scelle, les addons ne pourraient pas y poser leurs classes.
window.THREE = Object.assign({}, window.THREE, THREE_WEBGPU);
window.TSL = TSL;
window.dispatchEvent(new Event('moteur-webgpu-pret'));
