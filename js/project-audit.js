// ---------- Audit de STRUCTURE d'un projet : le créateur peut-il le retoucher ? ----------
//
// analyze_scene contrôle la scène (chevauchements, objets hors sol). Il ne voyait pas le défaut
// le plus coûteux d'un projet fait par une IA : un jeu entier caché dans un script, une scène vide
// dans l'éditeur, qui se remplit au lancement. Tout « marche », et le créateur ne peut rien toucher
// (Age of Ampyre, 2026-09-29). Cet audit mesure ça, à l'échelle du PROJET.
//
// Pur (ni DOM ni THREE) : la commande audit_project (js/copilot-workshop.js) lui passe un
// instantané, et test/project-audit.test.mjs le teste sous node.
//
// Instantané attendu :
//   {scripts: [{name, folder, code, holders}],   holders = nombre d'objets qui l'utilisent
//    objects: [{name, depth, generic}],          depth 0 = racine de la scène
//    assets:  [{kind, name, folder, validated?, changedSinceValidation?}],
//    violations: {id: nombre}}                    infractions signalées pendant la session

import { SCRIPT_LINES_WARN, lintScriptAssets, spawnsLevelInStart } from './script-asset-lint.js';
import { ruleText } from './ai-rules.js';

// Au-delà, un seul script porte « l'essentiel » du code du projet.
const MONOLITH_SHARE = 0.6;
const MONOLITH_MIN_LINES = 150;
// Appels de création dans un même script : au-delà, il pose le niveau lui-même.
const SPAWN_CALLS_MAX = 8;
const ROOT_OBJECTS_MAX = 8;

// Bibliothèque : écrit `exports.f = …`, `module.exports`, ou passe par un alias `var X = exports; X.f = …`.
export function isLibraryCode(code){
  const src = String(code || '');
  return /\bexports\s*\./.test(src) || /\bmodule\.exports\b/.test(src)
    || /\b(?:var|let|const)\s+[A-Za-z_$][\w$]*\s*=\s*exports\b/.test(src);
}

function lineCount(code){ return String(code || '').split('\n').length; }

function countMatches(src, re){
  const m = String(src || '').match(re);
  return m ? m.length : 0;
}

/**
 * Rend `{issues: [{level, text}], stats}`. `level` : 'grave' (le créateur ne peut pas retoucher),
 * 'attention' (à vérifier). Chaque texte dit quoi faire, pas seulement ce qui ne va pas.
 */
export function auditProject(snapshot){
  const scripts = (snapshot && snapshot.scripts) || [];
  const objs = (snapshot && snapshot.objects) || [];
  const assetList = (snapshot && snapshot.assets) || [];
  const issues = [];
  const add = function(level, text){ issues.push({level: level, text: text}); };

  const totalLines = scripts.reduce(function(n, s){ return n + lineCount(s.code); }, 0);

  scripts.forEach(function(s){
    const code = String(s.code || '');
    const n = lineCount(code);
    // Un script qui porte l'essentiel du code : le jeu est un programme, pas un projet.
    if(n >= MONOLITH_MIN_LINES && n / totalLines >= MONOLITH_SHARE && scripts.length < 4){
      add('grave', 'le script « ' + s.name + ' » porte ' + Math.round(100 * n / totalLines) + ' % du code du projet ('
        + n + ' lignes, ' + scripts.length + ' script(s) en tout) : découpe-le en un script par comportement, '
        + 'attaché à l\'objet qu\'il pilote, et sors le contenu en assets');
    } else if(n > SCRIPT_LINES_WARN){
      add('attention', 'le script « ' + s.name + ' » fait ' + n + ' lignes : vérifie qu\'il ne porte qu\'un comportement');
    }
    // Pose le niveau lui-même : beaucoup de créations, ou des créations en boucle dans start.
    const spawns = countMatches(code, /\bapi\.create\s*\(/g);
    const loopSpawn = spawnsLevelInStart(code);
    if(loopSpawn){
      add('grave', 'le script « ' + s.name + ' » ' + ruleText('scripts.no_level_in_start'));
    } else if(spawns > SPAWN_CALLS_MAX){
      add('grave', 'le script « ' + s.name + ' » crée des objets ' + spawns + ' fois'
        + ' : un niveau se pose dans la scène (objets, prefabs instanciés, paint_room), il n\'est pas '
        + 'généré au lancement — api.create sert aux apparitions en jeu');
    }
    if(!s.holders && !isLibraryCode(code)){
      add('attention', 'le script « ' + s.name + ' » n\'est attaché à aucun objet (et n\'est pas une bibliothèque)');
    }
    if(!s.folder){
      add('attention', 'le script « ' + s.name + ' » est à la racine des assets : range-le dans Scripts/<Domaine> (move_asset)');
    }
    if(n > 40 && !/@vars/.test(code) && countMatches(code, /\b\d+(\.\d+)?\b/g) > 25){
      add('attention', 'le script « ' + s.name + ' » contient beaucoup de nombres en dur et aucun bloc @vars : '
        + 'expose les réglages dans l\'inspecteur (/* @vars {...} */, lus par api.props())');
    }
  });

  // Scène presque vide et beaucoup de code : le contenu est dans les scripts.
  if(objs.length <= 3 && totalLines >= MONOLITH_MIN_LINES){
    add('grave', 'la scène ne compte que ' + objs.length + ' objet(s) pour ' + totalLines + ' lignes de script : '
      + 'le contenu du jeu doit être dans la scène et les assets, visibles dans l\'éditeur');
  }

  const roots = objs.filter(function(o){ return !o.depth; });
  if(roots.length > ROOT_OBJECTS_MAX){
    add('attention', roots.length + ' objets à la racine de la scène : regroupe-les sous des groupes '
      + '(Environnement, Gameplay, Lumières, Joueur, UI)');
  }
  const generic = objs.filter(function(o){ return o.generic; });
  if(generic.length){
    add('attention', generic.length + ' objet(s) au nom générique (' + generic.slice(0, 5).map(function(o){ return o.name; }).join(', ')
      + (generic.length > 5 ? '…' : '') + ') : renomme-les d\'après ce qu\'ils sont');
  }

  const loose = assetList.filter(function(a){ return !a.folder && a.kind !== 'script'; });
  if(loose.length){
    add('attention', loose.length + ' asset(s) à la racine (' + loose.slice(0, 5).map(function(a){ return a.name; }).join(', ')
      + (loose.length > 5 ? '…' : '') + ') : ' + ruleText('assets.folder') + ' (move_asset)');
  }
  assetList.forEach(function(a){
    if(a.kind !== 'documentUI' || !a.html) return;
    frozenBoundClasses(a.html).forEach(function(f){
      add('attention', 'le document UI « ' + a.name + ' » écrit la classe « ' + f.cls + ' » en dur sur l\'élément lié à « '
        + f.key + ' » (data-bind-class) : le moteur GARDE la classe du HTML et y ajoute la valeur liée, donc « '
        + f.cls + ' » ne part jamais et l\'élément reste figé dans cet état — retire-la du HTML, le script la pose');
    });
  });
  // Modèles et prefabs rangés hors de leur dossier de type (Zeldo : tout était à la racine, ou en vrac).
  [['model', 'Models'], ['prefab', 'Prefabs']].forEach(function(k){
    const out = assetList.filter(function(a){ return a.kind === k[0] && a.folder && a.folder.split('/')[0] !== k[1]; });
    if(out.length){
      add('attention', out.length + ' ' + k[0] + '(s) hors de ' + k[1] + '/ (' + out.slice(0, 5).map(function(a){ return a.name; }).join(', ')
        + (out.length > 5 ? '…' : '') + ') : ' + ruleText('assets.folder') + ' (move_asset)');
    }
  });
  // Lumières, géométrie et matériaux construits par un script : le créateur ne les voit pas.
  scripts.forEach(function(s){
    const lint = lintScriptAssets(s.code);
    // Des lumières en code sont REFUSÉES à l'écriture ; celles d'un script plus ancien restent graves.
    if(lint.blocking.indexOf(ruleText('scripts.no_lights')) !== -1) add('grave', 'le script « ' + s.name + ' » ' + ruleText('scripts.no_lights'));
    lint.warnings.forEach(function(w){
      if(w === ruleText('scripts.no_geometry') || w === ruleText('scripts.no_material')) add('attention', 'le script « ' + s.name + ' » ' + w);
    });
  });
  // Un asset validé par l'utilisateur puis modifié : le travail validé a bougé sans son accord.
  assetList.forEach(function(a){
    if(a.validated && a.changedSinceValidation){
      add('grave', 'l\'asset validé « ' + a.name + ' » a été modifié depuis sa validation : ' + ruleText('assets.validated_overwrite'));
    }
  });
  // Les infractions que le moteur a déjà signalées pendant la session (post-contrôle des outils).
  const viol = (snapshot && snapshot.violations) || {};
  Object.keys(viol).forEach(function(id){
    add('attention', 'règle ' + id + ' signalée ' + viol[id] + ' fois pendant cette session : ' + ruleText(id));
  });
  const kinds = {};
  assetList.forEach(function(a){ kinds[a.kind] = (kinds[a.kind] || 0) + 1; });
  if(totalLines >= MONOLITH_MIN_LINES && !kinds.data && !kinds.prefab && !kinds.material){
    add('attention', 'aucune table data, aucun prefab, aucun matériau pour ' + totalLines + ' lignes de script : '
      + 'le contenu (statistiques, éléments répétés, apparences) est probablement écrit en code');
  }

  return {
    issues: issues,
    stats: {scripts: scripts.length, scriptLines: totalLines, objects: objs.length,
      rootObjects: roots.length, assets: assetList.length}
  };
}

// Classes d'ÉTAT écrites en dur sur un élément qui porte aussi data-bind-class. js/game-ui.js
// (_applyClassBind) garde la classe du HTML et y AJOUTE la valeur liée : `class="invite off"` lié à
// « on » donne `invite off on`, et `.invite.off{display:none}` le cache toujours. Le HUD de Zeldo
// n'a jamais affiché son invite ni ses dialogues à cause de ça (2026-10-01), sans un mot en console.
// Est suspecte une classe autre que la première qui est un mot d'état connu, ou qu'une règle CSS
// du document combine à une autre classe (`.x.off`) : c'est alors un état, pas une mise en page.
const STATE_CLASSES = ['on', 'off', 'hidden', 'visible', 'active', 'inactive', 'show', 'hide', 'open', 'closed',
  'actif', 'inactif', 'cache', 'masque', 'ouvert', 'ferme'];
export function frozenBoundClasses(html){
  const src = String(html || ''), out = [];
  const compound = {};
  (src.match(/\.[\w-]+\.([\w-]+)/g) || []).forEach(function(sel){ compound[sel.split('.')[2]] = true; });
  const tags = src.match(/<[a-z][^>]*\bdata-bind-class\s*=\s*"[^"]*"[^>]*>/gi) || [];
  tags.forEach(function(tag){
    const cls = /\bclass\s*=\s*"([^"]*)"/i.exec(tag), key = /\bdata-bind-class\s*=\s*"([^"]*)"/i.exec(tag);
    if(!cls) return;
    cls[1].trim().split(/\s+/).slice(1).forEach(function(t){
      if(STATE_CLASSES.indexOf(t.toLowerCase()) !== -1 || compound[t]) out.push({key: key[1], cls: t});
    });
  });
  return out;
}

// Un nom tel que le moteur le donne à la création : « Cube 12 », « Sphere », « Group 3 ».
export function isGenericName(name){
  return /^(cube|sph[eè]re|sphere|cylindre|cylinder|c[oô]ne|cone|tore|torus|plan|plane|groupe?|group|objet|object|sprite|lumi[eè]re|light|empty|vide)(\s*\d+)?$/i
    .test(String(name || '').trim());
}

/** Le texte rendu par la commande. */
export function formatAudit(r){
  const s = r.stats;
  const head = s.scripts + ' script(s), ' + s.scriptLines + ' lignes · ' + s.objects + ' objet(s) dans la scène ('
    + s.rootObjects + ' à la racine) · ' + s.assets + ' asset(s).';
  if(!r.issues.length) return head + '\nStructure saine : le contenu est dans les assets et la scène.';
  const order = {grave: 0, attention: 1};
  return head + '\n' + r.issues.slice().sort(function(a, b){ return order[a.level] - order[b.level]; })
    .map(function(i){ return (i.level === 'grave' ? '✗ ' : '⚠ ') + i.text; }).join('\n');
}

/** Les lignes `grave` de l'audit, ajoutées au résultat de save_project et play_and_measure ('' si aucune). */
export function formatGraveIssues(r){
  const grave = r.issues.filter(function(i){ return i.level === 'grave'; });
  if(!grave.length) return '';
  return '\n✗ audit : ' + grave.length + ' point(s) grave(s) — ' + grave.map(function(i){ return i.text; }).join(' ✗ ');
}
