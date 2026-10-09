// L'IMPORT DES CLÉS NUES N'EN SUPPRIME AUCUNE.
//
// La clé API du copilote est lue DIRECTEMENT dans localStorage à six endroits (copilot.js), et
// deux onglets de l'éditeur partagent le même stockage sans se parler. Supprimer après import,
// c'est effacer la clé sous le nez de l'onglet d'à côté — et sous celui d'une version
// antérieure rouverte ensuite. La suppression est une décision d'une version ultérieure,
// annoncée dans un ChangeLog.
//
// `importBareKeys` est une fonction PURE : elle reçoit un dictionnaire, elle ne touche pas
// localStorage. C'est ce qui la rend testable — et c'est aussi ce qui l'empêche de supprimer
// quoi que ce soit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/ui/registry.js', 'js/ui/prefs.js']);
const { importBareKeys, PREFS_DEFAULT, Prefs } = env;

test('les cles nues connues sont reprises', () => {
  const p = importBareKeys({
    'copilot-key': 'sk-xxx', 'copilot-modele': 'claude-opus-5',
    'moteur3d-plugins': '["a.js"]', 'moteur3d-nommage': '{"suffixes":{}}',
    'window:animator': '{"x":10}'
  });
  assert.equal(p['copilot.key'], 'sk-xxx');
  assert.equal(p['copilot.model'], 'claude-opus-5');
  assert.deepEqual(Array.from(p['plugins.actifs']), ['a.js']);
  assert.deepEqual({ ...p['textures.naming'] }, { suffixes: {} });
});

test('une cle absente prend sa valeur par defaut', () => {
  const p = importBareKeys({});
  Object.keys(PREFS_DEFAULT).forEach((k) => assert.notEqual(p[k], undefined,
    'defaut manquant : ' + k));
});

test('une cle illisible ne fait pas echouer tout l import', () => {
  const p = importBareKeys({ 'moteur3d-plugins': '{{{ pas du json', 'copilot-key': 'sk' });
  assert.equal(p['copilot.key'], 'sk');
  assert.deepEqual(Array.from(p['plugins.actifs']), []);
});

test('l espace de noms jeu3d: est IGNORE', () => {
  const p = importBareKeys({ 'jeu3d:partie1': '{"or":10}' });
  assert.equal(Object.keys(p).some((k) => k.indexOf('jeu3d') !== -1), false,
    'ce sont les SAUVEGARDES des joueurs (scripts.js), pas des preferences');
});

test('la geometrie des fenetres flottantes reste NUE', () => {
  const p = importBareKeys({ 'window:animator': '{"x":10}' });
  assert.equal(Object.keys(p).some((k) => k.indexOf('window:') !== -1), false,
    'une cle creee a la volee par fenetre ne peut pas entrer dans un registre declare');
});

test('les projets recents ne sont pas des preferences', () => {
  // recents.js les garde en IndexedDB : ce sont des FileSystemDirectoryHandle, non
  // serialisables en JSON. Prefs n'accepte que des valeurs JSON.
  const p = importBareKeys({ 'recents': 'peu importe' });
  assert.equal(p['recents'], undefined);
});

test('importBareKeys ne SUPPRIME rien — elle ne recoit meme pas de quoi le faire', () => {
  const source = { 'copilot-key': 'sk-xxx' };
  importBareKeys(source);
  assert.equal(source['copilot-key'], 'sk-xxx');
});

test('la cle unique gagne sur la cle nue : elle est plus recente par construction', () => {
  const p = importBareKeys({
    'copilot-key': 'sk-vieille',
    'moteur3d-preferences': JSON.stringify({ 'copilot.key': 'sk-neuve' })
  });
  assert.equal(p['copilot.key'], 'sk-neuve');
});

test('une preference non declaree n existe pas', () => {
  assert.equal(Prefs.get('rien.du.tout'), undefined);
});

test('un plugin declare sa preference, et elle a un defaut', () => {
  Prefs.define({ key: 'monplugin.couleur', label: 'Couleur', type: 'color',
                 category: 'Extensions', default: '#ff0000' });
  assert.equal(Prefs.get('monplugin.couleur'), '#ff0000');
  Prefs.set('monplugin.couleur', '#00ff00');
  assert.equal(Prefs.get('monplugin.couleur'), '#00ff00');
});

test('byCategory range les preferences par ecran', () => {
  const apparence = Prefs.byCategory('Apparence').map((d) => d.key);
  assert.ok(apparence.indexOf('ui.theme') !== -1);
  assert.ok(apparence.indexOf('ui.density') !== -1);
  assert.equal(apparence.indexOf('nav.speed'), -1);
});

test('les cles nues sont TOUJOURS ECRITES en plus de la cle unique', () => {
  // C'est la contrepartie de la non-suppression : copilot.js lit encore la clé nue.
  Prefs.set('copilot.key', 'sk-ecrite');
  assert.equal(env.localStorage.getItem('copilot-key'), 'sk-ecrite');
  assert.ok(env.localStorage.getItem('moteur3d-preferences'));
});

// ---------- L'EFFET d'une préférence ----------
//
// Une préférence qui ne s'applique qu'au prochain démarrage donne l'impression de n'avoir rien
// fait, et on la règle deux fois. Celles qui changent quelque chose portent leur `apply`.

test('la densite est un attribut sur html, pose des qu on la change', () => {
  const e = creerContexte(['js/ui/registry.js', 'js/ui/prefs.js']);
  e.Prefs.applyAll();
  assert.equal(e.document.documentElement.getAttribute('data-density'), 'normale');
  e.Prefs.set('ui.density', 'compacte');
  assert.equal(e.document.documentElement.getAttribute('data-density'), 'compacte');
});

test('le theme pose son attribut — un seul theme existe, et la liste le DIT', () => {
  const e = creerContexte(['js/ui/registry.js', 'js/ui/prefs.js']);
  e.Prefs.applyAll();
  assert.equal(e.document.documentElement.getAttribute('data-theme'), 'sombre');
  const options = e.Prefs.all().find((d) => d.key === 'ui.theme').options;
  assert.equal(options.length, 1,
    'proposer un theme clair sans palette claire, c est un reglage qui ne fait rien');
});

test('une preference SANS effet ne fait rien de special — et c est normal', () => {
  // La clé API du copilote est LUE au moment de s'en servir : elle n'a rien à appliquer.
  const e = creerContexte(['js/ui/registry.js', 'js/ui/prefs.js']);
  e.Prefs.set('copilot.key', 'sk-x');
  assert.equal(e.Prefs.get('copilot.key'), 'sk-x');
});

test('tokens.css repond aux trois densites', async () => {
  const fs = await import('node:fs');
  const css = fs.readFileSync(new URL('../css/tokens.css', import.meta.url), 'utf8');
  ['compacte', 'confortable'].forEach(function(d){
    assert.ok(css.indexOf('data-density="' + d + '"') !== -1, 'densite sans style : ' + d);
  });
  // « normale » n'a pas de bloc : c'est le :root lui-même. Un bloc qui redit les mêmes valeurs
  // serait une seconde source pour la même chose.
  assert.equal(css.indexOf('data-density="normale"'), -1);
});
