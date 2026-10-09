// ---------- LA CONFIANCE ACCORDÉE AU CODE D'UN PROJET ----------
//
// Le complément de js/script-scope.js, et la seule parade réelle contre un attaquant décidé.
// Le masquage de portée réduit la surface ; il ne ferme pas `eval`. Ce qui ferme vraiment le
// vecteur, c'est de ne pas exécuter du code qu'on n'a pas écrit sans l'avoir demandé.
//
// MODULE D'ÉDITEUR, volontairement. Il n'est PAS embarqué dans un build : un joueur qui
// télécharge un jeu a déjà choisi de le lancer, lui poser la question serait du théâtre. Elle
// ne se pose qu'à l'endroit où l'on OUVRE le projet d'autrui — l'éditeur.
//
// ---------- LA CLÉ EST L'EMPREINTE DU CODE, PAS LE PROJET ----------
//
// Il n'y a pas d'identifiant de projet dans ce moteur (`project` n'en porte pas). On pourrait
// prendre le nom : deux projets nommés « Test » partageraient alors leur confiance, ce qui est
// précisément le trou qu'on essaie de fermer.
//
// La clé retenue est l'empreinte du CODE de chaque script. Ça donne exactement le comportement
// voulu, et pour la bonne raison — **la confiance suit la PATERNITÉ** :
//   · vous écrivez ou modifiez un script dans l'éditeur → son code reçoit la confiance au
//     moment où vous l'enregistrez, puisque vous venez de le taper. Aucune question ;
//   · vous ouvrez le projet de quelqu'un d'autre → ses scripts sont inconnus, on demande UNE
//     fois, et la réponse vaut pour la suite ;
//   · cette personne vous envoie une mise à jour → le code a changé, donc l'empreinte aussi, et
//     on redemande. C'est voulu : c'est un nouveau code, qu'on n'a toujours pas écrit.
//
// Une clé par projet aurait raté ce dernier cas, qui est le plus vicieux — le projet en qui on
// a confiance, et dont la version suivante ne la mérite plus.
//
// ---------- CE QUE ÇA NE PRÉTEND PAS FAIRE ----------
//
// L'empreinte est un SHA-256. Elle était un FNV-1a 32 bits, avec l'argument que « la question
// se poserait de toute façon sur le code choisi ». C'était faux : il suffisait d'ajouter à un
// script malveillant un commentaire qui lui donne l'empreinte d'un code que la victime a
// forcément approuvé (le modèle de script par défaut) — une seconde préimage sur 32 bits se
// calcule en minutes — et le projet s'exécutait sans aucune question (revue du 2026-09-29,
// § 2.2). Le préfixe `s256:` distingue les nouvelles empreintes : les anciennes, en FNV, ne
// correspondent plus à rien, et la question sera reposée une fois — c'est voulu.

import { closeModal, openModal } from './ui.js';

const KEY = 'moteur3d-scripts-confiance';
const CAP = 500;   // au-delà, on oublie les plus anciennes : c'est un cache, pas un registre

// SHA-256, SYNCHRONE. `crypto.subtle.digest` est asynchrone, et la garde de confiance est
// appelée dans des chemins synchrones (lancement d'une partie, boucle de scripts) : on calcule
// donc ici. Quelques dizaines de lignes, sans dépendance ; vérifié sur les vecteurs de la FIPS
// 180-4 (test/script-confiance.test.mjs).
const K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];

/** Le SHA-256 d'une chaîne (encodée en UTF-8), en hexadécimal. */
export function sha256Hex(text){
  const bytes = new TextEncoder().encode(String(text));
  const bitLen = bytes.length * 8;
  const total = ((bytes.length + 9 + 63) >> 6) << 6;
  const m = new Uint8Array(total);
  m.set(bytes);
  m[bytes.length] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 8, Math.floor(bitLen / 0x100000000));
  dv.setUint32(total - 4, bitLen >>> 0);
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const W = new Uint32Array(64);
  const rotr = function(x, n){ return (x >>> n) | (x << (32 - n)); };
  for(let off = 0; off < total; off += 64){
    for(let t = 0; t < 16; t++) W[t] = dv.getUint32(off + t * 4);
    for(let t = 16; t < 64; t++){
      const s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
      const s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for(let t = 0; t < 64; t++){
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[t] + W[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return H.map(function(x){ return ('0000000' + x.toString(16)).slice(-8); }).join('');
}

/**
 * Empreinte d'un code source : `s256:` suivi de son SHA-256.
 *
 * Les fins de ligne sont normalisées AVANT : le même script passé par Windows et par un dépôt
 * git en LF donnerait sinon deux empreintes, donc une question de confiance qui revient sans
 * raison compréhensible pour la personne.
 */
export function fingerprintCode(code){
  return 's256:' + sha256Hex(String(code || '').replace(/\r\n/g, '\n'));
}

function readTrusted(){
  try{ const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; }
  catch(e){ return []; }   // stockage refusé (navigation privée) : on redemandera — le bon repli
}

function writeTrusted(list){
  try{ localStorage.setItem(KEY, JSON.stringify(list.slice(-CAP))); }
  catch(e){ /* stockage plein ou refusé : la confiance ne dure que la session, tant pis */ }
}

/** Un code vide n'est pas du code : il ne pose aucune question. */
export function codeTrusted(code){
  if(!String(code || '').trim()) return true;
  return readTrusted().indexOf(fingerprintCode(code)) !== -1;
}

/**
 * Marque un code comme digne de confiance. Appelée à DEUX endroits, et les deux comptent :
 * quand la personne répond « oui » à la question, et quand elle enregistre un script qu'elle
 * vient d'écrire (js/scripts.js) — c'est ce second appel qui fait qu'un auteur ne se voit
 * jamais poser la question sur son propre travail.
 */
export function trustCode(code){
  if(!String(code || '').trim()) return;
  const f = fingerprintCode(code);
  const list = readTrusted();
  if(list.indexOf(f) === -1){ list.push(f); writeTrusted(list); }
}

// Réponse mémorisée pour la session en cours, pour ne pas reposer la question à chaque image
// quand quelqu'un a dit non : `null` = pas encore demandé, `false` = refusé.
let sessionAnswer = null;
let askPending = null;

/** Remet la question à zéro — à appeler au chargement d'un autre projet. */
export function resetTrustSession(){
  sessionAnswer = null;
  askPending = null;
}

/** true si la personne a explicitement refusé pendant cette session. */
export function executionRefused(){ return sessionAnswer === false; }

/**
 * LE CODE EXÉCUTABLE D'UN ASSET, quel que soit le champ qui le porte — ou `''`.
 *
 * DEUX GENRES, PAS UN SEUL, et c'est la correction d'un trou réel. La garde ne regardait que
 * `kind === 'script'`. Or un asset `documentUI` porte du HTML de projet, que `js/game-ui.js`
 * écrit dans `innerHTML` sans filtre — c'est sa fonction, une interface de jeu est du HTML.
 * Conséquence : un projet SANS AUCUN SCRIPT mais avec un document d'interface passait la garde
 * sans qu'aucune question soit posée, et ses gestionnaires en ligne (`onerror`, `onload`)
 * s'exécutaient dans la page de l'éditeur — donc avec `localStorage`, où vit la clé du
 * copilote, et avec `fetch`. Les balises `<script>` d'un `innerHTML` ne s'exécutent pas ; les
 * gestionnaires d'événements, si.
 *
 * ON NE CHERCHE PAS À DISTINGUER LE HTML « INERTE » DU HTML EXÉCUTABLE. Il faudrait un
 * analyseur, et un analyseur qui se trompe une seule fois rouvre le trou en entier :
 * `onerror`, `javascript:`, `srcdoc`, une `url()` dans un `style`… La règle retenue tient en
 * une phrase et ne peut pas se tromper : le HTML d'un projet est du code.
 *
 * LES FEUILLES DE STYLE N'Y SONT PAS, et c'est un choix mesuré, pas un oubli : leur contenu
 * part dans le `textContent` d'une balise `<style>`, qui n'exécute aucun script. Il reste un
 * canal d'exfiltration faible — une `url()` déclenchée par un sélecteur d'attribut — sans
 * accès au `localStorage` ni au DOM. À réévaluer si le CSS gagne un jour un chemin d'exécution.
 */
export function codeOfAsset(a){
  if(!a) return '';
  if(a.kind === 'script') return String(a.code || '');
  if(a.kind === 'documentUI') return String(a.html || '');
  if(a.kind === 'plugin') return String(a.code || '');
  return '';
}

/**
 * Le code du projet qui n'a pas encore reçu la confiance — scripts ET documents d'interface.
 * `listAssets` est la liste d'assets du projet, passée en paramètre pour que ce module ne
 * dépende de rien d'autre que de la modale.
 */
export function untrustedCode(listAssets){
  return (listAssets || []).filter(function(a){
    const code = codeOfAsset(a);
    return code.trim() !== '' && !codeTrusted(code);
  });
}

function escape(s){
  return String(s).replace(/[<&]/g, function(c){ return c === '<' ? '&lt;' : '&amp;'; });
}

/**
 * Pose la question, une seule fois, et rend une promesse de booléen.
 *
 * Le libellé dit ce qui est en jeu sans dramatiser : la personne doit pouvoir décider, pas être
 * effrayée. Il NOMME les scripts concernés — refuser en bloc sans savoir de quoi il s'agit
 * pousse à accepter par lassitude, ce qui viderait la garde de son sens.
 */
export function askTrustScripts(unknown){
  if(sessionAnswer !== null) return Promise.resolve(sessionAnswer);
  if(askPending) return askPending;

  // LA NATURE EST DITE, pas seulement le nom : « Menu » ne renseigne personne sur ce qu'il va
  // exécuter, alors que « Menu — document d'interface » situe la question.
  const names = unknown.map(function(a){
    const kindLabel = a.kind === 'documentUI' ? " — document d'interface"
      : (a.kind === 'plugin' ? ' — plugin' : ' — script');
    return (a.name || 'sans nom') + kindLabel;
  });
  const items = names.slice(0, 12).map(function(n){ return '<li>' + escape(n) + '</li>'; }).join('');
  const more = names.length > 12 ? '<p>…et ' + (names.length - 12) + ' autre(s).</p>' : '';

  askPending = new Promise(function(resolve){
    openModal('Ce projet contient du code que vous n\'avez pas écrit',
      '<p>' + names.length + ' script(s) de ce projet vont s\'exécuter. Un script peut agir sur '
      + 'votre navigateur, pas seulement sur la scène.</p>'
      + '<ul>' + items + '</ul>' + more
      + '<p>Si ce projet vient de quelqu\'un d\'autre, n\'exécutez son code que si vous lui '
      + 'faites confiance. Vous pouvez lire les scripts dans le panneau Projet avant de '
      + 'décider — le reste de l\'éditeur fonctionne normalement si vous refusez.</p>'
      + '<div class="row" style="justify-content:flex-end;gap:8px;margin-top:14px">'
      + '<button id="trust-no" class="btn">Ne pas exécuter</button>'
      + '<button id="trust-yes" class="btn primary">Exécuter les scripts</button></div>');

    const finish = function(ok){
      if(ok) unknown.forEach(function(a){ trustCode(codeOfAsset(a)); });
      sessionAnswer = ok;
      askPending = null;
      closeModal();
      resolve(ok);
    };
    const yes = document.getElementById('trust-yes');
    const no = document.getElementById('trust-no');
    if(yes) yes.addEventListener('click', function(){ finish(true); });
    if(no) no.addEventListener('click', function(){ finish(false); });
  });
  return askPending;
}

/**
 * Le point d'entrée des appelants : rien à faire si tout est connu, sinon la question.
 * Rend `true` quand l'exécution est permise.
 */
export function allowRunScripts(listAssets){
  const unknown = untrustedCode(listAssets);
  if(!unknown.length) return Promise.resolve(true);
  return askTrustScripts(unknown);
}

// Exposé en globale pour les appelants qui gardent leur `typeof` (même régime que le more de
// la famille « éditeur seulement », voir docs/ARCHITECTURE.md).
globalThis.codeTrusted = codeTrusted;
globalThis.trustCode = trustCode;
globalThis.executionRefused = executionRefused;
globalThis.resetTrustSession = resetTrustSession;
globalThis.allowRunScripts = allowRunScripts;
globalThis.codeOfAsset = codeOfAsset;
