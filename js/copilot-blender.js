// ---------- Les commandes Blender, pour une IA branchée par MCP ----------
//
// Ce que faisait EVAVEO 3D Studio (une application Python, sa propre boucle de chat OpenAI, ses
// neuf outils) est ici réduit à ce qui compte : les neuf outils, exposés comme des commandes du
// moteur. Ils partent donc tout seuls par les DEUX liens MCP (cloud et pont local), sans une
// ligne dans cloud/back/mcp ni dans bridge.mjs, et l'IA est celle de l'utilisateur — Claude
// Desktop, Claude Code… — pas une IA payée par le moteur.
//
// Chaque commande relaie à l'addon Blender par blender-link.js. Les descriptions sont celles du
// Studio (studio_tools.py), avec `spec` en vrai objet au lieu d'une chaîne JSON.
//
// Elles sont dans le domaine `blender` (copilot-budget.js) pour ne pas peser sur le copilote
// intégré ; `blender_status` reste toujours visible et dit comment charger les autres.

import { folderCurrent, importFiles, setFolderCurrent } from './assets.js';
import { ruleMessage, validatedAfter } from './ai-rules.js';
import { BlenderLink } from './blender-link.js';
import { CopilotTools } from './copilot.js';
import { setStatus } from './hierarchy.js';
import { pushHistory } from './history.js';
import { describePivot, explicitPivotParams } from './model-replace.js';

const MAX_TEXT = 8000;

// ---------- Pas d'import sans validation ----------
// Zeldo : des modèles importés dans le projet avant que l'utilisateur ait vu le rendu. Le moteur le
// refuse (règle blender.no_import_unvalidated) : blender_import_to_project n'est permis que si un
// rendu a été fait depuis la dernière opération Blender qui ÉCRIT — le compteur est remis à zéro à
// chaque écriture, donc la garde ne se contourne pas en rendant une fois au début.
const previewState = {seen: false};
export function blenderPreviewSeen(){ return previewState.seen; }
export function resetBlenderPreview(){ previewState.seen = false; }

// Les actions qui ne modifient pas la scène Blender (lecture, rendu, checkpoint, export sans import).
const READ_ACTIONS = {
  blender_project: ['list', 'save'],
  blender_material: ['list', 'inspect'],
  blender_rig: ['inspect'],
  blender_animation: ['list', 'preview'],
  blender_inspect: null,                                   // toutes les actions lisent
  blender_delivery: ['preview', 'turntable', 'export', 'iso']
};
const PREVIEW_ACTIONS = {blender_delivery: ['preview', 'turntable', 'iso']};

/** Cette commande modifie-t-elle la scène Blender ? */
export function isBlenderWrite(tool, action){
  if(!Object.prototype.hasOwnProperty.call(READ_ACTIONS, tool)) return true;
  const reads = READ_ACTIONS[tool];
  return reads !== null && reads.indexOf(action) === -1;
}

/** Un dossier de projet, nettoyé ; `..` refusé. */
function cleanProjectFolder(f, byDefault){
  const folder = String(f === undefined ? byDefault : f).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if(folder.split('/').some(function(s){ return s === '..'; })) throw new Error('chemin de dossier invalide');
  return folder;
}

function summarize(result){
  if(result && result.pending){
    return 'Toujours en cours dans Blender (job ' + result.pending + '). Rappeler blender_status '
      + 'avec {job: "' + result.pending + '"} dans quelques secondes.';
  }
  const s = typeof result === 'string' ? result : JSON.stringify(result, null, 1);
  return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + '\n… (tronqué)' : s;
}

function bufferToBase64(bytes){
  const u = new Uint8Array(bytes);
  let s = '';
  for(let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Une planche contact : les rendus côte à côte, en UNE image — le MCP n'en relaie qu'une par
 * réponse. Sans canvas (tests), la première image seule.
 */
async function contactSheet(urls, maxWidth){
  if(urls.length === 1 || typeof document === 'undefined' || typeof Image === 'undefined') return urls[0];
  const imgs = await Promise.all(urls.map(function(u){
    return new Promise(function(res, rej){
      const i = new Image(); i.onload = function(){ res(i); }; i.onerror = rej; i.src = u;
    });
  }));
  const cols = Math.ceil(Math.sqrt(imgs.length));
  const rows = Math.ceil(imgs.length / cols);
  const cell = Math.floor(Math.min(maxWidth / cols, imgs[0].width || 256));
  const cv = document.createElement('canvas');
  cv.width = cell * cols; cv.height = cell * rows;
  const g = cv.getContext('2d');
  g.fillStyle = '#2a2a2a'; g.fillRect(0, 0, cv.width, cv.height);
  imgs.forEach(function(img, i){ g.drawImage(img, (i % cols) * cell, Math.floor(i / cols) * cell, cell, cell); });
  return cv.toDataURL('image/png');
}

/**
 * Un sprite iso et son masque d'équipe CÔTE À CÔTE, à leur taille réelle et sur fond TRANSPARENT
 * (sprite à gauche, masque à droite) : l'appelant les sépare en coupant l'image en deux.
 */
async function spriteWithMask(imagePath, maskPath){
  const urls = [];
  for(const p of [imagePath, maskPath]) urls.push('data:image/png;base64,' + bufferToBase64(await BlenderLink.fetchFile(p)));
  if(typeof document === 'undefined' || typeof Image === 'undefined') return urls[0];
  const imgs = await Promise.all(urls.map(function(u){
    return new Promise(function(res, rej){ const i = new Image(); i.onload = function(){ res(i); }; i.onerror = rej; i.src = u; });
  }));
  const cv = document.createElement('canvas');
  cv.width = imgs[0].width * 2; cv.height = imgs[0].height;
  const g = cv.getContext('2d');
  g.drawImage(imgs[0], 0, 0); g.drawImage(imgs[1], imgs[0].width, 0);
  return cv.toDataURL('image/png');
}

/** Rend les images d'un résultat `preview`/`turntable` en une planche (data URL). */
export async function previewImage(result, maxWidth){
  const paths = (result && result.images) || [];
  if(!paths.length) return null;
  const urls = [];
  for(const p of paths.slice(0, 16)){
    urls.push('data:image/png;base64,' + bufferToBase64(await BlenderLink.fetchFile(p)));
  }
  return contactSheet(urls, maxWidth || 1024);
}

/** Exporte depuis Blender et importe les GLB rendus dans le projet, par le chemin du glisser-déposer. */
export async function importFromBlender(opts, onProgress){
  const o = opts || {};
  const spec = exportSpecFor(o);
  const res = await BlenderLink.call('delivery_action', {action: 'export', spec_json: spec},
    {timeoutMs: o.timeoutMs === undefined ? null : o.timeoutMs, onProgress: onProgress});
  if(res && res.pending) return {pending: res.pending};
  const glbs = ((res && res.files) || []).filter(function(f){ return /\.glb$/i.test(String(f)); });
  if(!glbs.length) throw new Error('l\'export n\'a produit aucun GLB : ' + summarize(res).slice(0, 300));
  const files = [];
  for(const path of glbs){
    const g = await BlenderLink.fetchGlb(path);
    files.push(new File([g.bytes], g.name, {type: 'model/gltf-binary'}));
  }
  pushHistory();
  // Rangé par type (Models), jamais à la racine : l'importeur lit le dossier COURANT quand le
  // chargement aboutit, on le pose donc le temps de l'import et on le rend ensuite.
  const folder = cleanProjectFolder(o.folder, 'Models');
  const folderBefore = folderCurrent;
  setFolderCurrent(folder);
  let r;
  try {
    // Le GLB principal porte le nom de l'export : c'est lui qu'on attend (et lui seul qu'on remplace).
    const main = files.find(function(f){ return f.name.replace(/\.glb$/i, '') === spec.name; }) || files[0];
    const done = globalThis.importModelFile(main, {paramsImport: explicitPivotParams(o), replace: !!o.replace,
      replaceName: o.name, timeoutMs: 60000});
    const others = files.filter(function(f){ return f !== main; });
    if(others.length) importFiles(others);
    r = await done;
  } finally {
    setFolderCurrent(folderBefore);
  }
  setStatus('✅ ' + files.map(function(f){ return f.name; }).join(', ') + ' importé(s) depuis Blender', 5000);
  return {imported: files.map(function(f){ return f.name; }), model: r.model.name, id: r.model.id,
    replaced: r.replaced ? {sameId: true, instances: r.replaced.instances, prefabs: r.replaced.prefabs} : false,
    pivot: describePivot(r.model.paramsImport),
    exportedObjects: res.objects, origin: res.origin || 'keep', qa: res.qa, animations: res.animations};
}

/**
 * La spec d'export envoyée à l'addon. `objects` restreint l'export à ces objets (un élément d'un
 * kit sans supprimer le reste) ; `origin` place le pivot du GLB : 'keep' (origine monde de
 * Blender, défaut), 'bottom' (centre du bas de la boîte), 'center', ou [x,y,z] en mètres (Z
 * vertical, repère Blender).
 */
export function exportSpecFor(o){
  const spec = {name: o.name || 'BlenderAsset', stage: o.stage || 'source', formats: ['GLB'],
    animations: o.animations !== false, collisions: !!o.collisions, individual: false,
    lod_ratios: o.lods ? [0.5, 0.25] : []};
  if(o.objects !== undefined){
    if(!Array.isArray(o.objects) || !o.objects.length || !o.objects.every(function(n){ return typeof n === 'string' && n; }))
      throw new Error('objects : liste non vide de noms d\'objets Blender attendue (voir blender_scene)');
    spec.objects = o.objects.slice();
  }
  if(o.origin !== undefined){
    const ok = (o.origin === 'keep' || o.origin === 'bottom' || o.origin === 'center')
      || (Array.isArray(o.origin) && o.origin.length === 3 && o.origin.every(function(v){ return typeof v === 'number' && isFinite(v); }));
    if(!ok) throw new Error('origin : « keep », « bottom », « center » ou [x, y, z] attendu');
    spec.origin = o.origin;
  }
  return spec;
}

const GROUPS = [
  {name: 'blender_project', op: 'project_action', actions: ['new', 'save', 'restore', 'settings', 'list'],
    description: 'Blender — gérer le projet. new:{name} crée une scène VIDE et un matériau neutre. '
      + 'save:{label} crée un checkpoint récupérable. restore:{checkpoint_id} charge un checkpoint dans '
      + 'une nouvelle scène — SEULEMENT si l\'utilisateur demande de revenir en arrière : sinon on retouche la '
      + 'dernière version. settings:{fps,triangle_budget,texture_size,render_samples,render_device:CPU|GPU}. '
      + 'list:{} liste les checkpoints et l\'état.'},
  {name: 'blender_geometry', op: 'model_geometry',
    actions: ['mesh', 'sweep', 'lathe', 'extrude', 'modifier', 'transform', 'duplicate', 'join', 'delete', 'edit_vertices', 'cleanup', 'origin', 'rename'],
    description: 'Blender — modélisation libre, en mètres, Z VERTICAL (l\'export GLB le ramène en Y). '
      + 'Toute cible est un nom exact lu par blender_scene ou blender_inspect. '
      + 'mesh:{name,vertices:[[x,y,z]],faces:[[indices]],material_id,smooth} (20000 sommets max). '
      + 'sweep:{name,path:[[x,y,z]],radii:[[rx,ry]],segments:16,caps:true,material_id,smooth} membres/tuyaux/formes organiques. '
      + 'lathe:{name,profile:[[radius,z]],segments:32,material_id,smooth} bouteilles/vases/roues, axe Z. '
      + 'extrude:{name,polygon:[[x,y]],depth,material_id,smooth}. '
      + 'LISSAGE : smooth vaut FALSE partout (facettes) ; ne le passer à true que si l\'utilisateur le demande. '
      + 'modifier:{object,type:BEVEL|MIRROR|SUBSURF|SOLIDIFY|DECIMATE|REMESH|BOOLEAN,apply:false,settings:{width,segments,levels,thickness,ratio,voxel_size,axes,operand,operation}} '
      + '(Remesh détruit topologie et UV ; refusé sur un mesh riggué). '
      + 'transform:{object,location,rotation_deg,scale,apply:false}. duplicate:{object,name,offset}. '
      + 'join:{objects,name}. delete:{objects}. edit_vertices:{object,changes:[{index,position}]}. '
      + 'cleanup:{objects,merge_distance,smooth} soude les sommets et recalcule les normales ; l\'ombrage ne change QUE si '
      + 'smooth est donné (true lisse, false facette), le résultat dit ce qui a changé. origin:{object,mode:GEOMETRY|BOTTOM|CURSOR}. '
      + 'rename:{object,name} renomme (ex. retirer un suffixe « .002 » après restore). '
      + 'Faire blender_project save avant un changement destructif.'},
  {name: 'blender_material', op: 'material_action', actions: ['create', 'assign', 'procedural', 'list', 'inspect', 'pack'],
    description: 'Blender — matériaux Principled PBR. create:{id,basecolor:[r,g,b,1],roughness,metallic,tile_size_m,'
      + 'normal_strength,emission,emission_strength,maps:{basecolor,roughness,metallic,normal,ao,emission,height}} '
      + '(chemins relatifs de fichiers envoyés par l\'Atelier, normales OpenGL). assign:{id,objects,faces}. '
      + 'procedural:{id,pattern:wood|stone|fabric|metal|checker,colors,scale,roughness,metallic} (à baker avant export). '
      + 'list:{}. inspect:{id}. pack:{roughness,metallic,ao,output,size} crée une texture ORM.'},
  {name: 'blender_uv', op: 'uv_action', actions: ['unwrap', 'seams', 'layout', 'transform', 'lightmap'],
    description: 'Blender — UV. unwrap:{objects,method:SMART|ANGLE|TILE,uv_name,margin,tile_size_m}. '
      + 'seams:{object,edges,clear}. layout:{object,uv_name,output,size} exporte un PNG des UV. '
      + 'transform:{objects,uv_name,scale,offset,rotation_deg}. lightmap:{objects,margin} ajoute un UV2.'},
  {name: 'blender_rig', op: 'rig_action', actions: ['create', 'humanoid', 'bind', 'weights', 'ik', 'shape_key', 'inspect'],
    description: 'Blender — rigging. create:{name,bones:[{name,head,tail,parent,deform}]} (parents avant enfants). '
      + 'humanoid:{name,height:1.8,center} squelette T-pose de départ. bind:{rig,objects,method:AUTO|ENVELOPE|RIGID,bone}. '
      + 'weights:{object,groups:[{bone,vertices,weight}],normalize,limit:4}. ik:{rig,bone,target,pole,chain_length}. '
      + 'shape_key:{object,name,offsets:[{index,delta}],value}. inspect:{rig}. Contrôler en pose après un auto-weight.'},
  {name: 'blender_animation', op: 'animation_action', actions: ['clip', 'shape_clip', 'delete', 'pose', 'sample_cycle', 'frame', 'list', 'preview'],
    description: 'Blender — animation. clip:{object,name,fps,frames,keys:[{frame,bone,location,rotation_deg,scale}],interpolation:LINEAR|BEZIER} '
      + '(clés d\'os en espace local de pose ; un clip du même nom est REMPLACÉ). delete:{object,name} supprime un clip. shape_clip:{object,name,frames,keys:[{frame,shape,value}]}. '
      + 'pose:{rig,bones:[{name,rotation_deg,location}],frame}. sample_cycle:{rig,name,kind:idle|walk|run,frames,amplitude} '
      + '(cycle d\'essai, pas une animation finale). frame:{frame}. list:{}. preview:{object,name,frames,stage}. '
      + 'Chaque clip devient un sous-asset du modèle une fois importé dans le moteur.'},
  {name: 'blender_inspect', op: 'inspect_mesh', actions: ['audit', 'geometry', 'object'],
    description: 'Blender — inspection. audit:{stage:source|atlas,triangle_budget} rapport topologie/UV/matériaux/poids/budget. '
      + 'geometry:{object,offset,limit} sommets/faces indexés pour edit_vertices. object:{object} transform, modificateurs, '
      + 'groupes, shape keys. Une validation structurelle n\'est pas une certification visuelle : regarder blender_preview.'},
  {name: 'blender_import', op: 'import_asset', actions: ['import', 'reference'],
    description: 'Blender — import:{file} importe dans Blender un GLB/FBX/OBJ/STL envoyé par l\'Atelier (chemin uploads/…). '
      + 'reference:{file,view:front|back|left|right|top|free,size,location} pose un concept art comme image de référence '
      + '(jamais rendue ni exportée).'},
  {name: 'blender_delivery', op: 'delivery_action', actions: ['export', 'turntable', 'preview', 'texture_bake', 'atlas', 'iso'],
    description: 'Blender — livraison. export:{name,stage:source|atlas,formats:[GLB,FBX,OBJ],animations,lod_ratios,collisions,individual} '
      + 'exporte SANS importer (pour importer dans le projet : blender_import_to_project). '
      + 'atlas:{size:512|1024|2048|4096} cuit tous les matériaux en UN atlas PBR (étape « atlas »), en pose de repos. '
      + 'texture_bake:{object,size,channels:[AO]}. '
      + 'iso:{name,width,height,origin_px:[x,y],px_per_unit,z_scale,azimuth_deg,elevation_deg,flip_x,shadow,sun:[x,y,z] vers la lumière ou null,sun_strength,sun_angle_deg,samples} rend un SPRITE '
      + 'isométrique PNG à fond transparent (défauts : dimétrique 2:1 d’Age of Ampyre, le point (x,y,z) au pixel '
      + '(ox+(x-y)*48, oy+(x+y)*24-z*44)). target:"Objet" cadre CET objet (échelle et origine calculées, autres '
      + 'pièces cachées sauf only_target:false, z_scale 1 par défaut : hauteurs non écrasées). Pour voir le modèle : blender_preview.'}
];

/** Refuse de restaurer un checkpoint plus ancien que la validation d'un asset (blender.validated_restore). */
async function refuseValidatedRestore(spec){
  const p = globalThis.project;
  const table = (p && p.settings && p.settings.validatedAssets) || {};
  if(!Object.keys(table).length) return;
  const list = await BlenderLink.call('project_action', {action: 'list', spec_json: {}});
  const id = spec && spec.checkpoint_id;
  const cp = ((list && list.checkpoints) || []).find(function(c){ return c.id === id; });
  const names = cp ? validatedAfter(table, cp.created_at) : [];
  if(names.length){
    throw new Error(ruleMessage('blender.validated_restore') + ' (validés depuis : ' + names.join(', ') + ')');
  }
}

GROUPS.forEach(function(g){
  CopilotTools.register({
    name: g.name,
    description: g.description,
    schema: {type: 'object', properties: {
      action: {type: 'string', enum: g.actions},
      spec: {type: 'object', description: 'paramètres de l\'action, tels que décrits ci-dessus (JSON, jamais du code)'}
    }, required: ['action'], additionalProperties: false},
    exec: async function(a){
      // Restaurer un checkpoint antérieur à la validation d'un asset défairait un travail validé.
      if(g.name === 'blender_project' && a.action === 'restore') await refuseValidatedRestore(a.spec);
      // Toute opération qui écrit invalide le rendu déjà montré (garde de blender_import_to_project).
      if(isBlenderWrite(g.name, a.action)) previewState.seen = false;
      // `atlas` n'est pas une action du groupe de livraison côté pipeline mais son opération à part.
      const res = a.action === 'atlas'
        ? await BlenderLink.call('build_atlas', Object.assign({size: 1024}, a.spec || {}))
        : await BlenderLink.call(g.op, {action: a.action, spec_json: a.spec || {}});
      const previews = PREVIEW_ACTIONS[g.name];
      if(previews && previews.indexOf(a.action) !== -1 && !(res && res.pending)) previewState.seen = true;
      return summarize(res);
    }
  });
});

CopilotTools.register({
  name: 'blender_status',
  description: 'Blender : la liaison avec l\'addon EVAVEO Blender Bridge (connectée ou non, versions, dossier de '
    + 'travail) — ou, avec {job}, l\'état d\'une opération longue. À appeler EN PREMIER. Les autres commandes '
    + 'blender_* sont dans le domaine « blender » : load_tools({domains:["blender"]}) pour le copilote intégré. '
    + 'Méthode complète : ressource editeur3d://guide/blender.',
  schema: {type: 'object', properties: {
    job: {type: 'string', description: 'identifiant d\'un job rendu « en cours » par une commande précédente'}
  }, additionalProperties: false},
  exec: async function(a){
    if(a.job){
      const out = await BlenderLink.followJob(a.job, {timeoutMs: 20000});
      if(out.error) throw new Error(out.error);
      return summarize(out.pending ? {pending: a.job} : out.result);
    }
    const h = await BlenderLink.hello();
    return 'Blender connecté (Blender ' + h.blender + ', addon ' + h.bridge + ', protocole ' + h.protocol
      + '). Dossier de travail : ' + h.project + (h.busy ? '. Une opération est en cours.' : '.')
      + ' Commandes : blender_project, blender_geometry, blender_material, blender_uv, blender_rig, '
      + 'blender_animation, blender_inspect, blender_import, blender_delivery, blender_scene, blender_preview, '
      + 'blender_import_to_project.';
  }
});

CopilotTools.register({
  name: 'blender_scene',
  description: 'Blender : inventaire du projet Blender (objets source et atlas, matériaux, rigs, clips, exports). '
    + 'À lire avant de viser un objet par son nom.',
  schema: {type: 'object', properties: {}, additionalProperties: false},
  exec: async function(){ return summarize(await BlenderLink.call('inspect', {})); }
});

CopilotTools.register({
  name: 'blender_preview',
  description: 'Blender : REND le modèle et renvoie l\'IMAGE (quatre vues face/profil/dos/3-4, ou un turntable), '
    + 'en une planche. C\'est la seule façon de VOIR ce qu\'on modélise : à faire après chaque étape de forme.',
  schema: {type: 'object', properties: {
    stage: {type: 'string', enum: ['source', 'atlas']},
    turntable: {type: 'boolean', description: 'orbite de N images au lieu des quatre vues'},
    frames: {type: 'number', description: 'images du turntable (4 à 36, défaut 8)'},
    size: {type: 'number', description: 'taille d\'une vue en pixels (128 à 2048, défaut 384)'},
    iso: {type: 'object', description: 'rend UNE vue isométrique (sprite, fond transparent) avec ces réglages : voir blender_delivery iso '
      + '(dont target:"Objet" pour cadrer un seul objet)'}
  }, additionalProperties: false},
  exec: async function(a){
    const spec = {size: a.size || 384};
    if(a.stage) spec.stage = a.stage;
    if(a.frames) spec.frames = a.frames;
    const res = a.iso
      ? await BlenderLink.call('delivery_action', {action: 'iso', spec_json: a.iso})
      : await BlenderLink.call('delivery_action', {action: a.turntable ? 'turntable' : 'preview', spec_json: spec});
    if(res && res.pending) return summarize(res);
    // Avec un masque d'équipe (iso + team_materials), le sprite et son masque reviennent CÔTE À CÔTE
    // dans la même image : le MCP n'en relaie qu'une par réponse.
    const image = res.mask ? await spriteWithMask(res.image, res.mask) : await previewImage(res, 1024);
    previewState.seen = true;
    const text = 'Rendu Blender (' + (res.images || []).length + ' vue(s), étape ' + res.stage + ').';
    return image ? {text: text, image: image} : text;
  }
});

CopilotTools.register({
  name: 'blender_import_to_project',
  description: 'Blender : EXPORTE le modèle en GLB et l\'IMPORTE dans le projet du moteur, exactement comme un '
    + 'glisser-déposer (matériaux, clips en sous-assets). Le poser ensuite avec instantiate_model. '
    + '`objects` n\'exporte que ces objets (un élément d\'un kit), `origin` place le pivot du GLB. Le moteur '
    + 'recentre et pose au sol par défaut : `center:false` / `setGround:false` gardent le pivot exporté '
    + '(charnière). `replace:true` met à jour le modèle de même nom EN PLACE (même id : prefabs et instances suivent).',
  schema: {type: 'object', properties: {
    name: {type: 'string', description: 'nom de l\'asset (lettres, chiffres, _ et -)'},
    stage: {type: 'string', enum: ['source', 'atlas'], description: 'atlas : après blender_delivery atlas, un seul matériau'},
    animations: {type: 'boolean'},
    lods: {type: 'boolean', description: 'ajoute des LOD 50 % et 25 % (meshes statiques seulement)'},
    collisions: {type: 'boolean', description: 'ajoute des enveloppes convexes séparées'},
    objects: {type: 'array', items: {type: 'string'}, description: 'n\'exporter que ces objets (noms lus par blender_scene) ; défaut : toute la scène'},
    origin: {description: 'pivot du GLB : "keep" (origine monde, défaut), "bottom" (centre du bas de la boîte des objets exportés), "center", ou [x,y,z] (mètres, Z vertical)'},
    center: {type: 'boolean', description: 'le moteur recentre en X/Z à l\'import (défaut true)'},
    setGround: {type: 'boolean', description: 'le moteur pose la base à Y=0 à l\'import (défaut true)'},
    replace: {type: 'boolean', description: 'remplacer en place le modèle existant de même nom (garde son id)'},
    folder: {type: 'string', description: 'dossier du projet (défaut « Models ») ; jamais la racine'}
  }, required: ['name'], additionalProperties: false},
  exec: async function(a){
    // PAS D'IMPORT SANS VALIDATION : un rendu doit avoir été montré depuis la dernière écriture.
    if(!previewState.seen) throw new Error(ruleMessage('blender.no_import_unvalidated'));
    return summarize(await importFromBlender(Object.assign({timeoutMs: 90000}, a)));
  }
});
