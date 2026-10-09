// Reconstruit le game de démonstration « Plateforme » en n'appelant QUE les commandes
// du copilot (js/copilot.js) — la même surface qu'un modèle utilise. Le fichier
// plateforme-demo.p3d.json qui en sort est donc reproductible, et ce script sert
// aussi de test de bout en bout de cette surface : s'il casse, c'est que le
// copilot ne suffit plus à construire un game complet.
//
//   node exemples/construire-demo-plateforme.mjs
//
// Deux mesures valent d'être connues avant de lire les positions :
//   - le cube natif du moteur mesure 1,6 unité, pas 1 : une échelle x=2,5 donne
//     une plateforme large de 4. Toutes les largeurs ci-dessous en découlent.
//   - la sphère native a un radius de 1 ; le joueur est mis à l'échelle 0,6.
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const editeurUrl = pathToFileURL(path.join(dirname, '..', 'editor.html')).href;
const sortie = path.join(dirname, 'plateforme-demo.p3d.json');

// Écrit avec le contrôleur de personnage (api.deplacerPersonnage) et les
// contacts (api.auContact). La version précédente faisait la même chose en
// deux fois plus de lignes : gravité, raycast, calage sur la surface, et une
// comparaison de distances sur chaque pièce à chaque image.
const SCRIPT_JOUEUR = `function start(api){
  const p = api.props();
  p.pieces = 0; p.vies = 3; p.fini = false;
  p.total = api.byTag('coin').length;
  api.status('Ramasse les ' + p.total + ' pieces, puis rejoins le drapeau');

  api.auContact('coin', function(piece){
    if(p.fini) return;
    api.detruire(piece); p.pieces++;
    api.status('Pieces : ' + p.pieces + '/' + p.total);
  });

  api.auContact('ennemi', function(ennemi){
    if(p.fini) return;
    // On l'écrase si on lui tombe dessus, il nous coûte une vie sinon.
    if(api.me.position.y > ennemi.position.y + 0.3){
      api.detruire(ennemi); api.rebondir(7); api.status('Ennemi ecrase !');
    } else { perdreUneVie(api, 'Aie !'); }
  });

  api.auContact('but', function(){
    if(p.fini) return;
    if(p.pieces >= p.total){ p.fini = true; api.status('GAGNE ! ' + p.pieces + '/' + p.total + ' pieces'); }
    else api.status('Il manque ' + (p.total - p.pieces) + ' piece(s)');
  });
}
function perdreUneVie(api, cause){
  const p = api.props();
  p.vies--;
  if(p.vies <= 0){ p.fini = true; api.status('Perdu — plus de vies'); }
  else { api.status(cause + ' Vies restantes : ' + p.vies); api.reapparaitre(); }
}
function update(api){
  if(api.props().fini) return;
  const state = api.deplacerPersonnage({speed:7, saut:9.5, gravite:24});
  if(state.tombe) perdreUneVie(api, 'Tombe !');
}`;

const SCRIPT_PIECE = `function start(api){ api.props().y0 = api.me.position.y; }
function update(api){
  api.me.rotateY(2.2 * api.dt);
  api.me.position.y = api.props().y0 + Math.sin(api.temps * 3) * 0.15;
}`;

const SCRIPT_ENNEMI = `function start(api){ api.props().x0 = api.me.position.x; }
function update(api){
  api.me.position.x = api.props().x0 + Math.sin(api.temps * 1.6) * 1.5;
}`;

const SCRIPT_CAMERA = `function update(api){
  const j = api.trouver('Joueur');
  if(!j) return;
  const m = api.me, k = Math.min(1, api.dt * 4);
  m.position.x += (j.position.x - m.position.x) * k;
  m.position.y += (j.position.y + 5 - m.position.y) * k;
  m.position.z += (j.position.z + 12 - m.position.z) * k;
  api.regarder(j);
}`;

const navigateur = await chromium.launch({ args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist'] });
const page = await navigateur.newPage();
await page.goto(editeurUrl);
await page.waitForFunction('typeof createObject === "function"');

const ratio = await page.evaluate(async (s) => {
  const summary = { appels: 0, echecs: [] };
  const C = (name, args) => {
    const cmd = COMMANDS.find((c) => c.name === name);
    if (!cmd) { summary.echecs.push('commande inconnue : ' + name); return; }
    summary.appels++;
    try { cmd.exec(args || {}); }
    catch (e) { summary.echecs.push(name + ' — ' + e.message); }
  };

  // Table rase. On ne suppose pas l'état de départ, et on re-liste après CHAQUE
  // suppression : delete_object emporte les enfants, et la scène de départ
  // parente la sphère et le spot au cube (startup.js). Lister une fois puis
  // supprimer en loop ferait échouer les appels suivants sur des objets déjà
  // partis — c'est le piège de cette surface.
  const lister = () => JSON.parse(COMMANDS.find((c) => c.name === 'list_scene').exec()).objects;
  for (let garde = 0; garde < 200; garde++) {
    const restant = lister().find((o) => o.type !== 'camera');
    if (!restant) break;
    C('delete_object', { name: restant.name });
  }

  C('create_object', { type: 'directional', name: 'Soleil', position: { x: 10, y: 20, z: 10 } });

  // [name, centerX, centerY, échelleX, échelleZ] — width réelle = échelleX × 1,6
  [['Sol', 0, -0.5, 6.25, 3], ['Plateforme 1', 9.5, 0.5, 2.5, 2.5],
   ['Plateforme 2', 16, 1.5, 2.5, 2.5], ['Plateforme 3', 22.5, 2.5, 2.5, 2.5],
   ['Plateforme 4', 29.4, 2.5, 3, 2.5], ['Plateforme 5', 37.2, 3.5, 4, 3]
  ].forEach((p) => {
    C('create_object', { type: 'cube', name: p[0], position: { x: p[1], y: p[2], z: 0 } });
    C('transform', { name: p[0], scale: { x: p[3], y: 1, z: p[4] } });
    C('configure_game', { name: p[0], tag: 'ground', layer: 'Décor' });
    C('configure_material', { name: p[0], color: '#3d7a4a' });
  });

  C('create_object', { type: 'sphere', name: 'Joueur', position: { x: 0, y: 2, z: 0 } });
  C('transform', { name: 'Joueur', scale: { x: 0.6, y: 0.6, z: 0.6 } });
  C('configure_game', { name: 'Joueur', tag: 'joueur', layer: 'Joueur' });
  C('configure_material', { name: 'Joueur', color: '#e8452c' });
  C('attach_script', { name: 'Joueur', code: s.joueur });

  // Une pièce complète, puis des copies : duplicate_object emporte le script, le
  // matériau et le tag. Quatre commandes au lieu de cinq par pièce.
  // Pièces à l'échelle 0,55 (soit 1,54 de large : le tore natif fait 2,8).
  // Elles étaient à 0,35 et le ramassage se jouait à la limite exacte du
  // recouvrement de boîtes — approche minimale mesurée entre 0,97 et 1,32 sur
  // TOUTES les pièces, pas seulement celle en plein vol. api.auContact teste un
  // recouvrement, bien plus strict qu'une comparaison de distances : un petit
  // objet croisé à la course se rate. La 4e reste au-dessus du trou, mais à
  // 4,5 et non 5, le sommet du saut étant à 5,18.
  const pieces = [[9.5, 2.5], [16, 3.5], [22.5, 4.5], [26, 4.5], [29.4, 4.5], [37.2, 5.5]];
  C('create_object', { type: 'torus', name: 'Pièce 1', position: { x: pieces[0][0], y: pieces[0][1], z: 0 } });
  C('transform', { name: 'Pièce 1', scale: { x: 0.55, y: 0.55, z: 0.55 } });
  C('configure_game', { name: 'Pièce 1', tag: 'coin' });
  C('configure_material', { name: 'Pièce 1', color: '#ffcc33', emissive: '#7a5500' });
  C('attach_script', { name: 'Pièce 1', code: s.piece });
  pieces.slice(1).forEach((c, i) => {
    C('duplicate_object', { name: 'Pièce 1', new: 'Pièce ' + (i + 2),
      position: { x: c[0], y: c[1], z: 0 } });
  });

  [['Ennemi 1', 22.5, 3.78], ['Ennemi 2', 37.2, 4.78]].forEach((e) => {
    C('create_object', { type: 'cube', name: e[0], position: { x: e[1], y: e[2], z: 0 } });
    C('transform', { name: e[0], scale: { x: 0.6, y: 0.6, z: 0.6 } });
    C('configure_game', { name: e[0], tag: 'ennemi', layer: 'Ennemis' });
    C('configure_material', { name: e[0], color: '#7b3fb5' });
    C('attach_script', { name: e[0], code: s.ennemi });
  });

  C('create_object', { type: 'cone', name: 'Drapeau', position: { x: 39.5, y: 5.58, z: 0 } });
  C('transform', { name: 'Drapeau', scale: { x: 0.8, y: 1.6, z: 0.8 } });
  C('configure_game', { name: 'Drapeau', tag: 'but' });
  C('configure_material', { name: 'Drapeau', color: '#ffd700', emissive: '#8a6d00' });

  // La caméra du départ porte le script de suivi.
  const cam = lister().find((o) => o.type === 'camera');
  if (cam) C('attach_script', { name: cam.name, code: s.camera });

  C('configure_environment', { sky: 'gradient', skyTop: '#4aa3e0', skyBottom: '#cfe9ff',
    brouillard: false, ambiante: 0.75, sun: 1 });

  project.name = 'Plateforme — démo';
  // Contrôle de jouabilité AVANT de figer le fichier : les commandes peuvent
  // toutes réussir et produire un niveau infranchissable. C'est arrivé.
  summary.analyse = COMMANDS.find((c) => c.name === 'analyze_scene').exec();
  summary.project = await buildDataProject();
  // Archive .p3d réelle — le format qu'un utilisateur enregistre et rouvre.
  // Produite dans le MÊME passage que le JSON, donc impossible à désynchroniser.
  summary.archive = Array.from(fflate.zipSync(splitProject(summary.project), { level: 6 }));
  return summary;
}, { joueur: SCRIPT_JOUEUR, piece: SCRIPT_PIECE, ennemi: SCRIPT_ENNEMI, camera: SCRIPT_CAMERA });

await navigateur.close();

if (ratio.echecs.length) {
  console.error('Commandes en échec :');
  ratio.echecs.forEach((e) => console.error('  ' + e));
  process.exit(1);
}

fs.writeFileSync(sortie, JSON.stringify(ratio.project, null, 2) + '\n');

// L'archive .p3d va dans projets/ à la racine du dépôt : c'est le folder que
// l'équipe ouvre depuis l'explorateur, à côté du launcher. Un game de démo doit
// être un project ORDINAIRE — sinon il n'apprend rien sur l'outil.
const dossierProjets = path.join(dirname, '..', '..', 'projets');
fs.mkdirSync(dossierProjets, { recursive: true });
const archive = path.join(dossierProjets, 'plateforme.p3d');
fs.writeFileSync(archive, Buffer.from(ratio.archive));
const objects = ratio.project.scenes[0].data.objects;
console.log('Écrit : ' + path.relative(process.cwd(), sortie));
console.log('  ' + ratio.appels + ' commandes copilot, 0 échec');
console.log('  analyse de jouabilité : ' + ratio.analyse);
console.log('  ' + objects.length + ' objets, '
  + objects.filter((o) => o.scripts && o.scripts.length).length + ' porteurs de script');
