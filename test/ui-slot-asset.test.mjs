// UN COMPOSANT QUI RÉFÉRENCE UN ASSET DOIT POUVOIR ÊTRE REMPLI.
//
// Le ScriptJS a cessé de porter son code pour ne garder que `scriptId` — et sa carte affichait
// le nom de l'asset en LECTURE SEULE. Ajouter le composant à un objet donnait donc une carte
// inerte : ni liste, ni dépôt, aucun moyen de désigner le script. Le composant existait et ne
// servait à rien, sans qu'un seul message le dise.
//
// Ce fichier tient le contrat du slot : il liste, il accepte le dépôt d'un asset RECEVABLE, et
// il refuse le reste. Le filtre n'est pas écrit deux fois — un dépôt est retenu si et seulement
// si son id figure dans les options du champ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

function neuf(){
  return creerContexte(['js/ui/registry.js', 'js/ui/form-plan.js', 'js/ui/fields.js',
                        'js/ui/form.js', 'js/history.js']);
}

const OPTIONS = [['', '— aucun —'], ['a16', 'director'], ['a17', 'player-fps']];

function monter(env, cible){
  const host = env.document.createElement('div');
  env.document.body.appendChild(host);
  const form = env.createForm(host, { id: 'p', sections: [{ id: 's', fields: [
    { ids: ['f-slot'], label: 'Script', type: 'assetSlot', options: OPTIONS,
      get: (c) => c.scriptId || '',
      set: (c, v) => { c.scriptId = v || null; } }
  ]}]});
  form.setTargets([cible]);
  return { form: form, el: env.document.getElementById('f-slot') };
}

// Le transfert d'un glisser-déposer de l'éditeur : `text/asset` porte l'id (js/assets.js).
function drop(el, type, id){
  el.dispatchEvent({ type: type, preventDefault(){ this.prevented = true; },
                     dataTransfer: { getData: (k) => (k === 'text/asset' ? id : ''),
                                     dropEffect: '' } });
}

test('le slot liste les assets recevables et montre celui qui est reference', () => {
  const env = neuf();
  const { el } = monter(env, { scriptId: 'a17' });
  assert.equal(el.value, 'a17', 'le slot doit montrer le script déjà référencé');
});

test('LACHER UN ASSET RECEVABLE L ECRIT SUR LA CIBLE — le geste qui manquait', () => {
  const env = neuf();
  const cible = { scriptId: null };
  const { el } = monter(env, cible);
  drop(el, 'drop', 'a16');
  assert.equal(cible.scriptId, 'a16', 'le dépôt n\'a pas écrit la référence sur la cible');
});

test('un asset d un autre genre est REFUSE, et ne vide pas le slot', () => {
  const env = neuf();
  const cible = { scriptId: 'a17' };
  const { el } = monter(env, cible);
  // « m3 » est un matériau : il n'est pas dans les options, donc il n'est pas recevable.
  drop(el, 'drop', 'm3');
  assert.equal(cible.scriptId, 'a17', 'un dépôt hors options a quand même changé la référence');
});

test('le survol d un depot recevable s ALLUME, celui d un refus reste eteint', () => {
  const env = neuf();
  const { el } = monter(env, { scriptId: null });
  drop(el, 'dragover', 'm3');
  assert.equal(el.classList.contains('drop-target'), false,
    'le slot s\'allume pour un dépôt qu\'il refusera : le geste ment');
  drop(el, 'dragover', 'a16');
  assert.equal(el.classList.contains('drop-target'), true,
    'le slot ne dit rien pendant le survol d\'un dépôt recevable');
  drop(el, 'dragleave', '');
  assert.equal(el.classList.contains('drop-target'), false, 'le liseré reste allumé après coup');
});
