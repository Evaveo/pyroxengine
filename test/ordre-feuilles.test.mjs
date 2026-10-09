// L'ORDRE DES FEUILLES EST UNE DÉPENDANCE, ET RIEN NE PEUT L'ÉVALUER ICI.
//
// Sans build, la cascade dépend de l'ordre des <link>. Le harnais n'a pas de moteur de rendu :
// aucun test ne peut dire « cette règle gagne ». Ce qu'on PEUT mesurer, c'est que l'ordre écrit
// dans la page est bien celui que la scission a supposé — et qu'aucune feuille n'a été ajoutée
// au milieu sans y penser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Du plus général au plus spécifique. Déplacer une ligne d'ici sans déplacer le <link>
// correspondant fait échouer le test — c'est le but.
// `editor.css` n'est PAS dans cette liste : il a disparu à la scission, une fois ses 904
// lignes réparties entre les quatre feuilles ci-dessous.
// `states.css` s'intercale entre la remise à zéro et la coquille : elle ne décrit aucune
// surface (focus, sélection, désactivé, barres de défilement), donc tout ce qui suit doit
// pouvoir la préciser. Elle est SÉPARÉE de base.css parce que help.html en a besoin et ne
// peut pas charger base.css — voir l'en-tête de css/states.css.
const ORDRE = ['css/tokens.css', 'css/base.css', 'css/states.css', 'css/components.css',
               'css/layout.css',
               'css/panels.css', 'css/widgets.css'];

function liens(page){
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  return [...html.matchAll(/<link[^>]+href="(css\/[a-z-]+\.css)/g)].map((m) => m[1]);
}

test('editor.html charge les feuilles dans l ordre de cascade attendu', () => {
  assert.deepEqual(liens('editor.html'), ORDRE);
});

test('aucune feuille de css/ n est oubliee par une page', () => {
  const surDisque = fs.readdirSync(path.join(root, 'css')).filter((f) => f.endsWith('.css'));
  // TOUTES les pages du dépôt, pas trois nommées. La liste en dur ne connaissait qu'editor,
  // help et hub : une feuille chargée par une quatrième page passait pour orpheline, et il
  // fallait modifier ce test pour ajouter une page — c'est-à-dire relâcher la garde pour faire
  // passer du neuf. Le test juste en dessous scrute déjà toutes les pages, pour la brèche
  // symétrique (une feuille citée qui n'existe pas) : les deux regardent maintenant le même
  // ensemble.
  const pages = fs.readdirSync(root).filter((f) => f.endsWith('.html'));
  const chargees = new Set(pages.flatMap(liens).map((h) => h.replace('css/', '')));
  const orphelines = surDisque.filter((f) => !chargees.has(f));
  assert.deepEqual(orphelines, [],
    'feuilles jamais chargees : ' + orphelines.join(', '));
});

// LA BRECHE MESUREE (v0.101.9) : `external-editor.html` a garde son <link> vers
// `css/editor.css` pendant toute la scission. Le fichier n'existe plus, le serveur a renvoye sa
// page 404 en `text/plain`, et le navigateur a REFUSE la feuille — l'editeur de code et
// l'editeur nodal de shader s'ouvraient sans aucune mise en forme. Aucun test ne regardait ces
// pages-la : les deux au-dessus ne connaissent qu'editor.html et help.html.
test('aucune page ne charge une feuille qui n existe pas', () => {
  const pages = fs.readdirSync(root).filter((f) => f.endsWith('.html'));
  const fautes = [];
  pages.forEach(function(page){
    liens(page).forEach(function(href){
      if(!fs.existsSync(path.join(root, href))) fautes.push(page + ' -> ' + href);
    });
  });
  assert.deepEqual(fautes, [], 'feuilles introuvables : ' + fautes.join(', '));
});

test('le commentaire qui explique l ordre est present', () => {
  const html = fs.readFileSync(path.join(root, 'editor.html'), 'utf8');
  assert.ok(/ordre/i.test(html.slice(0, html.indexOf('</head>'))),
    'un ordre non explique sera casse par le premier qui ajoutera une feuille');
});

test('aucune feuille n est VIDE : une feuille chargee pour rien est un piege', () => {
  ORDRE.forEach(function(f){
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    // Sans les commentaires : une feuille qui n'a plus qu'un en-tête n'a plus de raison d'être
    // chargée, et le suivant y ajoutera une règle en croyant qu'elle compte.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    assert.ok(code.length > 0, f + ' est vide — la supprimer et retirer sa ligne d ORDRE');
  });
});

const NL = String.fromCharCode(10);

test('chaque !important restant porte un commentaire qui nomme le conflit', () => {
  const fautes = [];
  fs.readdirSync(path.join(root, 'css')).filter((f) => f.endsWith('.css')).forEach(function(f){
    const src = fs.readFileSync(path.join(root, 'css', f), 'utf8');
    // Les commentaires sont NEUTRALISÉS en gardant les sauts de ligne : un commentaire qui
    // explique un `!important` retiré ne doit pas compter comme un `!important` posé, et les
    // numéros de ligne doivent rester justes pour que le message serve à quelque chose.
    const sansCom = src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
    const lignes = src.split(NL);
    sansCom.split(NL).forEach(function(l, i){
      if(l.indexOf('!important') === -1) return;
      // Le commentaire est au-dessus, ou sur la ligne : les deux se lisent avant la règle.
      const contexte = (lignes[i - 2] || '') + (lignes[i - 1] || '') + lignes[i];
      if(contexte.indexOf('/*') === -1 && contexte.indexOf('*') === -1){
        fautes.push(f + ':' + (i + 1) + ' — ' + lignes[i].trim());
      }
    });
  });
  assert.deepEqual(fautes, [],
    'un !important sans explication sera recopie par le suivant :' + NL + fautes.join(NL));
});
