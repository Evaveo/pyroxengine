import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

function neuf(){
  return creerContexte(['js/ui/registry.js', 'js/ui/form-plan.js', 'js/ui/fields.js',
                        'js/ui/form.js', 'js/history.js']);
}

const descriptor = { id: 'p', sections: [{ id: 's', fields: [
  { key: 'position.x', label: 'X', type: 'number' },
  { key: 'name', label: 'Nom', type: 'text' },
  { key: 'visible', label: 'Visible', type: 'checkbox' }
]}]};

function cube(x){ return { position: { x: x, y: 0, z: 0 }, name: 'cube', visible: true }; }

test('la construction pose un element par champ, avec son id', () => {
  const env = neuf();
  const host = env.document.createElement('div');
  env.document.body.appendChild(host);
  const form = env.createForm(host, descriptor);
  form.setTargets([cube(3)]);

  assert.ok(env.document.getElementById('f-position-x'), 'le champ X doit exister');
  assert.equal(env.document.getElementById('f-position-x').value, '3');
  assert.equal(env.document.getElementById('f-name').value, 'cube');
  assert.equal(env.document.getElementById('f-visible').checked, true);
});

test('sync recopie les valeurs sans reconstruire', () => {
  const env = neuf();
  const host = env.document.createElement('div');
  env.document.body.appendChild(host);
  const form = env.createForm(host, descriptor);
  const c = cube(3);
  form.setTargets([c]);
  const avant = env.document.getElementById('f-position-x');

  c.position.x = 9;
  form.sync();
  assert.equal(avant.value, '9');
  assert.equal(env.document.getElementById('f-position-x'), avant,
    'le MEME element : sync ne reconstruit pas');
});

test('sync ne touche PAS un champ qui a le focus', () => {
  const env = neuf();
  const host = env.document.createElement('div');
  env.document.body.appendChild(host);
  const form = env.createForm(host, descriptor);
  const c = cube(3);
  form.setTargets([c]);

  const el = env.document.getElementById('f-position-x');
  el.focus();
  el.value = '12';        // l'utilisateur tape
  c.position.x = 99;      // le gizmo bouge en meme temps
  form.sync();
  assert.equal(el.value, '12', 'la saisie en cours ne doit pas etre ecrasee');
});

test('une saisie non lisible n ecrit rien et allume l etat invalide', () => {
  const env = neuf();
  const host = env.document.createElement('div');
  env.document.body.appendChild(host);
  const form = env.createForm(host, descriptor);
  const c = cube(3);
  form.setTargets([c]);

  const el = env.document.getElementById('f-position-x');
  el.value = '1.2e';
  el.dispatchEvent({ type: 'input' });
  assert.equal(c.position.x, 3, 'rien ne doit etre ecrit');
  assert.equal(el.classList.contains('invalid'), true);

  el.value = '1.25';
  el.dispatchEvent({ type: 'input' });
  assert.equal(c.position.x, 1.25);
  assert.equal(el.classList.contains('invalid'), false);
});

test('une saisie ecrit sur TOUTES les cibles, en un seul instantane', () => {
  const env = neuf();
  const host = env.document.createElement('div');
  env.document.body.appendChild(host);
  const form = env.createForm(host, descriptor);
  const a = cube(3), b = cube(7);
  form.setTargets([a, b]);

  const avant = env.historyLength();
  const el = env.document.getElementById('f-position-x');
  el.focus();
  el.value = '5'; el.dispatchEvent({ type: 'input' });
  el.value = '6'; el.dispatchEvent({ type: 'input' });
  el.dispatchEvent({ type: 'change' });

  assert.equal(a.position.x, 6);
  assert.equal(b.position.x, 6);
  assert.equal(env.historyLength() - avant, 1, 'une interaction = un instantane');
});

test('un champ divergent affiche l etat mixed et n ecrase rien', () => {
  const env = neuf();
  const host = env.document.createElement('div');
  env.document.body.appendChild(host);
  const form = env.createForm(host, descriptor);
  const a = cube(3), b = cube(7);
  form.setTargets([a, b]);

  const el = env.document.getElementById('f-position-x');
  assert.equal(el.classList.contains('mixed'), true);
  assert.equal(a.position.x, 3);
  assert.equal(b.position.x, 7);
});

test('la reconstruction de FORME est differee tant qu un champ a le focus', () => {
  const env = neuf();
  const host = env.document.createElement('div');
  env.document.body.appendChild(host);
  const descr = { id: 'p', sections: [{ id: 's', fields: [
    { key: 'type', label: 'Type', type: 'text' },
    { key: 'couleur', label: 'Couleur', type: 'color', visible: (t) => t.type === 'color' }
  ]}]};
  const form = env.createForm(host, descr);
  const t = { type: 'hdri', couleur: '#ffffff' };
  form.setTargets([t]);
  assert.equal(env.document.getElementById('f-couleur'), null);

  const el = env.document.getElementById('f-type');
  el.focus();
  t.type = 'color';              // la forme change...
  form.sync();
  assert.equal(env.document.getElementById('f-couleur'), null,
    '...mais on ne detruit pas le champ en cours de saisie');

  el.blur();
  form.sync();
  assert.ok(env.document.getElementById('f-couleur'),
    'la reconstruction differee a lieu au blur');
});

test('apres reconstruction, le focus revient sur le champ de meme cle', () => {
  const env = neuf();
  const host = env.document.createElement('div');
  env.document.body.appendChild(host);
  const descr = { id: 'p', sections: [{ id: 's', fields: [
    { key: 'a', label: 'A', type: 'text' },
    { key: 'b', label: 'B', type: 'text', visible: (t) => t.withB }
  ]}]};
  const form = env.createForm(host, descr);
  const t = { a: 'x', b: 'y', withB: false };
  form.setTargets([t]);

  env.document.getElementById('f-a').focus();
  t.withB = true;
  form.rebuild();     // reconstruction FORCEE, focus a restaurer
  assert.equal(env.document.activeElement, env.document.getElementById('f-a'));
});


test('sync ne CONSTRUIT rien — meme sur une section en ligne', () => {
  // POURQUOI CE TEST EXISTE. La ligne partagee d'une section `layout:'inline'` etait fabriquee
  // dans `build()` ET dans `sync()`. Chaque synchronisation empilait une ligne de plus : pendant
  // un glissement de gizmo, l'inspecteur se remplissait de « Nom » a soixante par seconde.
  const env = neuf();
  const host = env.document.createElement('div');
  env.document.body.appendChild(host);
  const descr = { id: 'p', sections: [{ id: 'identity', title: '', layout: 'inline', fields: [
    { ids: ['f-nom'], label: 'Nom', type: 'text', get: (o) => o.name, set: (o, v) => { o.name = v; } },
    { ids: ['f-tag'], label: 'Tag', type: 'text', get: (o) => o.tag, set: (o, v) => { o.tag = v; } }
  ]}]};
  const cible = { name: 'Plan 1', tag: '' };
  const form = env.createForm(host, descr);
  form.setTargets([cible]);
  const apresConstruction = host.children.length;

  for(let i = 0; i < 10; i++){ form.setTargets([cible]); form.sync(); }
  assert.equal(host.children.length, apresConstruction,
    'dix synchronisations ne doivent rien ajouter au DOM');
});

test('choisir dans un <select> reconstruit TOUT DE SUITE, meme si le select garde le focus', () => {
  // POURQUOI CE TEST EXISTE. Le type de ciel (panneau Environnement) est un <select> : le
  // choisir declenche `change`, mais l'element garde le focus. La garde « ne reconstruis pas
  // pendant une saisie » reportait donc l'apparition des champs qui dependent du choix
  // jusqu'au clic suivant ailleurs — passer le ciel en « Panorama (image) » ne montrait aucun
  // champ Image, et le reglage passait pour casse.
  const env = neuf();
  const host = env.document.createElement('div');
  env.document.body.appendChild(host);
  const descr = { id: 'p', sections: [{ id: 's', fields: [
    { ids: ['f-sky'], label: 'Type', type: 'choice',
      options: [['color', 'Couleur'], ['image', 'Panorama']],
      get: (t) => t.sky, set: (t, v) => { t.sky = v; } },
    { ids: ['f-img'], label: 'Image', type: 'choice', options: [['a1', 'HDRI']],
      visible: (t) => t.sky === 'image',
      get: (t) => t.img, set: (t, v) => { t.img = v; } }
  ]}]};
  const form = env.createForm(host, descr);
  const t = { sky: 'color', img: 'a1' };
  form.setTargets([t]);
  assert.equal(env.document.getElementById('f-img'), null, 'point de depart : pas de champ Image');

  const el = env.document.getElementById('f-sky');
  el.focus();
  el.value = 'image';
  el.dispatchEvent({ type: 'input' });
  el.dispatchEvent({ type: 'change' });

  assert.equal(t.sky, 'image', 'le choix est ecrit sur la cible');
  assert.ok(env.document.getElementById('f-img'),
    'le champ Image apparait sans attendre un clic ailleurs');
});

test('un accesseur qui LEVE ne bloque plus le reste du formulaire', () => {
  // POURQUOI CE TEST EXISTE. `field.set` etait appele sans filet : une exception dans un
  // accesseur (par exemple `applyEnvironment()` derriere le type de ciel) remontait dans
  // l'ecouteur du champ, et tout ce qui suit — dont le recalcul de forme qui fait apparaitre
  // les champs dependants — ne s'executait jamais. Le panneau semblait ignorer le reglage.
  const env = neuf();
  const host = env.document.createElement('div');
  env.document.body.appendChild(host);
  const descr = { id: 'p', sections: [{ id: 's', fields: [
    { ids: ['f-sky'], label: 'Type', type: 'choice',
      options: [['color', 'Couleur'], ['image', 'Panorama']],
      get: (t) => t.sky,
      set: (t, v) => { t.sky = v; throw new Error('le rendu a echoue'); } },
    { ids: ['f-img'], label: 'Image', type: 'choice', options: [['a1', 'HDRI']],
      visible: (t) => t.sky === 'image', get: (t) => t.img, set: (t, v) => { t.img = v; } }
  ]}]};
  const form = env.createForm(host, descr);
  const t = { sky: 'color', img: 'a1' };
  form.setTargets([t]);

  const el = env.document.getElementById('f-sky');
  el.focus();
  el.value = 'image';
  el.dispatchEvent({ type: 'input' });
  el.dispatchEvent({ type: 'change' });

  assert.equal(t.sky, 'image', 'la valeur est ecrite avant que l accesseur ne leve');
  assert.ok(env.document.getElementById('f-img'),
    'le champ dependant apparait quand meme : le formulaire n est pas fige');
});

test('reconstruire depuis une case a cocher ou un select ne LEVE pas', () => {
  // POURQUOI CE TEST EXISTE. `rebuild()` lisait et reecrivait `selectionStart` sur le champ
  // qui a le focus, quel que soit son type. Chrome leve `InvalidStateError` des que ce n'est
  // pas un champ texte (case a cocher, select, number, color) : la reconstruction n'avait
  // alors JAMAIS lieu. Basculer le type de ciel en « Panorama » laissait donc les champs du
  // degrade a l'ecran, sans que rien ne le dise a part une erreur dans la console.
  const env = neuf();
  const host = env.document.createElement('div');
  env.document.body.appendChild(host);
  const descr = { id: 'p', sections: [{ id: 's', fields: [
    { ids: ['f-on'], label: 'Actif', type: 'checkbox', get: (t) => t.on, set: (t, v) => { t.on = v; } },
    { ids: ['f-detail'], label: 'Detail', type: 'text', visible: (t) => t.on,
      get: (t) => t.detail, set: (t, v) => { t.detail = v; } }
  ]}]};
  const form = env.createForm(host, descr);
  const t = { on: false, detail: 'x' };
  form.setTargets([t]);

  const el = env.document.getElementById('f-on');
  el.focus();
  // le piege : lire OU ecrire selectionStart sur une case leve dans un vrai navigateur
  Object.defineProperty(el, 'selectionStart', {
    get(){ throw new Error("InvalidStateError: does not support selection"); },
    set(){ throw new Error("InvalidStateError: does not support selection"); },
    configurable: true });
  Object.defineProperty(el, 'selectionEnd', {
    set(){ throw new Error("InvalidStateError: does not support selection"); },
    configurable: true });
  el.checked = true;
  el.dispatchEvent({ type: 'input' });
  el.dispatchEvent({ type: 'change' });

  assert.equal(t.on, true);
  assert.ok(env.document.getElementById('f-detail'),
    'le champ dependant apparait : la reconstruction n a pas ete coupee par une exception');
});

// UN CHAMP `info` NE PEUT CHANGER QUE PAR UNE SYNCHRONISATION — c'est sa seule raison d'être.
//
// TROUVÉ EN BRANCHANT UN OUTIL EXTERNE (exemples/plugin-evaveo-studio.js). Son panneau affiche
// l'avancement d'un export dans un champ `info`, et invite en toutes lettres à « suivre
// l'avancement dans le champ État ci-dessus ». Mesuré : le champ restait figé sur « Export
// demandé au Studio… » pour toujours, pendant que la barre d'état de l'éditeur, elle, affichait
// « Connecté — 1 fichier(s) exporté(s) ». Deux affichages de la même valeur, l'un juste, l'autre
// mort — et aucune erreur nulle part.
//
// LA CAUSE. La règle 2 de `sync()` protège une SAISIE en cours qu'on ne sait pas relire
// (« 1.2e », « - ») : `read()` rend `undefined` et le champ n'est pas vide, donc on n'écrase
// pas. Or le `read` d'un champ `info` rend `undefined` PAR DÉFINITION (« rien à relire »), et
// son élément est un `<span>`, dont `.value` vaut `undefined` — `String(undefined)` donne
// « undefined », qui n'est jamais vide. La garde se déclenchait donc à CHAQUE synchronisation,
// sur TOUS les champs info du produit, y compris ceux des panneaux natifs.
test('sync rafraichit un champ info — il ne se saisit pas, donc rien ne le protege', () => {
  const env = neuf();
  const host = env.document.createElement('div');
  env.document.body.appendChild(host);
  const form = env.createForm(host, { id: 'p', sections: [{ id: 's', fields: [
    { label: 'État', type: 'info', get: (t) => t.etat }
  ]}]});
  const cible = { etat: 'Export demandé…' };
  form.setTargets([cible]);
  const el = env.document.getElementById('f-s-0');
  assert.equal(el.textContent, 'Export demandé…');

  cible.etat = 'Connecté — 1 fichier(s) exporté(s)';
  form.sync();
  assert.equal(el.textContent, 'Connecté — 1 fichier(s) exporté(s)',
    'un champ info gele apres sa construction : c est le defaut du plugin Studio');
  assert.equal(env.document.getElementById('f-s-0'), el, 'sync ne reconstruit pas pour autant');
});

// La règle 2 doit continuer de mordre là où elle sert : un champ qu'on SAISIT.
test('sync laisse toujours intacte une saisie illisible dans un champ editable', () => {
  const env = neuf();
  const host = env.document.createElement('div');
  env.document.body.appendChild(host);
  const form = env.createForm(host, { id: 'p', sections: [{ id: 's', fields: [
    { key: 'x', label: 'X', type: 'number' }
  ]}]});
  const cible = { x: 3 };
  form.setTargets([cible]);
  const el = env.document.getElementById('f-x');

  el.value = '1.2e';              // en cours de frappe : illisible, mais pas vide
  cible.x = 9;
  form.sync();
  assert.equal(el.value, '1.2e', 'la frappe en cours a ete ecrasee — la regle 2 ne mord plus');
});
