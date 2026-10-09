// Le regroupement en InstancedMesh est AUTOMATIQUE : personne ne l'a demandé, donc
// personne ne le surveille. Ce qui compte n'est pas qu'il aille vite — c'est qu'il ne
// change RIEN à ce qu'on voit, dans les cas où il pourrait le faire :
//   un objet qu'un script déplace, masque ou détruit pendant la partie ;
//   un objet trop loin, écarté par le niveau de détail ;
//   et le retour à l'édition, qui doit tout rendre comme avant.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const editeurUrl = pathToFileURL(path.join(dirname, '..', '..', 'editor.html')).href;

let navigateur = null;
before(async () => {
  navigateur = await chromium.launch({ args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist'] });
});
after(async () => { if (navigateur) await navigateur.close(); });

async function dansEditeur(travail) {
  const contexte = await navigateur.newContext();
  try {
    const page = await contexte.newPage();
    await page.goto(editeurUrl);
    await page.waitForFunction('typeof instantiateStatic === "function"', { timeout: 30000 });
    return await travail(page);
  } finally {
    await contexte.close();
  }
}

// Pose N cubes identiques (même géométrie et même matériau : c'est duplicate_object qui
// le garantit, comme le ferait un utilisateur qui copie-colle son décor).
const POSER_DECOR = `(function(n){
  COMMANDS.find((c) => c.name === 'create_object').exec({type:'cube', name:'Caisse 1', position:{x:0,y:0,z:0}});
  for(let i = 2; i <= n; i++){
    COMMANDS.find((c) => c.name === 'duplicate_object').exec(
      {name:'Caisse 1', new:'Caisse ' + i, position:{x:i*2, y:0, z:0}});
  }
  return objects.filter((o) => /^Caisse /.test(o.name)).length;
})`;

test('le decor identique se regroupe, et un decor trop rare ne se regroupe pas', async () => {
  const res = await dansEditeur((page) => page.evaluate((set) => {
    const n = eval(set)(12);
    const regroupes = instantiateStatic(scene, objects);
    const b = summaryInstances();
    const nbInstanced = scene.children.filter((c) => c.userData.instancesEngine).length;
    undoInstances();

    // La frontière du seuil, des deux côtés : à 8 on regroupe (8 n'est pas < 8), à 7 non.
    // Un seuil qu'on ne teste que d'un côté se décale d'un cran sans que rien ne le dise.
    objects.filter((o) => /^Caisse (9|10|11|12)$/.test(o.name))
      .forEach((o) => COMMANDS.find((c) => c.name === 'delete_object').exec({name:o.name}));
    const auSeuil = instantiateStatic(scene, objects);
    undoInstances();

    COMMANDS.find((c) => c.name === 'delete_object').exec({name:'Caisse 8'});
    const sousLeSeuil = instantiateStatic(scene, objects);
    undoInstances();

    return {n, regroupes, lots: b.lots, economie: b.economie, nbInstanced, auSeuil, sousLeSeuil};
  }, POSER_DECOR));

  assert.equal(res.n, 12, 'les 12 caisses doivent exister');
  assert.equal(res.regroupes, 12, 'les 12 doivent être regroupées');
  assert.equal(res.lots, 1, 'elles partagent géométrie et matériau : un seul lot');
  assert.equal(res.nbInstanced, 1, 'un seul InstancedMesh ajouté à la scène');
  assert.equal(res.economie, 11, '12 objects en 1 appel = 11 appels économisés');
  assert.equal(res.auSeuil, 8, 'à 8 objects on est AU threshold : ça regroupe encore');
  assert.equal(res.sousLeSeuil, 0, 'à 7, le gain ne paie plus la gestion du lot');
});

test('un objet deplace, masque ou detruit reste juste', async () => {
  const res = await dansEditeur((page) => page.evaluate((set) => {
    eval(set)(12);
    instantiateStatic(scene, objects);
    const lot = engineInstances.lots[0];
    const read = (i) => { const m = new THREE.Matrix4(); lot.mesh.getMatrixAt(i, m); return m; };

    // 1. déplacé : la matrice du lot doit suivre
    const bouge = lot.sources[3];
    bouge.position.set(50, 7, 0);
    updateInstances();
    const apresDeplacement = read(3).elements[13];   // composante Y

    // 2. masqué par un script : api.setActive écrit l'INTENTION
    const hidden = lot.sources[4];
    hidden.userData.activeVoulu = false;
    updateInstances();
    const echelleApresMasquage = read(4).elements[0];

    // 3. détruit : retiré de la scène, donc sans parent
    const mort = lot.sources[5];
    mort.parent.remove(mort);
    updateInstances();
    const echelleApresDestruction = read(5).elements[0];

    // 4. intact : ne doit pas avoir bougé
    const echelleIntacte = read(6).elements[0];

    undoInstances();
    return {apresDeplacement, echelleApresMasquage, echelleApresDestruction, echelleIntacte};
  }, POSER_DECOR));

  assert.equal(res.apresDeplacement, 7, 'un objet déplacé par un script doit suivre dans le lot');
  assert.equal(res.echelleApresMasquage, 0,
    'un objet masqué doit disparaître du lot — sinon api.setActive n’a aucun effet sur lui');
  assert.equal(res.echelleApresDestruction, 0,
    'un objet détruit doit disparaître du lot — sinon il reste un fantôme à l’écran');
  assert.equal(res.echelleIntacte, 1, 'les autres ne doivent pas être touchés');
});

test('le niveau de detail fait disparaitre le lointain, dans le lot comme hors du lot', async () => {
  const res = await dansEditeur((page) => page.evaluate((set) => {
    eval(set)(12);
    const cam = objects.find((o) => o.userData.type === 'camera') || camEditor;
    cam.position.set(0, 0, 0);
    cam.updateWorldMatrix(true, false);

    // Caisse 1 est à x=0 (près), Caisse 12 à x=24 (loin). Seuil : 10 m.
    objects.filter((o) => /^Caisse /.test(o.name)).forEach((o) => { o.userData.detail = {distance:10}; });
    collectDetail(objects);

    // hors lot : c'est `visible` qui porte la décision
    updateDetail(cam);
    const pres = objects.find((o) => o.name === 'Caisse 1').visible;
    const loin = objects.find((o) => o.name === 'Caisse 12').visible;

    // dans un lot : c'est la matrice
    instantiateStatic(scene, objects);
    updateDetail(cam);
    updateInstances();
    const lot = engineInstances.lots[0];
    const iLoin = lot.sources.findIndex((o) => o.name === 'Caisse 12');
    const iPres = lot.sources.findIndex((o) => o.name === 'Caisse 1');
    const m = new THREE.Matrix4();
    lot.mesh.getMatrixAt(iLoin, m); const echelleLoin = m.elements[0];
    lot.mesh.getMatrixAt(iPres, m); const echellePres = m.elements[0];

    undoInstances();
    const visibleApresArret = objects.find((o) => o.name === 'Caisse 12').visible;
    return {pres, loin, echelleLoin, echellePres, visibleApresArret};
  }, POSER_DECOR));

  assert.equal(res.pres, true, 'le proche reste visible');
  assert.equal(res.loin, false, 'le lointain disparaît');
  assert.equal(res.echelleLoin, 0, 'et il disparaît AUSSI quand il est dans un lot');
  assert.equal(res.echellePres, 1, 'le proche reste dessiné dans le lot');
  assert.equal(res.visibleApresArret, true,
    'défaire les lots doit tout rendre à l’édition — sinon du décor manque au retour');
});
