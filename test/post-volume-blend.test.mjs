import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/post-volume-blend.js']);
const { blendPostVolumes } = env;

function profil(overrides){
  return Object.assign({
    bloom: {overridden:false, threshold:0.8, intensity:0.7, radius:1},
    vignette: {overridden:false, amount:0.25},
    grain: {overridden:false, amount:0},
    toneMapping: {overridden:false, mode:'aces'},
    colorGrading: {overridden:false, contrast:1, saturation:1, temperature:0, exposure:1}
  }, overrides);
}

test('aucun volume : rien à mélanger, rendu null', () => {
  const r = blendPostVolumes([], {x:0, y:0, z:0});
  assert.equal(r, null);
});

test('un seul volume global, tout overridden : ses valeurs passent telles quelles', () => {
  const volumes = [{
    global: true, priority: 0, effects: profil({
      vignette: {overridden:true, amount:0.6}
    })
  }];
  const r = blendPostVolumes(volumes, {x:0, y:0, z:0});
  assert.ok(r, 'un volume actif doit produire un état');
  assert.equal(r.vignette.amount, 0.6);
});

test('champ non overridden : reste à sa valeur neutre de départ, pas celle du volume', () => {
  const volumes = [{
    global: true, priority: 0, effects: profil({
      bloom: {overridden:false, threshold:0.1, intensity:5, radius:9}
    })
  }];
  const r = blendPostVolumes(volumes, {x:0, y:0, z:0});
  assert.equal(r, null, 'aucun champ overridden nulle part : rien à appliquer, pipeline sauté');
});

test('volume local hors de portée : poids 0, aucun effet', () => {
  const volumes = [{
    global: false, priority: 0, shape: 'sphere', radius: 2, blendDistance: 1,
    position: {x:0, y:0, z:0},
    effects: profil({vignette: {overridden:true, amount:0.9}})
  }];
  const r = blendPostVolumes(volumes, {x:10, y:0, z:0});
  assert.equal(r, null);
});

test('volume local dans la zone : poids plein, valeur exacte', () => {
  const volumes = [{
    global: false, priority: 0, shape: 'sphere', radius: 2, blendDistance: 1,
    position: {x:0, y:0, z:0},
    effects: profil({vignette: {overridden:true, amount:0.9}})
  }];
  const r = blendPostVolumes(volumes, {x:0, y:0, z:0});
  assert.ok(r);
  assert.equal(r.vignette.amount, 0.9);
});

test('volume local dans la bande de blend : poids intermédiaire, valeur interpolée', () => {
  const volumes = [{
    global: false, priority: 0, shape: 'sphere', radius: 2, blendDistance: 2,
    position: {x:0, y:0, z:0},
    effects: profil({vignette: {overridden:true, amount:0.65}})
  }];
  const r = blendPostVolumes(volumes, {x:3, y:0, z:0});
  assert.ok(r);
  assert.ok(r.vignette.amount > 0.25 && r.vignette.amount < 0.65,
    'poids intermédiaire attendu, ni la valeur de depart ni celle du volume');
});

test('priorité : le volume de plus haute priorité domine, traité en dernier', () => {
  const volumes = [
    {global: true, priority: 0, effects: profil({vignette: {overridden:true, amount:0.2}})},
    {global: true, priority: 5, effects: profil({vignette: {overridden:true, amount:0.8}})}
  ];
  const r = blendPostVolumes(volumes, {x:0, y:0, z:0});
  assert.equal(r.vignette.amount, 0.8, 'priorité 5 doit dominer, quel que soit l ordre du tableau');
});

test('profil vide (aucun champ overridden) ne contribue rien, ne casse pas le mélange des autres', () => {
  const volumes = [
    {global: true, priority: 0, effects: profil()},
    {global: true, priority: 1, effects: profil({grain: {overridden:true, amount:0.4}})}
  ];
  const r = blendPostVolumes(volumes, {x:0, y:0, z:0});
  assert.ok(r);
  assert.equal(r.grain.amount, 0.4);
});

test('colorGrading.exposure se mélange comme un champ numérique (lerp)', () => {
  const volumes = [{
    global: false, priority: 0, shape: 'sphere', radius: 2, blendDistance: 2,
    position: {x:0, y:0, z:0},
    effects: profil({colorGrading: {overridden:true, contrast:1, saturation:1, temperature:0, exposure:1.8}})
  }];
  const r = blendPostVolumes(volumes, {x:3, y:0, z:0});
  assert.ok(r);
  assert.ok(r.colorGrading.exposure > 1 && r.colorGrading.exposure < 1.8,
    'poids intermédiaire attendu, valeur interpolée entre la neutre (1) et celle du volume (1.8)');
});

test('volume sans effects (profil introuvable côté appelant) est ignoré sans planter', () => {
  const volumes = [
    {global: true, priority: 0, effects: null},
    {global: true, priority: 1, effects: profil({grain: {overridden:true, amount:0.7}})}
  ];
  const r = blendPostVolumes(volumes, {x:0, y:0, z:0});
  assert.ok(r);
  assert.equal(r.grain.amount, 0.7);
});

// ---- Le neutre est VRAIMENT neutre ----
// Le bug historique : le neutre valait les mêmes chiffres que les défauts d'un profil
// (bloom 0,7 / vignette 0,25 / ACES). Activer ou désactiver un effet laissé à ses valeurs
// par défaut ne changeait donc RIEN à l'écran, et un profil qui ne touchait que la
// gradation imposait quand même un bloom que personne n'avait demandé.
test('un effet non overridden ne produit AUCUN effet (neutre = image brute)', () => {
  const r = blendPostVolumes([{global:true, priority:0,
    effects: profil({colorGrading:{overridden:true, contrast:1.5, saturation:1, temperature:0, exposure:1}})}],
    {x:0, y:0, z:0});
  assert.equal(r.bloom.intensity, 0, 'un bloom non demandé ne doit pas apparaître');
  assert.equal(r.vignette.amount, 0);
  assert.equal(r.grain.amount, 0);
  assert.equal(r.toneMapping.mode, 'none');
  assert.equal(r.colorGrading.contrast, 1.5);
});

test('activer le bloom d un profil aux valeurs par défaut CHANGE le résultat', () => {
  const eteint = blendPostVolumes([{global:true,
    effects: profil({vignette:{overridden:true, amount:0.5}})}], {x:0, y:0, z:0});
  const allume = blendPostVolumes([{global:true,
    effects: profil({vignette:{overridden:true, amount:0.5},
                     bloom:{overridden:true, threshold:0.8, intensity:0.7, radius:1}})}],
    {x:0, y:0, z:0});
  assert.notEqual(eteint.bloom.intensity, allume.bloom.intensity);
  assert.equal(allume.bloom.intensity, 0.7);
});
