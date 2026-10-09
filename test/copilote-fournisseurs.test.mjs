import { deEsm } from './engine-env.mjs';
// Parler à n'importe quel modèle : la traduction, dans les deux sens.
//
// Le test qui porte le fichier est celui des RÉSULTATS D'OUTILS. C'est la seule différence entre les
// deux formats qui se recopie mal : Anthropic groupe tous les résultats dans UN message `user`,
// OpenAI en veut UN PAR APPEL, chacun portant son `tool_call_id`. Grouper là où il faut séparer donne
// une conversation que l'API refuse, avec un message d'erreur qui parle de `tool_call_id` sans dire
// lequel manque — on cherche alors du côté des identifiants, qui sont justes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const hote = (x) => JSON.parse(JSON.stringify(x));

function contexte(){
  const bac = {console, Math, JSON, Number, String, Object, Array, isFinite};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('js/copilot-providers.js')), ctx, {filename: 'js/copilot-providers.js'});
  // `PROVIDERS` est un `const` au premier level : il vit dans l'environnement LEXICAL global, pas
  // dans l'object global. `ctx.PROVIDERS` rend donc `undefined` alors que le navigateur, lui, le voit
  // parfaitement depuis les autres scripts de la page. Il faut l'ÉVALUER. Les `validateProvider` et
  // autres passent, eux, parce qu'une déclaration de FONCTION devient bien une propriété du global —
  // d'où un fichier à moitié visible, ce qui est plus déroutant qu'un fichier invisible.
  ctx.F = vm.runInContext('PROVIDERS', ctx);
  return ctx;
}

const COMMANDS = [
  {name: 'create_object', description: 'crée un objet',
   schema: {type: 'object', properties: {type: {type: 'string'}}, required: ['type']}},
  {name: 'check', description: 'mesure la scène', schema: {type: 'object', properties: {}}}
];

test('LES RESULTATS D OUTILS : groupes chez l un, SEPARES chez l autre', () => {
  const ctx = contexte();
  const resultats = [
    {id: 'a1', name: 'create_object', content: 'cube créé', error: false},
    {id: 'a2', name: 'check', content: '{"ratio":3}', error: false}
  ];

  // Anthropic : UN message `user` qui porte les deux résultats.
  const an = hote(ctx.F.anthropic.messagesResultats(resultats));
  assert.equal(an.length, 1, 'Anthropic groupe les résultats : ' + JSON.stringify(an));
  assert.equal(an[0].role, 'user');
  assert.equal(an[0].content.length, 2);
  assert.equal(an[0].content[0].type, 'tool_result');
  assert.equal(an[0].content[0].tool_use_id, 'a1');

  // OpenAI : DEUX messages `tool`, chacun avec son identifiant. C'est la faute qui se recopie.
  const oa = hote(ctx.F.openai.messagesResultats(resultats));
  assert.equal(oa.length, 2, 'OpenAI veut UN message par appel : ' + JSON.stringify(oa));
  assert.deepEqual(oa.map((m) => m.role), ['tool', 'tool']);
  assert.deepEqual(oa.map((m) => m.tool_call_id), ['a1', 'a2']);
  // Le contenu doit être une CHAÎNE : un objet passerait, puis serait refusé par l'API sans dire
  // pourquoi — le champ `content` d'un message `tool` n'accepte que du texte.
  for(const m of oa) assert.equal(typeof m.content, 'string', 'content doit être une chaîne');
});

test('LA DECLARATION DES OUTILS suit la shape de chaque fournisseur', () => {
  const ctx = contexte();
  const an = hote(ctx.F.anthropic.tools(COMMANDS));
  assert.equal(an[0].name, 'create_object');
  assert.ok(an[0].input_schema, 'Anthropic attend `input_schema`');
  assert.equal(an[0].input_schema.required[0], 'type', 'le schéma doit passer tel quel');

  const oa = hote(ctx.F.openai.tools(COMMANDS));
  assert.equal(oa[0].type, 'function');
  assert.equal(oa[0].function.name, 'create_object');
  assert.ok(oa[0].function.parameters, 'OpenAI attend `function.parameters`');
  assert.equal(oa[0].function.parameters.required[0], 'type');
  // Le même catalogue donne le même number d'outils : en perdre un le rendrait invisible au modèle,
  // qui inventerait alors un appel que rien ne sait exécuter.
  assert.equal(an.length, oa.length);
  assert.equal(an.length, COMMANDS.length);
});

test('LE MESSAGE SYSTEME va au bon endroit — un champ chez l un, un MESSAGE chez l autre', () => {
  const ctx = contexte();
  const o = {model: 'x', maxTokens: 8192, system: 'LES RÈGLES', commands: COMMANDS,
             messages: [{role: 'user', content: 'fais un platformer'}]};
  const an = hote(ctx.F.anthropic.body(o));
  assert.equal(an.system[0].text, 'LES RÈGLES', 'Anthropic attend un champ `system` (bloc mis en cache)');
  assert.equal(an.messages.length, 1, 'et le système ne doit PAS être dans les messages');
  assert.equal(an.max_tokens, 8192);

  const oa = hote(ctx.F.openai.body(o));
  assert.equal(oa.system, undefined, 'OpenAI ignorerait un champ `system` en silence');
  assert.equal(oa.messages.length, 2, 'le système doit être le PREMIER message');
  assert.equal(oa.messages[0].role, 'system');
  assert.equal(oa.messages[0].content, 'LES RÈGLES');
  assert.equal(oa.max_completion_tokens, 8192, 'OpenAI n\'a pas de champ max_tokens');
});

test('LA LECTURE DES REPONSES rend la MEME shape des deux cotes', () => {
  const ctx = contexte();
  // Réponse Anthropic avec un appel d'outil.
  const an = ctx.F.anthropic.read({
    stop_reason: 'tool_use',
    content: [{type: 'text', text: 'je crée le sol'},
              {type: 'tool_use', id: 'tu_1', name: 'create_object', input: {type: 'plane'}}]
  });
  assert.equal(an.text, 'je crée le sol');
  assert.equal(an.appels.length, 1);
  assert.deepEqual(hote(an.appels[0]), {id: 'tu_1', name: 'create_object', args: {type: 'plane'}});
  assert.equal(an.fini, false, 'un tour avec appel d\'outil n\'est pas fini');

  // Réponse OpenAI équivalente : les arguments arrivent en CHAÎNE JSON, pas en object.
  const oa = ctx.F.openai.read({
    choices: [{finish_reason: 'tool_calls', message: {content: 'je crée le sol', tool_calls: [
      {id: 'call_1', type: 'function', function: {name: 'create_object', arguments: '{"type":"plane"}'}}
    ]}}]
  });
  assert.equal(oa.text, 'je crée le sol');
  assert.deepEqual(hote(oa.appels[0]), {id: 'call_1', name: 'create_object', args: {type: 'plane'}});
  assert.equal(oa.fini, false);

  // Un tour SANS outil est fini, des deux côtés.
  assert.equal(ctx.F.anthropic.read({stop_reason: 'end_turn', content: [{type: 'text', text: 'fini'}]}).fini, true);
  assert.equal(ctx.F.openai.read({choices: [{finish_reason: 'stop', message: {content: 'fini'}}]}).fini, true);
});

test('DES ARGUMENTS JSON TRONQUES ne font pas tomber le tour', () => {
  const ctx = contexte();
  // Une réponse coupée par la limite de jetons laisse un JSON incomplet. Lever ici ferait perdre tout
  // le tour, y compris les appels valides qui précèdent ; on rend un appel lisible et l'erreur remonte
  // au modèle, qui peut réessayer.
  const oa = ctx.F.openai.read({
    choices: [{finish_reason: 'tool_calls', message: {tool_calls: [
      {id: 'c1', function: {name: 'paint_room', arguments: '{"plan":"###'}}
    ]}}]
  });
  assert.equal(oa.appels.length, 1);
  assert.ok(oa.appels[0].args.__errorArguments, 'les arguments illisibles doivent être signalés');
  assert.ok(String(oa.appels[0].args.__errorArguments).includes('###'),
    'et le texte reçu doit être conservé, pour que le modèle voie ce qui a été coupé');
});

test('UNE IMAGE part en block chez Anthropic, et son ABSENCE est DITE chez OpenAI', () => {
  const ctx = contexte();
  const an = hote(ctx.F.anthropic.contentWithImage('view capturée', 'AAAB'));
  assert.equal(an.length, 2);
  assert.equal(an[1].type, 'image');
  assert.equal(an[1].source.data, 'AAAB');

  // Un message `tool` d'OpenAI ne porte pas d'image. Le taire laisserait croire au modèle qu'il a
  // regardé quelque chose — et il conclurait sur une image qu'il n'a jamais vue.
  const oa = ctx.F.openai.contentWithImage('view capturée', 'AAAB');
  assert.equal(typeof oa, 'string');
  assert.ok(oa.includes('image non transmise'), 'la perte doit être dite : ' + oa);
  assert.ok(oa.includes('check'), 'et une alternative proposée');
  assert.ok(!oa.includes('AAAB'), 'la donnée ne doit pas être collée dans le texte');
});

test('validateProvider SIGNALE un modele envoye au bad fournisseur', () => {
  const ctx = contexte();
  const p = ctx.validateProvider('openai', 'claude-opus-5', 'sk-x');
  assert.ok(p.some((x) => x.includes('appartient à')), JSON.stringify(hote(p)));
  // Un modèle inconnu est un AVERTISSEMENT, pas un refusal : un service compatible OpenAI propose ses
  // propres noms, et refuser interdirait tout serveur local.
  const q = ctx.validateProvider('openai', 'mistral-large', 'sk-x');
  assert.ok(q.some((x) => x.includes('pas dans la liste connue')));
  assert.ok(!q.some((x) => x.includes('appartient à')));
  // Pas de clé : c'est le seul cas bloquant, et il doit être dit avant la requête.
  assert.ok(ctx.validateProvider('anthropic', 'claude-opus-5', '').some((x) => x.includes('clé')));
  assert.deepEqual(hote(ctx.validateProvider('anthropic', 'claude-opus-5', 'sk-x')), []);
  // Et le fournisseur d'un modèle se retrouve, ce qui évite d'envoyer au bad endroit.
  assert.equal(ctx.providerOfModel('gpt-5'), 'openai');
  assert.equal(ctx.providerOfModel('claude-sonnet-5'), 'anthropic');
  assert.equal(ctx.providerOfModel('inconnu-42'), null);
});
