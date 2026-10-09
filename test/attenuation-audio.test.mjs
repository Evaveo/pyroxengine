import { deEsm } from './engine-env.mjs';
// L'atténuation d'une source audio, partagée éditeur/game.
//
// Le test qui porte le fichier est celui du MODÈLE : `inverse` — le défaut du Web Audio et celui de tous
// les projets existants — ne descend JAMAIS à zéro. C'est la cause du symptôme qu'on décrit comme « le
// niveau est bruyant sans qu'on sache pourquoi » : dix sources lointaines restent audibles en fond, et
// aucune ne paraît fautive puisque chacune, prise seule, semble discrète.
//
// Seul `lineaire` éteint vraiment. Ce fichier le PROUVE en chiffres, parce qu'entre les deux modèles la
// différence est invisible dans le code et ne s'entend qu'à l'usage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const hote = (x) => JSON.parse(JSON.stringify(x));

function contexte(){
  const bac = {console, Math, JSON, Number, String, Object, Array, isFinite};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('js/audio-falloff.js')), ctx, {filename: 'js/audio-falloff.js'});
  return ctx;
}

/** Une source son factice : elle ENREGISTRE ce qu'on lui pose, au lieu de le play. */
function fauxSon(sansCertaines){
  const pose = {};
  const s = {pose: pose};
  const met = (name, key) => { s[name] = function(v){ pose[key] = v; }; };
  if(!(sansCertaines || []).includes('ref')) met('setRefDistance', 'ref');
  if(!(sansCertaines || []).includes('max')) met('setMaxDistance', 'max');
  if(!(sansCertaines || []).includes('rolloff')) met('setRolloffFactor', 'rolloff');
  if(!(sansCertaines || []).includes('model')) met('setDistanceModel', 'model');
  return s;
}

test('SEUL LE MODELE LINEAIRE eteint vraiment le son — le test qui porte le fichier', () => {
  const ctx = contexte();
  const base = {range: 10, distanceMax: 100, rolloff: 1};

  // `inverse` : à la distance maximale, le son s'entend ENCORE. C'est le défaut, et c'est la cause du
  // mélange brouillé qu'on n'arrive pas à attribuer.
  const gInv = ctx.gainAudioA(Object.assign({}, base, {model: 'inverse'}), 100);
  assert.ok(gInv > 0.05, 'inverse à la distance max : gain ' + gInv.toFixed(4) + ' — devrait rester audible');
  // Et même à DIX FOIS la distance maximale, il ne se tait pas : la distance est bornée à max, donc le
  // gain plafonne au lieu de continuer à descendre. C'est le piège du champ « distance max » avec ce
  // modèle — il ne fait pas ce que son nom dit.
  const gLoin = ctx.gainAudioA(Object.assign({}, base, {model: 'inverse'}), 1000);
  assert.ok(Math.abs(gLoin - gInv) < 1e-9,
    'inverse : le gain doit PLAFONNER au-delà de la distance max (' + gLoin + ' vs ' + gInv + ')');

  // `lineaire` : zéro exactement à la distance maximale, et zéro au-delà.
  const lin = Object.assign({}, base, {model: 'lineaire'});
  assert.equal(ctx.gainAudioA(lin, 100), 0, 'linéaire doit atteindre ZÉRO à la distance max');
  assert.equal(ctx.gainAudioA(lin, 500), 0, 'et rester à zéro au-delà');
  // Volume plein en dessous de la portée, dans les deux modèles.
  assert.equal(ctx.gainAudioA(lin, 0), 1);
  assert.equal(ctx.gainAudioA(lin, 10), 1, 'à la portée exactement, le volume est encore plein');
  assert.equal(ctx.gainAudioA(Object.assign({}, base, {model: 'inverse'}), 5), 1);

  // Et il DÉCROÎT de façon monotone entre les deux : une atténuation qui remonte s'entend comme un
  // son qui « respire » quand le joueur s'éloigne.
  let prec = 2;
  for(let d = 10; d <= 100; d += 5){
    const g = ctx.gainAudioA(lin, d);
    assert.ok(g <= prec + 1e-9, 'linéaire non monotone à d=' + d + ' : ' + g + ' > ' + prec);
    prec = g;
  }
});

test('LA PENTE change la raideur, et 0 supprime l falloff', () => {
  const ctx = contexte();
  const a = ctx.gainAudioA({range: 10, distanceMax: 100, rolloff: 1, model: 'inverse'}, 50);
  const b = ctx.gainAudioA({range: 10, distanceMax: 100, rolloff: 3, model: 'inverse'}, 50);
  assert.ok(b < a, 'une pente plus forte doit atténuer davantage (' + b + ' vs ' + a + ')');
  // Pente 0 : le son garde son volume plein partout — comme s'il n'était pas spatial. C'est un réglage
  // légitime, et `validateFalloffAudio` le dit plutôt que de le laisser passer pour un bug.
  assert.equal(ctx.gainAudioA({range: 10, distanceMax: 100, rolloff: 0, model: 'inverse'}, 999), 1);
  assert.equal(ctx.gainAudioA({range: 10, distanceMax: 100, rolloff: 0, model: 'lineaire'}, 999), 1);
});

test('UNE DISTANCE MAX SOUS LA PORTEE est REPOUSSEE, pas acceptee', () => {
  const ctx = contexte();
  // `max <= ref` donne une division par zéro dans le modèle linéaire : selon le navigateur, le son
  // disparaît d'un coup ou reste à plein volume. On repousse plutôt que de refuser, parce qu'un réglage
  // tapé à l'envers doit continuer de produire un son.
  const s = fauxSon();
  const r = ctx.setFalloffAudio(s, {range: 20, distanceMax: 5, rolloff: 1, model: 'lineaire'});
  assert.ok(s.pose.max > s.pose.ref, 'max=' + s.pose.max + ' doit dépasser ref=' + s.pose.ref);
  assert.equal(r.range, 20);
  // Et le gain reste fini et dans [0, 1] — pas de NaN, qui rendrait la source muette sans erreur.
  const g = ctx.gainAudioA({range: 20, distanceMax: 5, rolloff: 1, model: 'lineaire'}, 30);
  assert.ok(isFinite(g) && g >= 0 && g <= 1, 'gain = ' + g);
  // Et c'est SIGNALÉ.
  assert.ok(ctx.validateFalloffAudio({range: 20, distanceMax: 5, model: 'lineaire'})
              .some((x) => x.includes('sous la portée')));
});

test('LES QUATRE REGLAGES sont posés, et un setter absent est SIGNALE', () => {
  const ctx = contexte();
  const s = fauxSon();
  const r = ctx.setFalloffAudio(s, {range: 8, distanceMax: 80, rolloff: 2, model: 'lineaire'});
  assert.deepEqual(hote(s.pose), {ref: 8, max: 80, rolloff: 2, model: 'linear'},
    'les quatre setters doivent recevoir les valeurs, et le modèle traduit en anglais');
  assert.deepEqual(hote(r.ignored), []);

  // Une source NON positionnelle n'a aucun de ces setters. On ne fait rien, et on le DIT : un réglage
  // silencieusement ignoré parce que la méthode n'existe pas est la pire des issues — l'auteur croit
  // avoir réglé quelque chose.
  const nu = fauxSon(['ref', 'max', 'rolloff', 'model']);
  const r2 = ctx.setFalloffAudio(nu, {range: 8});
  assert.deepEqual(hote(r2.ignored).sort(), ['distanceMax', 'model', 'range', 'rolloff']);
  assert.deepEqual(hote(nu.pose), {}, 'rien ne doit être posé');
  // Et aucun appel ne doit lever sur un objet vide ou absent.
  assert.doesNotThrow(() => ctx.setFalloffAudio(null, null));
  assert.doesNotThrow(() => ctx.setFalloffAudio({}, {}));
});

test('UN MODELE INCONNU retombe sur inverse, pas sur du vide', () => {
  const ctx = contexte();
  const s = fauxSon();
  ctx.setFalloffAudio(s, {range: 10, model: 'aleatoire'});
  assert.equal(s.pose.model, 'inverse',
    'un modèle inconnu passé au Web Audio lèverait, et le son ne jouerait pas du tout');
  // Le gain suit le même repli : sans ça, `gainAudioA` et le son réel diverngeraient, et le message de
  // l'inspecteur mentirait sur ce qu'on entend.
  assert.equal(ctx.gainAudioA({range: 10, distanceMax: 100, model: 'aleatoire'}, 100),
               ctx.gainAudioA({range: 10, distanceMax: 100, model: 'inverse'}, 100));
});

test('validateFalloffAudio DONNE LE CHIFFRE, pas seulement un avis', () => {
  const ctx = contexte();
  const p = ctx.validateFalloffAudio({range: 10, distanceMax: 100, rolloff: 1, model: 'inverse'});
  assert.ok(p.length, 'le modèle inverse doit être commenté');
  // Un pourcentage, pas un adjectif : « ce son s'entend encore à N % » est vérifiable, « ce modèle
  // atténue peu » ne l'est pas — et c'est ce chiffre qui fait comprendre la différence.
  assert.ok(/\d+\s*%/.test(p.join(' ')), 'le message doit donner un pourcentage : ' + p.join(' '));
  assert.ok(p.join(' ').includes('lineaire'), 'et nommer le modèle à prendre');
  // Le modèle linéaire, lui, n'a rien à signaler.
  assert.deepEqual(hote(ctx.validateFalloffAudio({range: 10, distanceMax: 100, rolloff: 1, model: 'lineaire'})), []);
  // Une source non spatiale ignore toute l'atténuation : la commenter serait du bruit.
  assert.deepEqual(hote(ctx.validateFalloffAudio({spatial: false, model: 'inverse'})), []);
  // Pente nulle : signalée, avec la suggestion qui va avec.
  assert.ok(ctx.validateFalloffAudio({range: 10, rolloff: 0, model: 'lineaire'})
              .some((x) => x.includes('3D')));
});

test('LES DEUX MOTEURS appellent la MEME fonction, pas une copie', () => {
  // C'est la raison d'être du fichier partagé. Deux exemplaires de ces quatre réglages feraient sonner
  // le jeu publié autrement que l'éditeur — et une divergence d'atténuation ne se voit pas : elle
  // s'entend, plus tard, chez le joueur, sur un mélange qu'on croyait validé.
  const manques = [];
  for(const f of ['js/audio.js', 'js/game-runtime.js']){
    const s = read(f).replace(/\r\n/g, '\n');
    // L'atténuation passe désormais par createSourceSound (js/audio-bus.js), qui la reçoit en
    // paramètre : le moteur doit lui donner la fonction partagée, pas une copie.
    if(!/createSourceSound\([^;]*setFalloffAudio/.test(s)) manques.push(f + ' n\'appelle pas la fonction partagée');
    // Et surtout : plus de setter en dur, qui recréerait la divergence en douce.
    const codeSeul = s.split('\n').filter(function(l){ return !/^\s*(\/\/|\*)/.test(l); }).join('\n');
    if(/setRefDistance\(/.test(codeSeul)) manques.push(f + ' pose encore setRefDistance à la main');
    if(/setMaxDistance\(/.test(codeSeul)) manques.push(f + ' pose encore setMaxDistance à la main');
  }
  assert.deepEqual(manques, [], manques.join('\n'));
});
