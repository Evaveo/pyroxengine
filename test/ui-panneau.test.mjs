import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

function neuf(){
  return creerContexte(['js/ui/registry.js', 'js/ui/form-plan.js', 'js/ui/fields.js',
                        'js/ui/form.js', 'js/ui/panel.js', 'js/history.js']);
}

test('un panneau declare avant boot est construit par boot', () => {
  const env = neuf();
  const host = env.document.createElement('div');
  env.document.body.appendChild(host);
  env.Panels.register({ id: 'p1', title: 'P1', sections: [{ id: 's', fields: [
    { key: 'a', label: 'A', type: 'number' } ]}], targets: () => [{ a: 1 }] });
  assert.equal(env.document.getElementById('f-a'), null, 'rien avant boot');
  env.Panels.boot({ p1: host });
  assert.ok(env.document.getElementById('f-a'), 'construit par boot');
});

test('boot est reentrant : un panneau declare APRES est construit aussi', () => {
  const env = neuf();
  const h1 = env.document.createElement('div');
  const h2 = env.document.createElement('div');
  env.document.body.appendChild(h1);
  env.document.body.appendChild(h2);
  env.Panels.register({ id: 'p1', sections: [{ id: 's', fields: [{ key: 'a', label: 'A', type: 'number' }] }], targets: () => [{ a: 1 }] });
  env.Panels.boot({ p1: h1 });
  // Un plugin s'enregistre apres l'initialisation (startup.js charge les plugins en dernier).
  env.Panels.register({ id: 'p2', sections: [{ id: 's', fields: [{ key: 'b', label: 'B', type: 'number' }] }], targets: () => [{ b: 2 }] });
  env.Panels.boot({ p2: h2 });
  assert.ok(env.document.getElementById('f-b'), 'le panneau tardif doit etre construit');
  assert.ok(env.document.getElementById('f-a'), 'et le premier ne doit pas avoir ete perdu');
});

test('un panneau qui leve est isole : placard d erreur, les autres survivent', () => {
  const env = neuf();
  const h1 = env.document.createElement('div');
  const h2 = env.document.createElement('div');
  env.document.body.appendChild(h1);
  env.document.body.appendChild(h2);
  env.Panels.register({ id: 'casse', title: 'Casse',
    sections: [{ id: 's', fields: [{ key: 'x', label: 'X', type: 'type-inexistant' }] }],
    targets: () => [{ x: 1 }] });
  env.Panels.register({ id: 'sain',
    sections: [{ id: 's', fields: [{ key: 'ok', label: 'OK', type: 'number' }] }],
    targets: () => [{ ok: 1 }] });

  env.Panels.boot({ casse: h1, sain: h2 });

  assert.ok(env.document.getElementById('f-ok'), 'le panneau sain doit vivre');
  assert.equal(env.Panels.failed('casse'), true);
  assert.ok(String(h1.textContent).indexOf('Casse') !== -1
         || String(h1.textContent).length > 0, 'un placard d erreur doit etre affiche');
});

test('un panneau en echec n est plus synchronise', () => {
  const env = neuf();
  const h = env.document.createElement('div');
  env.document.body.appendChild(h);
  let syncs = 0;
  env.Panels.register({ id: 'casse', sections: [], targets: () => [{}],
    sync(){ syncs += 1; throw new Error('boum'); } });
  env.Panels.boot({ casse: h });
  env.Panels.syncAll();
  env.Panels.syncAll();
  assert.equal(syncs, 1, 'une seule tentative : apres l echec, on ne rappelle plus');
  assert.equal(env.Panels.failed('casse'), true);
});

test('un panneau cache n est pas synchronise', () => {
  const env = neuf();
  const h = env.document.createElement('div');
  env.document.body.appendChild(h);
  let syncs = 0;
  env.Panels.register({ id: 'p', sections: [], targets: () => [{}], sync(){ syncs += 1; } });
  env.Panels.boot({ p: h });
  env.Panels.setVisible('p', false);
  env.Panels.syncAll();
  assert.equal(syncs, 0);
  env.Panels.setVisible('p', true);
  env.Panels.syncAll();
  assert.equal(syncs, 1);
});
