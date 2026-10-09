// LE DOCK ADOPTE, IL NE RECONSTRUIT JAMAIS.
//
// Déplacer un <canvas> dans le DOM conserve son contexte WebGL ; le recréer perdrait contexte,
// textures et buffers. Même chose, moins spectaculaire mais aussi cassante, pour les écouteurs
// posés au chargement sur #hier-body, #project-body et #insp-body par une douzaine de fichiers.
// Ce test mesure l'identité des éléments — pas leur apparence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';
import fs from 'node:fs';

function neuf(){
  const env = creerContexte(['js/ui/registry.js', 'js/ui/form-plan.js', 'js/ui/fields.js',
                             'js/ui/form.js', 'js/ui/panel.js', 'js/ui/dock-tree.js',
                             'js/dev-guards.js', 'js/ui/dock.js', 'js/history.js']);
  const doc = env.document;
  const app = doc.createElement('div'); app.id = 'app';
  doc.body.appendChild(app);
  const dock = doc.createElement('div'); dock.id = 'dock';
  app.appendChild(dock);
  // Les quatre hôtes déjà présents dans la page, comme dans editor.html.
  ['hier', 'view', 'insp', 'project'].forEach((id) => {
    const el = doc.createElement('div'); el.id = id;
    app.appendChild(el);
  });
  return env;
}

function declare(env){
  env.Panels.register({ id: 'hierarchy', title: 'Hiérarchie', adopt: 'hier', defaultZone: 'left' });
  env.Panels.register({ id: 'viewport', title: 'Vue', adopt: 'view', defaultZone: 'center', closable: false });
  env.Panels.register({ id: 'inspector', title: 'Inspecteur', adopt: 'insp', defaultZone: 'right' });
  env.Panels.register({ id: 'project', title: 'Projet', adopt: 'project', defaultZone: 'bottom' });
}

test('le dock adopte les elements existants, sans les recreer', () => {
  const env = neuf();
  declare(env);
  const avant = env.document.getElementById('view');
  env.Dock.mount(env.document.getElementById('dock'), null);
  assert.equal(env.document.getElementById('view'), avant,
    'le MEME element : un canvas recree perdrait son contexte WebGL');
  assert.notEqual(avant.parentNode.id, 'app', 'il a bien change de parent');
});

test('chaque zone porte ses onglets, dans l ordre du layout', () => {
  const env = neuf();
  declare(env);
  env.Panels.register({ id: 'console', title: 'Console', defaultZone: 'bottom' });
  env.Dock.mount(env.document.getElementById('dock'), null);
  assert.deepEqual(Array.from(env.Dock.tabsOf('bottom')), ['project', 'console']);
  assert.equal(env.Dock.activeOf('bottom'), 'project');
});

test('activer un onglet cache l autre et le DIT au panneau', () => {
  const env = neuf();
  declare(env);
  env.Panels.register({ id: 'console', title: 'Console', defaultZone: 'bottom' });
  env.Dock.mount(env.document.getElementById('dock'), null);
  env.Dock.activate('bottom', 'console');
  assert.equal(env.Dock.activeOf('bottom'), 'console');
  assert.equal(env.Panels.visible('console'), true);
  assert.equal(env.Panels.visible('project'), false,
    'un panneau cache ne doit pas etre synchronise soixante fois par seconde');
});

test('un panneau non closable n a pas de croix de fermeture', () => {
  const env = neuf();
  declare(env);
  env.Dock.mount(env.document.getElementById('dock'), null);
  assert.equal(env.Dock.closable('viewport'), false);
  assert.equal(env.Dock.closable('inspector'), true);
});

test('fermer un panneau le retire du layout, le rouvrir le remet', () => {
  const env = neuf();
  declare(env);
  env.Dock.mount(env.document.getElementById('dock'), null);
  env.Dock.close('inspector');
  assert.equal(env.Dock.open('inspector'), false);
  env.Dock.reopen('inspector');
  assert.equal(env.Dock.open('inspector'), true);
});

test('la vue 3D ne se ferme pas, meme si on le demande', () => {
  const env = neuf();
  declare(env);
  env.Dock.mount(env.document.getElementById('dock'), null);
  env.Dock.close('viewport');
  assert.equal(env.Dock.open('viewport'), true);
});

test('le layout se relit tel qu il a ete enregistre', () => {
  const env = neuf();
  declare(env);
  env.Dock.mount(env.document.getElementById('dock'), null);
  env.Dock.activate('bottom', 'project');
  const enregistre = env.Dock.serialize();
  const env2 = neuf();
  declare(env2);
  env2.Dock.mount(env2.document.getElementById('dock'), enregistre);
  assert.equal(env2.Dock.serialize(), enregistre);
});

test('un layout illisible ouvre l editeur quand meme, et le journalise', () => {
  const env = neuf();
  declare(env);
  const messages = [];
  env.logConsole = (level, msg) => { messages.push(String(msg === undefined ? level : msg)); };
  env.Dock.mount(env.document.getElementById('dock'), '{{{ pas du json');
  assert.equal(env.Dock.activeOf('center'), 'viewport', 'la vue 3D doit etre la');
  assert.ok(messages.some((m) => m.toLowerCase().indexOf('disposition') !== -1),
    'un retour au defaut silencieux fait chercher ce qu on a perdu');
});

test('un panneau ADOPTE garde son contenu — personne ne le vide', () => {
  // POURQUOI CE TEST EXISTE. `Panels.boot` fabriquait un formulaire dans TOUT hôte, y compris
  // celui d'un panneau qui ne fait qu'adopter un élément. `createForm` commence par
  // `host.innerHTML = ''` : le contenu de #view — le canvas, le gizmo de vue, le cadre du mode
  // Lecture — était effacé au démarrage, et `loop()` levait une TypeError à chaque image sur
  // `#view-game-frame` disparu. Aucun test ne le voyait : ils montaient tous des hôtes vides.
  const env = neuf();
  declare(env);
  const view = env.document.getElementById('view');
  const dedans = env.document.createElement('div');
  dedans.id = 'view-game-frame';
  view.appendChild(dedans);

  env.Dock.mount(env.document.getElementById('dock'), null);

  assert.equal(env.document.getElementById('view-game-frame'), dedans,
    'le contenu d un panneau adopte doit survivre au montage du dock');
  assert.equal(dedans.parentNode, view);
});

test('reconstruire le dock ne DETRUIT pas les elements adoptes', () => {
  // `host.innerHTML = ''` ne vide pas une boite : il detruit ce qu elle contient. Fermer un
  // panneau, en rouvrir un ou reinitialiser la disposition reconstruit les zones — et ferait
  // disparaitre le canvas de la page, sans aucun moyen de le rendre.
  const env = neuf();
  declare(env);
  const view = env.document.getElementById('view');
  env.Dock.mount(env.document.getElementById('dock'), null);
  env.Dock.close('inspector');
  env.Dock.reopen('inspector');
  env.Dock.reset();
  assert.equal(env.document.getElementById('view'), view,
    'le MEME element de vue, apres trois reconstructions');
  assert.ok(view.parentNode, 'et il est toujours quelque part dans le document');
});


test('la barre d une zone porte TOUS ses onglets, puis les barres d outils', () => {
  // POURQUOI CE TEST EXISTE. La barre d outils etait posee au fil de la boucle des onglets :
  // celle du panneau Projet s intercalait donc AVANT l onglet Console et, comme elle est alignee
  // a droite, poussait cet onglet a l autre bout de la barre. On lisait « Projet [outils] ...
  // Console » au lieu de « Projet Console [outils] ».
  const env = neuf();
  declare(env);
  const doc = env.document;
  const outils = doc.createElement('span'); outils.id = 'tools-project';
  doc.body.appendChild(outils);
  env.Panels.forget && env.Panels.forget('project');
  env.Panels.register({ id: 'project', title: 'Projet', adopt: 'project',
    toolbar: 'tools-project', defaultZone: 'bottom' });
  env.Panels.register({ id: 'console', title: 'Console', defaultZone: 'bottom' });
  env.Dock.mount(doc.getElementById('dock'), null);

  const barre = env.Dock.tabElement('project').parentNode;
  const enfants = Array.prototype.slice.call(barre.children);
  const iProjet = enfants.indexOf(env.Dock.tabElement('project'));
  const iConsole = enfants.indexOf(env.Dock.tabElement('console'));
  const iOutils = enfants.indexOf(outils);
  assert.ok(iProjet < iConsole, 'les onglets restent dans l ordre du layout');
  assert.ok(iConsole < iOutils, 'la barre d outils vient APRES tous les onglets');
});

test('detacher un panneau ouvre une fenetre flottante, la refermer le rattache', () => {
  // `windows.js` sait deja adopter un element et le rendre a sa place (il pose une ancre la ou
  // l element vivait). Detacher un panneau, c est appeler ce qui existe — pas ecrire un second
  // systeme de fenetres. Ici on bouchonne windows.js : ce qu on mesure, c est que le dock
  // l appelle avec le BON element, et qu une fermeture rattache le panneau.
  const env = neuf();
  declare(env);
  const ouvertes = {};
  let dernier = null;
  env.openWindow = (id, el, opts) => { ouvertes[id] = true; dernier = { id, el, opts }; return {}; };
  env.windowOpen = (id) => !!ouvertes[id];

  env.Dock.mount(env.document.getElementById('dock'), null);
  const insp = env.document.getElementById('insp');

  env.Dock.detach('inspector', 100, 80);
  assert.equal(env.Dock.floating('inspector'), true);
  assert.equal(dernier.el, insp, 'la fenetre recoit l element EXISTANT, pas une copie');
  assert.equal(env.Dock.tabsOf('right').indexOf('inspector'), -1,
    'il n est plus dans sa zone');

  // La fermeture de la fenetre : windows.js appelle onFermeture.
  delete ouvertes[dernier.id];
  dernier.opts.onFermeture();
  assert.equal(env.Dock.open('inspector'), true, 'refermer la fenetre RATTACHE le panneau');
  assert.equal(env.Dock.floating('inspector'), false);
});

test('un panneau NON actif qui devient flottant redevient VISIBLE pour Panels (bug corrige)', () => {
  // Le bug rapporte : un panneau sorti en fenetre flottante alors qu il n etait PAS l onglet
  // actif de sa zone restait a `Panels.visible() === false` pour toujours — `applyVisible`
  // (le seul point qui appelait `Panels.setVisible`) n est jamais rappele pour un flottant.
  // Consequence mesuree : `Panels.syncAll()` ne remplissait plus jamais son formulaire.
  const env = neuf();
  declare(env);
  env.Panels.register({ id: 'console', title: 'Console', defaultZone: 'bottom' });
  const ouvertes = {};
  env.openWindow = (id) => { ouvertes[id] = true; return {}; };
  env.windowOpen = (id) => !!ouvertes[id];

  env.Dock.mount(env.document.getElementById('dock'), null);
  // 'project' est actif par defaut dans 'bottom' ; 'console' ne l est pas => invisible.
  assert.equal(env.Dock.activeOf('bottom'), 'project');
  assert.equal(env.Panels.visible('console'), false);

  env.Dock.detach('console', 50, 50);

  assert.equal(env.Panels.visible('console'), true,
    'flottant, un panneau doit redevenir visible pour Panels.syncAll(), sinon son formulaire ne se met plus a jour');
});

test('rattacher un flottant a une zone PRECISE ferme la fenetre SANS onFermeture', () => {
  // Le bug rapporté : une fois détaché, un panneau ne pouvait plus revenir QUE via la croix de
  // la fenêtre (sa zone par défaut). `Dock.redock` est le pendant, pour une fenêtre, de
  // `Dock.detach` — appelé quand on lâche la barre de titre au-dessus d'une zone.
  const env = neuf();
  declare(env);
  const fermetures = [];
  const ouvertes = {};
  env.openWindow = (id, el, opts) => { ouvertes[id] = true; return {}; };
  env.windowOpen = (id) => !!ouvertes[id];
  env.closeWindow = (id, sansRappel) => { fermetures.push({id, sansRappel}); delete ouvertes[id]; return true; };

  env.Dock.mount(env.document.getElementById('dock'), null);
  env.Dock.detach('inspector', 100, 80);
  assert.equal(env.Dock.floating('inspector'), true);

  const ok = env.Dock.redock('inspector', {zone: 'left', where: 'center'});
  assert.equal(ok, true);
  assert.equal(env.Dock.floating('inspector'), false, 'la fenetre est fermee');
  assert.equal(env.Dock.zoneOf('inspector'), 'left', 'rattache a la zone VISEE, pas la zone par defaut');
  assert.equal(fermetures.length, 1);
  assert.equal(fermetures[0].sansRappel, true,
    'sansRappel=true : sinon onFermeture le renverrait a sa zone par defaut (right)');
});

test('Dock.close() sur un panneau FLOTTANT le ferme vraiment (bug corrige)', () => {
  const env = neuf();
  declare(env);
  const ouvertes = {};
  const fermetures = [];
  env.openWindow = (id) => { ouvertes[id] = true; return {}; };
  env.windowOpen = (id) => !!ouvertes[id];
  env.closeWindow = (id, sansRappel) => { fermetures.push({id, sansRappel}); delete ouvertes[id]; return true; };

  env.Dock.mount(env.document.getElementById('dock'), null);
  env.Dock.detach('inspector', 100, 80);
  assert.equal(env.Dock.floating('inspector'), true);

  const ok = env.Dock.close('inspector');
  assert.equal(ok, true, 'avant le correctif, close() rendait false sur un panneau flottant');
  assert.equal(env.Dock.open('inspector'), false, 'le panneau est bien absent du layout');
  assert.equal(fermetures.length, 1, 'la fenetre REELLE doit se fermer avec le layout');
  assert.equal(fermetures[0].sansRappel, true, 'sinon onFermeture le rattacherait tout seul');
});

test('une popup bloquee retombe flottante EN PAGE, jamais poppee sans fenetre', () => {
  const env = neuf();
  declare(env);
  const ouvertes = {};
  env.popOutWindow = () => false;   // le navigateur refuse la popup
  env.windowPopped = () => false;
  env.openWindow = (id) => { ouvertes[id] = true; return {}; };
  env.windowOpen = (id) => !!ouvertes[id];

  env.Dock.mount(env.document.getElementById('dock'), null);
  const ok = env.Dock.popOut('inspector');

  assert.equal(env.Dock.popped('inspector'), false, 'jamais marque poppe sans fenetre reelle');
  assert.equal(env.Dock.open('inspector'), true, 'le panneau reste present quelque part');
  assert.equal(env.Dock.floating('inspector'), true, 'retombe flottant EN PAGE, pas perdu');
  assert.equal(ouvertes['panel:inspector'], true,
    'syncFloating doit vraiment avoir appele openWindow pour le repli, pas seulement le layout');
});

test('popper un panneau ne resurrecte pas un AUTRE panneau ferme (bug corrige)', () => {
  const env = neuf();
  declare(env);
  const poppees = {};
  env.openWindow = () => ({});
  env.windowOpen = () => false;
  env.popOutWindow = (id) => { poppees[id] = true; return {}; };
  env.windowPopped = (id) => !!poppees[id];

  env.Dock.mount(env.document.getElementById('dock'), null);
  env.Dock.close('project');
  assert.equal(env.Dock.open('project'), false);

  env.Dock.popOut('inspector');

  assert.equal(env.Dock.open('project'), false,
    'project etait ferme : il ne doit PAS reapparaitre juste parce qu on pope un autre panneau');
});

test('la toolbar VOYAGE avec le panneau quand il flotte', () => {
  const env = neuf();
  const outils = env.document.createElement('span'); outils.id = 'tools-project';
  env.document.body.appendChild(outils);
  env.Panels.register({ id: 'project', title: 'Projet', adopt: 'project',
    toolbar: 'tools-project', defaultZone: 'bottom' });
  let dernier = null;
  env.openWindow = (id, el) => { dernier = el; return {}; };
  env.windowOpen = () => false;

  env.Dock.mount(env.document.getElementById('dock'), null);
  env.Dock.detach('project', 50, 50);

  assert.ok(Array.isArray(dernier), 'openWindow doit recevoir [toolbar, corps], pas juste le corps');
  assert.equal(dernier[0], outils);
});

test('la vue 3D ne se detache pas', () => {
  const env = neuf();
  declare(env);
  const ouvertes = {};
  env.openWindow = (id) => { ouvertes[id] = true; return {}; };
  env.windowOpen = (id) => !!ouvertes[id];
  env.Dock.mount(env.document.getElementById('dock'), null);
  env.Dock.detach('viewport', 10, 10);
  assert.equal(env.Dock.floating('viewport'), false,
    'un panneau qu on ne peut pas fermer ne peut pas non plus flotter');
  assert.equal(env.Dock.activeOf('center'), 'viewport');
});

// ---------- UN SEUL PANNEAU VISIBLE PAR ZONE ----------
//
// Le bug, tel qu'il s'est présenté : la colonne de droite affichait l'inspecteur, l'environnement,
// le rendu, les paramètres du projet et les préférences les uns SOUS les autres, avec leurs cinq
// onglets au-dessus. Cause réelle : `buildZone` construit la zone HORS du document (`render` ne
// l'attache qu'après), et l'hôte d'un panneau était résolu par `document.getElementById` — qui ne
// trouve que ce qui est DANS le document. Pour tout panneau à hôte NEUF, la résolution rendait
// `null`, aucun `display:none` n'était posé, et tous s'affichaient.
//
// Les panneaux ADOPTÉS y échappaient (leur élément est déjà dans la page), ce qui a caché le bug
// jusqu'à ce qu'une zone porte plusieurs panneaux à hôte neuf.

function declareSansHote(env){
  declare(env);
  // Quatre panneaux du socle dans la MÊME zone : c'est la configuration qui a révélé le bug.
  ['environment', 'render', 'project-settings', 'preferences'].forEach((id) => {
    env.Panels.register({ id: id, title: id, defaultZone: 'right',
                          sections: [{ id: 's', fields: [] }], targets: () => [] });
  });
}

function visibles(env, ids){
  return ids.filter((id) => {
    const el = env.Panels.hostOf(id) || env.document.getElementById('dock-host-' + id);
    return el && el.style.display !== 'none';
  });
}

const ZONE_DROITE = ['inspector', 'environment', 'render', 'project-settings', 'preferences'];

test('une zone a plusieurs panneaux n en montre qu UN', () => {
  const env = neuf();
  declareSansHote(env);
  env.Dock.mount(env.document.getElementById('dock'), null);
  assert.deepEqual(visibles(env, ZONE_DROITE), ['inspector'],
    'les autres doivent etre masques : sinon leurs contenus s empilent sous les onglets');
});

test('changer d onglet echange les deux, il n en ajoute pas un', () => {
  const env = neuf();
  declareSansHote(env);
  env.Dock.mount(env.document.getElementById('dock'), null);
  env.Dock.activate('right', 'preferences');
  assert.deepEqual(visibles(env, ZONE_DROITE), ['preferences']);
  env.Dock.activate('right', 'render');
  assert.deepEqual(visibles(env, ZONE_DROITE), ['render']);
});

test('l hote d un panneau est resolu par la CARTE du dock, pas par le document', () => {
  // Test de STRUCTURE, et il faut dire pourquoi : le mini-DOM du harnais indexe un élément dès
  // qu'il est ajouté à N'IMPORTE QUEL parent, attaché ou non. Il ne peut donc pas reproduire la
  // règle du navigateur qui a causé le bug, et un test de comportement passerait aussi bien
  // avant la correction qu'après. Ce qui est mesurable ici, c'est que la résolution ne repose
  // plus sur `getElementById` seul.
  const src = fs.readFileSync(new URL('../js/ui/dock.js', import.meta.url), 'utf8');
  const corps = src.slice(src.indexOf('function hostOfPanel'),
                          src.indexOf('function zoneNodeOf'));
  assert.ok(corps.indexOf('panelElements.get(id)') !== -1,
    'hostOfPanel doit consulter la carte des elements de panneau AVANT le document');
  assert.ok(src.indexOf('panelElements.set(id, el)') !== -1,
    'buildZone doit y inscrire chaque hote qu il pose');
  assert.ok(src.indexOf('panelElements.clear()') !== -1,
    'et la vider a chaque reconstruction, sinon un hote detruit y survivrait');
});

// ---------- ROUVRIR UN PANNEAU A LA DEMANDE AVEC ZONE PAR DEFAUT ----------
//
// Le bug : `reopen()` traitait TOUT panneau absent du layout après `normalizeLayout` comme un
// panneau sans zone (le seul cas prévu par `dock-tree.js` pour l'auto-injection au démarrage),
// et le faisait toujours flotter à la position fixe (120,80,420,320) — même quand il déclare une
// `defaultZone`. Deux panneaux `onDemand` ouverts l'un après l'autre (ex. Environnement puis
// Rendu) atterrissaient donc exactement l'un sur l'autre, sans le moindre décalage : le second
// semblait « ne pas s'ouvrir ».

test('rouvrir un panneau A LA DEMANDE avec zone par defaut le DOCKE, il ne flotte pas', () => {
  const env = neuf();
  declare(env);
  env.Panels.register({ id: 'environment', title: 'Environnement', defaultZone: 'right',
                        onDemand: true, sections: [{ id: 's', fields: [] }], targets: () => [] });
  env.Dock.mount(env.document.getElementById('dock'), null);
  assert.equal(env.Dock.open('environment'), false,
    'onDemand : absent tant que personne ne l a demande');
  env.Dock.reopen('environment');
  assert.equal(env.Dock.floating('environment'), false,
    'une zone par defaut existe : il doit la rejoindre, pas flotter');
  assert.ok(env.Dock.tabsOf('right').indexOf('environment') !== -1);
});
