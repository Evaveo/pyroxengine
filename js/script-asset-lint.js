// ---------- Un script est du COMPORTEMENT, pas du contenu ----------
//
// Né d'un jeu façon Age of Empires construit par un agent MCP (2026-09-29) : tout le jeu tenait
// dans UN script de 180 000 caractères — statistiques des unités en littéraux, carte générée,
// interface dessinée sur un canevas, rendu isométrique fait main. Rien de tout cela n'était
// visible ni retouchable par le créateur dans le panneau Projet : ni une table, ni une scène, ni
// un matériau. Le moteur est fait pour que le contenu soit des ASSETS sérialisés ; ce contrôle
// refuse le pire et signale le reste, à chaque attach_script / replace_script.
//
// Pur (ni DOM ni THREE) : testé sous node (test/script-asset-lint.test.mjs).

import { ruleText } from './ai-rules.js';

export const SCRIPT_LINES_WARN = 300;
export const SCRIPT_LINES_MAX = 800;

// Chaque règle : ce qu'on cherche, et l'asset à créer à la place. `block` = refus.
const RULES = [
  {id: 'scripts.no_base64', block: true, re: /data:(image|audio|font|model|application\/octet-stream)[^'"`\s]*;base64,/i,
    msg: ruleText('scripts.no_base64')},
  {id: 'scripts.no_canvas_art', block: true, re: /createElement\(\s*['"]canvas['"]\s*\)[\s\S]{0,4000}?\b(fillRect|arc|lineTo|putImageData)\b/,
    msg: ruleText('scripts.no_canvas_art')},
  // Les motifs qui contiennent « new » sont écrits en chaîne : dans un littéral /…/, le garde du
  // glossaire (test/cliquets-dette.test.mjs) le lirait comme un identifiant.
  {id: 'scripts.no_synth_audio', block: true, re: RegExp('\\b(createOscillator|createBufferSource|new\\s+(Offline)?AudioContext)\\b'),
    msg: ruleText('scripts.no_synth_audio')},
  {id: 'scripts.no_geometry', block: false, re: RegExp('new\\s+THREE\\.\\w+Geometry\\b'),
    msg: ruleText('scripts.no_geometry')},
  {id: 'scripts.no_material', block: false, re: RegExp('new\\s+THREE\\.Mesh\\w*Material\\b'),
    msg: ruleText('scripts.no_material')},
  // Zeldo, 2026-10-02 : soleil, ciel et lumières des feux étaient créés par Jeu_Principal/Decor —
  // invisibles et non réglables dans l'éditeur. Une lumière est un objet de scène.
  {id: 'scripts.no_lights', block: true, re: RegExp('new\\s+THREE\\.(Hemisphere|Directional|Point|Spot|Ambient|RectArea)Light\\b'),
    msg: ruleText('scripts.no_lights')}
];

// Une table de contenu écrite en littéral : beaucoup d'objets qui portent les MÊMES clés.
function literalTables(code){
  const shapes = {};
  const re = /\{\s*((?:[A-Za-z_$][\w$]*\s*:[^{}:,]*,\s*){3,}[A-Za-z_$][\w$]*\s*:[^{}]*)\}/g;
  let m;
  while((m = re.exec(code))){
    const keys = (m[1].match(/([A-Za-z_$][\w$]*)\s*:/g) || []).map(function(k){ return k.replace(/\s*:$/, ''); });
    const sig = keys.slice(0, 4).join(',');
    shapes[sig] = (shapes[sig] || 0) + 1;
  }
  let worst = 0;
  Object.keys(shapes).forEach(function(k){ if(shapes[k] > worst) worst = shapes[k]; });
  return worst;
}

// Un niveau posé par le script : des api.create en BOUCLE dans start. api.create hors de start (tirs,
// vagues d'ennemis) reste permis — seule la génération du niveau au lancement est refusée.
// Une boucle `for (…; i < N; …)` bornée par un PETIT littéral (4 boutons d'interface, 3 vies) n'est
// pas un niveau : elle reste permise. Seules les boucles non bornées ou grandes sont refusées.
export const SMALL_LOOP_MAX = 8;
function isSmallBoundedLoop(header){
  const m = /^for\s*\([^;]*;\s*[A-Za-z_$][\w$]*\s*(<=?)\s*(\d+)\s*;/.exec(header);
  if(!m) return false;
  return Number(m[2]) + (m[1] === '<=' ? 1 : 0) <= SMALL_LOOP_MAX;
}
export function spawnsLevelInStart(code){
  const startBody = /function\s+start\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(String(code || ''));
  if(!startBody) return false;
  const body = startBody[1];
  const re = /\b(for|while)\b/g;
  let m;
  while((m = re.exec(body))){
    const rest = body.slice(m.index, m.index + 400);
    if(!/\bapi\.create\s*\(/.test(rest) || isSmallBoundedLoop(rest)) continue;
    return true;
  }
  return false;
}

/**
 * Examine le code d'un script. Rend `{blocking: [...], warnings: [...]}` (messages en clair).
 * `blocking` non vide = le script doit être refusé.
 */
export function lintScriptAssets(code){
  const src = String(code || '');
  const blocking = [], warnings = [];
  const lines = src.split('\n').length;
  if(lines > SCRIPT_LINES_MAX){
    blocking.push('le script fait ' + lines + ' lignes (maximum ' + SCRIPT_LINES_MAX + ') : découpe-le en '
      + 'plusieurs scripts courts, un par comportement, attachés aux objets qu\'ils pilotent, et mets le '
      + 'contenu (statistiques, cartes, textes) dans des assets');
  } else if(lines > SCRIPT_LINES_WARN){
    warnings.push('le script fait ' + lines + ' lignes : un script = un comportement ; au-delà de '
      + SCRIPT_LINES_WARN + ' lignes, vérifie qu\'il ne porte pas du contenu qui devrait être un asset');
  }
  RULES.forEach(function(r){
    if(r.re.test(src)) (r.block ? blocking : warnings).push(r.msg);
  });
  if(spawnsLevelInStart(src)) blocking.push(ruleText('scripts.no_level_in_start'));
  const n = literalTables(src);
  if(n >= 12){
    warnings.push(n + ' objets littéraux de même forme : c\'est une table de contenu, mets-la dans un '
      + 'asset data (create_data) et lis-la avec api.data(nom)');
  }
  return {blocking: blocking, warnings: warnings};
}

/** Lève si le script est refusé ; sinon rend le texte d'avertissement à ajouter ('' si rien). */
export function enforceScriptAssets(code){
  const r = lintScriptAssets(code);
  if(r.blocking.length){
    throw Error('script refusé — le contenu doit être des ASSETS, pas du code : '
      + r.blocking.join(' · '));
  }
  return r.warnings.length ? ' ⚠ ' + r.warnings.join(' · ') : '';
}
