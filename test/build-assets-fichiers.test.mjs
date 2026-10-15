// LES ASSETS D'UN BUILD EN FICHIERS SÉPARÉS (js/build.js, externalizeAssets, v1.17.0).
// Avant : chaque fichier en data URL base64 dans data.js — un tiers plus lourd, tout téléchargé au
// lancement, et le texte gardé en mémoire toute la partie à côté de la forme décodée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { creerContexte } from './engine-env.mjs';

const ctx = creerContexte(['js/build.js']);
ctx.atob = globalThis.atob;   // fourni par le navigateur, absent du bac à sable vm
const durl = (mime, txt) => 'data:' + mime + ';base64,' + Buffer.from(txt).toString('base64');

test('chaque fichier sort en assets/<empreinte>.<ext>, data.js ne garde que le chemin', async () => {
  const data = {
    assets: [
      {kind: 'texture', files: [{name: 'herbe.PNG', b64: durl('image/png', 'pixels')}]},
      {kind: 'audio', files: [{name: 'theme.ogg', b64: durl('audio/ogg', 'musique')}]},
      {kind: 'texture', files: [{name: 'copie.png', b64: durl('image/png', 'pixels')}]}
    ],
    fonts: [{name: 'titre.woff2', b64: durl('font/woff2', 'police')}],
    deja: {name: 'x.png', b64: 'assets/abc.png'}
  };
  const out = await ctx.externalizeAssets(data);
  const tex = data.assets[0].files[0].b64;
  assert.match(tex, /^assets\/[0-9a-f]{16,20}\.png$/);
  assert.match(data.assets[1].files[0].b64, /\.ogg$/);
  assert.match(data.fonts[0].b64, /\.woff2$/);
  assert.equal(data.assets[2].files[0].b64, tex, 'même contenu = même fichier');
  assert.equal(Object.keys(out).length, 3);
  assert.equal(Buffer.from(out[tex]).toString(), 'pixels');
  assert.equal(data.deja.b64, 'assets/abc.png', 'un chemin déjà externe est laissé tel quel');
  assert.ok(!JSON.stringify(data).includes('base64,'), 'plus aucune data URL dans data.js');
});

test('extension par liste fermée : un nom hostile ne fait pas servir du HTML', () => {
  assert.equal(ctx.assetExtension('piege.html'), 'bin');
  assert.equal(ctx.assetExtension('modele.GLB'), 'glb');
  assert.equal(ctx.assetExtension('sans-extension'), 'bin');
});

test('assembleBuild externalise APRÈS décodeurs et allègement, et met les fichiers dans le ZIP', () => {
  const src = readFileSync(new URL('../js/build.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export async function assembleBuild'));
  assert.ok(body.indexOf('decodersNeeded(data)') < body.indexOf('externalizeAssets(data)'));
  assert.ok(body.indexOf('trimmingBuild(data)') < body.indexOf('externalizeAssets(data)'));
  assert.ok(body.indexOf('externalizeAssets(data)') < body.indexOf("'data.js'"));
  assert.match(body, /files\[k\] = assetFiles\[k\]/);
});

test('le runtime lit un chemin comme une data URL (fetch), avec nouvelles tentatives', () => {
  const rt = readFileSync(new URL('../js/game-runtime.js', import.meta.url), 'utf8');
  const f = rt.slice(rt.indexOf('function b64InBlob'), rt.indexOf('function b64InBlob') + 900);
  assert.match(f, /fetch\(src\)/);
  assert.match(f, /RETRY_ATTEMPTS/);
});
