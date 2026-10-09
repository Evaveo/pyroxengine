import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/environment.js', 'js/component-registry.js', 'js/component.js', 'js/assets.js', 'js/model-import.js', 'js/import-settings.js',
  'js/post-profile.js', 'js/components/component-postvolume.js']);

function noeudFactice(){
  return { userData: {} };
}

test('valeurs par défaut à la création : global, forme box, aucun profil', () => {
  const c = new env.PostVolume(noeudFactice(), {});
  assert.equal(c.data.global, true);
  assert.equal(c.data.shape, 'box');
  assert.equal(c.data.profileId, null);
  assert.equal(c.data.priority, 0);
});

test('serialize() rend les données telles quelles, hydrate() les relit à l identique', () => {
  const c = new env.PostVolume(noeudFactice(), {});
  c.data.global = false;
  c.data.shape = 'sphere';
  c.data.radius = 4;
  c.data.priority = 7;
  const serialise = c.serialize();

  const c2 = new env.PostVolume(noeudFactice(), {});
  c2.hydrate(serialise);
  assert.equal(c2.data.global, false);
  assert.equal(c2.data.shape, 'sphere');
  assert.equal(c2.data.radius, 4);
  assert.equal(c2.data.priority, 7);
});

test('get profile() rend l asset référencé, ou null si profileId est vide/introuvable', () => {
  const a = env.createAssetPostProfile();
  const c = new env.PostVolume(noeudFactice(), {profileId: a.id});
  assert.equal(c.profile.id, a.id);

  const cVide = new env.PostVolume(noeudFactice(), {profileId: null});
  assert.equal(cVide.profile, null);

  const cSupprime = new env.PostVolume(noeudFactice(), {profileId: 'inexistant'});
  assert.equal(cSupprime.profile, null, 'un asset supprimé du disque ne doit pas planter');
});

test('size partiel au constructeur : x fourni, y/z retombent sur leur défaut (10)', () => {
  const c = new env.PostVolume(noeudFactice(), {size: {x: 5}});
  assert.equal(c.data.size.x, 5);
  assert.equal(c.data.size.y, 10);
  assert.equal(c.data.size.z, 10);
});

test('size partiel via hydrate() : x fourni, y/z retombent sur leur défaut (10)', () => {
  const c = new env.PostVolume(noeudFactice(), {});
  c.hydrate({size: {x: 5}});
  assert.equal(c.data.size.x, 5);
  assert.equal(c.data.size.y, 10);
  assert.equal(c.data.size.z, 10);
});

test('typeName et category sont déclarés, et le composant est enregistré dans le Registry', () => {
  assert.equal(env.PostVolume.typeName, 'PostVolume');
  assert.equal(env.Registry.classByType('PostVolume'), env.PostVolume);
});

test('onAdd sur le premier PostVolume global d une scène active pré-remplit un profil depuis env.post', () => {
  env.env.post = {active: true, toneMapping: 'cineon', exposition: 1.2, bloom: true,
    bloomThreshold: 0.6, bloomIntensity: 0.9, bloomRadius: 1.5, contraste: 1.1, saturation: 0.9,
    temperature: 0.1, vignette: 0.4, grain: 0.05, fxaa: true};
  env.Registry.clear();
  const nb = env.assets.length;

  const c = new env.PostVolume(noeudFactice(), {global: true});
  c.onAdd();

  assert.equal(env.assets.length, nb + 1, 'un profil doit avoir été créé');
  assert.ok(c.data.profileId, 'le volume doit référencer le profil créé');
  const p = c.profile;
  assert.equal(p.effects.toneMapping.overridden, true);
  assert.equal(p.effects.toneMapping.mode, 'cineon');
  assert.equal(p.effects.vignette.overridden, true);
  assert.equal(p.effects.vignette.amount, 0.4);
  assert.equal(p.effects.bloom.overridden, true);
  assert.equal(p.effects.bloom.intensity, 0.9);
  assert.equal(p.effects.colorGrading.overridden, true);
  assert.equal(p.effects.colorGrading.exposure, 1.2, 'env.post.exposition doit se reporter dans colorGrading.exposure');
});

test('onAdd ne pré-remplit rien si env.post.active est déjà false', () => {
  env.env.post = {active: false};
  env.Registry.clear();
  const nb = env.assets.length;
  const c = new env.PostVolume(noeudFactice(), {global: true});
  c.onAdd();
  assert.equal(env.assets.length, nb, 'rien à migrer, aucun profil créé');
  assert.equal(c.data.profileId, null);
});

test('onAdd ne pré-remplit rien si un PostVolume est déjà présent dans la scène', () => {
  env.env.post = {active: true, vignette: 0.4};
  env.Registry.clear();
  const existant = new env.PostVolume(noeudFactice(), {global: true, profileId: 'a-deja-la'});
  env.addSceneObject(existant.node);   // le noeud doit appartenir à la scène pour compter comme actif
  env.Registry.register(existant);   // simule un volume déjà indexé dans la scène

  const nb = env.assets.length;
  const c = new env.PostVolume(noeudFactice(), {global: true});
  c.onAdd();
  assert.equal(env.assets.length, nb, 'un volume existe déjà : pas de deuxième pré-remplissage');
  assert.equal(c.data.profileId, null);
});

test('onAdd pré-remplit quand même si le seul PostVolume existant n est pas vivant dans la scène (registered mais pas addSceneObject)', () => {
  env.env.post = {active: true, vignette: 0.4};
  env.Registry.clear();
  const existant = new env.PostVolume(noeudFactice(), {global: true, profileId: 'a-deja-la'});
  env.Registry.register(existant);   // indexé dans le Registry, mais jamais ajouté à la scène (préfab/template/détaché)

  const nb = env.assets.length;
  const c = new env.PostVolume(noeudFactice(), {global: true});
  c.onAdd();
  assert.equal(env.assets.length, nb + 1, 'le seul PostVolume existant n est pas vivant dans la scène : le pré-remplissage doit avoir lieu');
  assert.ok(c.data.profileId, 'le volume doit référencer le profil créé');
});

// ---- Le jeu publié n'a pas `assets`, il a `assetsById` ----
// Sans cette résolution, PostVolume.profile rendait TOUJOURS null dans le jeu publié : aucun
// profil ne s'y appliquait jamais, en silence (aucune erreur, juste une image inchangée).
test('get profile() résout aussi via assetsById (runtime publié, sans tableau assets)', () => {
  const envJeu = creerContexte(['js/component-registry.js', 'js/component.js', 'js/post-profile.js',
                                'js/components/component-postvolume.js']);
  envJeu.assets = undefined;   // le runtime publié n'a pas cet tableau : seulement assetsById
  envJeu.assetsById = {a7: {kind: 'postProfile', name: 'Profil 1',
                            effects: envJeu.ensurePostProfileDefaults({})}};
  const c = new envJeu.PostVolume(noeudFactice(), {profileId: 'a7'});
  assert.ok(c.profile, 'le profil du jeu publié doit être trouvé');
  assert.equal(c.profile.name, 'Profil 1');
  assert.equal(new envJeu.PostVolume(noeudFactice(), {profileId: 'a9'}).profile, null);
});
