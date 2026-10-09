// moteur/test/project-roundtrip.test.mjs
//
// Le format de projet porte les COMPOSANTS, et pas seulement les sacs userData historiques.
// C'est le préalable au retrait de `userData.type` : tant que la reconstruction passe par
// `syncComponents`, dont la table a `userData.type` pour clé, retirer le type rendrait une
// forêt de `Group` nus à la relecture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');

test('serializeObject ecrit le champ components', () => {
  const src = read('js/serialization.js');
  const corps = src.slice(src.indexOf('function serializeObject'),
                          src.indexOf('function serializeTree'));
  assert.match(corps, /components:\s*componentEntriesOf\(o\)/,
    'le nœud sérialisé ne porte pas ses composants');
  // Le type ET l'activation, pas seulement les données : un composant désactivé qui revient
  // actif à la relecture, c'est un comportement qui reprend tout seul.
  assert.match(corps, /type: c\.constructor\.typeName/, 'le type du composant n\'est pas écrit');
  assert.match(corps, /active: c\.active !== false/, 'l\'activation du composant n\'est pas écrite');
});

test('les trois sacs DEJA reconstruits par leur composant ne sont plus ecrits en double', () => {
  // PREMIERE MARCHE DE LA SORTIE DU DOUBLE STOCKAGE (docs/REVUE_2026-09-10.md SS 3.1).
  //
  // Le format ecrivait `terr`, `probe` et `subScene` DEUX FOIS : une fois a plat, une fois dans
  // l entree `components` du composant qui les possede. Et `rebuildTree` ne relisait deja plus
  // que la seconde. La copie a plat etait donc du poids mort dans chaque fichier de scene, et
  // surtout une SECONDE verite que rien ne reconciliait le jour ou les deux diffèrent.
  //
  // Ce qui autorise le retrait est mesure juste en dessous : « Terrain / Reflection / SubScene
  // se reconstruit entierement depuis ses donnees serialisees ». Ne pas retirer un sac sans ce
  // test-la pour le meme composant.
  const src = read('js/serialization.js');
  const corps = src.slice(src.indexOf('function serializeObject'),
                          src.indexOf('function serializeTree'));
  const revenus = [];
  for(const champ of ['terr', 'subScene', 'probe']){
    if(new RegExp('^\\s*' + champ + ':', 'm').test(corps)) revenus.push(champ);
  }
  assert.deepEqual(revenus, [],
    'Ces champs sont de nouveau ecrits a plat, en double avec leur composant. Personne ne les '
    + 'relit : c est du poids mort, et une seconde verite qui divergera. ' + revenus.join(', '));

  // Et le sens inverse : les dix-sept qui RESTENT sont encore relus, donc les retirer casserait
  // le chargement. On verifie que `rebuildTree` les lit toujours, pour que ce test ne devienne
  // pas une invitation a tous les supprimer d un coup.
  const rebuild = src.slice(src.indexOf('function rebuildTree'), src.indexOf('function fileInB64'));
  for(const champ of ['phys', 'collider', 'scripts', 'audio', 'animator', 'events']){
    assert.ok(rebuild.includes('d.' + champ),
      'rebuildTree ne relit plus `d.' + champ + '` : si le composant sait vraiment se '
      + 'reconstruire seul, retirez AUSSI l ecriture, et ajoutez `' + champ + '` a la liste '
      + 'ci-dessus. Sinon le chargement perd cette donnee en silence.');
  }
});

test('Mesh.serialize n appelle aucune globale de materials.js (absente du jeu publie)', () => {
  // Le runtime clone un prefab via toJSON -> serialize() : `smoothingFromRoughness` (materials.js,
  // non chargé par le build) y levait « is not defined », et chaque api.create échouait (v0.170.2).
  const src = read('js/components/component-mesh.js');
  const debut = src.indexOf('  serialize() {');
  const corps = src.slice(debut, src.indexOf('\n  }', debut));
  const code = corps.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /smoothingFromRoughness|roughnessFromSmoothing|invert01/,
    'Mesh.serialize dépend d\'une fonction de materials.js');
});

test('un DEBRIS de clone est ecrit (gabarit de prefab), un objet sans typeName ne l est pas', () => {
  // Le gabarit d'un prefab est un clone DÉTACHÉ : ses composants sont les objets nus de
  // Component.toJSON — {typeName, active, ...données}. Les écarter enregistrait chaque prefab sans
  // maillage ni lumière : des groupes vides, invisibles et intouchables en jeu (v0.170.1).
  // Un objet SANS typeName, lui, ne part pas : `{type: undefined}` ne saurait pas être reposé.
  const src = read('js/serialization.js');
  const debut = src.indexOf('function componentEntriesOf');
  const corps = src.slice(debut, src.indexOf('\n}', debut) + 2);
  const componentEntriesOf = new Function(corps + '; return componentEntriesOf;')();
  class Mesh { static get typeName(){ return 'Mesh'; } serialize(){ return {geo: 'sphere'}; } }
  const vivant = new Mesh(); vivant.active = false;
  const o = {userData: {components: [
    vivant,
    {typeName: 'Mesh', active: true, geo: 'cube', color: '#ff0000'},   // débris de clone
    {geo: 'orphelin'},                                               // aucun type : écarté
    null
  ]}};
  assert.deepEqual(componentEntriesOf(o), [
    {type: 'Mesh', data: {geo: 'sphere'}, active: false},
    {type: 'Mesh', data: {geo: 'cube', color: '#ff0000'}, active: true}
  ]);
});

import vm from 'node:vm';
import { creerContexte, deEsm } from './engine-env.mjs';

/**
 * L'INVARIANT DE RECONSTRUCTION, vérifié composant par composant :
 *
 *     addComponent(type, composant.serialize()) === l'état d'origine
 *
 * Autrement dit : les données du composant se suffisent. Tant que ce n'était pas vrai,
 * `rebuildTree` devait retoucher le nœud à la main après la fabrique (patcher `ed(o).light`
 * depuis le sac `d.lum`, `ed(o).cam.fov` depuis `d.fov`…), et cette logique existait donc en
 * double — une fois dans la fabrique, une fois dans la relecture. C'est cette duplication qui
 * faisait qu'une caméra 2D rechargée revenait en perspective : une seule des deux copies savait.
 *
 * `fichiers` : les composants à charger en plus de la base.
 * `prelude` : le code de contexte (stubs de l'éditeur) dont ces composants ont besoin.
 * `apres` : les fichiers à charger APRÈS le prélude — pour ceux qui, au chargement, appellent
 * l'éditeur (js/terrain.js enregistre ses raccourcis clavier) et qui échoueraient avant.
 */
function contexteComponents(fichiers, prelude, apres){
  const ctx = creerContexte(['js/component-registry.js', 'js/component.js', 'js/node.js'].concat(fichiers));
  vm.runInContext(`
    var _ed = new WeakMap();
    function ed(o){ if(!_ed.has(o)) _ed.set(o, {}); return _ed.get(o); }
    function removeHelper(){}
    ${prelude || ''}
  `, ctx);
  (apres || []).forEach((f) => {
    vm.runInContext(deEsm(readFileSync(path.join(root, f), 'utf8')), ctx, { filename: f });
  });
  return ctx;
}

test('Light se reconstruit entierement depuis ses donnees serialisees', () => {
  const ctx = contexteComponents(['js/component-data.js', 'js/components/component-light.js']);
  vm.runInContext(`
    // Le nœud d'une lumière est le MAILLAGE repère (la petite sphère), pas un Group : c'est
    // son matériau émissif que la relecture doit retrouver.
    function noeudLumiere(){
      const n = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6),
                               new THREE.MeshStandardMaterial({}));
      n.userData.type = 'group';
      applyNodeMixin(n);
      return n;
    }
    const source = noeudLumiere();
    source.addComponent('Light', { subType: 'spot', color: 0x00ff00, intensity: 3,
                                   range: 12, angle: 0.5, penumbra: 0.2 });
    const donnees = source.getComponent('Light').serialize();

    const copie = noeudLumiere();
    copie.addComponent('Light', donnees);
    const l = ed(copie).light;
    this.etat = { type: l.type, color: l.color.getHex(), intensity: l.intensity,
                  distance: l.distance, angle: l.angle, penumbra: l.penumbra,
                  emissive: copie.material.emissive.getHex(),
                  emissiveBase: copie.userData.emissiveBase,
                  typeNoeud: copie.userData.type };
  `, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.etat)), {
    type: 'SpotLight', color: 0x00ff00, intensity: 3, distance: 12,
    angle: 0.5, penumbra: 0.2,
    // Le repère émissif : c'est ce que `rebuildTree` posait à la main, et qui manquait dès
    // qu'une lumière était reconstruite autrement que par la relecture d'un projet.
    emissive: 0x00ff00, emissiveBase: 0x00ff00,
    typeNoeud: 'spot'
  });
});

test('Camera se reconstruit entierement depuis ses donnees serialisees', () => {
  const ctx = contexteComponents(['js/component-data.js', 'js/components/component-camera.js'],
    'var activeCam = null; function quitViewCamera(){} function applyMaskCamera(){}');
  vm.runInContext(`
    // Le nœud caméra porte DÉJÀ une THREE.PerspectiveCamera quand le composant arrive : c'est
    // makeCamera() qui la construit, avec ses valeurs par défaut. Le composant doit donc régler
    // une caméra existante, et pas seulement savoir en créer une.
    function noeudCamera(){
      const n = new THREE.Group();
      n.userData.type = 'group';
      applyNodeMixin(n);
      const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 1000);
      n.add(cam);
      ed(n).cam = cam;
      return n;
    }
    const source = noeudCamera();
    source.addComponent('Camera', { fov: 80, near: 0.5, far: 250 });
    const donnees = source.getComponent('Camera').serialize();

    const copie = noeudCamera();
    copie.addComponent('Camera', donnees);
    const c = ed(copie).cam;
    this.etatCam = { fov: c.fov, near: c.near, far: c.far, typeNoeud: copie.userData.type };
  `, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.etatCam)),
    { fov: 80, near: 0.5, far: 250, typeNoeud: 'camera' });
});

test('une camera desactivee le reste apres relecture', () => {
  // `camActive` est le miroir historique que lisent la sérialisation et le runtime publié :
  // sans lui, une caméra qu'on a désactivée redevient active à la réouverture du projet, et
  // le jeu démarre sur la mauvaise vue.
  const ctx = contexteComponents(['js/component-data.js', 'js/components/component-camera.js'],
    'var activeCam = null; function quitViewCamera(){} function applyMaskCamera(){}');
  vm.runInContext(`
    const n = new THREE.Group();
    n.userData.type = 'group';
    applyNodeMixin(n);
    n.addComponent('Camera', { fov: 50, active: false });
    this.camInactive = { active: n.getComponent('Camera').active, miroir: n.userData.camActive };
  `, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.camInactive)), { active: false, miroir: false });
});

test('Reflection se reconstruit entierement depuis ses donnees serialisees', () => {
  const ctx = contexteComponents(
    ['js/component-data.js', 'js/components/component-reflection.js'],
    'function removeBoxProbeViz(){} function disposeProbe(){} function applyProbes(){}'
    + ' function updateBoxProbeViz(){}');
  vm.runInContext(`
    function noeudSonde(){
      const n = new THREE.Group();
      n.userData.type = 'group';
      applyNodeMixin(n);
      return n;
    }
    const source = noeudSonde();
    source.addComponent('Reflection', { radius: 42, resolution: 256, box: true,
                                        boxSize: [3, 4, 5] });
    const donnees = source.getComponent('Reflection').serialize();

    const copie = noeudSonde();
    copie.addComponent('Reflection', JSON.parse(JSON.stringify(donnees)));
    const s = copie.userData.probe;
    this.etatSonde = { radius: s.radius, resolution: s.resolution, box: s.box,
                       boxSize: s.boxSize,
                       // Les champs absents des données reçues sont complétés par les défauts,
                       // et pas laissés vides : c'est le rôle d'ensureProbe.
                       intensity: s.intensity,
                       typeNoeud: copie.userData.type,
                       // Le composant et le sac sont le MÊME objet : probes.js écrit dans le
                       // sac, l'inspecteur dans le composant, et les deux doivent se voir.
                       memeObjet: copie.getComponent('Reflection').data === s };
  `, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.etatSonde)), {
    radius: 42, resolution: 256, box: true, boxSize: [3, 4, 5],
    intensity: 1, typeNoeud: 'probe', memeObjet: true
  });
});

test('SubScene se reconstruit entierement depuis ses donnees serialisees', () => {
  const ctx = contexteComponents(['js/components/component-subscene.js']);
  vm.runInContext(`
    function noeudSousScene(){
      const n = new THREE.Group();
      n.userData.type = 'group';
      applyNodeMixin(n);
      return n;
    }
    const source = noeudSousScene();
    source.addComponent('SubScene', { scene: 'Village', overrides: { '3': { name: 'Puits' } } });
    const donnees = source.getComponent('SubScene').serialize();

    const copie = noeudSousScene();
    copie.addComponent('SubScene', JSON.parse(JSON.stringify(donnees)));
    this.etatSS = { scene: copie.userData.subScene.scene,
                    overrides: copie.userData.subScene.overrides,
                    // Le composant lit le sac : les deux ne doivent jamais diverger.
                    vue: copie.getComponent('SubScene').nameScene,
                    typeNoeud: copie.userData.type };
  `, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.etatSS)), {
    scene: 'Village', overrides: { '3': { name: 'Puits' } },
    vue: 'Village', typeNoeud: 'subScene'
  });
});

test('Particles se reconstruit entierement depuis ses donnees serialisees', () => {
  const ctx = contexteComponents(
    ['js/component-data.js', 'js/components/component-particles.js'],
    'function resetSystemParticles(){} function updateParticles(){}');
  vm.runInContext(`
    function noeudEmetteur(){
      const n = new THREE.Group();
      n.userData.type = 'group';
      applyNodeMixin(n);
      return n;
    }
    const source = noeudEmetteur();
    source.addComponent('Particles', { rate: 250, vie: 4.5 });
    const donnees = source.getComponent('Particles').serialize();

    const copie = noeudEmetteur();
    copie.addComponent('Particles', JSON.parse(JSON.stringify(donnees)));
    const s = copie.userData.part;
    this.etatPart = { rate: s.rate, vie: s.vie,
                      // Un champ que les données reçues ne portaient pas : le défaut comble,
                      // il ne reste pas vide.
                      defautPresent: s.shape !== undefined,
                      typeNoeud: copie.userData.type,
                      memeObjet: copie.getComponent('Particles').data === s };
  `, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.etatPart)), {
    rate: 250, vie: 4.5, defautPresent: true, typeNoeud: 'particles', memeObjet: true
  });
});

test('Terrain se reconstruit entierement depuis ses donnees serialisees', () => {
  const ctx = contexteComponents(
    ['js/component-data.js'],
    'function registerInputs(){} function setStatus(){} var histo = { gel: false };'
    + ' function pushHistory(){} var selection = null;',
    ['js/terrain.js', 'js/components/component-terrain.js']);
  vm.runInContext(`
    const source = buildTerrain({ size: 40, segments: 8 });
    // Une bosse : c'est elle qui doit se retrouver dans la géométrie de la copie, et pas
    // seulement dans le sac de données.
    source.userData.terr.heights[12] = 3.5;
    const donnees = JSON.parse(JSON.stringify(source.getComponent('Terrain').serialize()));

    const copie = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
    copie.userData.type = 'group';
    applyNodeMixin(copie);
    copie.addComponent('Terrain', donnees);
    const t = copie.userData.terr;
    this.etatTerr = {
      size: t.size, segments: t.segments, nSommets: t.heights.length,
      bosseData: t.heights[12],
      // LA géométrie, pas seulement les données : c'est ce qui distingue un composant
      // reconstructif d'un composant qui se contente de retenir un sac.
      bosseGeo: Math.round(copie.geometry.attributes.position.getY(12) * 100) / 100,
      countGeo: copie.geometry.attributes.position.count,
      typeNoeud: copie.userData.type
    };
  `, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.etatTerr)), {
    size: 40, segments: 8, nSommets: 81, bosseData: 3.5, bosseGeo: 3.5,
    countGeo: 81, typeNoeud: 'terrain'
  });
});

test('Model porte la provenance du modele importe', () => {
  const ctx = contexteComponents(['js/components/component-model.js']);
  vm.runInContext(`
    // Un clone frais de cloneModel porte déjà assetId/format : le composant ne fait que les
    // emporter dans ses données.
    const source = new THREE.Group();
    source.userData.type = 'model';
    source.userData.assetId = 'a-42';
    source.userData.format = 'glb';
    applyNodeMixin(source);
    source.addComponent('Model');
    const donnees = source.getComponent('Model').serialize();

    // Le nœud NU : c'est le cas de la reconstruction depuis le seul format à composants.
    const copie = new THREE.Group();
    copie.userData.type = 'group';
    applyNodeMixin(copie);
    copie.addComponent('Model', JSON.parse(JSON.stringify(donnees)));
    this.etatModel = { assetId: copie.userData.assetId, format: copie.userData.format,
                       typeNoeud: copie.userData.type,
                       serialise: donnees };
  `, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.etatModel)), {
    assetId: 'a-42', format: 'glb', typeNoeud: 'model',
    serialise: { assetId: 'a-42', format: 'glb' }
  });
});

test('Model n ecrase pas la provenance que le noeud connait deja', () => {
  // Un clone frais sait de quel asset il vient ; des données plus anciennes ne doivent pas
  // le renvoyer vers un asset supprimé ou remplacé.
  const ctx = contexteComponents(['js/components/component-model.js']);
  vm.runInContext(`
    const n = new THREE.Group();
    n.userData.type = 'model';
    n.userData.assetId = 'frais';
    applyNodeMixin(n);
    n.addComponent('Model', { assetId: 'ancien', format: 'fbx' });
    this.provenance = { assetId: n.userData.assetId, format: n.userData.format };
  `, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.provenance)), { assetId: 'frais', format: 'fbx' });
});

test('Mesh se reconstruit entierement depuis ses donnees serialisees', () => {
  // Le composant historiquement décrit comme un « miroir jamais relu » : il écrivait
  // fidèlement forme, couleur et matériau, et personne ne les relisait — c'est `rebuildTree`
  // qui rejouait tout à la main depuis les sacs du fichier.
  const ctx = contexteComponents(['js/component-data.js'],
    'function setStatus(){} var palette = [0x888888]; var assets = [];',
    ['js/materials.js', 'js/components/component-mesh.js']);
  vm.runInContext(`
    // buildGeometry vit dans js/objects.js, qui traîne tout l'éditeur derrière lui : la forme
    // se réduit ici aux deux primitives dont le test a besoin.
    function buildGeometry(nom){
      return nom === 'sphere'
        ? { geo: new THREE.SphereGeometry(0.5, 8, 6), name: 'Sphère', geoName: 'sphere' }
        : { geo: new THREE.BoxGeometry(1, 1, 1), name: 'Cube', geoName: 'cube' };
    }
    function noeudMaillage(geoName){
      const c = buildGeometry(geoName);
      const n = new THREE.Mesh(c.geo, new THREE.MeshStandardMaterial({ color: 0x888888 }));
      n.userData.type = 'group';
      n.userData.geo = c.geoName;
      applyNodeMixin(n);
      return n;
    }
    const source = noeudMaillage('sphere');
    source.addComponent('Mesh');
    source.material.color.setHex(0x123456);
    source.material.metalness = 0.75;
    source.material.roughness = 0.2;
    source.material.opacity = 0.4;
    source.userData.emissiveBase = 0x00ff00;
    source.material.emissive.setHex(0x00ff00);
    const donnees = JSON.parse(JSON.stringify(source.getComponent('Mesh').serialize()));

    // Le nœud de destination est un CUBE : la forme aussi doit suivre les données.
    const copie = noeudMaillage('cube');
    copie.addComponent('Mesh', donnees);
    this.etatMesh = {
      geo: copie.userData.geo,
      color: copie.material.color.getHex(),
      metal: copie.material.metalness,
      // La rugosité voyage en « lissage » dans le fichier : l'aller-retour doit rendre la
      // valeur de départ, sinon chaque enregistrement ferait dériver l'apparence.
      roughness: Math.round(copie.material.roughness * 1000) / 1000,
      opacity: copie.material.opacity,
      transparent: copie.material.transparent,
      emissive: copie.material.emissive.getHex(),
      emissiveBase: copie.userData.emissiveBase,
      typeNoeud: copie.userData.type
    };
  `, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.etatMesh)), {
    geo: 'sphere', color: 0x123456, metal: 0.75, roughness: 0.2, opacity: 0.4,
    transparent: true, emissive: 0x00ff00, emissiveBase: 0x00ff00, typeNoeud: 'mesh'
  });
});

test('Mesh pose sans donnees ne touche a rien', () => {
  // makePrimitive attache le composant APRÈS avoir construit forme et matériau : un
  // `hydrate({})` qui reconstruirait la géométrie jetterait le travail de la fabrique.
  const ctx = contexteComponents(['js/component-data.js'],
    'function setStatus(){} var assets = [];',
    ['js/materials.js', 'js/components/component-mesh.js']);
  vm.runInContext(`
    const n = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
                             new THREE.MeshStandardMaterial({ color: 0xabcdef }));
    n.userData.type = 'group';
    n.userData.geo = 'cube';
    applyNodeMixin(n);
    const geoAvant = n.geometry;
    n.addComponent('Mesh');
    this.etatVide = { memeGeometrie: n.geometry === geoAvant, color: n.material.color.getHex() };
  `, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.etatVide)),
    { memeGeometrie: true, color: 0xabcdef });
});

test('applyComponents relit un composant DEJA pose par la fabrique', () => {
  // Le cas normal de la relecture d'un projet : la fabrique a construit la lumière avec ses
  // valeurs par défaut et son composant, et le fichier dit maintenant lesquelles sont les
  // bonnes. Reposer le composant en créerait un second ; on relit celui qui est là.
  const ctx = contexteComponents(['js/component-data.js', 'js/components/component-light.js'],
    'function logConsole(){}',
    ['js/component-migration.js']);
  vm.runInContext(`
    const n = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6),
                             new THREE.MeshStandardMaterial({}));
    n.userData.type = 'group';
    applyNodeMixin(n);
    n.addComponent('Light', { subType: 'point', color: 0xffffff, intensity: 1 });

    applyComponents(n, [{ type: 'Light', active: true,
                          data: { subType: 'point', color: 0xff0000, intensity: 7, range: 30 } }]);
    const l = ed(n).light;
    this.relu = { nbComposants: n.getComponents('Light').length,
                  color: l.color.getHex(), intensity: l.intensity, distance: l.distance,
                  champ: n.getComponent('Light').color,
                  emissive: n.material.emissive.getHex() };
  `, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.relu)), {
    nbComposants: 1, color: 0xff0000, intensity: 7, distance: 30,
    champ: 0xff0000, emissive: 0xff0000
  });
});

test('applyComponents pose un composant absent et respecte son activation', () => {
  const ctx = contexteComponents(['js/component-data.js', 'js/components/component-camera.js'],
    'function logConsole(){} var activeCam = null;'
    + ' function quitViewCamera(){} function applyMaskCamera(){}',
    ['js/component-migration.js']);
  vm.runInContext(`
    const n = new THREE.Group();
    n.userData.type = 'group';
    applyNodeMixin(n);
    applyComponents(n, [{ type: 'Camera', active: false, data: { fov: 33, near: 1, far: 90 } }]);
    const c = n.getComponent('Camera');
    this.pose = { fov: ed(n).cam.fov, near: ed(n).cam.near, far: ed(n).cam.far,
                  active: c.active, miroir: n.userData.camActive,
                  typeNoeud: n.userData.type };
  `, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.pose)), {
    fov: 33, near: 1, far: 90, active: false, miroir: false, typeNoeud: 'camera'
  });
});

test('un composant inconnu du fichier n interrompt pas la reconstruction', () => {
  // Un projet enregistré par une version plus récente de l'éditeur, ou un plugin absent :
  // le nœud et ses AUTRES composants doivent survivre.
  const ctx = contexteComponents(['js/component-data.js', 'js/components/component-camera.js'],
    'var avertissements = []; var activeCam = null;'
    + ' function quitViewCamera(){} function applyMaskCamera(){}'
    + ' function logConsole(niveau, message){ avertissements.push(message); }',
    ['js/component-migration.js']);
  vm.runInContext(`
    const n = new THREE.Group();
    n.userData.type = 'group';
    applyNodeMixin(n);
    applyComponents(n, [{ type: 'VenuDuFutur', data: {} },
                        { type: 'Camera', data: { fov: 44 } }]);
    this.survie = { camera: !!n.getComponent('Camera'), fov: ed(n).cam.fov,
                    prevenu: avertissements.length === 1 };
  `, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.survie)),
    { camera: true, fov: 44, prevenu: true });
});

test('deux scripts relus font deux composants, et pas un double', () => {
  // ScriptJS est le seul composant dont `onAdd` POUSSE dans un sac que la reconstruction vient
  // de remplir (`userData.scripts`), et le seul qui cohabite avec ses semblables sur un nœud.
  // Les deux pièges se paient au même endroit : un script exécuté deux fois, ou le second qui
  // écrase le premier.
  const ctx = contexteComponents(['js/component-data.js'],
    'function logConsole(){} function parseExposures(){ return []; }'
    + ' function setStatus(){} var assets = [];',
    ['js/components/component-script.js', 'js/component-migration.js']);
  vm.runInContext(`
    const n = new THREE.Group();
    n.userData.type = 'group';
    applyNodeMixin(n);
    // Ce que rebuildTree écrit AVANT de poser les composants : le tableau du fichier.
    // L'entree du fichier ne porte que son scriptId : le code vit sur l'asset reference.
    n.userData.scripts = [{ scriptId: 'a1', active: true, values: {} },
                          { scriptId: 'a2', active: true, values: {} }];
    applyComponents(n, [{ type: 'ScriptJS', data: { scriptId: 'a1', values: {} } },
                        { type: 'ScriptJS', data: { scriptId: 'a2', values: {} } }]);
    this.scripts = { nbComposants: n.getComponents('ScriptJS').length,
                     nbEntrees: n.userData.scripts.length,
                     ids: n.userData.scripts.map(function(s){ return s.scriptId; }) };
  `, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.scripts)),
    { nbComposants: 2, nbEntrees: 2, ids: ['a1', 'a2'] });
});

// ---------------------------------------------------------------------------
// LE FILET : le round-trip complet d'une scène.
//
// C'est le point précis où le monde 2D disparaissait en silence — `serializeObject` refusait
// comme parent tout nœud sans `userData.type`, le lien de parenté partait donc à `null`, et
// `rebuildTree` sautait le nœud sans type sans un mot. Tout marchait dans la session en cours :
// la pire forme du défaut. Ce filet existe pour que le retrait de `userData.type` du format ne
// puisse pas rouvrir cette porte.
// ---------------------------------------------------------------------------

/** Le moteur assez complet pour sérialiser une scène et la relire. */
function contexteScene(){
  const composants = readdirSync(path.join(root, 'js/components'))
    .filter((f) => f.endsWith('.js')).map((f) => 'js/components/' + f);
  const ctx = creerContexte(['js/component-registry.js', 'js/component.js', 'js/node.js', 'js/component-data.js']
    .concat(composants).concat(['js/component-migration.js', 'js/materials.js']));
  // Ce que js/scene.js et l'interface fourniraient. `objects.js` les référence sans les
  // déclarer, et les charger pour de vrai amènerait le renderer, la barre d'outils et le DOM
  // complet — sans rien apporter au round-trip.
  vm.runInContext('var LAYER_HELPERS = 31; var scene = new THREE.Scene();'
    + ' function updateHierarchy(){} function select(){} function setStatus(){}'
    + ' function logConsole(){} function removeHelper(){}'
    + ' var activeCam = null; function quitViewCamera(){}', ctx);
  ['js/objects.js', 'js/serialization.js'].forEach((f) => {
    vm.runInContext(deEsm(readFileSync(path.join(root, f), 'utf8')), ctx, { filename: f });
  });
  return ctx;
}

test('une scene mixte survit a un aller-retour de serialisation', () => {
  const ctx = contexteScene();
  vm.runInContext(`
    const decor = createSceneNode({ name: 'Décor', silent: true });
    const sol = createSceneNode({ name: 'Sol', parent: decor, silent: true,
                                  object3d: makePrimitive('cube') });
    sol.material.color.setHex(0x112233);
    sol.material.metalness = 0.9;
    const lampe = createSceneNode({ name: 'Lampe', parent: decor, silent: true,
                                    object3d: makeLight('spot') });
    lampe.getComponent('Light').color = 0xff0000;
    lampe.getComponent('Light').intensity = 5;
    const cam = createSceneNode({ name: 'Caméra', parent: decor, silent: true,
                                  object3d: makeCamera() });
    cam.getComponent('Camera').fov = 77;

    const fichier = objects.map(serializeObject);
    clearSceneObjects();
    const rec = rebuildTree(fichier, {}, false);
    // Ce que fait l'appelant (history.js) : attacher les racines et indexer les nœuds relus.
    rec.racines.forEach(function(r){ scene.add(r); });
    Object.keys(rec.byId).forEach(function(k){ addSceneObject(rec.byId[k]); });

    const relu = function(nom){ return objects.find(function(o){ return o.name === nom; }); };
    const l = relu('Lampe');
    this.aller = {
      noms: objects.map(function(o){ return o.name; }).sort(),
      // LA parenté : c'est elle qui partait à null.
      parente: relu('Sol').parent === relu('Décor'),
      indexes: objects.every(function(o){ return isSceneObject(o); }),
      color: relu('Sol').material.color.getHex(),
      metal: relu('Sol').material.metalness,
      compsSol: relu('Sol').getComponents().map(function(c){ return c.constructor.typeName; }),
      lumType: ed(l).light.type,
      lumColor: ed(l).light.color.getHex(),
      lumIntensite: ed(l).light.intensity,
      fov: ed(relu('Caméra')).cam.fov
    };
  `, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.aller)), {
    noms: ['Caméra', 'Décor', 'Lampe', 'Sol'],
    parente: true, indexes: true,
    color: 0x112233, metal: 0.9,
    compsSol: ['Mesh', 'Collider', 'Physics'],
    lumType: 'SpotLight', lumColor: 0xff0000, lumIntensite: 5,
    fov: 77
  });
});

test('deux allers-retours de suite ne font pas deriver la scene', () => {
  // Une seule relecture peut réussir par accident — la fabrique repose les bonnes valeurs par
  // défaut. C'est le SECOND tour qui montre ce qui ne se relit pas : ce qui a été perdu au
  // premier ne peut plus revenir.
  const ctx = contexteScene();
  vm.runInContext(`
    const sol = createSceneNode({ name: 'Sol', silent: true, object3d: makePrimitive('sphere') });
    sol.material.color.setHex(0x445566);
    const lampe = createSceneNode({ name: 'Lampe', silent: true, object3d: makeLight('directional') });
    lampe.getComponent('Light').intensity = 2.5;

    function tour(){
      const fichier = objects.map(serializeObject);
      clearSceneObjects();
      const rec = rebuildTree(fichier, {}, false);
      rec.racines.forEach(function(r){ scene.add(r); });
      Object.keys(rec.byId).forEach(function(k){ addSceneObject(rec.byId[k]); });
      return fichier;
    }
    tour();
    tour();
    const relu = function(nom){ return objects.find(function(o){ return o.name === nom; }); };
    this.deuxTours = {
      nb: objects.length,
      geo: relu('Sol').userData.geo,
      color: relu('Sol').material.color.getHex(),
      intensite: ed(relu('Lampe')).light.intensity,
      // Un composant reposé en double à chaque tour est le symptôme classique : on le verrait
      // ici, et nulle part ailleurs.
      compsSol: relu('Sol').getComponents().length
    };
  `, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.deuxTours)), {
    nb: 2, geo: 'sphere', color: 0x445566, intensite: 2.5, compsSol: 3
  });
});

test('un noeud SANS type se reconstruit depuis ses seuls composants', () => {
  // Le cœur du retrait de `userData.type` du format : la reconstruction ne doit plus rien
  // devoir au type stocké. Les entrées ci-dessous n'en portent aucun — c'est le composant
  // nommé qui dit ce qu'il faut construire (`static makeObject3D`).
  const ctx = contexteScene();
  vm.runInContext(`
    const fichier = [
      { id: 1, name: 'Décor', pos: [0, 0, 0], quat: [0, 0, 0, 1], ech: [1, 1, 1],
        parent: null, components: [] },
      { id: 2, name: 'Sol', pos: [1, 2, 3], quat: [0, 0, 0, 1], ech: [1, 1, 1], parent: 1,
        components: [{ type: 'Mesh', active: true,
                       data: { geo: 'sphere', color: 0x336699,
                               mat: { smoothness: 0.5, metal: 0.25, emissive: 0, opacity: 1 } } }] },
      { id: 3, name: 'Lampe', pos: [0, 4, 0], quat: [0, 0, 0, 1], ech: [1, 1, 1], parent: 1,
        components: [{ type: 'Light', active: true,
                       data: { subType: 'spot', color: 0x00ffcc, intensity: 4, range: 9,
                               angle: 0.4, penumbra: 0.1 } }] }
    ];
    const rec = rebuildTree(fichier, {}, false);
    const sol = rec.byId[2], lampe = rec.byId[3];
    this.sansType = {
      racines: rec.racines.length,
      parente: sol.parent === rec.byId[1],
      position: sol.position.toArray(),
      geo: sol.userData.geo,
      color: sol.material.color.getHex(),
      metal: sol.material.metalness,
      // Le type RUNTIME est reposé par les composants (markType) : ce sont les systèmes
      // historiques qui le lisent, pas le fichier.
      typeSol: sol.userData.type,
      typeLampe: lampe.userData.type,
      lumType: ed(lampe).light.type,
      lumColor: ed(lampe).light.color.getHex(),
      lumIntensite: ed(lampe).light.intensity
    };
  `, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.sansType)), {
    racines: 1, parente: true, position: [1, 2, 3], geo: 'sphere',
    color: 0x336699, metal: 0.25, typeSol: 'mesh', typeLampe: 'spot',
    lumType: 'SpotLight', lumColor: 0x00ffcc, lumIntensite: 4
  });
});

test('LES DEUX COTES construisent leurs noeuds par le meme code', () => {
  // Le plus gros écart d'architecture du dépôt : l'éditeur et le jeu publié reconstruisaient
  // chacun la scène par leur propre cascade sur `d.type` — la même connaissance en deux copies,
  // dont une seule était tenue à jour. C'est ainsi qu'une caméra 2D revenait ORTHOGRAPHIQUE
  // d'un côté et PERSPECTIVE de l'autre, ce qui ne se voit qu'après export.
  const partage = read('js/component-migration.js');
  assert.ok(partage.includes('function nodeOfComponents'),
    'le constructeur de noeud partage a disparu');
  // La reconstruction elle-même, des deux côtés : c'est là que vivaient les deux cascades.
  // (Ailleurs, `userData.type` reste un tag d'exécution posé par les composants — il est lu
  //  par les systèmes historiques, et ce n'est pas le sujet de cette garde.)
  [['js/serialization.js', 'function rebuildTree', 'function fileInB64'],
   ['js/game-runtime.js', 'function buildList', '// ---------- environnement']].forEach(
    ([f, debut, fin]) => {
      const src = read(f);
      const corps = src.slice(src.indexOf(debut), src.indexOf(fin));
      assert.ok(corps.includes('nodeOfComponents(d,'), f + ' : ne passe pas par le constructeur partage');
      const code = corps.split(String.fromCharCode(10))
        .filter((x) => !x.trim().startsWith("//")).join(String.fromCharCode(10));
      assert.equal(/=== .(mesh|point|terrain|probe|subScene|sousScene)./.test(code), false,
        f + ' : une cascade sur le type de noeud subsiste dans la reconstruction');
    });
});

test('les PORTEURS sont declares des deux cotes, et ils different', () => {
  // Le seul point où les deux environnements divergent, et il est déclaré : l'éditeur donne à
  // une lumière son repère visible et à une caméra son boîtier, le jeu publié n'embarque ni
  // l'un ni l'autre. Un porteur oublié côté jeu, c'est un objet qui manque après export.
  const editeur = ['js/objects.js', 'js/terrain.js', 'js/particles.js', 'js/probes.js',
                   'js/subscenes.js'].map(read).join('\n');
  const manques = [];
  ['Mesh', 'Light', 'Camera', 'Terrain', 'Particles', 'Reflection', 'SubScene', 'Model']
    .forEach((t) => {
      if(!editeur.includes("NodeShells.register('" + t + "'")) manques.push('editeur : ' + t);
    });
  // Le jeu publié n'en déclare que trois : tout le reste se contente d'un Object3D nu, que le
  // composant équipe lui-même (Light y accroche sa THREE.Light, Camera sa THREE.Camera).
  const runtime = read('js/game-runtime.js');
  ['Mesh', 'Terrain', 'Model'].forEach((t) => {
    if(!runtime.includes("NodeShells.register('" + t + "'")) manques.push('jeu publie : ' + t);
  });
  assert.deepEqual(manques, []);
});

// ---------------------------------------------------------------------------------------
// TOUT CHAMP DE NŒUD ÉCRIT DANS LE FICHIER EST RELU PAR LES DEUX MOTEURS.
//
// La classe de défaut la plus coûteuse du dépôt, et la moins visible : un champ que
// `serializeObject` écrit, que `rebuildTree` relit, et que `buildList` oublie. L'utilisateur
// règle quelque chose, le voit tenir dans l'éditeur, sauvegarde, rouvre — tout va bien. Puis
// il publie, et le réglage n'est plus là. Aucune exception, aucun avertissement, et la boucle
// de correction est la plus lente de toutes.
//
// Trois cas mesurés le 2026-09-22 (docs/REVUE_2026-09-22.md § 8.3), tous silencieux depuis
// plusieurs versions :
//   · `ombreProjetee` / `ombreRecue` — un objet décoché « projette une ombre » en projetait
//     quand même une dans le jeu publié, la construction les mettant à `true` par défaut.
//   · `detail` — js/render-perf.js est EMBARQUÉ dans le build et lit `userData.detail`, mais
//     le sac n'était jamais reposé : le LOD tournait à vide, sur zéro objet.
//   · `lightmapAtlas` — toujours ouvert, voir la liste ci-dessous.
//
// Ce test ne compare pas les corps des deux fonctions (ils divergent légitimement partout) :
// il compare les CHAMPS LUS, qui sont la promesse réellement faite au fichier de projet.
// (La première version de cette liste y mettait `id`. L'assertion des exceptions périmées,
//  en bas, l'a immédiatement refusé : le jeu relit bien `d.id`. C'est exactement son rôle.)
const CHAMPS_NON_RELUS_PAR_LE_JEU = {
  prefabId: 'lien d\'instance vers un asset prefab. Notion D\'ÉDITEUR seule (js/prefabs.js, '
    + 'js/analysis.js, js/prefab-library.js — aucun embarqué dans un build) : un jeu publié '
    + 'reçoit des instances déjà cuites, il n\'a rien à re-lier.',
  // `lightmapAtlas` a figuré ici, comme DÉFAUT OUVERT, entre la v0.149.2 et la v0.149.3 :
  // reapplyAtlasLightmap() ne vivait que dans js/lightmap-bake.js, qui importe douze modules
  // d'éditeur et ne peut pas être embarqué. Le champ était écrit dans chaque fichier de projet
  // et inapplicable côté jeu. Corrigé en extrayant la fonction dans js/lightmap-atlas.js, un
  // module partagé sans aucun import — l'entrée a donc disparu de cette liste, et c'est
  // l'assertion des exceptions périmées, en bas, qui l'a exigé.
};

test('tout champ de noeud ecrit dans le fichier est relu par LES DEUX moteurs', () => {
  const ser = read('js/serialization.js');
  const ecrits = ser.slice(ser.indexOf('function serializeObject'), ser.indexOf('function serializeTree'))
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .map((l) => (l.match(/^\s{4}([a-zA-Z0-9_]+)\s*:/) || [])[1])
    .filter(Boolean);
  assert.ok(ecrits.length >= 10,
    'moins de 10 champs lus dans serializeObject — le motif de lecture est cassé et cette '
    + 'garde ne mesure plus rien (' + ecrits.join(', ') + ')');

  const relu = (src, champ) => new RegExp('\\bd\\.' + champ + '\\b').test(src);
  const runtime = read('js/game-runtime.js');

  const oublies = [];
  ecrits.forEach((champ) => {
    // `components` est reconstruit par nodeOfComponents des deux côtés, et `parent` sert au
    // rattachement, pas à un réglage : ni l'un ni l'autre ne se lit en `d.<champ>`.
    if(champ === 'components' || champ === 'parent') return;
    if(!relu(ser, champ)) return;            // pas relu par l'éditeur non plus : hors sujet ici
    if(relu(runtime, champ)) return;         // relu des deux côtés : rien à dire
    if(CHAMPS_NON_RELUS_PAR_LE_JEU[champ]) return;
    oublies.push(champ);
  });

  assert.deepEqual(oublies, [],
    'champ(s) ÉCRITS dans le fichier de projet et relus par l\'éditeur, mais JAMAIS par le jeu '
    + 'publié. Le réglage tient dans l\'éditeur et disparaît après publication, sans un mot. '
    + 'Relisez-le dans buildList (js/game-runtime.js), ou déclarez-le dans '
    + 'CHAMPS_NON_RELUS_PAR_LE_JEU AVEC SA RAISON :\n  ' + oublies.join('\n  '));

  // Et le sens inverse : une exception qui n'a plus lieu d'être doit disparaître, sinon la
  // liste devient le tapis sous lequel on glisse les oublis suivants.
  const perimees = Object.keys(CHAMPS_NON_RELUS_PAR_LE_JEU)
    .filter((c) => ecrits.includes(c) && relu(runtime, c));
  assert.deepEqual(perimees, [],
    'ces champs sont déclarés « non relus par le jeu » alors que le jeu les relit : retirez-les '
    + 'de CHAMPS_NON_RELUS_PAR_LE_JEU.\n  ' + perimees.join('\n  '));
});

test('le format de projet ne stocke plus le type d un noeud', () => {
  // Ce que le nœud EST se lit dans ses composants. Le champ `type` ne survit que pour les types
  // apportés par un PLUGIN (API publique registerTypeObject, js/plugins.js), qui n'ont pas de
  // composant à nommer.
  const s = read('js/serialization.js');
  const corps = s.slice(s.indexOf('function serializeObject'), s.indexOf('function serializeTree'));
  assert.equal(/^\s*(id: o\.id,)?\s*type: t,/m.test(corps), false,
    'serializeObject ecrit encore le type de chaque noeud');
  assert.ok(corps.includes('components:'), 'serializeObject n ecrit pas les composants');
});
