import { deEsm } from './engine-env.mjs';
// L'HISTORIQUE DES ASSETS : ce que l'instantané retient, et ce qu'il laisse dehors.
//
// La création d'un asset était le seul geste vraiment définitif de l'éditeur. Un objet supprimé se
// récupérait par Ctrl+Z depuis toujours ; une texture créée par erreur, non — et pire, le Ctrl+Z
// semblait ne RIEN faire, puisqu'il restaurait une scène identique. On appuyait une seconde fois,
// et on perdait l'action d'avant.
//
// LE TEST QUI PORTE LE FICHIER est celui de la frontière, et elle a bougé deux fois. Aujourd'hui :
// la liste ET les champs éditables sont photographiés — créer, supprimer, renommer, régler l'import
// s'annulent — et le CODE d'un script reste dehors.
//
// Cette dernière exclusion n'est pas un oubli, c'est la condition de sûreté. `js/code-editor.js`
// n'empile AUCUN pas d'historique : photographier `code` ferait undo du code TAPÉ que rien n'a
// enregistré. Un historique qui détruit du travail au lieu d'en défaire est pire qu'un historique
// absent — et c'est pourquoi chaque champ ne devient photographiable qu'APRÈS que son site
// d'édition ait appris à empiler.
//
// Ces tests exercent `stateCurrent`, `restoreAssets` et `restoreFieldsAssets` POUR DE VRAI dans
// un bac : les bouchons ne remplacent que ce qui touche au DOM et à three.js, jamais la logique
// mesurée. Les moulinettes de réapplication sont bouchonnées par des MOUCHARDS, pas par du vide :
// vérifier qu'une restauration change l'image demande de savoir qui y est repassé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
// RAPATRIEMENT DANS LE ROYAUME DE L'HÔTE : un tableau né dans un contexte vm porte le prototype de
// CE contexte, et `deepEqual(objetVm, {...})` échoue alors même que les deux sont identiques.
const hote = (x) => JSON.parse(JSON.stringify(x));

/**
 * js/history.js dans un bac.
 *
 * On n'exécute PAS `restoreState` (il démonte une vraie scène three.js) : on mesure `stateCurrent`
 * et `restoreAssets`, qui portent toute la logique neuve. Le reste est bouchonné à l'identique
 * de ce que le moteur fournit.
 */
function contexte(){
  const urlsCreees = [];
  const urlsRevoquees = [];
  const bac = {
    console, Math, JSON, Object, Array, Set, Map, String, Number, RegExp, Error,
    assets: [],
    objects: [],
    Registry: {activeNodes(){ return []; }},
    anim: {tracks: [], duration: 5, loop: true, t: 0},
    env: {sky: 'uni'},
    selection: null,
    selectionMulti: [],
    assetSelected: null,
    phys: {active: false},
    autosave: {modifie: false},
    serializeObject: (o) => ({id: o.id}),
    URL: {
      createObjectURL(f){ const u = 'blob:neuf-' + urlsCreees.length; urlsCreees.push(f); return u; },
      revokeObjectURL(u){ urlsRevoquees.push(u); }
    },
    // Les rafraîchissements d'interface : on note qu'ils ont eu lieu, et dans quel ordre.
    appels: [],
    updateProject(){ bac.appels.push('updateProject'); },
    refreshInspectorAsset(){ bac.appels.push('refreshInspectorAsset'); },
    selectAsset(a){ bac.appels.push('selectAsset'); bac.assetSelected = a; },
    // Les moulinettes de réapplication : on note QUEL asset y est repassé. C'est le seul medium de
    // vérifier qu'une restauration change l'image et pas seulement la donnée — et qu'elle ne
    // repasse pas sur tout le project à chaque annulation.
    reappliques: [],
    ensureParamsImport(a){ if(!a.paramsImport) a.paramsImport = {}; return a.paramsImport; },
    applyImportTexture(a){ bac.reappliques.push(a.id); },
    applyImportModel(a){ bac.reappliques.push(a.id); },
    applyImportAudio(a){ bac.reappliques.push(a.id); },
    applyMaterialEverywhere(a){ bac.reappliques.push(a.id); },
    refreshSpritesOfLAsset(a){ bac.reappliques.push(a.id); }
  };
  bac.window = bac; bac.globalThis = bac;
  bac.urlsCreees = urlsCreees; bac.urlsRevoquees = urlsRevoquees;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('js/history.js')), ctx, {filename: 'js/history.js'});
  vm.runInContext('this.histo = histo;', ctx);
  return bac;
}

const asset = (id, kind, extra) => Object.assign({id: id, kind: kind, name: id}, extra || {});


test('L INSTANTANE retient la LISTE et les CHAMPS, jamais les poignees vivantes', () => {
  const c = contexte();
  const file = {size: 10};
  const texture = {isTexture: true, dispose(){}};
  const tex = asset('a1', 'texture', {
    name: 'ground', preview: 'blob:origine', file: file, texture: texture,
    paramsImport: {filtrage: 'lineaire', mipmaps: true, tuilage: [1, 1]},
    _decL: 16                                     // brouillon de l'inspecteur
  });
  c.assets.push(tex);

  const avant = c.stateCurrent();
  assert.ok(Array.isArray(avant.assets), 'l\'instantané ne porte pas de liste d\'assets');
  assert.equal(avant.assets[0], tex, 'la LISTE garde la RÉFÉRENCE de l\'asset');

  // Le tableau, lui, doit être une copie : sinon l'instantané suivrait les ajouts et ne
  // photographierait rien du tout.
  assert.notEqual(avant.assets, c.assets, 'l\'instantané doit copier le TABLEAU');
  c.assets.push(asset('a2', 'audio'));
  assert.equal(avant.assets.length, 1, 'l\'instantané a suivi un ajout postérieur : il ne fige rien');

  // LES CHAMPS SONT COPIÉS EN PROFONDEUR : c'est ce qui fait qu'un renommage postérieur ne
  // réécrit pas l'instantané qu'on vient de prendre.
  const photo = avant.fieldsAssets.find((p) => p.id === 'a1');
  assert.ok(photo, 'aucune photo des champs pour cet asset');
  assert.equal(photo.fields.name, 'ground');
  tex.name = 'sol renommé';
  tex.paramsImport.filtrage = 'near';
  assert.equal(photo.fields.name, 'ground', 'la photo a suivi un renommage postérieur : elle ne fige rien');
  assert.equal(photo.fields.paramsImport.filtrage, 'lineaire',
    'la photo partage l\'object paramsImport au lieu de le copier');

  // ET LES POIGNÉES VIVANTES RESTENT DEHORS. Un fichier, une THREE.Texture, un AudioBuffer ne se
  // clonent pas — et n'ont pas à l'être : ils ne changent pas quand on renomme.
  ['file', 'texture', 'preview', 'id', 'kind'].forEach((k) => {
    assert.equal(photo.fields[k], undefined,
      `« ${k} » ne doit pas entrer dans la photo (poignée vivante, URL transitoire ou identité)`);
  });
  assert.equal(photo.fields._decL, undefined,
    'les champs préfixés d\'un « _ » sont le brouillon de l\'inspecteur : les restaurer ferait '
    + 'sauter les champs d\'un panneau open pendant qu\'on y tape');

  // LE TRI PAR TYPE, exercé sur un champ que PERSONNE n'a nommé. C'est le second filet : il
  // attrape la poignée qu'on ajoutera demain sans penser à cette liste. Écrit avec une vraie
  // classe, parce qu'un objet simple passerait — et c'est justement ce qui a fait échouer la
  // première version de ce test, sur un `file: {}` que le moteur n'a jamais produit.
  class PoigneeQuelconque { constructor(){ this.size = 1; } }
  c.assets[0].nouvelleMachine = new PoigneeQuelconque();
  c.assets[0].donneesSimples = {a: 1, b: [2, 3]};
  const photo2 = c.stateCurrent().fieldsAssets.find((p) => p.id === 'a1').fields;
  assert.equal(photo2.nouvelleMachine, undefined,
    'un objet portant son propre prototype est une poignée vivante : il ne doit pas être cloné');
  assert.deepEqual(hote(photo2.donneesSimples), {a: 1, b: [2, 3]},
    'un objet SIMPLE, lui, est de la donnée : il doit entrer dans la photo sans être nommé');
});

test('LE CODE D UN SCRIPT est photographie — et chaque session d edit pose son pas', () => {
  // CE TEST DISAIT L'INVERSE, ET C'ÉTAIT JUSTE À L'ÉPOQUE. Tant que la fenêtre d'édition n'empilait
  // aucun pas, capturer `code` aurait fait undo du code TAPÉ que rien n'avait enregistré.
  //
  // Le défaut était en fait déjà là pour les scripts d'OBJET : leur code vit dans
  // `userData.scripts`, que `serializeObject` photographie depuis toujours. Un Ctrl+Z venu d'un
  // geste antérieur rendait donc l'ancien code — mesuré dans le navigateur, « C1 du code TAPÉ »
  // redevenait « C0 » en deux Ctrl+Z. Ce n'est donc pas une extension, c'est une réparation.
  const c = contexte();
  c.assets.push(asset('a1', 'script', {name: 'Deplacement', code: 'function update(api){}'}));
  const photo = c.stateCurrent().fieldsAssets[0].fields;
  assert.equal(photo.name, 'Deplacement', 'le NOM d\'un script doit être photographié');
  assert.equal(photo.code, 'function update(api){}',
    'le code n\'est plus photographié : une session d\'édition redevient irréversible');

  c.assets[0].code = 'du code tapé depuis';
  c.restoreFieldsAssets([{id: 'a1', fields: {name: 'Deplacement', code: 'l old code'}}]);
  assert.equal(c.assets[0].code, 'l old code', 'la restauration ne remet pas le code');

  // LA CONDITION DE SURETE, mesuree la ou elle se decide. IL N'Y A PLUS QU'UN SEUL CHEMIN
  // D'EDITION : le composant Script reference son asset au lieu d'en copier le code, donc
  // `openEditorScript` (le script d'un objet) ne fait plus que router vers l'editeur d'asset.
  // C'est ce routage qu'on mesure ici — s'il se remettait a ecrire un code a lui, la copie
  // reviendrait, et avec elle les deux sources de verite qu'on vient de supprimer.
  const src = read('js/scripts.js').replace(/\r\n/g, '\n');
  const iRoute = src.indexOf('function openEditorScript(');
  assert.notEqual(iRoute, -1, 'openEditorScript a disparu');
  const bodyRoute = src.slice(iRoute, src.indexOf('\n}', iRoute));
  assert.ok(bodyRoute.includes('openEditorScriptAsset('),
    "openEditorScript n'ouvre plus l'editeur de l'ASSET : le script d'un objet redeviendrait "
    + "editable a part, donc divergent de l'asset dont il vient");
  assert.ok(!/\.code\s*=/.test(bodyRoute),
    "openEditorScript ecrit un `code` : le composant ne doit RIEN porter du code, seulement sa "
    + "reference — c'est exactement la copie qu'on a retiree");

  [['openEditorScriptAsset', 'un asset script']].forEach(([fn, quoi]) => {
    const i = src.indexOf('function ' + fn + '(');
    assert.notEqual(i, -1, fn + ' a disparu');
    const body = src.slice(i, src.indexOf('\n}', i));
    assert.ok(body.includes('pushHistory()'),
      `l'éditeur de ${quoi} n'empile plus de pas : le code est pourtant photographié, donc un `
      + 'Ctrl+Z venu de la scène rendrait un code que rien n\'a enregistré');
    // UN pas par SESSION, pas un par salve : la frappe est enregistrée en continu (debounce de
    // 300 ms), et un instantané par salve noierait la pile — la scène en serait chassée.
    assert.ok(/premiereUpdate/.test(body),
      `l'éditeur de ${quoi} empile sans garde de session : une frappe continue poserait un pas `
      + 'toutes les 300 ms');
    // Et la comparaison AVANT l'écriture : un rappel qui renvoie le code inchangé ne doit rien
    // empiler, sinon le premier Ctrl+Z n'a l'air de rien faire.
    assert.ok(/data\.code !== (s|a)\.code/.test(body),
      `l'éditeur de ${quoi} empile sans vérifier que le code a changé`);
  });
});

test('RENOMMER puis ANNULER rend le nom d avant', () => {
  const c = contexte();
  c.assets.push(asset('a1', 'texture', {name: 'ground', preview: 'blob:x', file: {},
                                        paramsImport: {filtrage: 'lineaire'}}));
  const avant = c.stateCurrent();

  c.assets[0].name = 'sol de pierre';
  c.restoreFieldsAssets(avant.fieldsAssets);
  assert.equal(c.assets[0].name, 'ground', 'le renommage n\'a pas été annulé');
});

test('LES PARAMS D IMPORT restaures sont REAPPLIQUES, pas seulement reecrits', () => {
  // Le fond du travail. Remettre `filtrage: proche` sans repasser par applyImportTexture
  // changerait la donnée sans changer l'image : la THREE.Texture resterait configurée comme avant,
  // et l'annulation aurait l'air d'avoir échoué alors qu'elle a réussi à moitié.
  const c = contexte();
  c.assets.push(asset('a1', 'texture', {name: 'ground', preview: 'blob:x', file: {},
                                        paramsImport: {filtrage: 'near', mipmaps: false}}));
  const avant = c.stateCurrent();

  c.assets[0].paramsImport.filtrage = 'lineaire';
  c.assets[0].paramsImport.mipmaps = true;
  c.restoreFieldsAssets(avant.fieldsAssets);

  assert.equal(c.assets[0].paramsImport.filtrage, 'near', 'le filtrage n\'a pas été restauré');
  assert.equal(c.assets[0].paramsImport.mipmaps, false);
  assert.deepEqual(c.reappliques, ['a1'],
    'la texture n\'a pas été reconfigurée : la donnée est juste et l\'image reste fausse');
});

test('ON NE REAPPLIQUE QUE CE QUI A BOUGE', () => {
  // Repasser sur tout le project à chaque annulation reconfigurerait chaque texture et chaque
  // matériau de la scène pour rien, et ça se sent à la main sur un project chargé.
  const c = contexte();
  c.assets.push(asset('a1', 'texture', {name: 'ground', preview: 'blob:x', file: {},
                                        paramsImport: {filtrage: 'near'}}));
  c.assets.push(asset('a2', 'material', {name: 'metal', color: 3355443}));
  const avant = c.stateCurrent();

  c.assets[1].color = 16711680;                 // seul le matériau change
  c.restoreFieldsAssets(avant.fieldsAssets);
  assert.deepEqual(c.reappliques, ['a2'],
    'la texture inchangée a été reconfigurée pour rien');
  assert.equal(c.assets[1].color, 3355443);
});

test('UN ASSET DISPARU DEPUIS la photo ne fait pas lever la restauration', () => {
  // Annuler peut ramener un état où un asset n'existe plus : sa photo n'a alors plus de cible.
  const c = contexte();
  c.assets.push(asset('a1', 'texture', {name: 'ground', preview: 'blob:x', file: {}}));
  assert.doesNotThrow(() => c.restoreFieldsAssets([
    {id: 'a1', fields: {name: 'old'}},
    {id: 'disparu', fields: {name: 'fantome'}}
  ]));
  assert.equal(c.assets[0].name, 'old');
});

test('CREER puis ANNULER retire l asset, et RETABLIR le remet', () => {
  const c = contexte();
  c.assets.push(asset('a1', 'texture', {preview: 'blob:x', file: {}}));
  const avantCreation = c.stateCurrent().assets;

  c.assets.push(asset('a2', 'audio', {name: 'jump'}));
  const apresCreation = c.stateCurrent().assets;

  c.restoreAssets(avantCreation);
  assert.deepEqual(c.assets.map((a) => a.id), ['a1'], 'l\'annulation n\'a pas retiré l\'asset créé');

  c.restoreAssets(apresCreation);
  assert.deepEqual(c.assets.map((a) => a.id), ['a1', 'a2'], 'le rétablissement ne le remet pas');
});

test('SUPPRIMER puis ANNULER ramene un asset UTILISABLE, pas une tile morte', () => {
  const c = contexte();
  const file = {name: 'sol.png'};
  const tex = asset('a1', 'texture', {preview: 'blob:origine', file: file,
                                      texture: {name: 'la texture GPU'}});
  c.assets.push(tex);
  const avant = c.stateCurrent().assets;

  // La suppression réelle révoque l'URL d'aperçu (js/assets.js) : sans refabrication, la tile
  // reviendrait avec une image morte et on conclurait que l'annulation ramène un asset abîmé.
  c.URL.revokeObjectURL(tex.preview);
  c.assets.length = 0;

  c.restoreAssets(avant);
  assert.deepEqual(c.assets.map((a) => a.id), ['a1'], 'l\'asset supprimé n\'est pas revenu');
  assert.notEqual(c.assets[0].preview, 'blob:origine',
    'l\'aperçu pointe encore sur l\'URL révoquée : la tile afficherait une image morte');
  assert.equal(c.urlsCreees.length, 1, 'l\'URL d\'aperçu doit être refabriquée depuis le fichier');
  assert.equal(c.urlsCreees[0], file, 'refabriquée depuis le fichier de l\'asset, pas d\'autre chose');

  // La THREE.Texture n'est PAS refaite : la suppression ne l'a pas libérée, elle est encore en
  // mémoire et déjà sur la map graphique. La recharger ferait clignoter tous les matériaux.
  assert.equal(c.assets[0].texture.name, 'la texture GPU', 'la texture ne doit pas être remplacée');
});

test('UN ASSET DEJA PRESENT ne voit pas son apercu refabrique', () => {
  // Sans ce contrôle, chaque annulation fabriquerait une URL par texture du project : sur un project
  // de cinquante textures et vingt annulations, mille URL vivantes que rien ne libère.
  const c = contexte();
  c.assets.push(asset('a1', 'texture', {preview: 'blob:origine', file: {}}));
  c.assets.push(asset('a2', 'texture', {preview: 'blob:deux', file: {}}));
  const state = c.stateCurrent().assets;

  c.restoreAssets(state);
  assert.equal(c.urlsCreees.length, 0, 'aucune URL ne doit être fabriquée quand rien n\'a disparu');
  assert.equal(c.assets[0].preview, 'blob:origine', 'l\'aperçu d\'un asset présent doit rester');
});

test('L ORDRE des assets est restaure, pas seulement leur presence', () => {
  // Le panneau Projet affiche dans l'ordre du tableau, et `list_assets` le rend au copilote.
  // Restaurer un ensemble sans son ordre ferait « move » les tuiles à chaque annulation.
  const c = contexte();
  ['a1', 'a2', 'a3'].forEach((id) => c.assets.push(asset(id, 'material')));
  const state = c.stateCurrent().assets;
  c.assets.reverse();
  c.restoreAssets(state);
  assert.deepEqual(c.assets.map((a) => a.id), ['a1', 'a2', 'a3']);
});

test('LA SELECTION du panneau est lachee si son asset a disparu', () => {
  // Sinon l'inspecteur continue d'afficher les champs d'un asset hors du project, et les écrire
  // modifie un objet que plus rien ne référence : on croit régler quelque chose, sans effet.
  const c = contexte();
  const a = asset('a1', 'texture', {preview: 'blob:x', file: {}});
  c.assets.push(a);
  c.assetSelected = a;
  const empty = [];

  c.restoreAssets(empty);
  assert.equal(c.assetSelected, null, 'la sélection d\'asset n\'a pas été lâchée');
  assert.ok(c.appels.includes('selectAsset'), 'selectAsset(null) n\'a pas été appelé');
});

test('UN INSTANTANE SANS LISTE — pris par une version anterieure — ne vide pas le project', () => {
  // Les instantanés vivent en mémoire, jamais sur disque : le cas ne peut survenir qu'au
  // rechargement d'une page ouverte pendant une mise à jour. Vider le panneau Projet à la première
  // annulation serait une façon spectaculaire de perdre son travail pour une raison invisible.
  const c = contexte();
  c.assets.push(asset('a1', 'texture', {preview: 'blob:x', file: {}}));
  c.restoreAssets(undefined);
  assert.deepEqual(c.assets.map((a) => a.id), ['a1'], 'un instantané sans assets a vidé le project');
  c.restoreAssets(null);
  assert.deepEqual(c.assets.map((a) => a.id), ['a1']);
});

test('LE CABLAGE : la suppression empile un pas, et les assets sont restaures AVANT l tree', () => {
  const src = read('js/assets.js').replace(/\r\n/g, '\n');
  // ON ANCRE SUR LE RETRAIT LUI-MÊME, PAS SUR LA CONDITION. `contains('del')` apparaît DEUX
  // fois dans ce fichier : d'abord pour la croix d'un DOSSIER. `indexOf` rendait donc le
  // mauvais bloc — un one-liner sans historique — et le test accusait un code correct. Ce
  // dépôt s'est déjà fait prendre trois fois à ce piège dans la même session.
  //
  // Le retrait a été EXTRAIT deux fois plutôt qu'une. `removeAssetInMemory` d'abord, pour que
  // la croix du panneau et la surveillance du dossier de projet (js/project.js, quand un
  // fichier disparaît du disque) partagent le même nettoyage. Puis `removeAsset`, qui y ajoute
  // le pas d'historique et le retrait du fichier disque : la fenêtre des presets d'import
  // supprime elle aussi des assets, et un second chemin de suppression est celui qui oublie le
  // fichier. Les deux ancres sont donc vérifiées : la croix passe bien par `removeAsset`, et
  // `removeAsset` empile son pas AVANT de retirer quoi que ce soit.
  const iSplice = src.indexOf('assets.splice(i, 1)');
  assert.notEqual(iSplice, -1, 'le retrait d\'un asset a changé de forme');
  assert.notEqual(src.lastIndexOf('function removeAssetInMemory', iSplice), -1,
    'le retrait ne vit plus dans removeAssetInMemory');

  const iFn = src.indexOf('function removeAsset(a)');
  assert.notEqual(iFn, -1, 'la suppression complète ne vit plus dans removeAsset');
  const block = src.slice(iFn, src.indexOf('projectBody.addEventListener', iFn));
  assert.ok(block.includes('removeAssetInMemory(a)'),
    'removeAsset n\'appelle plus removeAssetInMemory');
  assert.ok(block.includes('pushHistory()'),
    'la suppression d\'un asset n\'empile plus de pas : elle redevient définitive');
  assert.ok(block.indexOf('pushHistory()') < block.indexOf('removeAssetInMemory(a)'),
    'le pas est empilé APRÈS le retrait : il photographierait un projet déjà amputé');
  assert.ok(block.includes('removeFilesAssetOnDisk'),
    'removeAsset ne retire plus le fichier du disque : l\'asset reviendrait au '
    + 'prochain rafraîchissement du dossier');

  // Et la croix du panneau passe bien par elle, plutôt que de refaire la séquence à sa façon.
  const iCroix = src.indexOf('removeAsset(a)',
    src.indexOf("projectBody.addEventListener('click'", iFn));
  assert.notEqual(iCroix, -1, 'la croix du panneau n\'appelle plus removeAsset');
  const debutBloc = src.lastIndexOf("e.target.classList.contains('del')", iCroix);
  assert.notEqual(debutBloc, -1, 'le bouton de suppression d\'asset a changé de forme');

  const hist = read('js/history.js').replace(/\r\n/g, '\n');
  const iRestaure = hist.indexOf('restoreAssets(state.assets)');
  const iArbre = hist.indexOf('rebuildTree(state.objects');
  assert.notEqual(iRestaure, -1, 'restaurerEtat n\'appelle plus restoreAssets');
  assert.notEqual(iArbre, -1, 'restaurerEtat ne reconstruit plus l\'tree');
  assert.ok(iRestaure < iArbre,
    'les assets sont restaurés APRÈS l\'tree : un objet dont l\'asset vient de revenir '
    + 'retomberait sur le matériau par défaut');

  // ET LES CHAMPS SONT BIEN REMIS PAR restoreState. Les tests plus haut appellent
  // `restoreFieldsAssets` DIRECTEMENT : ils prouvent que la fonction est juste, jamais qu'elle
  // est branchée. Retirer son appel les laissait tous verts pendant que le renommage redevenait
  // irréversible — la mutation a survécu, et c'est la seule façon de s'en apercevoir.
  const iChamps = hist.indexOf('restoreFieldsAssets(state.fieldsAssets)');
  assert.notEqual(iChamps, -1,
    'restaurerEtat n\'appelle plus restoreFieldsAssets : le renommage et les paramètres '
    + 'd\'import redeviennent irréversibles, sans qu\'aucun autre test ne le voie');
  assert.ok(iRestaure < iChamps,
    'les champs sont réécrits AVANT que la liste soit remise : un asset qui revient ne serait pas '
    + 'encore dans le tableau, et la réapplication n\'y trouverait pas ses utilisations');
  assert.ok(iChamps < iArbre,
    'les champs sont remis APRÈS l\'tree, qui a donc été reconstruit sur les anciennes values');
});
