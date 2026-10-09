// Machine a etats du verrou de scene. Aucune E/S : l api est injectee.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  claimIfNeeded, heartbeat, initSceneLock, lockBlocks, lockMessage, lockState, releaseLock,
  sceneLock, stopHeartbeat, switchScene
} from '../js/scene-lock.js';

function cloudQui(reponse){
  const appels = [];
  return {
    appels,
    cloud: {
      id: 7,
      api: {
        takeLock: async (id, scene) => { appels.push(['take', id, scene]); return reponse(); },
        releaseLock: async (id, scene) => { appels.push(['release', id, scene]); }
      }
    }
  };
}

test("hors projet heberge, le module dort et n empeche rien", () => {
  initSceneLock(null, null);
  assert.equal(lockState(), 'editable');
  assert.equal(lockBlocks(), false);
  assert.ok(!claimIfNeeded(), 'aucune demande ne part sans projet heberge');
});

test("le premier geste passe en `unknown` : on ne bloque pas en attendant le reseau", () => {
  const { cloud } = cloudQui(() => ({ ok: true, expire_le: 1 }));
  initSceneLock(cloud, 'Ville');
  assert.equal(lockState(), 'unknown');
  assert.equal(lockBlocks(), false,
    "bloquer avant d avoir demande gelerait l editeur a chaque ouverture");
  stopHeartbeat();
});

test("verrou accorde : on edite, et un seul appel part meme si on demande deux fois", async () => {
  const { cloud, appels } = cloudQui(() => ({ ok: true, expire_le: 42 }));
  initSceneLock(cloud, 'Ville');
  const a = claimIfNeeded();
  const b = claimIfNeeded();
  assert.equal(a, b, 'la demande en cours est partagee, pas relancee');
  await a;
  assert.equal(sceneLock.state, 'mine');
  assert.equal(lockState(), 'editable');
  assert.equal(appels.filter((x) => x[0] === 'take').length, 1);
  stopHeartbeat();
});

test("verrou refuse : lecture seule, et le message NOMME le detenteur", async () => {
  const { cloud } = cloudQui(() => ({ ok: false, email: 'remi@evaveo.com' }));
  initSceneLock(cloud, 'Ville');
  await claimIfNeeded();
  assert.equal(sceneLock.state, 'other');
  assert.equal(lockBlocks(), true);
  assert.match(lockMessage(), /remi@evaveo\.com/);
  assert.match(lockMessage(), /Ville/);
});

test("une demande qui ECHOUE n est pas un refus : on reste en unknown", async () => {
  const { cloud } = cloudQui(() => { throw new Error('reseau coupe'); });
  initSceneLock(cloud, 'Ville');
  await claimIfNeeded();
  assert.equal(sceneLock.state, 'unknown',
    "sans reponse on ne sait pas qui tient la scene — bloquer sur une coupure serait pire");
  assert.equal(lockBlocks(), false);
});

test("deux echecs de battement sont tolerés, le troisieme fait perdre le verrou", async () => {
  let ok = true;
  const { cloud } = cloudQui(() => { if(!ok) throw new Error('coupure'); return { ok: true, expire_le: 1 }; });
  initSceneLock(cloud, 'Ville');
  await claimIfNeeded();
  stopHeartbeat();
  assert.equal(sceneLock.state, 'mine');

  ok = false;
  await heartbeat(); assert.equal(sceneLock.state, 'mine', '1er echec : le bail vaut trois battements');
  await heartbeat(); assert.equal(sceneLock.state, 'mine', '2e echec : encore dans le bail');
  await heartbeat();
  assert.equal(sceneLock.state, 'lost', '3e echec : le serveur a pu donner la scene a un autre');
  assert.equal(lockBlocks(), true);
  assert.match(lockMessage(), /pas perdu/, "le message doit rassurer : rien n est jete");
});

test("le verrou repris par un autre pendant le battement bascule en lecture seule", async () => {
  let premier = true;
  const { cloud } = cloudQui(() => {
    if(premier){ premier = false; return { ok: true, expire_le: 1 }; }
    return { ok: false, email: 'seb@evaveo.com' };
  });
  initSceneLock(cloud, 'Ville');
  await claimIfNeeded();
  stopHeartbeat();
  await heartbeat();
  assert.equal(sceneLock.state, 'other');
  assert.match(lockMessage(), /seb@evaveo\.com/);
});

test("changer de scene LIBERE la precedente : on ne tient qu un verrou", async () => {
  const { cloud, appels } = cloudQui(() => ({ ok: true, expire_le: 1 }));
  initSceneLock(cloud, 'Ville');
  await claimIfNeeded();
  stopHeartbeat();
  await switchScene('Menu');
  assert.deepStrictEqual(appels.filter((x) => x[0] === 'release'), [['release', 7, 'Ville']]);
  assert.equal(sceneLock.scene, 'Menu');
  assert.equal(sceneLock.state, 'unknown', 'la nouvelle scene n est pas encore demandee');
});

test("liberer sans detenir ne parle pas au serveur", async () => {
  const { cloud, appels } = cloudQui(() => ({ ok: false }));
  initSceneLock(cloud, 'Ville');
  await releaseLock();
  assert.equal(appels.length, 0);
});


// ---------- Etat visible ----------
// Un message de statut disparait ; l etat du verrou dure. Sans bandeau, on decouvre la lecture
// seule EN ESSAYANT — par un refus, donc au pire moment.
import { updateBannerCloud } from '../js/scene-lock.js';

function bacDom(){
  const el = { style: {}, innerHTML: '' };
  globalThis.document = { getElementById: (id) => (id === 'banner-cloud' ? el : null) };
  return el;
}

test("le bandeau NOMME le detenteur des que le verrou est refuse", async () => {
  const el = bacDom();
  const { cloud } = cloudQui(() => ({ ok: false, email: 'remi@evaveo.com' }));
  initSceneLock(cloud, 'Ville');
  await claimIfNeeded();
  assert.equal(el.style.display, 'flex');
  assert.match(el.innerHTML, /Lecture seule/);
  assert.match(el.innerHTML, /remi@evaveo\.com/);
  delete globalThis.document;
});

test("le bandeau dit qu on edite quand le verrou est a nous", async () => {
  const el = bacDom();
  const { cloud } = cloudQui(() => ({ ok: true, expire_le: 1 }));
  initSceneLock(cloud, 'Ville');
  await claimIfNeeded();
  stopHeartbeat();
  assert.match(el.innerHTML, /vous éditez/);
  assert.match(el.innerHTML, /Ville/);
  delete globalThis.document;
});

test("hors projet heberge, aucun bandeau", () => {
  const el = bacDom();
  initSceneLock(null, null);
  assert.equal(el.style.display, 'none');
  delete globalThis.document;
});
