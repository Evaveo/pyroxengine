// Construit « Coup Franc », un game de football dans l'esprit de Sensible
// Soccer : view haute, joueurs minuscules, contrôle du plus proche du ballon,
// effet après la frappe. En n'appelant QUE les commandes du copilot.
//
//   node exemples/construire-foot.mjs
//
// Quatre choix qui décident du reste :
//
// - PHYSIQUE D'ARCADE, pas de body rigides. Le ballon a une speed, une
//   height et un frottement ; il rebondit sur les lignes. Sensible Soccer
//   faisait exactement ça, et c'est bien plus prévisible qu'un solveur de
//   contacts pour un game où le toucher de balle est tout.
//
// - L'EFFET APRÈS LA FRAPPE. La direction maintenue après le tir infléchit la
//   trajectoire, avec une autorité qui décroît. C'est la signature du game
//   d'origine : sans ça on a un game de foot, avec ça on a CE game de foot.
//   Corollaire : un ballon en l'air n'est pas jouable, on attend qu'il retombe.
//
// - UN SEUL SCRIPT D'ARBITRE sur un objet invisible : écrans, ballon, dix
//   joueurs, score. Dix scripts qui se coordonnent par événements seraient plus
//   « propres » et beaucoup plus difficiles à faire play juste.
//
// - ÉQUIPES ≠ CAMPS. Les équipes sont des DONNÉES (name, color, lues par
//   api.donnees) ; les camps sont des objets de scène avec leurs postes. On
//   choisit une équipe à l'écran de sélection, elle est peinte sur un camp.
//   Ajouter une équipe ne demande donc pas de toucher au code ni à la scène.
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const editeurUrl = pathToFileURL(path.join(dirname, '..', 'editor.html')).href;
const sortie = path.join(dirname, 'foot-demo.p3d.json');

// Terrain : x de -30 à 30 (longueur), z de -20 à 20 (width).
const EQUIPES = [
  { name: 'Bleus',     color: '#2f6fd0' },
  { name: 'Rouges',    color: '#d0402f' },
  { name: 'Verts',     color: '#2f9e44' },
  { name: 'Or',        color: '#e0a800' },
  { name: 'Violets',   color: '#7048c0' },
  { name: 'Noirs',     color: '#2b2f36' }
];

const SCRIPT_ARBITRE = `
// Écrans, ballon, joueurs, tirs, buts, score.
//
// Séparation qui structure tout : les ÉQUIPES sont des données (name, color)
// et les CAMPS sont des objets de scène (Domicile, Exterieur, avec leurs
// postes). On choisit une équipe, elle est peinte sur un camp. C'est ainsi que
// fonctionne le game d'origine, et ça évite de créer onze objets par équipe.

var CAMPS = [
  {name: 'Domicile',  tag: 'domicile',  sens:  1,
   postes: [[-27, 0], [-16, -9], [-16, 9], [-6, -4], [-6, 4]]},
  {name: 'Exterieur', tag: 'exterieur', sens: -1,
   postes: [[27, 0], [16, -9], [16, 9], [6, -4], [6, 4]]}
];

function equipes(api){ return api.donnees('Equipes') || []; }
function monEquipe(api){ return equipes(api)[api.state.choix] || equipes(api)[0]; }
function equipeAdverse(api){
  const e = equipes(api);
  return e[(api.state.choix + 1) % e.length] || e[1] || e[0];
}

// Trois écrans, trois Noeuds UIDocument (voir création dans le script de
// construction) : afficher un écran, c'est activer/désactiver son Noeud —
// api.uiDocument sert seulement à écrire le texte affiché dans chacun.
function uiAccueil(api){ return api.uiDocument(api.trouver('UI Accueil')); }
function uiSelection(api){ return api.uiDocument(api.trouver('UI Selection')); }
function uiMatch(api){ return api.uiDocument(api.trouver('UI Match')); }

function ecran(api, name){
  api.state.ecran = name;
  api.activer(api.trouver('UI Accueil'), name === 'accueil');
  api.activer(api.trouver('UI Selection'), name === 'selection');
  api.activer(api.trouver('UI Match'), name !== 'accueil' && name !== 'selection');
  if(name === 'selection') majChoix(api);
}

function majChoix(api){
  const e = monEquipe(api);
  const ui = uiSelection(api);
  if(!e || !ui) return;
  // Régénère le fragment entier : c'est la seule façon de paint la color
  // de l'équipe choisie (data-bind ne synchronise que du texte, pas un style).
  ui.html = '<div class="ecran selection">'
    + '<div class="title">VOTRE ÉQUIPE</div>'
    + '<div class="choix" style="color:' + e.color + '">' + e.name.toUpperCase() + '</div>'
    + '<div class="aide">Gauche / Droite pour changer · Espace pour valider</div>'
    + '</div>';
}

// Peint les maillots : l'équipe choisie joue à domicile, l'autre à l'extérieur.
// Le gardien garde sa color distincte, comme au football.
function habiller(api){
  const mienne = monEquipe(api), autre = equipeAdverse(api);
  [[CAMPS[0], mienne], [CAMPS[1], autre]].forEach(function(paire){
    paire[0].postes.forEach(function(xy, i){
      const j = api.trouver(paire[0].name + ' ' + (i + 1));
      if(!j || !j.material) return;
      j.material.color.set(i === 0 ? '#f4d03f' : paire[1].color);
    });
  });
  const ui = uiMatch(api);
  if(ui){
    ui.values.domicile = mienne.name.toUpperCase();
    ui.values.exterieur = autre.name.toUpperCase();
  }
}

function start(api){
  const p = api.props();
  p.vx = 0; p.vz = 0; p.vy = 0; p.tir = 0; p.pending = 0;
  if(api.state.choix === undefined) api.state.choix = 0;
  api.state.butsDomicile = api.state.butsDomicile || 0;
  api.state.butsExterieur = api.state.butsExterieur || 0;
  placerTout(api);
  habiller(api);
  majScore(api);
  ecran(api, api.state.ecran === 'match' ? 'match' : 'accueil');

  // Réplication : le ballon et les onze joueurs. Le décor, les cages et
  // l'interface ne sont PAS répliqués — tout le world charge le même project,
  // il n'y a rien à transmettre pour ce qui ne bouge pas.
  api.network.repliquer(api.trouver('Ballon'));
  CAMPS.forEach(function(c){
    c.postes.forEach(function(xy, i){
      api.network.repliquer(api.trouver(c.name + ' ' + (i + 1)));
    });
  });
}

function majScore(api){
  const ui = uiMatch(api);
  if(ui) ui.values.score = api.state.butsDomicile + ' — ' + api.state.butsExterieur;
}

// data-bind="message" + CSS ".message:empty{display:none}" : un texte empty
// masque le message, pas besoin d'un .visible() séparé.
function afficherMessage(api, texte){
  const ui = uiMatch(api);
  if(ui) ui.values.message = texte || '';
}

function placerTout(api){
  const p = api.props();
  api.placer(api.trouver('Ballon'), {x: 0, y: 0.35, z: 0});
  p.vx = 0; p.vz = 0; p.vy = 0; p.tir = 0;
  CAMPS.forEach(function(c){
    c.postes.forEach(function(xy, i){
      const j = api.trouver(c.name + ' ' + (i + 1));
      if(j) api.placer(j, {x: xy[0], y: 0.6, z: xy[1]});
    });
  });
}

function versBallon(joueur, ballon, speed, dt){
  const dx = ballon.position.x - joueur.position.x;
  const dz = ballon.position.z - joueur.position.z;
  const d = Math.hypot(dx, dz) || 1;
  joueur.position.x += (dx / d) * speed * dt;
  joueur.position.z += (dz / d) * speed * dt;
}

function versPoste(joueur, xy, ballon, speed, dt){
  const cibleX = xy[0] + Math.max(-9, Math.min(9, (ballon.position.x - xy[0]) * 0.45));
  const cibleZ = xy[1] + Math.max(-6, Math.min(6, (ballon.position.z - xy[1]) * 0.35));
  const dx = cibleX - joueur.position.x, dz = cibleZ - joueur.position.z;
  const d = Math.hypot(dx, dz);
  if(d < 0.3) return;
  joueur.position.x += (dx / d) * speed * dt;
  joueur.position.z += (dz / d) * speed * dt;
}

function update(api){
  const p = api.props();
  const dt = Math.min(api.dt, 0.05);

  // ---------- écrans ----------
  if(api.state.ecran === 'accueil'){
    if(api.actionAppuyee('jump')) ecran(api, 'selection');
    return;
  }
  if(api.state.ecran === 'selection'){
    const n = equipes(api).length || 1;
    if(api.actionAppuyee('right')){ api.state.choix = (api.state.choix + 1) % n; majChoix(api); }
    if(api.actionAppuyee('left')){ api.state.choix = (api.state.choix + n - 1) % n; majChoix(api); }
    if(api.actionAppuyee('jump')){
      api.state.butsDomicile = 0; api.state.butsExterieur = 0;
      habiller(api); majScore(api); placerTout(api);
      ecran(api, 'match');
    }
    return;
  }

  const ballon = api.trouver('Ballon');
  if(!ballon) return;

  if(p.pending > 0){
    p.pending -= dt;
    if(p.pending <= 0){ placerTout(api); afficherMessage(api, ''); }
    return;
  }

  // ---------- joueurs contrôlés ----------
  // À DEUX : le joueur local tient Domicile, le premier joueur distant tient
  // Exterieur. Hors ligne, api.network.distants() est empty et rien ne change —
  // c'est le test de bonne conception : le game solo n'a pas été retouché.
  const plusProche = function(tag, gardien){
    let meilleur = null, d0 = 1e9;
    api.byTag(tag).forEach(function(j){
      if(j.name === gardien) return;
      const d = Math.hypot(j.position.x - ballon.position.x, j.position.z - ballon.position.z);
      if(d < d0){ d0 = d; meilleur = j; }
    });
    return meilleur;
  };
  const distant = api.network.distants()[0] || null;
  const controle = plusProche('domicile', 'Domicile 1');
  const controleB = distant ? plusProche('exterieur', 'Exterieur 1') : null;

  const ax = api.axe('horizontal'), az = -api.axe('vertical');
  // Entrées du second joueur, lues exactement comme les locales.
  const bx = distant ? api.network.axe(distant, 'horizontal') : 0;
  const bz = distant ? -api.network.axe(distant, 'vertical') : 0;

  if(controleB){
    controleB.position.x += bx * 11 * dt;
    controleB.position.z += bz * 11 * dt;
    const dB2 = Math.hypot(controleB.position.x - ballon.position.x,
                           controleB.position.z - ballon.position.z);
    if(ballon.position.y < 0.9 && dB2 < 1.5){
      if(api.network.action(distant, 'jump')){
        let dx = bx, dz = bz;
        if(!dx && !dz){ dx = -1; dz = 0; }   // par défaut vers SON but adverse
        const n = Math.hypot(dx, dz) || 1;
        p.vx = (dx / n) * 32; p.vz = (dz / n) * 32; p.vy = 7; p.tir = 1.1;
      } else if(dB2 < 1.05){
        p.vx += bx * 26 * dt; p.vz += bz * 26 * dt;
      }
    }
  }

  if(controle){
    controle.position.x += ax * 11 * dt;
    controle.position.z += az * 11 * dt;
    const uiC = uiMatch(api);
    if(uiC) uiC.values.controle = controle.name
      + (controleB ? ' · ' + controleB.name + ' (distant)' : '');

    const dB = Math.hypot(controle.position.x - ballon.position.x,
                          controle.position.z - ballon.position.z);
    // Un ballon EN L'AIR n'est pas jouable : c'est ce qui donne son rythme au
    // game d'origine. On attend qu'il retombe, il ne se colle pas au pied.
    const jouable = ballon.position.y < 0.9;
    if(jouable && dB < 1.5){
      if(api.actionAppuyee('jump')){
        let dx = ax, dz = az;
        if(!dx && !dz){ dx = 1; dz = 0; }
        const n = Math.hypot(dx, dz) || 1;
        p.vx = (dx / n) * 32; p.vz = (dz / n) * 32;
        p.vy = 7;         // le tir décolle
        p.tir = 1.1;      // fenêtre d'effet
      } else if(dB < 1.05){
        p.vx += ax * 26 * dt; p.vz += az * 26 * dt;   // conduite de balle
      }
    }
  }

  // ---------- EFFET APRÈS LE TIR ----------
  // La signature de Sensible Soccer : la direction maintenue APRÈS la frappe
  // continue d'infléchir la trajectoire, avec une autorité qui décroît. Sans
  // ça on a un game de foot ; avec, on a CE game de foot.
  if(p.tir > 0){
    p.tir -= dt;
    const authority = 30 * (p.tir / 1.1);
    p.vx += ax * authority * dt;
    p.vz += az * authority * dt;
  }

  // ---------- les autres joueurs ----------
  CAMPS.forEach(function(c){
    c.postes.forEach(function(xy, i){
      const j = api.trouver(c.name + ' ' + (i + 1));
      if(!j || j === controle || j === controleB) return;   // pilotés par des humains
      if(i === 0){
        j.position.z += Math.max(-5, Math.min(5, ballon.position.z - j.position.z)) * 3.2 * dt;
        return;
      }
      const d = Math.hypot(j.position.x - ballon.position.x, j.position.z - ballon.position.z);
      if(d < 9){
        versBallon(j, ballon, 8.5, dt);
        if(d < 1.2 && ballon.position.y < 0.9){
          p.vx = c.sens * 26;
          p.vz = (Math.abs(ballon.position.z) > 12 ? -Math.sign(ballon.position.z) : 0) * 12;
          p.vy = 5; p.tir = 0;    // un dégagement de l'IA ne se pilote pas
        }
      } else {
        versPoste(j, xy, ballon, 6.5, dt);
      }
    });
  });

  // ---------- ballon ----------
  ballon.position.x += p.vx * dt;
  ballon.position.z += p.vz * dt;
  p.vy -= 26 * dt;
  ballon.position.y += p.vy * dt;
  if(ballon.position.y < 0.35){
    ballon.position.y = 0.35;
    p.vy = (Math.abs(p.vy) > 2.5) ? Math.abs(p.vy) * 0.42 : 0;   // rebond amorti
  }
  // Le frottement ne s'applique qu'au sol : en l'air le ballon garde sa speed.
  const frein = Math.pow(ballon.position.y > 0.5 ? 0.85 : 0.16, dt);
  p.vx *= frein; p.vz *= frein;
  if(Math.abs(p.vx) < 0.05) p.vx = 0;
  if(Math.abs(p.vz) < 0.05) p.vz = 0;

  if(ballon.position.z > 19.4){ ballon.position.z = 19.4; p.vz = -Math.abs(p.vz) * 0.7; p.tir = 0; }
  if(ballon.position.z < -19.4){ ballon.position.z = -19.4; p.vz = Math.abs(p.vz) * 0.7; p.tir = 0; }

  // ---------- cages ----------
  // Un but compte si le ballon franchit la ligne ENTRE les poteaux et SOUS la
  // bar. Un ballon trop haut passe au-dessus : la bar n'est pas décorative.
  const entre = Math.abs(ballon.position.z) < 5.4;
  const sous = ballon.position.y < 2.0;
  if(ballon.position.x > 29.8){
    if(entre && sous){ marquer(api, 'domicile'); return; }
    if(entre){ p.pending = 0.7; afficherMessage(api, 'Au-dessus !'); return; }
    ballon.position.x = 29.8; p.vx = -Math.abs(p.vx) * 0.6; p.tir = 0;
  }
  if(ballon.position.x < -29.8){
    if(entre && sous){ marquer(api, 'exterieur'); return; }
    if(entre){ p.pending = 0.7; afficherMessage(api, 'Au-dessus !'); return; }
    ballon.position.x = -29.8; p.vx = Math.abs(p.vx) * 0.6; p.tir = 0;
  }
}

function marquer(api, camp){
  const p = api.props();
  const name = (camp === 'domicile' ? monEquipe(api) : equipeAdverse(api));
  if(camp === 'domicile') api.state.butsDomicile++; else api.state.butsExterieur++;
  majScore(api);
  afficherMessage(api, 'BUT ! ' + (name ? name.name : ''));
  api.evenement('but', {camp: camp});
  p.pending = 1.8;
}
`;

const SCRIPT_CAMERA = `function update(api){
  // Vue haute et LARGE : Sensible Soccer se joue de loin, avec de petits
  // joueurs, parce qu'on doit voir venir la passe. Une caméra trop basse rend
  // le game illisible même s'il fonctionne — c'est ce que montrait le premier
  // essai, mesures à l'appui. On suit le ballon en longueur, en gardant toute
  // la width du terrain.
  const b = api.trouver('Ballon');
  if(!b) return;
  const m = api.me, k = Math.min(1, api.dt * 3);
  m.position.x += (b.position.x * 0.55 - m.position.x) * k;
  m.position.y += (70 - m.position.y) * k;
  m.position.z += (b.position.z * 0.2 + 34 - m.position.z) * k;
  api.regarder(b);
}`;

// Camps : ce sont des objets de scène, pas des équipes. Une équipe est peinte
// sur un camp au coup d'envoi (voir habiller() dans le script d'arbitre).
const CAMPS = [
  { name: 'Domicile', tag: 'domicile', postes: [[-27, 0], [-16, -9], [-16, 9], [-6, -4], [-6, 4]] },
  { name: 'Exterieur', tag: 'exterieur', postes: [[27, 0], [16, -9], [16, 9], [6, -4], [6, 4]] }
];

const navigateur = await chromium.launch({ args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist'] });
const page = await navigateur.newPage();
const erreursPage = [];
page.on('pageerror', (e) => erreursPage.push(String(e)));
await page.goto(editeurUrl);
await page.waitForFunction('typeof createObject === "function"');

const ratio = await page.evaluate(async (s) => {
  const summary = { appels: 0, echecs: [] };
  const C = (name, args) => {
    const cmd = COMMANDS.find((c) => c.name === name);
    if (!cmd) { summary.echecs.push('commande inconnue : ' + name); return; }
    summary.appels++;
    try { return cmd.exec(args || {}); }
    catch (e) { summary.echecs.push(name + ' - ' + e.message); }
  };
  const lister = () => JSON.parse(C('list_scene')).objects;

  for (let g = 0; g < 200; g++) {
    const r = lister().find((o) => o.type !== 'camera');
    if (!r) break;
    C('delete_object', { name: r.name });
  }

  C('create_data', { name: 'Equipes', content: JSON.stringify(s.equipes, null, 2) });

  C('create_object', { type: 'directional', name: 'Soleil', position: { x: 0, y: 40, z: 20 } });

  // Terrain. Largeur réelle = échelle × 1,6 (mesuré, pas supposé).
  C('create_object', { type: 'cube', name: 'Pelouse', position: { x: 0, y: -0.4, z: 0 } });
  C('transform', { name: 'Pelouse', scale: { x: 40, y: 0.5, z: 26.5 } });
  C('configure_material', { name: 'Pelouse', color: '#2e7d32' });
  C('configure_game', { name: 'Pelouse', tag: 'terrain' });

  C('create_object', { type: 'cube', name: 'Ligne mediane', position: { x: 0, y: -0.12, z: 0 } });
  C('transform', { name: 'Ligne mediane', scale: { x: 0.12, y: 0.02, z: 25 } });
  C('configure_material', { name: 'Ligne mediane', color: '#e8f5e9' });
  C('create_object', { type: 'torus', name: 'Rond central', position: { x: 0, y: -0.12, z: 0 } });
  // Le torus natif fait 2,8 u de large, pas 1,6 comme le cube : mesuré après
  // avoir obtenu un rond central deux fois trop grand.
  C('transform', { name: 'Rond central', scale: { x: 3, y: 3, z: 0.6 },
    rotation: { x: 90, y: 0, z: 0 } });
  C('configure_material', { name: 'Rond central', color: '#e8f5e9' });

  [['Gauche', -30.4], ['Droite', 30.4]].forEach((g) => {
    ['Haut', 'Bas'].forEach((cote, k) => {
      const n = 'Poteau ' + g[0] + ' ' + cote;
      C('create_object', { type: 'cube', name: n, position: { x: g[1], y: 1, z: (k ? -1 : 1) * 5.5 } });
      C('transform', { name: n, scale: { x: 0.25, y: 1.6, z: 0.25 } });
      C('configure_material', { name: n, color: '#fafafa' });
    });
    const b = 'Barre ' + g[0];
    C('create_object', { type: 'cube', name: b, position: { x: g[1], y: 2.1, z: 0 } });
    C('transform', { name: b, scale: { x: 0.22, y: 0.14, z: 7.2 } });
    C('configure_material', { name: b, color: '#fafafa' });
  });

  C('create_object', { type: 'sphere', name: 'Ballon', position: { x: 0, y: 0.35, z: 0 } });
  // Mesuré : un joueur fait 0,7 de large. Le ballon était à 0,7 aussi.
  C('transform', { name: 'Ballon', scale: { x: 0.16, y: 0.16, z: 0.16 } });
  C('configure_material', { name: 'Ballon', color: '#fafafa', emissive: '#454545' });
  C('configure_game', { name: 'Ballon', tag: 'ballon' });

  // Joueurs : un modèle par camp, puis des copies — duplicate_object emporte
  // matériau et tag. Les couleurs sont posées au coup d'envoi par le script.
  s.camps.forEach((c) => {
    const premier = c.name + ' 1';
    C('create_object', { type: 'cylinder', name: premier,
      position: { x: c.postes[0][0], y: 0.6, z: c.postes[0][1] } });
    C('transform', { name: premier, scale: { x: 0.45, y: 0.75, z: 0.45 } });
    C('configure_material', { name: premier, color: '#f4d03f' });
    C('configure_game', { name: premier, tag: c.tag });
    c.postes.slice(1).forEach((xy, i) => {
      C('duplicate_object', { name: premier, new: c.name + ' ' + (i + 2),
        position: { x: xy[0], y: 0.6, z: xy[1] } });
    });
  });

  C('create_object', { type: 'group', name: 'Arbitre', position: { x: 0, y: 0, z: 0 } });
  C('attach_script', { name: 'Arbitre', code: s.arbitre });

  const cam = lister().find((o) => o.type === 'camera');
  if (cam) {
    C('transform', { name: cam.name, position: { x: 0, y: 70, z: 34 } });
    C('attach_script', { name: cam.name, code: s.camera });
  }

  // ---- interface : trois Noeuds portant chacun un composant UIDocument ----
  // (accueil, sélection d'équipe, tableau d'affichage en match). Le script
  // d'arbitre active/désactive ces Noeuds (api.activer) et écrit dans leur
  // UIDocument via api.uiDocument — voir ecran()/majScore()/habiller() dans
  // SCRIPT_ARBITRE. On les crée en 'group' (pas de mesh) puis on attache le
  // composant directement, faute de commande copilot dédiée à ce composant.
  const creerUiDocument = (name, html, css) => {
    C('create_object', { type: 'group', name: name });
    const n = scene.getObjectByName(name);
    if (n) n.addComponent('UIDocument', { html: html, css: css });
    else summary.echecs.push('UIDocument : Noeud introuvable — ' + name);
  };

  const CSS_UI = ''
    + '.ecran{position:absolute;inset:0;display:flex;flex-direction:column;'
    + 'align-items:center;justify-content:center;gap:16px;background:#080b10d9;'
    + 'color:#fff;font-family:sans-serif;text-align:center}'
    + '.ecran .title{font-size:58px;font-weight:bold}'
    + '.ecran .sous-title,.ecran .aide{font-size:20px;color:#9fb3c8}'
    + '.ecran .choix{font-size:44px;font-weight:bold}'
    + '.hud{position:absolute;inset:0;font-family:sans-serif;color:#e8eef5;pointer-events:none}'
    + '.hud .score{position:absolute;top:16px;left:50%;transform:translateX(-50%);'
    + 'font-size:38px;font-weight:bold;color:#fff;background:#0d0f12b3;'
    + 'border-radius:10px;padding:4px 18px}'
    + '.hud .domicile{position:absolute;top:26px;left:calc(50% - 300px);width:150px;'
    + 'font-size:19px;font-weight:bold;text-align:right}'
    + '.hud .exterieur{position:absolute;top:26px;left:calc(50% + 150px);width:150px;'
    + 'font-size:19px;font-weight:bold}'
    + '.hud .controle{position:absolute;bottom:20px;left:20px;font-size:15px;'
    + 'background:#0d0f12b3;border-radius:8px;padding:4px 10px}'
    + '.hud .message{position:absolute;top:calc(50% - 50px);left:50%;'
    + 'transform:translateX(-50%);font-size:30px;font-weight:bold;color:#ffd54f}'
    + '.hud .message:empty{display:none}';

  creerUiDocument('UI Accueil',
    '<div class="ecran">'
    + '<div class="title">COUP FRANC</div>'
    + '<div class="sous-title">Espace pour commencer</div>'
    + '</div>', CSS_UI);

  creerUiDocument('UI Selection',
    '<div class="ecran">'
    + '<div class="title">VOTRE ÉQUIPE</div>'
    + '<div class="choix"></div>'
    + '<div class="aide">Gauche / Droite pour changer · Espace pour valider</div>'
    + '</div>', CSS_UI);

  creerUiDocument('UI Match',
    '<div class="hud">'
    + '<div class="score" data-bind="score">0 — 0</div>'
    + '<div class="domicile" data-bind="domicile"></div>'
    + '<div class="exterieur" data-bind="exterieur"></div>'
    + '<div class="controle" data-bind="controle">-</div>'
    + '<div class="message" data-bind="message"></div>'
    + '</div>', CSS_UI);

  C('configure_environment', { sky: 'gradient', skyTop: '#6fb7f0', skyBottom: '#cfe9ff',
    brouillard: false, ambiante: 0.85, sun: 1 });

  project.name = 'Coup Franc - football';
  summary.analyse = C('analyze_scene');
  summary.project = await buildDataProject();
  // Archive .p3d réelle — le format qu'un utilisateur enregistre et rouvre.
  // Produite dans le MÊME passage que le JSON, donc impossible à désynchroniser.
  summary.archive = Array.from(fflate.zipSync(splitProject(summary.project), { level: 6 }));
  return summary;
}, { equipes: EQUIPES, camps: CAMPS, arbitre: SCRIPT_ARBITRE, camera: SCRIPT_CAMERA });

await navigateur.close();

if (ratio.echecs.length) {
  console.error('Commandes en echec :');
  ratio.echecs.forEach((e) => console.error('  ' + e));
  process.exit(1);
}
if (erreursPage.length) {
  console.error('Exceptions dans la page :');
  erreursPage.forEach((e) => console.error('  ' + e));
  process.exit(1);
}

fs.writeFileSync(sortie, JSON.stringify(ratio.project, null, 2) + '\n');

// L'archive .p3d va dans projets/ à la racine du dépôt : c'est le folder que
// l'équipe ouvre depuis l'explorateur, à côté du launcher.
const dossierProjets = path.join(dirname, '..', '..', 'projets');
fs.mkdirSync(dossierProjets, { recursive: true });
const archive = path.join(dossierProjets, 'coup-franc.p3d');
fs.writeFileSync(archive, Buffer.from(ratio.archive));
const objects = ratio.project.scenes[0].data.objects;
console.log('Ecrit : ' + path.relative(process.cwd(), sortie));
console.log('  ' + ratio.appels + ' commandes copilot, 0 echec');
const nomsUi = ['UI Accueil', 'UI Selection', 'UI Match'];
console.log('  ' + objects.length + ' objets, ' + nomsUi.length
  + ' documents d interface, ' + EQUIPES.length + ' equipes');
console.log('  analyse : ' + ratio.analyse);
