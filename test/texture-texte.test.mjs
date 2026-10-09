import { deEsm } from './engine-env.mjs';
// LE TEXTE SUR UNE TEXTURE — une police matricielle, et pourquoi pas un canvas.
//
// Ce module ne dessine que dans un tampon de pixels : c'est ce qui le rend lisible par un test sans
// navigateur, et cette pureté vaut plus qu'un `fillText`. Une police 5 × 7 y suffit pour ce dont un
// jeu a besoin — un chiffre sur un cube, une étiquette sur un panneau, un score — et elle reste
// NETTE à toute échelle entière, ce qu'aucune police vectorielle ne garantit sur une texture
// filtrée « au plus proche ».
//
// Les tests LISENT LES PIXELS. Vérifier que la fonction existe ne dirait pas si quelque chose est
// écrit, ni si c'est lisible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

function contexte(){
  const bac = {console, Math, JSON, Object, Array, Number, String, isFinite,
               Uint8ClampedArray, parseInt, parseFloat};
  bac.window = bac; bac.globalThis = bac;
  vm.runInContext(deEsm(read('js/proc-texture.js')),
    vm.createContext(bac), {filename: 'js/proc-texture.js'});
  return bac;
}
const C = contexte();
// RAPATRIEMENT DANS LE ROYAUME DE L HOTE. Un tableau ne dans un contexte vm porte le prototype
// de CE contexte, et deepEqual echoue en affichant deux structures identiques — « same structure
// but not reference-equal ». Cinquieme fois que ce repo s y fait prendre.
const nu = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));

/** Les pixels d'encre : ceux qui diffèrent du fond. */
function encre(t, fond){
  const p = [];
  for(let y = 0; y < t.h; y++) for(let x = 0; x < t.l; x++){
    const i = (y * t.l + x) * 4;
    if(t.px[i] !== fond[0] || t.px[i+1] !== fond[1] || t.px[i+2] !== fond[2]) p.push([x, y]);
  }
  return p;
}
const bounds = (p) => ({x0: Math.min.apply(null, p.map(q => q[0])), x1: Math.max.apply(null, p.map(q => q[0])),
                        y0: Math.min.apply(null, p.map(q => q[1])), y1: Math.max.apply(null, p.map(q => q[1]))});

test('LE TEXTE EST ECRIT, et il est CENTRE — le test qui porte le fichier', () => {
  const t = C.makeTextureProc({kind:'text', width:64, height:64, text:'2048',
                                    color:'#ffffff', color2:'#000000'});
  assert.ok(t, 'aucune texture produite');
  const p = encre(t, [255, 255, 255]);
  assert.ok(p.length > 50, 'presque rien n\'est écrit (' + p.length + ' pixels d\'encre)');
  const b = bounds(p);
  // CENTRÉ : les marges gauche/droite et haut/bottom ne doivent pas différer de plus d'un pixel.
  // Un texte collé à gauche « marche » aussi, et c'est exactement ce qu'on ne veut pas livrer.
  assert.ok(Math.abs(b.x0 - (t.l - 1 - b.x1)) <= 1,
    'text non centré horizontalement : ' + b.x0 + ' à gauche, ' + (t.l - 1 - b.x1) + ' à droite');
  assert.ok(Math.abs(b.y0 - (t.h - 1 - b.y1)) <= 1,
    'text non centré verticalement : ' + b.y0 + ' en haut, ' + (t.h - 1 - b.y1) + ' en bas');
});

test('CHAQUE CARACTERE CONNU dessine quelque chose de DIFFERENT des autres', () => {
  // Une police où deux glyphes se ressemblent est pire qu'une absence de police : « 8 » lu pour
  // « 0 » sur un cube fait perdre une partie sans qu'on comprenne pourquoi.
  const vus = new Map();
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ+-=.!?*'.split('').forEach(function(c){
    const t = C.makeTextureProc({kind:'text', width:16, height:16, text:c,
                                      color:'#ffffff', color2:'#000000'});
    const key = encre(t, [255, 255, 255]).map(function(q){ return q.join(','); }).join(' ');
    assert.ok(key.length, 'le caractère « ' + c + ' » ne dessine rien');
    assert.ok(!vus.has(key), '« ' + c + ' » et « ' + vus.get(key) + ' » dessinent la MÊME chose');
    vus.set(key, c);
  });
  // L'space, lui, doit être empty — c'est le seul.
  const e = C.makeTextureProc({kind:'text', width:16, height:16, text:'A A',
                                    color:'#ffffff', color2:'#000000'});
  assert.ok(encre(e, [255,255,255]).length > 0, 'un texte avec space ne dessine rien du tout');
});

test('L ECHELLE EST ENTIERE, et grandit avec la place', () => {
  // Un grossissement fractionnaire rendrait une rangée de pixels sur deux plus épaisse que sa
  // voisine : le chiffre paraîtrait mal dessiné plutôt que petit.
  const e = (l, h, n) => C.scaleTextProc(l, h, n, 0);
  assert.equal(e(5, 7, 1), 1, 'la place juste suffisante doit donner 1');
  assert.equal(e(10, 14, 1), 2);
  assert.equal(e(50, 70, 1), 10);
  assert.equal(e(1, 1, 1), 1, 'jamais zéro : un texte invisible vaut moins qu\'un texte serré');
  [[64, 64, 4], [128, 32, 2], [7, 33, 3]].forEach(function(c){
    const v = e(c[0], c[1], c[2]);
    assert.equal(v, Math.round(v), 'échelle non entière pour ' + c.join('×'));
    assert.ok(v >= 1);
  });
  // Plus de caractères dans la même place : jamais plus grand.
  assert.ok(e(64, 64, 4) <= e(64, 64, 1), '« 2048 » ne peut pas être plus gros que « 2 »');
});

test('UN NOMBRE PLUS LONG TIENT TOUJOURS dans la meme texture', () => {
  // Le cas du jeu de fusion : la même face de cube porte « 2 » puis « 2048 » puis « 16384 ».
  // Si le texte débordait, le chiffre serait rogné et illisible exactement quand il compte le plus.
  ['2', '16', '2048', '16384', '131072'].forEach(function(n){
    const t = C.makeTextureProc({kind:'text', width:128, height:128, text:n,
                                      color:'#222222', color2:'#ffdd55'});
    const p = encre(t, [34, 34, 34]);
    assert.ok(p.length > 20, '« ' + n + ' » n\'écrit presque rien');
    const b = bounds(p);
    // PAS COLLE AU BORD. Les pixels hors cadre sont jetes en silence par le tracage : une clamped
    // « dans la texture » est donc toujours vraie, meme quand le texte deborde largement. Ce qui
    // se mesure, c est qu il RESTE de la marge — sinon le number est rogne exactement quand il
    // count le plus.
    assert.ok(b.x0 >= 1 && b.x1 <= t.l - 2,
      '« ' + n + ' » touche le bord : il est rogne (x de ' + b.x0 + ' a ' + b.x1 + ')');
    assert.ok(b.y0 >= 1 && b.y1 <= t.h - 2, '« ' + n + ' » touche le bord en height');
  });
});

test('LES COULEURS sont bien le fond et l encre, pas l inverse', () => {
  const t = C.makeTextureProc({kind:'text', width:32, height:32, text:'8',
                                    color:'#ff0000', color2:'#0000ff'});
  const coin = [t.px[0], t.px[1], t.px[2]];
  assert.deepEqual(coin, [255, 0, 0], 'le coin doit porter la couleur de FOND');
  const p = encre(t, [255, 0, 0]);
  const i = (p[0][1] * t.l + p[0][0]) * 4;
  assert.deepEqual([t.px[i], t.px[i+1], t.px[i+2]], [0, 0, 255], 'l\'encre doit être la seconde color');
});

test('UN TEXTE VIDE ou INCONNU est REFUSE, pas dessine en silence', () => {
  // Un aplat muet ferait croire que quelque chose a été écrit.
  ['', '   ', null, undefined].forEach(function(v){
    const p = C.validateTextureProc({kind:'text', width:32, height:32, text:v});
    assert.ok(p.length > 0, 'un texte « ' + JSON.stringify(v) + ' » est accepté');
  });
  // Un caractère inconnu ne fait pas échouer : il devient « ? », ce qui SE VOIT.
  assert.deepEqual(nu(C.validateTextureProc({kind:'text', width:32, height:32, text:'é'})), []);
  assert.equal(C.normalizeTextProc('é'), '?');
  assert.equal(C.normalizeTextProc('ab'), 'AB', 'les minuscules doivent passer en majuscules');
});

test('LE GENRE est declare partout ou il doit l etre', () => {
  const tp = read('js/proc-texture.js'), co = read('js/copilot-workshop.js');
  assert.ok(tp.indexOf("'character', 'text']") >= 0, 'kind absent du validateur');
  assert.ok(tp.indexOf("d.kind === 'text')      return textureText(") >= 0,
    'le genre est valide mais rien ne le factory : branche morte');
  assert.ok(co.indexOf("'noise', 'text']") >= 0, 'le copilote ne sait pas fabriquer de texte');
  // SUR LA BONNE COMMANDE. Une autre en porte un aussi : chercher « texte: {type: » n importe ou
  // laissait passer sa disparition de create_texture, et le genre devenait inatteignable.
  const block = co.slice(co.indexOf("name: 'create_texture'"), co.indexOf("exec:", co.indexOf("name: 'create_texture'")));
  assert.ok(block.indexOf("text: {type:") >= 0,
    'create_texture n a pas de parametre « text » : le genre serait inatteignable');
});

test('LES GLYPHES NE SONT PAS EN MIROIR — un L reste un L', () => {
  // Une police miroir passe toutes les autres gardes : les caracteres restent distincts, le texte
  // reste centre, l echelle reste juste. Il faut donc une shape ASYMETRIQUE dont on sait de quel
  // cote elle est lourde. Le L porte sa bar a gauche et son pied en bas.
  const t = C.makeTextureProc({kind:'text', width:32, height:32, text:'L',
                                    color:'#ffffff', color2:'#000000'});
  const p = encre(t, [255, 255, 255]);
  const b = bounds(p);
  const milieuX = (b.x0 + b.x1) / 2, milieuY = (b.y0 + b.y1) / 2;
  const aGauche = p.filter(function(q){ return q[0] < milieuX; }).length;
  const aDroite = p.filter(function(q){ return q[0] > milieuX; }).length;
  const enBas   = p.filter(function(q){ return q[1] > milieuY; }).length;
  const enHaut  = p.filter(function(q){ return q[1] < milieuY; }).length;
  assert.ok(aGauche > aDroite, 'le L a plus d encre a DROITE (' + aDroite + ') qu a gauche ('
    + aGauche + ') : les glyphes sont dessines en miroir horizontal');
  assert.ok(enBas > enHaut, 'le L a plus d encre EN HAUT (' + enHaut + ') qu en bas ('
    + enBas + ') : les glyphes sont retournes verticalement');
});
