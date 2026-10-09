// La table déclarative est devenue la source unique : l'inspecteur en est le rendu, le
// lecteur de formulaire l'inverse, le copilote la lit. Ce qui doit être verrouillé, c'est
// donc l'ACCORD entre ces trois-là — une table qui décrirait un éditeur légèrement
// différent de celui qu'on a serait pire que les `if` qu'elle remplace.
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
    await page.waitForFunction('typeof renderPropsMaterial === "function"', { timeout: 30000 });
    return await travail(page);
  } finally {
    await contexte.close();
  }
}

test('la table couvre toutes les proprietes reelles du materiau', async () => {
  const res = await dansEditeur((page) => page.evaluate(() => {
    const decrites = PROPS_MATERIAL.filter((d) => d.key).map((d) => d.key);
    const reelles = Object.keys(MATERIAL_DEFAULT);
    return {
      oubliees: reelles.filter((k) => decrites.indexOf(k) === -1),
      inventees: decrites.filter((k) => reelles.indexOf(k) === -1),
      doublons: decrites.filter((k, i) => decrites.indexOf(k) !== i)
    };
  }));

  assert.deepEqual(res.oubliees, [],
    'une propriété du matériau absente de la table serait invisible dans l’inspecteur ET du copilote');
  assert.deepEqual(res.inventees, [],
    'une entrée de table sans propriété correspondante décrirait un champ qui n’existe pas');
  assert.deepEqual(res.doublons, []);
});

test('les dependances decident de l affichage : grisee ou masquee', async () => {
  const res = await dansEditeur((page) => page.evaluate(() => {
    const a = createAssetMaterial();
    const p = ensurePropsMaterial(a);
    const vu = (html, id) => html.indexOf('id="' + id + '"') !== -1;
    const grise = (html, id) => {
      const i = html.indexOf('id="' + id + '"');
      return i !== -1 && html.slice(i, i + 220).indexOf('disabled') !== -1;
    };

    const sans = renderPropsMaterial(p);
    p.normalAsset = 42;
    p.combinedAsset = 43;
    p.heightAsset = 44;
    const avec = renderPropsMaterial(p);

    return {
      // « grise » : visible sans sa carte, mais inert — on doit VOIR que ça existe
      intNormaleVisibleSansMap: vu(sans, 'ip-mnormint'),
      intNormaleGriseeSansMap: grise(sans, 'ip-mnormint'),
      intNormaleActiveAvecMap: vu(avec, 'ip-mnormint') && !grise(avec, 'ip-mnormint'),
      // « masque » : rien à afficher tant que la carte n'est pas là
      directXAbsentSansMap: !vu(sans, 'ip-mnormdx'),
      directXPresentAvecMap: vu(avec, 'ip-mnormdx'),
      packAbsentSansMasque: !vu(sans, 'ip-mpack'),
      packPresentAvecMasque: vu(avec, 'ip-mpack'),
      modeHauteurAbsent: !vu(sans, 'ip-mhmode'),
      modeHauteurPresent: vu(avec, 'ip-mhmode'),
      // l'occlusion accepte DEUX sources : le masque combiné suffit
      intAoActiveParLeMasque: vu(avec, 'ip-maoint') && !grise(avec, 'ip-maoint')
    };
  }));

  assert.equal(res.intNormaleVisibleSansMap, true);
  assert.equal(res.intNormaleGriseeSansMap, true, 'sans carte de normales, le champ est inert');
  assert.equal(res.intNormaleActiveAvecMap, true);
  assert.equal(res.directXAbsentSansMap, true, 'la case DirectX n’a aucun sens sans carte');
  assert.equal(res.directXPresentAvecMap, true);
  assert.equal(res.packAbsentSansMasque, true);
  assert.equal(res.packPresentAvecMasque, true);
  assert.equal(res.modeHauteurAbsent, true);
  assert.equal(res.modeHauteurPresent, true);
  assert.equal(res.intAoActiveParLeMasque, true,
    'aoIntensite requiert le masque OU l’occlusion séparée : le masque seul doit suffire');
});

test('la validation refuse en expliquant, plutot que d accepter en silence', async () => {
  const res = await dansEditeur((page) => page.evaluate(() => ({
    horsPlage: validatePropMaterial('smoothing', 12, {}),
    bonne: validatePropMaterial('smoothing', 0.4, {}),
    inconnue: validatePropMaterial('brillance', 1, {}),
    mauvaisChoix: validatePropMaterial('combinedPacking', 'urp', {}),
    bonChoix: validatePropMaterial('combinedPacking', 'orm', {}),
    couleurInvalide: validatePropMaterial('color', 'rouge', {}),
    // écrire une propriété sans sa carte : accepté, mais on le DIT
    sansEffet: validatePropMaterial('normalIntensite', 2, {})
  })));

  assert.equal(res.horsPlage.ok, false);
  assert.match(res.horsPlage.message, /0 à 1/, 'le refus doit donner la plage, pas juste refuser');
  assert.equal(res.bonne.ok, true);
  assert.equal(res.bonne.value, 0.4);
  assert.equal(res.inconnue.ok, false);
  assert.equal(res.mauvaisChoix.ok, false);
  assert.match(res.mauvaisChoix.message, /orm ou unity/);
  assert.equal(res.bonChoix.ok, true);
  assert.equal(res.couleurInvalide.ok, false);
  assert.equal(res.sansEffet.ok, true, 'écrire à l’avance est permis');
  assert.match(res.sansEffet.message, /sans effet/,
    'mais il faut le dire, sinon le modèle croit avoir agi');
});

test('le copilote recoit la meme description que l inspecteur', async () => {
  const res = await dansEditeur((page) => page.evaluate(() => {
    const decrit = JSON.parse(COMMANDS.find((c) => c.name === 'describe_material').exec());
    const liss = decrit.properties.find((x) => x.property === 'smoothing');
    const dx = decrit.properties.find((x) => x.property === 'normalDirectX');
    const pack = decrit.properties.find((x) => x.property === 'combinedPacking');
    return {
      nb: decrit.properties.length,
      nbTable: PROPS_MATERIAL.filter((d) => d.key).length,
      lissMin: liss && liss.min, lissMax: liss && liss.max,
      dxRequiert: dx && dx.requires, dxSiAbsent: dx && dx.ifMissing,
      packValeurs: pack && pack.values,
      // aucune fonction ni HTML de mise en page ne doit fuir vers le modèle
      propre: JSON.stringify(decrit).indexOf('function') === -1
    };
  }));

  assert.equal(res.nb, res.nbTable, 'le copilote voit exactement les propriétés de la table');
  assert.equal(res.lissMin, 0);
  assert.equal(res.lissMax, 1);
  assert.deepEqual(res.dxRequiert, ['normalAsset']);
  assert.equal(res.dxSiAbsent, 'sans objet');
  assert.deepEqual(res.packValeurs, ['orm', 'unity']);
  assert.equal(res.propre, true, 'le modèle reçoit des RÈGLES, pas de la mise en page');
});
