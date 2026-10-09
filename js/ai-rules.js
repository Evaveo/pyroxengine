// ---------- Registre unique des règles de l'IA et du MCP ----------
//
// Les règles vivaient en quatre endroits (instructions, lint des scripts, audit du projet, README
// de l'addon Blender), recopiées à la main et libres de dériver. Zeldo (2026-10-01/02) les a
// enfreintes à répétition : assets laissés à la racine, modèle validé reconstruit au lieu d'être
// retouché, import avant validation, lissage sans demande, décor et lumières générés par script.
// Une règle qui n'est qu'une phrase dans une invite n'est pas appliquée : ce registre est la
// source de leur TEXTE ; les gardes (lint, handlers, audit) en tirent leurs messages.
//
// `level` : 'block' = le moteur refuse · 'warn' = le moteur signale dans le résultat de l'outil ·
// 'audit' = relevé par audit_project. L'`id` est en anglais, le `text` en français (interface).
//
// PUR : ni DOM, ni THREE, ni import d'un module de l'éditeur (le pont MCP l'importe sous node).
// Testé par test/ai-rules.test.mjs.

export const AI_RULES = [
  // ----- Scripts (js/script-asset-lint.js) -----
  {id: 'scripts.no_base64', level: 'block',
    text: 'contient un fichier encodé en base64 : importe-le comme asset (import_image, import_audio, import_model)'},
  {id: 'scripts.no_canvas_art', level: 'block',
    text: 'dessine des images sur un canevas : fabrique des textures (create_texture, import_image, bake_iso_sprites) et lis-les avec api.image(nom)'},
  {id: 'scripts.no_synth_audio', level: 'block',
    text: 'synthétise du son en code : crée des assets bruitage / musique (create_sfx, create_music_loop, import_audio) et joue-les avec api.playSound(nom)'},
  {id: 'scripts.no_geometry', level: 'warn',
    text: 'construit des maillages en code : crée des objets de scène (create_object, prefabs) ou importe un modèle (import_model)'},
  {id: 'scripts.no_material', level: 'warn',
    text: 'crée des matériaux en code : crée des assets matériau (create_material) et affecte-les aux objets'},
  {id: 'scripts.no_lights', level: 'block',
    text: 'crée des lumières en code : pose-les dans la scène (create_object point/spot/directional, configure_light, configure_environment pour l\'ambiance) et retrouve-les avec api.find(nom)'},
  {id: 'scripts.no_level_in_start', level: 'block',
    text: 'crée des objets en boucle dans start : un niveau se pose dans la scène (objets, prefabs instanciés, paint_room), il n\'est pas généré au lancement — api.create sert aux apparitions en jeu'},

  // ----- Rangement (handlers, audit) -----
  {id: 'assets.folder', level: 'warn',
    text: 'range les assets par TYPE puis par usage (Models/, Prefabs/, Textures/, Audio/, Materials/, Data/, Scripts/<Domaine>), jamais à la racine'},
  {id: 'scene.root_object', level: 'warn',
    text: 'aucun objet en vrac à la racine de la scène : regroupe-les sous des groupes (Environnement, Gameplay, Lumières, Joueur, UI)'},
  {id: 'scene.generic_name', level: 'warn',
    text: 'nomme l\'objet d\'après ce qu\'il est (« Mur_Wallrun_G »), jamais « Cube 12 »'},
  {id: 'project.save', level: 'warn',
    text: 'rien n\'est enregistré tant que tu n\'appelles pas save_project : fais-le à la fin de chaque étape cohérente'},

  // ----- Blender -----
  {id: 'blender.edit_existing', level: 'block',
    text: 'toujours partir de la DERNIÈRE version et la RETOUCHER : ne jamais restaurer un checkpoint plus ancien ni supprimer une pièce validée sans que l\'utilisateur le demande explicitement'},
  {id: 'blender.no_import_unvalidated', level: 'block',
    text: 'n\'importe pas dans le projet avant que l\'utilisateur ait validé le rendu : montre le rendu (blender_preview) et attends sa validation'},
  {id: 'blender.no_smooth', level: 'warn',
    text: 'ne lisse pas (smooth) sans que l\'utilisateur le demande : le lissage est un choix de rendu, pas un réglage par défaut'},

  // ----- Assets validés -----
  {id: 'assets.validated_delete', level: 'block',
    text: 'cet asset a été validé par l\'utilisateur : refus sans confirm:true et sans sa confirmation dans la page'},
  {id: 'assets.validated_overwrite', level: 'block',
    text: 'cet asset a été validé par l\'utilisateur : ne l\'écrase pas par un réimport, utilise le remplacement en place (replace:true)'},
  {id: 'blender.validated_restore', level: 'block',
    text: 'ce checkpoint est antérieur à la validation d\'un asset : le restaurer défairait un travail validé'},

  // ----- Méthode -----
  {id: 'tools.missing_tool', level: 'warn',
    text: 'si une action nécessaire n\'a pas d\'outil, ne la contourne pas par un script de bricolage : dis-le, pour que l\'outil soit ajouté au moteur'}
];

const BY_ID = {};
AI_RULES.forEach(function(r){ BY_ID[r.id] = r; });

/** La règle d'un id, ou null. */
export function ruleById(id){ return BY_ID[id] || null; }

/** Le texte d'une règle. Un id inconnu LÈVE : une faute de frappe ne doit pas produire un message vide. */
export function ruleText(id){
  const r = BY_ID[id];
  if(!r) throw new Error('règle inconnue : ' + id);
  return r.text;
}

/** « règle <id> : <texte> », la forme ajoutée aux résultats d'outils et aux refus. */
export function ruleMessage(id){
  return 'règle ' + id + ' : ' + ruleText(id);
}

/** Les règles d'un niveau donné. */
export function rulesOfLevel(level){
  return AI_RULES.filter(function(r){ return r.level === level; });
}

// ---------- Post-contrôle des outils qui écrivent (phase C) ----------
//
// Après chaque outil qui MODIFIE le projet, copRun (copilot.js) compare l'état avant/après et passe
// le delta à `checkAfterWrite` : asset rangé à la racine, objet créé en vrac à la racine de la scène,
// nom générique, trop d'actions sans save_project. Le résultat de l'outil reçoit « ⚠ règle <id> : … »
// — l'agent le lit à l'instant où il commet l'écart, pas dans un audit final qu'il peut oublier.

/** Les outils qui ne modifient rien : pas de post-contrôle, pas de compte d'actions. */
export const READ_ONLY_TOOLS = [
  'list_scene', 'get_object', 'find_objects', 'get_hierarchy', 'read_script', 'read_console', 'script_api_reference', 'analyze_scene',
  'audit_project', 'load_tools', 'list_assets', 'read_asset', 'read_room', 'read_data', 'read_design',
  'summarize_scene', 'describe_material', 'read_animator_machine', 'read_sound_asset', 'capture_view',
  'blender_status', 'blender_inspect', 'blender_scene', 'blender_preview', 'check', 'play_and_measure', 'save_project'
];

/** Après combien d'outils qui écrivent, sans save_project, on le rappelle. */
export const SAVE_REMINDER_AFTER = 15;

const state = {writesSinceSave: 0, violations: {}};

/** Compte une action d'écriture ; rend le nombre d'actions depuis le dernier save_project. */
export function noteWrite(){ return ++state.writesSinceSave; }
export function noteSave(){ state.writesSinceSave = 0; }

export function recordViolation(id){ state.violations[id] = (state.violations[id] || 0) + 1; }
/** Les infractions signalées depuis le début de la session : `{id: nombre}`. */
export function violationCounts(){ return Object.assign({}, state.violations); }
export function resetViolations(){ state.violations = {}; state.writesSinceSave = 0; }

/**
 * Les règles enfreintes par ce qu'un outil vient de créer. `delta` :
 *   {newObjects: [{name, depth, isGroup, generic}], newAssets: [{kind, name, folder}], writes}
 * Rend `[{id, detail}]` — l'appelant fabrique le message avec `ruleMessage`.
 */
export function checkAfterWrite(delta){
  const d = delta || {};
  const out = [];
  const names = function(list){ return list.slice(0, 3).map(function(x){ return '« ' + x.name + ' »'; }).join(', ')
    + (list.length > 3 ? '…' : ''); };
  const loose = (d.newAssets || []).filter(function(a){ return !a.folder; });
  if(loose.length) out.push({id: 'assets.folder', detail: loose.length + ' asset(s) à la racine : ' + names(loose) + ' (move_asset)'});
  const rootObjs = (d.newObjects || []).filter(function(o){ return !o.depth && !o.isGroup; });
  if(rootObjs.length) out.push({id: 'scene.root_object', detail: rootObjs.length + ' objet(s) à la racine : ' + names(rootObjs) + ' (set_parent)'});
  const generic = (d.newObjects || []).filter(function(o){ return o.generic; });
  if(generic.length) out.push({id: 'scene.generic_name', detail: names(generic) + ' (rename_object)'});
  if(d.writes && d.writes % SAVE_REMINDER_AFTER === 0){
    out.push({id: 'project.save', detail: d.writes + ' actions depuis le dernier enregistrement'});
  }
  return out;
}

/** Le texte ajouté au résultat d'un outil : « ⚠ règle … ; règle … » ('' si rien). */
export function formatViolations(list){
  if(!list || !list.length) return '';
  return ' ⚠ ' + list.map(function(v){ return ruleMessage(v.id) + ' — ' + v.detail; }).join(' ⚠ ');
}

// ---------- Assets validés ----------
//
// « Validé » = l'utilisateur a dit que cet asset est bon. L'IA ne le supprime pas, ne l'écrase pas, ne
// restaure pas un état antérieur sans son accord. La validation vit dans les réglages du projet
// (`project.settings.validatedAssets`, voyage avec le projet) : `{idAsset: {name, fp, at}}`, où `fp` est
// l'empreinte de l'asset au moment de la validation et `at` la date (ISO).

/** Une empreinte bon marché : change si l'asset change de contenu ou de nom. */
export function assetFingerprint(a){
  const x = a || {};
  const size = (x.file && x.file.size) || (x.text || x.code || x.html || x.css || '').length || (x.regions && x.regions.length) || 0;
  return [x.kind, x.name, size].join("|");
}

/** L'asset est-il validé ? */
export function isValidated(validated, asset){
  return !!(validated && asset && validated[asset.id]);
}

/** Un asset validé a-t-il changé depuis sa validation ? */
export function changedSinceValidation(validated, asset){
  return isValidated(validated, asset) && validated[asset.id].fp !== assetFingerprint(asset);
}

/** Les assets validés APRÈS la date d'un checkpoint : le restaurer défairait leur validation. */
export function validatedAfter(validated, checkpointAt){
  const t = Date.parse(checkpointAt);
  if(!isFinite(t)) return [];
  return Object.keys(validated || {}).map(function(id){ return validated[id]; })
    .filter(function(v){ return Date.parse(v.at) > t; })
    .map(function(v){ return v.name; });
}
