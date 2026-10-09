import { deEsm } from './engine-env.mjs';
import { test } from 'node:test';
import assert from 'node:assert';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
function chargerComposantJs(context) {
  vm.createContext(context);
  // `component-registry.js` d'ABORD : il porte `Registry` et `NodeShells`, sortis de
  // `component.js` parce qu'un module sans dépendance s'évalue toujours en premier — condition
  // du passage aux modules ES (voir js/component-registry.js).
  for (const f of ['component-registry.js', 'component.js']) {
    vm.runInContext(deEsm(fs.readFileSync(path.join(dirname, '..', 'js', f), 'utf8')), context,
      { filename: 'js/' + f });
  }
}

test('Registre.enregistrer indexe par nomType et Registre.retirer nettoie', () => {
  const ctx = {};
  chargerComposantJs(ctx);
  class Faux extends ctx.Component { static get typeName() { return 'Faux'; } }
  const node = {};
  const instance = new Faux(node);
  ctx.Registry.register(instance);
  assert.equal(ctx.Registry.byType.get('Faux').has(instance), true);
  ctx.Registry.unregister(instance);
  assert.equal(ctx.Registry.byType.get('Faux').has(instance), false);
});

test('Composant par défaut est active et sérialise un objet vide', () => {
  const ctx = {};
  chargerComposantJs(ctx);
  const instance = new ctx.Component({});
  assert.equal(instance.active, true);
  assert.deepEqual(instance.serialize(), {});
});

test('classesEnregistrees liste les classes ajoutées via Registre.enregistrerClasse', () => {
  const ctx = {};
  chargerComposantJs(ctx);
  class Faux extends ctx.Component {
    static get typeName() { return 'Faux'; }
    static get category() { return 'Test'; }
  }
  ctx.Registry.registerClass(Faux);
  const trouve = ctx.Registry.registeredClasses.find((c) => c.typeName === 'Faux');
  assert.equal(trouve.category, 'Test');
});

test('applyNodeMixin ajoute getComponent/getComponents/addComponent/removeComponent', () => {
  const ctx = {};
  chargerComposantJs(ctx);
  const code = deEsm(fs.readFileSync(path.join(dirname, '..', 'js', 'node.js'), 'utf8'));
  vm.runInContext(code, ctx);

  class Faux extends ctx.Component {
    static get typeName() { return 'Faux'; }
    static restore(node, data) { return new Faux(node); }
  }
  ctx.Registry.registerClass(Faux);

  const node = { userData: {} };
  ctx.applyNodeMixin(node);

  const instance = node.addComponent('Faux', {});
  assert.equal(node.getComponent('Faux'), instance);
  assert.deepEqual(node.getComponents('Faux'), [instance]);
  assert.equal(node.getComponent('Absent'), null);

  node.removeComponent(instance);
  assert.equal(node.getComponent('Faux'), null);
});
