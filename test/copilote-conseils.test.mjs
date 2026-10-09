import { deEsm } from './engine-env.mjs';
// Les conseils du copilote doivent nommer des valeurs que le schéma accepte.
//
// Ce fichier existe pour UNE panne précise et coûteuse. Le message d'erreur de `regler_camera_2d`
// disait « aucune caméra 2D dans la scène — créez-en une avec create_object_2d type=camera », et
// l'énumération de `create_object_2d` valait ['sprite', 'tiles', 'empty'] : le seul chemin documenté
// pour créer la caméra du jeu n'existait pas. Le modèle suivait le conseil, obtenait un groupe nu,
// et la scène de départ gardait sa caméra 3D comme `cams[0]` — donc principale. Le jeu publié
// rendait depuis une perspective posée à l'origine : décor, sprites, tri de profondeur, tout était
// juste et l'écran ne montrait rien. Rien dans l'interface ne pouvait le dire.
//
// La garde ne relit pas UN message, elle relit TOUS les conseils de la shape
// « <commande> type=<valeur> » ou « <commande> type « <valeur> » » et les confronte au schéma réel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
// Les fichiers du copilote sont des scripts de page : ils touchent THREE, `objects`, le DOM. On ne
// veut RIEN de tout ça, seulement la table des commandes — d'où un global qui rend un objet creux
// pour tout nom inconnu, au lieu d'une liste de bouchons qu'il faudrait rallonger à chaque ajout.
const FICHIERS = ['js/copilot.js', 'js/copilot-workshop.js'];

function commands(){
  const creux = new Proxy(function(){}, {
    get: (c, p) => (p === 'then' ? undefined : creux), apply: () => creux, construct: () => creux
  });
  const dur = {console, Math, JSON, Number, isFinite, Array, Object, String, RegExp,
               Date, Set, Map, Boolean, Error, parseFloat, parseInt};
  const bac = new Proxy(dur, {
    has: () => true,
    get: (t, p) => (p in t ? t[p] : creux),
    set: (t, p, v) => { t[p] = v; return true; }
  });
  const ctx = vm.createContext(bac);
  ['js/ai-rules.js', 'js/ai-trace.js', 'js/ai-guidelines.js', 'js/copilot-budget.js', 'js/copilot-inspect.js'].concat(FICHIERS)
    .forEach((f) => vm.runInContext(deEsm(read(f)), ctx, {filename: f}));
  // `const COMMANDS` au premier niveau d'un script vit dans l'environnement lexical, pas sur le
  // global : il faut l'ÉVALUER, `ctx.COMMANDS` rendrait le proxy creux sans rien signaler.
  const c = vm.runInContext('typeof COMMANDS !== "undefined" ? COMMANDS : null', ctx);
  assert.ok(c && c.length, 'COMMANDS introuvable — le test ne mesure plus rien');
  return c;
}

// « create_object_2d type=camera » et « create_object_2d type « tuiles » » : les deux tournures
// employées dans les messages. La valeur s'arrête au premier délimiteur de phrase ou de chaîne.
const TOURNURES = [
  /([a-z_0-9]+) type ?= ?['«"]?([a-zA-Z_0-9]+)/g,
  /([a-z_0-9]+) type «\s*([a-zA-Z_0-9]+)\s*»/g
];

function conseils(names){
  const trouves = [];
  FICHIERS.forEach(function(f){
    const src = read(f);
    TOURNURES.forEach(function(re){
      re.lastIndex = 0;
      let m;
      // Un attribut HTML « <input type="…" > » a exactement la même shape qu'un conseil : on ne
      // retient un mot que s'il EST une commande, ou s'il est en serpent — ce qui laisse la garde
      // dénoncer une commande mal orthographiée sans se déclencher sur le balisage de l'interface.
      while((m = re.exec(src))){
        if(!names.includes(m[1]) && !m[1].includes('_')) continue;
        trouves.push({file: f, commande: m[1], value: m[2]});
      }
    });
  });
  return trouves;
}

test('LE TEST QUI PORTE LE FICHIER — tout conseil « commande type=value » nomme une valeur du schéma', () => {
  const C = commands();
  const vus = conseils(C.map(function(x){ return x.name; }));
  // Sans ce plancher, supprimer les deux messages rendrait le test vert en ne mesurant plus rien.
  assert.ok(vus.length >= 2, 'aucun conseil trouvé : la garde ne mesure plus rien (' + vus.length + ')');
  vus.forEach(function(c){
    const cmd = C.find(function(x){ return x.name === c.commande; });
    assert.ok(cmd, c.file + ' conseille « ' + c.commande + ' », commande inexistante');
    const enu = cmd.schema && cmd.schema.properties && cmd.schema.properties.type
             && cmd.schema.properties.type.enum;
    assert.ok(enu, c.file + ' : « ' + c.commande + ' » n\'a pas d\'argument « type » énuméré');
    assert.ok(enu.includes(c.value),
      c.file + ' conseille « ' + c.commande + ' type=' + c.value + ' », or le schéma n\'accepte que '
      + JSON.stringify(enu));
  });
});

test('create_object_2d sait créer la caméra, et par le fichierPath qui la marque principale', () => {
  const C = commands();
  const cmd = C.find(function(x){ return x.name === 'create_object_2d'; });
  assert.ok(cmd.schema.properties.type.enum.includes('camera'),
    'sans « camera » dans l\'énumération, un jeu 2D construit par le copilote n\'a pas de caméra');
  // La caméra passe par la fabrique de composant (`createFromCreatable`), et la branche marque
  // elle-même la première caméra comme PRINCIPALE. Sans ce marquage, `rtCameraMain` retombe sur
  // `cams[0]` — la caméra 3D de la scène de départ — et le joueur ne voit rien.
  const src = read('js/copilot.js');
  const start = src.indexOf("name: 'create_object_2d'");
  const branche = src.slice(start, src.indexOf("name: 'paint_room'", start));
  assert.ok(/a\.type === 'camera'[\s\S]{0,900}createFromCreatable\('Camera'\)/.test(branche),
    'la branche caméra de create_object_2d ne délègue plus à createFromCreatable');
  assert.ok(/main = true/.test(branche),
    'la branche caméra ne marque plus la première caméra comme principale');
});
