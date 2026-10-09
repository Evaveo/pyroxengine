// Les gardes de la classe de bugs « ça ne marche plus, et rien en console ».
//
// Deux mécanismes du socle UI supprimaient leurs propres symptômes :
//
//  · `Panels` condamnait à vie un panneau ayant levé une seule fois (`failed` jamais remis à
//    faux) : une exception passagère éteignait l'inspecteur pour toute la session, avec un
//    unique message au premier plantage puis plus rien du tout ;
//  · `closeWindow` laissait derrière elle les trois écouteurs de geste posés sur `window` par
//    `_bindWindow`. Ouvrir et fermer N fois une fenêtre laissait 3N fermetures vivantes,
//    retenant chacune une boîte détruite — aucune erreur, seulement une page qui ralentit.
//
// Ces tests-là échouent si l'un des deux revient.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

function contextePanneaux(){
  return creerContexte(['js/ui/registry.js', 'js/ui/form-plan.js', 'js/ui/fields.js',
                        'js/ui/form.js', 'js/ui/panel.js', 'js/history.js']);
}

test('un panneau tombe en echec peut etre reconstruit par retry()', () => {
  const env = contextePanneaux();
  const host = env.document.createElement('div');
  env.document.body.appendChild(host);

  // La cause de l'echec est PASSAGERE : elle disparait au deuxieme appel, exactement comme un
  // asset pas encore charge ou une selection vide au mauvais moment.
  let capricieux = true;
  env.Panels.register({ id: 'p', title: 'P', build(h){
    if(capricieux) throw new Error('asset pas encore la');
    h.innerHTML = '<span id="p-ok">ok</span>';
  } });

  env.Panels.boot({ p: host });
  assert.equal(env.Panels.failed('p'), true, 'le panneau doit etre marque en echec');
  assert.equal(env.Panels.failures('p'), 1, 'et l echec doit etre compte');

  capricieux = false;
  assert.equal(env.Panels.retry('p'), true, 'retry() doit reconstruire');
  assert.equal(env.Panels.failed('p'), false, 'et lever l echec');
  assert.ok(env.document.getElementById('p-ok'), 'le contenu du panneau doit etre la');
});

test('chaque echec est annonce, pas seulement le premier', () => {
  const env = contextePanneaux();
  const host = env.document.createElement('div');
  env.document.body.appendChild(host);
  const messages = [];
  env.logConsole = (msg) => messages.push(msg);

  env.Panels.register({ id: 'p', title: 'P', build(){ throw new Error('toujours cassee'); } });
  env.Panels.boot({ p: host });
  env.Panels.retry('p');

  assert.equal(env.Panels.failures('p'), 2, 'deux echecs distincts doivent etre comptes');
  assert.equal(messages.length, 2, 'et chacun doit avoir ete annonce');
  assert.ok(messages[1].includes('(2)'), 'le message doit porter le rang de l echec');
});

test('un hote neuf efface l echec : le panneau est reconstruit', () => {
  const env = contextePanneaux();
  const premier = env.document.createElement('div');
  const second = env.document.createElement('div');
  env.document.body.appendChild(premier);
  env.document.body.appendChild(second);

  let capricieux = true;
  env.Panels.register({ id: 'p', title: 'P', build(h){
    if(capricieux) throw new Error('hote invalide');
    h.innerHTML = '<span id="p-ok">ok</span>';
  } });

  env.Panels.boot({ p: premier });
  assert.equal(env.Panels.failed('p'), true);

  // Le dock donne une zone toute neuve au panneau : rien ne dit que la construction y echouera.
  capricieux = false;
  env.Panels.boot({ p: second });
  assert.equal(env.Panels.failed('p'), false, 'un hote neuf doit rouvrir la construction');
  assert.ok(env.document.getElementById('p-ok'), 'et le panneau doit vivre dans le nouvel hote');
});

test('le placard d erreur porte un bouton Reessayer', () => {
  const env = contextePanneaux();
  const host = env.document.createElement('div');
  env.document.body.appendChild(host);
  env.Panels.register({ id: 'p', title: 'P', build(){ throw new Error('cassee'); } });
  env.Panels.boot({ p: host });

  const bouton = host.querySelector('.panel-error-retry');
  assert.ok(bouton, 'le placard doit offrir une porte de sortie a l utilisateur');
  assert.equal(bouton.textContent, 'Réessayer');
});

// ---------- Fenetres ----------

function contexteFenetres(){
  return creerContexte(['js/windows.js']);
}

test('fermer une fenetre retire les ecouteurs poses sur window', () => {
  const env = contexteFenetres();
  const adopte = env.document.createElement('div');
  env.document.body.appendChild(adopte);
  const avant = env.windowListenerCount();

  env.openWindow('w', adopte, { title: 'W' });
  assert.ok(env.windowListenerCount() > avant, 'l ouverture pose bien des ecouteurs');

  env.closeWindow('w');
  assert.equal(env.windowListenerCount(), avant,
    'fermer doit rendre le solde d ecouteurs a son etat d avant l ouverture');
});

test('ouvrir et fermer dix fois n accumule rien', () => {
  const env = contexteFenetres();
  const adopte = env.document.createElement('div');
  env.document.body.appendChild(adopte);
  const avant = env.windowListenerCount();

  for(let i = 0; i < 10; i++){
    env.openWindow('w', adopte, { title: 'W' });
    env.closeWindow('w');
  }

  assert.equal(env.windowListenerCount(), avant,
    'dix cycles ne doivent laisser aucun ecouteur zombie derriere eux');
});
