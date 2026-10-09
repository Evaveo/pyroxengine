// ---------- ▶ Jouer : lance le jeu dans un onglet indépendant ----------
// Le runtime autonome (js/game-runtime.js, le même code qu'un build exporté) tourne dans
// game-preview.html, un nouvel onglet — pas dans le viewport de l'éditeur. L'éditeur reste
// pleinement utilisable pendant ce temps : pas de gel d'UI, pas d'instantané/restauration.
// Il n'existe donc plus de « mode lecture » DANS l'éditeur : le drapeau `modeGame.active`, qui
// ne devenait plus jamais vrai, et `stopGame()`, qui n'était appelée que sous ce drapeau, ont été
// retirés avec leurs branches mortes (docs/REVUE_2026-09-29.md § 6.1).
import { assets } from './assets.js';
import { setStatus } from './hierarchy.js';
import { allowRunScripts } from './script-trust.js';
import { buildDataProject } from './serialization.js';

export const btnPlay = document.getElementById('btn-play');

export async function play(){
  // CONFIANCE AVANT EXÉCUTION (js/script-trust.js), et c'est ICI qu'elle compte le plus :
  // l'onglet d'aperçu est de MÊME ORIGINE que l'éditeur, donc ce qu'un script y atteindrait
  // (`localStorage`, dont la clé du copilote) est exactement ce que l'éditeur expose. Ouvrir
  // l'onglet puis demander ne servirait à rien — le code aurait déjà tourné.
  //
  // Ici, contrairement à compiledOf() (js/scripts.js), on ATTEND la réponse : « ▶ Jouer » est un
  // geste délibéré, la personne est devant son écran, et rien ne tourne en boucle.
  if(!(await allowRunScripts(assets.concat(
       (typeof projectPluginsAsCode === 'function') ? projectPluginsAsCode() : [])))){
    setStatus('Lancement annulé — scripts non exécutés', 4000);
    return;
  }
  const data = await buildDataProject();
  window.PREVIEW_GAME_DATA = data;
  window.open('game-preview.html', '_blank');
}

btnPlay.addEventListener('click', play);


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.play = play;
