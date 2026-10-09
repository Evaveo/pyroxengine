// ---------- Copilote IA — Claude (P1-8) ----------
// Fenêtre de chat connectée à l'API Claude (appels directs depuis le
// navigateur). L'IA pilote l'éditeur via un catalogue d'outils qui appellent
// les fonctions existantes — chaque mutation passe par pushHistory()
// et reste annulable (Ctrl+Z). Clé API stockée en localStorage, jamais dans
// les projets. Modèle par défaut : claude-sonnet-5 (Opus au choix).
import { analyzeScene } from './analysis.js';
import { enforceScriptAssets } from './script-asset-lint.js';
import { normalizeViewport } from './camera-overlays.js';
import { clipsOf, stopAnimator } from './anim-models.js';
import { assets, createAssetAnimator, createAssetData, createAssetDocumentUI, createAssetSheetStyle, createAssetTilePalette, createPrefabFromSelection, instantiateAsset, moveAssetTo, newAssetScript, updateProject } from './assets.js';
import { engineRules } from './ai-guidelines.js';
import { READ_ONLY_TOOLS, checkAfterWrite, formatViolations, noteSave, noteWrite, recordViolation } from './ai-rules.js';
import { isGenericName } from './project-audit.js';
import { ensureCollider, ensureEvents, ensureGame, ensurePart, ensurePhys, ensureProbe, ensureTerrain } from './component-data.js';
import { Registry } from './component-registry.js';
import { faceCameraToPlane } from './components/component-camera.js';
import { rebuildMeshSprite } from './components/component-sprite.js';
import { updateComponentTag } from './components/component-tag.js';
import { rebuildTilemap } from './components/component-tilemap.js';
import { logConsole } from './console.js';
import { TRACE_BATCH_MAX, TRACE_STORAGE_KEY, formatTraceLine, resultHasWarning, traceEnabled } from './ai-trace.js';
import { PROVIDERS, providerBy, validateProvider } from './copilot-providers.js';
import { TOOL_DOMAINS, compactHistory, costOfUsage, describeDomains, formatCost, selectTools } from './copilot-budget.js';
import { INSPECTION_TOOLS, capOutput, roomLayout } from './copilot-inspect.js';
import { ENV_TOOL_KEYS, applyEnvironment, env } from './environment.js';
import { setStatus, updateHierarchy } from './hierarchy.js';
import { pushHistory } from './history.js';
import { mountMcpSettings } from './mcp-link.js';
import { refreshSpritesOfLAsset } from './import-settings.js';
import { buildInspector, deleteRoot, duplicateRoot, syncInspector } from './inspector.js';
import { applyVisibilityLayers } from './layers.js';
import { bakeLightmap, lightmapBakeState, settingsLightmap } from './lightmap-bake.js';
import { describeMaterialForAI, propMaterialByKey, validatePropMaterial } from './material-props.js';
import { applyMaterialEverywhere, attachMaterialAsset, createAssetMaterial, roughnessFromSmoothing } from './materials.js';
import { TYPE_NODE_DEFAULT, createFromCreatable, createObject, createSceneNode, escapeHtml, markLayersDirty, objects, register } from './objects.js';
import { resetSystemParticles } from './particles.js';
import { applyAtPrefab, assetPrefabOf } from './prefabs.js';
import { play } from './play-mode.js';
import { describeMaterialsPluginForAI } from './plugins.js';
import { createAssetPostProfile } from './post-profile.js';
import { updatePostVolumeViz } from './post-volume-viz.js';
import { applyProbes, bakeProbe, disposeProbe, probesActive, updateBoxProbeViz } from './probes.js';
import { addScene, changeScene, project, updateScenes } from './project.js';
import { scene, sun } from './scene.js';
import { INPUTS_DEFAULT, aScript, analyzeVarsDeclared, holdersOfScriptAsset, mergeVarsDeclared, syncScriptVarsOfAsset } from './scripts.js';
import { select, selection, selectionMulti } from './selection.js';
import { component } from './shader-graph-editor.js';
import { createSubScene, indexScene, traversesSubScene } from './subscenes.js';
import { applyHeightsTerrain, flattenTerrain, generateTerrain } from './terrain.js';
import { Dock } from './ui/dock.js';
import { setCameraLayer } from './ui/panels-components.js';
import { loop, mode } from './viewport.js';

// Les actions « Quand… Alors… » que les DEUX moteurs exécutent (js/events.js, js/game-runtime.js).
// Copie de EVENT_THEN (js/ui/panels-components.js), tenue égale par test/copilote-evenements.test.mjs.
export const EVENT_ACTION_TYPES = ['montrer', 'hide', 'toggle', 'destroy', 'emit', 'jouerSon',
  'burstParticules', 'status', 'wait', 'changerScene', 'parametreAnim'];
// Les noms d'avant v0.89.1, encore présents dans les modèles et dans de vieux exemples.
// Clés entre guillemets : ce sont des VALEURS reçues du modèle, pas des identifiants du code.
export const EVENT_ACTION_ALIASES = {'afficher': 'montrer', 'show': 'montrer', 'cacher': 'hide',
  'basculer': 'toggle', 'detruire': 'destroy', 'emettre': 'emit', 'attendre': 'wait', 'playSound': 'jouerSon'};

export const engineCopilot = {
  conv: [],            // historique de messages au format API
  inProgress: false,
  controller: null,    // AbortController de la requête en vol
  loadedDomains: [],   // domaines d'outils chargés par load_tools, pour la conversation
  session: {cost: 0, unknown: false, input: 0, cacheRead: 0, cacheWrite: 0, output: 0}
};

export const COPILOT_MODELS = ['claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5'];

// Les règles ci-dessous ne sont pas décoratives : chacune corrige une erreur
// réellement commise en construisant les deux jeux d'exemple. Référence
// complète : docs/API-IA.md.
export const COPILOT_SYSTEM =
  // « prototypes » figurait ici. Ce n'est pas un détail de vocabulaire : une
  // invite qui dit de viser un prototype fait produire un prototype. L'ambition
  // est de faire des jeux web complets, l'invite doit le dire.
  'Tu es le copilote intégré de PyroxEngine, un moteur 3D pour des jeux web complets '
  + '(three.js). Tu agis sur la scène UNIQUEMENT via les outils fournis. '
  // Le corps des règles vit dans js/ai-guidelines.js : c'est le MÊME texte que reçoit une IA
  // externe par le pont MCP. Chaque règle y est commentée par l'erreur qu'elle corrige.
  + engineRules(describeDomains())
  + 'Enchaîne librement plusieurs outils pour construire ce qui est demandé. Toutes tes '
  + 'actions sont annulables par Ctrl+Z. Réponds en français, brièvement : une ou deux '
  + 'phrases sur ce que tu as fait, sans lister chaque outil appelé.';

// ---------- catalogue de commandes (outils exposés à l'IA) ----------
export function copFind(name){
  const o = objects.find(function(x){ return x.name === name; });
  if(!o) throw new Error('objet « ' + name + ' » introuvable (utilise list_scene)');
  return o;
}

export const _copBox = new THREE.Box3();
export function arr2(v){ return Math.round(v * 100) / 100; }

export function copResume(o){
  const p = o.position;
  // La TAILLE count autant que la position : les primitives du moteur ne font
  // pas une unité (un cube en fait 1,6, une sphère a un rayon de 1), donc une
  // échelle de 2,5 donne une largeur de 4. Sans cette information, on place des
  // objets qui se chevauchent en croyant laisser un espace entre eux — et
  // aucune commande n'échoue pour le signaler.
  _copBox.setFromObject(o);
  const empty = _copBox.isEmpty();
  return {
    name: o.name, type: o.userData.type,
    position: [arr2(p.x), arr2(p.y), arr2(p.z)],
    size: empty ? null : [arr2(_copBox.max.x - _copBox.min.x),
                           arr2(_copBox.max.y - _copBox.min.y),
                           arr2(_copBox.max.z - _copBox.min.z)],
    extent: empty ? null : {
      x: [arr2(_copBox.min.x), arr2(_copBox.max.x)],
      y: [arr2(_copBox.min.y), arr2(_copBox.max.y)],
      z: [arr2(_copBox.min.z), arr2(_copBox.max.z)]
    },
    scale: [arr2(o.scale.x), arr2(o.scale.y), arr2(o.scale.z)],
    visible: visibleIntent(o),
    tag: (o.userData.game && o.userData.game.tag) || '',
    parent: (o.parent && o.parent !== scene) ? o.parent.name : null,
    physics: !!(o.userData.phys && o.userData.phys.active),
    scripts: (o.userData.scripts || []).length,
    script: aScript(o),
    events: (o.userData.events || []).length
  };
}

export const COMMANDS = [
  {
    // Cette commande est le point où l'éditeur cesse d'expliquer ses règles au modèle en
    // prose — et se met à les lui DONNER. La table de js/material-props.js est la même que
    // celle qui dessine l'inspecteur : il ne peut donc pas exister de propriété que
    // l'humain voit et que le modèle ignore, ni de plage vraie d'un côté et fausse de
    // l'autre. Une invite système, elle, vieillit dès qu'on ajoute un champ.
    name: 'describe_material',
    description: 'Renvoie la liste EXACTE des propriétés qu\'un matériau accepte : name, type, '
      + 'plage ou valeurs permises, et ce dont chacune dépend. À appeler avant de configurer '
      + 'un matériau qu\'on ne connaît pas, plutôt que de deviner un nom de propriété. '
      + '« requiert » indique les cartes sans lesquelles la propriété est sans effet ou sans objet. '
      + '« materiauxPlugin » liste les shaders ajoutés par des plugins, chacun avec SA propre '
      + 'table de propriétés — elles ne valent que pour ce matériau-là, pas pour le natif.',
    schema: {type: 'object', properties: {}, additionalProperties: false},
    exec: function(){
      // Un matériau de plugin est décrit par la MÊME fonction que le natif, appliquée à sa
      // table. Un shader ajouté après coup devient donc connu du modèle sans qu'une ligne
      // d'invite système soit réécrite : c'est ce que paie la table déclarative.
      const output = {properties: describeMaterialForAI()};
      if(typeof describeMaterialsPluginForAI === 'function'){
        const ofPlugins = describeMaterialsPluginForAI();
        if(ofPlugins.length) output.materialsPlugin = ofPlugins;
      }
      return JSON.stringify(output);
    }
  },
  {
    name: 'list_scene',
    description: 'Liste les objets de la scène courante : name, type, position, TAILLE réelle et '
      + 'étendue min/max sur chaque axe, échelle, tag, parent, physique, nombre de scripts. '
      + 'Les primitives ne font pas une unité (cube = 1,6 ; sphère = rayon 1) : lisez « taille » '
      + 'ou « etendue » plutôt que de déduire les dimensions de l\'échelle.',
    schema: {type: 'object', properties: {}, additionalProperties: false},
    exec: function(){
      return JSON.stringify({
        scene: project.scenes[project.current].name,
        objects: objects.map(copResume)
      });
    }
  },
  {
    name: 'create_object',
    description: 'Crée un objet dans la scène. Types : cube, sphere, cylinder, cone, torus, plane, groupe, particules, terrain, point (lumière), spot, directional, camera, probe (sonde de réflexion — voir configure_reflection_probe et bake_reflection_probes).',
    schema: {type: 'object', properties: {
      type: {type: 'string', enum: ['cube','sphere','cylinder','cone','torus','plane','star','diamond','pyramid','wave','rock','capsule','group','particles','terrain','point','spot','directional','camera','probe']},
      name: {type: 'string', description: 'name à donner à l\'objet (optionnel)'},
      position: {type: 'object', properties: {x:{type:'number'}, y:{type:'number'}, z:{type:'number'}}}
    }, required: ['type'], additionalProperties: false},
    exec: function(a){
      const o = createObject(a.type);
      if(a.name) o.name = a.name;
      // Un GROUPE sans position naît à l'origine, pas au point visé par la vue : ses enfants
      // (set_parent) auraient sinon un décalage local hérité d'une position quelconque.
      if(!a.position && a.type === 'group') o.position.set(0, 0, 0);
      if(a.position) o.position.set(a.position.x || 0,
        (a.position.y !== undefined) ? a.position.y : o.position.y, a.position.z || 0);
      updateHierarchy();
      syncInspector();
      return 'créé : ' + JSON.stringify(copResume(o));
    }
  },
  {
    name: 'delete_object',
    description: 'Supprime un objet (et ses enfants) de la scène.',
    schema: {type: 'object', properties: {name: {type: 'string'}}, required: ['name'], additionalProperties: false},
    exec: function(a){
      const o = copFind(a.name);
      pushHistory();
      if(o === selection || selectionMulti.indexOf(o) !== -1) select(null);
      deleteRoot(o);
      updateHierarchy();
      return 'supprimé : ' + a.name;
    }
  },
  {
    name: 'rename_object',
    description: 'Renomme un objet.',
    schema: {type: 'object', properties: {name: {type: 'string'}, newName: {type: 'string'}},
      required: ['name', 'newName'], additionalProperties: false},
    exec: function(a){
      const o = copFind(a.name);
      pushHistory();
      o.name = a.newName;
      updateHierarchy();
      return 'renommé en ' + a.newName;
    }
  },
  {
    name: 'transform',
    description: 'Positionne / tourne (degrés) / met à l\'échelle un objet. Seuls les champs fournis changent. '
      + '`visible` affiche ou masque l\'objet (l\'œil de la Hiérarchie, sauvegardé avec la scène) : '
      + 'de quoi isoler un problème sans rien supprimer.',
    schema: {type: 'object', properties: {
      name: {type: 'string'},
      visible: {type: 'boolean', description: 'false masque l\'objet et ses enfants (le rendu seulement : ses scripts continuent, api.setActive les arrête), true le réaffiche'},
      position: {type: 'object', properties: {x:{type:'number'}, y:{type:'number'}, z:{type:'number'}}},
      rotation: {type: 'object', properties: {x:{type:'number'}, y:{type:'number'}, z:{type:'number'}},
        description: 'euler en degrés'},
      scale: {type: 'object', properties: {x:{type:'number'}, y:{type:'number'}, z:{type:'number'}}}
    }, required: ['name'], additionalProperties: false},
    exec: function(a){
      const o = copFind(a.name);
      pushHistory();
      if(a.position) o.position.set(
        a.position.x !== undefined ? a.position.x : o.position.x,
        a.position.y !== undefined ? a.position.y : o.position.y,
        a.position.z !== undefined ? a.position.z : o.position.z);
      if(a.rotation) o.rotation.set(
        THREE.MathUtils.degToRad(a.rotation.x || 0),
        THREE.MathUtils.degToRad(a.rotation.y || 0),
        THREE.MathUtils.degToRad(a.rotation.z || 0));
      if(a.scale) o.scale.set(
        a.scale.x !== undefined ? a.scale.x : o.scale.x,
        a.scale.y !== undefined ? a.scale.y : o.scale.y,
        a.scale.z !== undefined ? a.scale.z : o.scale.z);
      if(typeof a.visible === 'boolean'){
        // Par l'INTENTION, comme l'œil de la Hiérarchie : écrire `visible` ne fait rien sur un
        // objet regroupé (son lot continue de le dessiner).
        setVisibleIntent(o, a.visible);
        if(typeof markBatchingDirty === 'function') markBatchingDirty();
        updateHierarchy();
      }
      if(o === selection) syncInspector();
      return 'transformé : ' + JSON.stringify(copResume(o));
    }
  },
  {
    name: 'set_parent',
    description: 'Attache un objet à un parent (ou à la racine si parent est omis). Par défaut la '
      + 'position MONDE est conservée ; keepWorld:false garde la position LOCALE (l\'objet suit le parent).',
    schema: {type: 'object', properties: {child: {type: 'string'}, parent: {type: 'string'},
      keepWorld: {type: 'boolean', description: 'true (défaut) : garde la transform monde ; false : garde la transform locale'}},
      required: ['child'], additionalProperties: false},
    exec: function(a){
      const child = copFind(a.child);
      const parent = a.parent ? copFind(a.parent) : scene;
      pushHistory();
      if(a.keepWorld === false) parent.add(child);   // conserve la transform locale
      else parent.attach(child);                      // conserve la transform monde
      updateHierarchy();
      return a.parent ? (a.child + ' → enfant de ' + a.parent) : (a.child + ' → racine');
    }
  },
  {
    name: 'configure_material',
    description: 'Change le matériau local d\'une primitive (couleurs en hexadécimal "#rrggbb"). '
      + 'lissage = smoothness : 1 pour un miroir, 0 pour un mat.',
    schema: {type: 'object', properties: {
      name: {type: 'string'},
      color: {type: 'string'}, emissive: {type: 'string'},
      smoothness: {type: 'number'}, metal: {type: 'number'}, opacity: {type: 'number'}
    }, required: ['name'], additionalProperties: false},
    exec: function(a){
      const o = copFind(a.name);
      if(o.userData.type !== 'mesh') throw new Error('« ' + a.name + ' » n\'est pas une primitive');

      // VALIDATION AVANT ÉCRITURE, et rien n'est écrit si un seul champ est refusé.
      //
      // `describe_material` enseigne au modèle les plages et les formats de la table
      // PROPS_MATERIAL. Rien ne vérifiait ensuite qu'il les avait suivis : `lissage: 12`
      // était silencieusement ramené dans l'intervalle par un Math.min, et `couleur: "rouge"`
      // laissait three refuser tout seul, dans son coin. Le commentaire de
      // validatePropMaterial dit exactement pourquoi c'est le bad choix — « refuser en
      // expliquant vaut mieux qu'accepter en silence : un modèle qui écrit lissage: 12 doit
      // apprendre la plage ». La fonction existait, elle était testée, elle n'était appelée
      // de nulle part.
      //
      // Tout ou rien : apply les champs valides d'un appel a moitie faux laisserait
      // l'objet dans un etat que le modele ne connait pas, et il enchainerait dessus.
      // On valide contre une fiche VIDE : une primitive porte un matériau three local, pas un
      // asset avec ses propriétés. Ce qui compte ici est la plage et le format, pas de savoir
      // si telle map rend telle autre inopérante.
      const valides = {}, refusal = [];
      ['color', 'emissive', 'smoothness', 'metal', 'opacity'].forEach(function(key){
        if(a[key] === undefined) return;
        const v = validatePropMaterial(key, a[key], {});
        if(!v.ok) refusal.push(v.message);
        else valides[key] = v.value;
      });
      if(refusal.length) throw new Error(refusal.join(' · '));

      pushHistory();
      if(valides.color !== undefined) o.material.color.set(valides.color);
      if(valides.emissive !== undefined){
        o.material.emissive.set(valides.emissive);
        o.userData.emissiveBase = o.material.emissive.getHex();
      }
      if(valides.smoothness !== undefined) o.material.roughness = roughnessFromSmoothing(valides.smoothness);
      if(valides.metal !== undefined) o.material.metalness = valides.metal;
      if(valides.opacity !== undefined){
        o.material.opacity = valides.opacity;
        o.material.transparent = o.material.opacity < 1;
      }
      if(o === selection) syncInspector();
      return 'matériau de ' + a.name + ' mis à jour';
    }
  },
  {
    name: 'configure_physics',
    description: 'Active / configure le corps rigide d\'un objet (masse 0 = statique) et son collider trigger.',
    schema: {type: 'object', properties: {
      name: {type: 'string'}, active: {type: 'boolean'},
      mass: {type: 'number'}, restitution: {type: 'number'}, friction: {type: 'number'},
      trigger: {type: 'boolean', description: 'collider déclencheur (ne bloque pas)'}
    }, required: ['name'], additionalProperties: false},
    exec: function(a){
      const o = copFind(a.name);
      pushHistory();
      ensurePhys(o);
      if(a.active !== undefined) o.userData.phys.active = a.active;
      if(a.mass !== undefined) o.userData.phys.mass = Math.max(0, a.mass);
      if(a.restitution !== undefined) o.userData.phys.restitution = Math.max(0, Math.min(1, a.restitution));
      if(a.friction !== undefined) o.userData.phys.friction = Math.max(0, Math.min(1, a.friction));
      if(a.trigger !== undefined){
        const c = ensureCollider(o);
        if(c.shape === 'auto') c.shape = 'box';
        c.trigger = a.trigger;
      }
      if(o === selection) buildInspector();
      return 'physique de ' + a.name + ' : ' + JSON.stringify(o.userData.phys);
    }
  },
  {
    name: 'configure_game',
    description: 'Définit le tag et/ou le calque d\'un objet. Le calque doit correspondre à un nom existant dans projet.layers (voir list_scene) ; une valeur inconnue est acceptée telle quelle par compatibilité avec les anciens projets.',
    schema: {type: 'object', properties: {name: {type: 'string'}, tag: {type: 'string'}, layer: {type: 'string'}},
      required: ['name'], additionalProperties: false},
    exec: function(a){
      const o = copFind(a.name);
      pushHistory();
      const game = ensureGame(o);
      if(a.tag !== undefined){ game.tag = a.tag; updateComponentTag(o); }
      if(a.layer !== undefined){
        game.layer = a.layer || 'Défaut';
        // Comme le champ Calque de l'inspecteur : le bit `Object3D.layers` ne se resynchronise
        // plus par balayage de la scène à chaque image (voir markLayersDirty, js/objects.js).
        markLayersDirty(o);
      }
      if(o === selection) syncInspector();
      return 'jeu de ' + a.name + ' : tag=' + game.tag + ', calque=' + game.layer;
    }
  },
  {
    name: 'manage_layers',
    description: 'Gère les calques du projet (projet.calques) : "list" les renvoie tous, '
      + '"create" en crée un nouveau (32 maximum), "update" renomme/masque/verrouille un calque '
      + 'existant (désigné par nom ou id), "remove" le retire (le calque 0, celui par défaut, '
      + 'ne peut pas être retiré). Un objet rejoint un calque via configure_game.',
    schema: {type: 'object', properties: {
      action: {type: 'string', enum: ['list', 'create', 'update', 'remove']},
      layer: {type: 'string', description: 'name ou id du calque visé (update/remove)'},
      name: {type: 'string', description: 'nouveau nom (create/update)'},
      visible: {type: 'boolean'}, locked: {type: 'boolean'}
    }, required: ['action'], additionalProperties: false},
    exec: function(a){
      if(a.action === 'list') return JSON.stringify(project.layers);
      if(a.action === 'create'){
        const idMax = project.layers.reduce(function(m, l){ return Math.max(m, l.id); }, 0);
        if(idMax >= 31) throw new Error('32 calques maximum');
        pushHistory();
        const l = {id: idMax + 1, name: a.name || ('Calque ' + (idMax + 1)), visible: true, verrouille: false};
        project.layers.push(l);
        applyVisibilityLayers();
        return 'calque créé : ' + JSON.stringify(l);
      }
      const l = project.layers.find(function(x){ return x.name === a.layer || String(x.id) === String(a.layer); });
      if(!l) throw new Error('calque « ' + a.layer + ' » introuvable (utilise manage_layers action « list »)');
      if(a.action === 'remove'){
        if(l.id === 0) throw new Error('le calque par défaut (0) ne peut pas être retiré');
        pushHistory();
        project.layers.splice(project.layers.indexOf(l), 1);
        applyVisibilityLayers();
        return 'calque « ' + a.layer + ' » retiré';
      }
      pushHistory();
      if(a.name !== undefined) l.name = a.name;
      if(a.visible !== undefined) l.visible = !!a.visible;
      if(a.locked !== undefined) l.verrouille = !!a.locked;
      applyVisibilityLayers();
      return 'calque mis à jour : ' + JSON.stringify(l);
    }
  },
  {
    name: 'attach_script',
    description: 'Ajoute un NOUVEAU script à un objet (les scripts existants sont conservés). '
      + 'Pour CORRIGER un script déjà présent, utilisez replace_script — sinon les deux '
      + 'versions coexistent et s\'exécutent toutes les deux. '
      + 'Le code définit function start(api) et/ou function update(api). API : api.me, '
      + 'api.dt, api.key(k), api.action(name), api.find(name), api.byTag(tag), api.bounds(cible), '
      + 'api.onContact(tag, fn), api.setPosition(cible, pos), api.setVelocity(cible, v), '
      + 'api.applyForce, api.raycast(o, d, dist, {tag}), api.moveTo(cible, vitesse), '
      + 'api.patrol([pts]), api.uiDocument(node), api.playSound(name), api.particles(), api.after(s, fn), '
      + 'api.emit/on, api.changeScene… Nomme le script d\'après son comportement (`script`, ex. '
      + '"Joueur_Deplacement") et range-le (`folder`, défaut "Scripts"). Sans `code`, `script` '
      + 'désigne un asset script EXISTANT, attaché tel quel (réutilisation, pas de copie). Réglages '
      + 'visibles dans l\'inspecteur : bloc /* @vars {"vitesse": 4} */ en tête, lu par api.props().',
    schema: {type: 'object', properties: {
      name: {type: 'string', description: 'objet qui reçoit le script'},
      code: {type: 'string'},
      script: {type: 'string', description: 'nom de l\'asset script (créé, ou existant si code est absent)'},
      folder: {type: 'string', description: 'dossier de l\'asset créé (défaut « Scripts »)'}
    }, required: ['name'], additionalProperties: false},
    exec: function(a){
      const o = copFind(a.name);
      let asset, created = false, warn = '';
      if(a.code === undefined){
        // Réutiliser un script : un même comportement sur dix ennemis est UN asset, pas dix copies.
        if(!a.script) throw new Error('donne `code` (nouveau script) ou `script` (asset existant à réutiliser)');
        asset = assets.find(function(x){ return x.kind === 'script' && x.name === a.script; });
        if(!asset){
          throw new Error('asset script « ' + a.script + ' » introuvable. Scripts : '
            + (assets.filter(function(x){ return x.kind === 'script'; }).map(function(x){ return x.name; }).join(', ') || '(aucun)'));
        }
        pushHistory();
      } else {
        warn = enforceScriptAssets(a.code);   // un script = du comportement, pas du contenu
        pushHistory();
        // LE CODE VA DANS UN ASSET, ET L'OBJET LE RÉFÉRENCE. Écrire le code sur l'instance
        // (`{code: a.code}`) en faisait une copie invisible du panneau Projet : le script du
        // copilote n'était éditable nulle part et ne pouvait pas être réutilisé sur un autre
        // objet. Il est maintenant un asset comme un autre, avec son fichier sur disque.
        // Il est aussi RANGÉ : « Script Cube 12 » à la racine des assets était le cas général.
        asset = newAssetScript(String(a.script || '').trim() || ('Script ' + o.name), a.code);
        created = true;
        const folder = String(a.folder === undefined ? 'Scripts' : a.folder).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        if(folder.split('/').some(function(s){ return s === '..'; })) throw new Error('chemin de dossier invalide');
        if(folder) moveAssetTo(asset, folder, {silent: true});
      }
      const component = o.addComponent('ScriptJS', {scriptId: asset.id, active: true});
      mergeVarsDeclared(o, component.code);
      updateProject();
      if(o === selection) buildInspector();
      const vars = analyzeVarsDeclared(asset.code);
      return 'script « ' + asset.name + ' » ' + (created ? 'créé dans ' + (asset.folder || 'la racine') + ' et ' : '')
        + 'attaché à ' + a.name + ' (' + String(asset.code || '').length + ' caractères, '
        + o.userData.scripts.length + ' script(s) au total sur cet objet'
        + (vars ? ', réglages inspecteur : ' + Object.keys(vars).join(', ') : ', aucun réglage @vars') + ')' + warn;
    }
  },
  {
    name: 'set_script_vars',
    description: 'Écrit les valeurs d\'inspecteur (@vars) d\'UN objet précis — ce que api.props() lit sur '
      + 'cet objet. Le même script posé sur dix PNJ peut ainsi avoir dix réglages différents. Seules les '
      + 'clés déclarées par un bloc @vars d\'un script attaché sont acceptées ; null remet la valeur par défaut.',
    schema: {type: 'object', properties: {
      name: {type: 'string', description: 'objet dont on règle les valeurs'},
      values: {type: 'object', description: 'ex. {"vitesse": 6, "dialogue": "Bonjour"}'}
    }, required: ['name', 'values'], additionalProperties: false},
    exec: function(a){
      const o = copFind(a.name);
      if(!a.values || typeof a.values !== 'object' || Array.isArray(a.values)) throw new Error('values doit être un objet {clé: valeur}');
      const declared = {};
      (o.getComponents ? o.getComponents('ScriptJS') : []).forEach(function(c){
        Object.assign(declared, analyzeVarsDeclared(c.code) || {});
      });
      const keys = Object.keys(a.values);
      const unknown = keys.filter(function(k){ return !(k in declared); });
      if(unknown.length){
        throw new Error('réglage(s) inconnu(s) sur « ' + a.name + ' » : ' + unknown.join(', ')
          + '. Déclarés par ses scripts : ' + (Object.keys(declared).join(', ') || '(aucun bloc @vars)'));
      }
      pushHistory();
      const props = ensureGame(o).props;
      keys.forEach(function(k){
        const v = a.values[k];
        props[k] = (v === null) ? declared[k] : v;
      });
      updateProject();
      if(o === selection) buildInspector();
      return 'réglages de ' + a.name + ' : ' + JSON.stringify(keys.reduce(function(r, k){ r[k] = props[k]; return r; }, {}));
    }
  },
  {
    // Corriger un script est le cas NORMAL, pas l'exception : sans cette
    // commande, chaque correction empilait une seconde copie du script et le
    // game exécutait les deux — en silence.
    name: 'replace_script',
    description: 'Remplace le code d\'un script existant d\'un objet. `index` désigne le script '
      + '(0 = le premier, valeur par défaut) ; list_scene indique combien un objet en porte. '
      + 'C\'est la commande à utiliser pour CORRIGER un script — attach_script en ajouterait un second.',
    schema: {type: 'object', properties: {
      name: {type: 'string'}, code: {type: 'string'}, index: {type: 'number'}
    }, required: ['name', 'code'], additionalProperties: false},
    exec: function(a){
      const o = copFind(a.name);
      const list = o.userData.scripts || [];
      const i = (a.index === undefined) ? 0 : a.index;
      if(!list.length) throw new Error(a.name + ' ne porte aucun script (utilise attach_script)');
      if(i < 0 || i >= list.length){
        throw new Error(a.name + ' porte ' + list.length + ' script(s) : index ' + i + ' hors bounds');
      }
      // On corrige L'ASSET, pas l'instance : c'est lui qui porte le code depuis que le
      // composant le référence. Une entrée sans asset (projet d'avant la référence, ou asset
      // supprimé) ne peut pas être corrigée à l'aveugle — le dire vaut mieux qu'écrire un
      // `code` que plus personne ne lit.
      const asset = list[i].scriptId
        ? assets.find(function(x){ return x.id === list[i].scriptId && x.kind === 'script'; })
        : null;
      if(!asset){
        throw new Error('le script ' + i + ' de ' + a.name + ' ne référence aucun asset : '
          + 'utilise attach_script pour en créer un');
      }
      const warn = enforceScriptAssets(a.code);
      pushHistory();
      asset.code = a.code;
      // Tous les porteurs reçoivent les défauts des clés @vars/@expose NOUVELLES (syncScriptVarsOfAsset).
      const count = syncScriptVarsOfAsset(asset);
      updateProject();
      if(o === selection) buildInspector();
      return 'script « ' + asset.name + ' » remplacé (' + a.code.length + ' caractères, '
        + count + ' objet(s) concerné(s)) — réglages de « ' + a.name + ' » : ' + JSON.stringify(ensureGame(o).props) + warn;
    }
  },
  {
    name: 'remove_script',
    description: 'Retire un script d\'un objet. `index` désigne le script (0 = le premier).',
    schema: {type: 'object', properties: {name: {type: 'string'}, index: {type: 'number'}},
      required: ['name'], additionalProperties: false},
    exec: function(a){
      const o = copFind(a.name);
      const list = o.userData.scripts || [];
      const i = (a.index === undefined) ? 0 : a.index;
      if(i < 0 || i >= list.length){
        throw new Error(a.name + ' porte ' + list.length + ' script(s) : index ' + i + ' hors bounds');
      }
      pushHistory();
      // LE COMPOSANT, pas seulement l'entrée. `userData.scripts` n'est que le miroir que le
      // composant ScriptJS alimente (component-script.js, onAdd/onRemove) ; retirer l'entrée
      // seule laissait le composant — c'est lui que la scène sérialise — et le script revenait
      // au rechargement, en bloquant au passage la suppression de son asset.
      const entry = list[i];
      const comp = typeof o.getComponents === 'function'
        ? o.getComponents('ScriptJS').find(function(c){ return c.entry === entry; })
        : null;
      if(comp) o.removeComponent(comp);
      else list.splice(i, 1);
      if(o === selection) buildInspector();
      return 'script ' + i + ' retiré de ' + a.name + ' (' + list.length + ' restant(s))';
    }
  },
  {
    name: 'duplicate_object',
    description: 'Duplique un objet (avec ses scripts, matériaux et enfants) à une nouvelle '
      + 'position. Évite de refaire créer + transform + configurer pour chaque copie.',
    schema: {type: 'object', properties: {
      name: {type: 'string'}, newName: {type: 'string'},
      position: {type: 'object', properties: {x:{type:'number'}, y:{type:'number'}, z:{type:'number'}}}
    }, required: ['name'], additionalProperties: false},
    exec: function(a){
      const o = copFind(a.name);
      pushHistory();
      const copie = duplicateRoot(o);
      if(a.newName) copie.name = a.newName;
      if(a.position) copie.position.set(
        a.position.x !== undefined ? a.position.x : copie.position.x,
        a.position.y !== undefined ? a.position.y : copie.position.y,
        a.position.z !== undefined ? a.position.z : copie.position.z);
      updateHierarchy();
      return 'dupliqué : ' + JSON.stringify(copResume(copie));
    }
  },
  {
    // Sans cette commande, un ennemi répété dix fois ne pouvait être factorisé qu'en le
    // dupliquant à chaque fois (duplicate_object) : dix copies indépendantes, aucune ne se
    // met à jour quand on corrige la première.
    name: 'create_prefab',
    description: 'Transforme un objet de la scène en prefab réutilisable (asset). L\'objet '
      + 'source devient la première instance liée. Utilisez ensuite instantiate_prefab pour en '
      + 'poser d\'autres exemplaires ; les corriger toutes ensemble se fait en modifiant '
      + 'l\'instance source puis en rappelant create_prefab, ou depuis l\'inspecteur (Appliquer). '
      + 'Avec `model` (nom d\'un asset modèle importé) au lieu de `name`, le prefab est fabriqué '
      + 'directement depuis le modèle, sans laisser d\'instance dans la scène. `folder` range le prefab.',
    schema: {type: 'object', properties: {
      name: {type: 'string', description: 'objet source (ou `model`)'},
      model: {type: 'string', description: 'asset modèle source, à la place de `name` (voir list_assets)'},
      prefabName: {type: 'string', description: 'name du prefab (par défaut : celui de l\'objet ou du modèle)'},
      folder: {type: 'string', description: 'dossier du prefab, relatif à assets/ (ex. "Prefabs/Decor")'}
    }, additionalProperties: false},
    exec: function(a){
      if(!a.name === !a.model) throw new Error('donner soit `name` (objet de la scène), soit `model` (asset modèle)');
      const moveTo = function(asset){
        // Sans `folder`, un prefab va dans Prefabs : jamais à la racine (règle assets.folder).
        const folder = String(a.folder === undefined ? 'Prefabs' : a.folder).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        if(folder.split('/').some(function(s){ return s === '..'; })) throw new Error('chemin de dossier invalide');
        moveAssetTo(asset, folder, {silent: true});
        return ', rangé dans ' + (folder || 'la racine');
      };
      if(a.model){
        // Le même enchaînement que instantiate_model → create_prefab → delete_object, en un geste :
        // l'instance de travail ne survit pas à l'appel.
        const model = assets.find(function(x){ return x.kind === 'model' && x.name === a.model; });
        if(!model) throw new Error('modèle introuvable : ' + a.model + '. Modèles disponibles : '
          + (assets.filter(function(x){ return x.kind === 'model'; }).map(function(x){ return x.name; }).join(', ') || '(aucun)'));
        const tmp = instantiateAsset(model, null);
        tmp.name = a.prefabName || model.name;
        let asset;
        try{ asset = createPrefabFromSelection(tmp); }
        finally{
          if(tmp === selection || selectionMulti.indexOf(tmp) !== -1) select(null);
          deleteRoot(tmp);
          updateHierarchy();
        }
        if(!asset) throw new Error('création du prefab impossible');
        // Nom donné explicitement : gardé tel quel (createPrefabFromSelection retire le chiffre final,
        // ce qui changeait « Brouillard_Bord_0 » en « Brouillard_Bord_ »).
        asset.name = a.prefabName || model.name;
        return 'prefab « ' + asset.name + ' » (id ' + asset.id + ') créé depuis le modèle ' + model.name
          + ' — aucune instance laissée dans la scène' + moveTo(asset);
      }
      const o = copFind(a.name);
      // DÉJÀ UNE INSTANCE : on met à jour SON prefab (le geste « Appliquer »), comme la
      // description le promet. Avant, un second asset du même nom était créé à chaque rappel
      // et l'instance changeait de prefab en silence.
      const existing = assetPrefabOf(o);
      if(existing){
        applyAtPrefab(o);
        return 'prefab « ' + existing.name + ' » mis à jour depuis ' + a.name;
      }
      const asset = createPrefabFromSelection(o);
      if(!asset) throw new Error('création du prefab impossible');
      // Le nom de l'objet donné par l'appelant est explicite : pas de nettoyage du chiffre final.
      asset.name = a.prefabName || o.name;
      return 'prefab « ' + asset.name + ' » (id ' + asset.id + ') créé depuis ' + a.name + moveTo(asset);
    }
  },
  {
    name: 'instantiate_prefab',
    description: 'Pose un nouvel exemplaire d\'un prefab existant dans la scène courante. '
      + 'Toutes les instances liées se mettent à jour ensemble quand le prefab est modifié '
      + '(Appliquer, dans l\'inspecteur).',
    schema: {type: 'object', properties: {
      prefab: {type: 'string', description: 'name du prefab (voir list_assets)'},
      name: {type: 'string', description: 'name à donner à cette instance (optionnel)'},
      position: {type: 'object', properties: {x:{type:'number'}, y:{type:'number'}, z:{type:'number'}}}
    }, required: ['prefab'], additionalProperties: false},
    exec: function(a){
      const asset = assets.find(function(x){ return x.kind === 'prefab' && x.name === a.prefab; });
      if(!asset) throw new Error('prefab introuvable : ' + a.prefab + '. Prefabs disponibles : '
        + (assets.filter(function(x){ return x.kind === 'prefab'; }).map(function(x){ return x.name; }).join(', ') || '(aucun)'));
      const copie = instantiateAsset(asset, null);
      if(a.name) copie.name = a.name;
      if(a.position) copie.position.set(
        a.position.x !== undefined ? a.position.x : copie.position.x,
        a.position.y !== undefined ? a.position.y : copie.position.y,
        a.position.z !== undefined ? a.position.z : copie.position.z);
      return 'instancié : ' + JSON.stringify(copResume(copie));
    }
  },
  {
    // Sans elle, un modèle importé (glTF/FBX) par l'utilisateur restait invisible au
    // copilote : create_object ne fabrique que des primitives, et rien ne pouvait poser un
    // exemplaire d'un asset kind:'model' déjà présent dans le projet. Ne PEUT PAS importer un
    // fichier — cette partie reste un geste humain (sélecteur natif) — seulement instancier
    // ce qui est déjà importé.
    name: 'instantiate_model',
    description: 'Pose un nouvel exemplaire d\'un modèle importé (glTF/FBX) déjà présent dans '
      + 'les assets du projet — voir list_assets pour ceux disponibles. Ne peut PAS importer un '
      + 'nouveau fichier : seulement placer un modèle que l\'utilisateur a déjà ajouté au projet.',
    schema: {type: 'object', properties: {
      model: {type: 'string', description: 'name de l\'asset modèle (voir list_assets)'},
      name: {type: 'string', description: 'name à donner à cette instance (optionnel)'},
      position: {type: 'object', properties: {x:{type:'number'}, y:{type:'number'}, z:{type:'number'}}}
    }, required: ['model'], additionalProperties: false},
    exec: function(a){
      const asset = assets.find(function(x){ return x.kind === 'model' && x.name === a.model; });
      if(!asset) throw new Error('modèle introuvable : ' + a.model + '. Modèles disponibles : '
        + (assets.filter(function(x){ return x.kind === 'model'; }).map(function(x){ return x.name; }).join(', ') || '(aucun — importez-en un via le panneau Projet)'));
      const copie = instantiateAsset(asset, null);
      if(a.name) copie.name = a.name;
      if(a.position) copie.position.set(
        a.position.x !== undefined ? a.position.x : copie.position.x,
        a.position.y !== undefined ? a.position.y : copie.position.y,
        a.position.z !== undefined ? a.position.z : copie.position.z);
      return 'instancié : ' + JSON.stringify(copResume(copie));
    }
  },
  {
    // Le champ `type: 'texture'` existe dans material-props.js depuis l'origine de cette
    // table (décrite au modèle par describe_material) mais aucune commande ne l'écrivait :
    // configure_material ne touche que le matériau LOCAL d'une primitive, jamais un asset
    // matériau partagé référencé par materialId — le seul qui porte des maps PBR.
    name: 'configure_material_pbr',
    description: 'Règle les propriétés d\'un asset matériau PBR partagé (celui référencé par '
      + 'l\'objet, ou un nouveau si l\'objet n\'en a pas encore) : couleurs, lissage, métal, ET '
      + 'les maps (albedo, normale, masque combiné ORM, rugosité, métal, occlusion, émissive, '
      + 'lightmap, hauteur), désignées par le nom d\'un asset texture existant. Appelez '
      + 'describe_material avant, pour connaître les clés et plages exactes — la même table '
      + 'valide ici.',
    schema: {type: 'object', properties: {
      name: {type: 'string', description: 'objet (primitive ou modèle importé) portant le matériau'},
      material: {type: 'string', description: 'name de l\'asset matériau à affecter à l\'objet. '
        + 'Existant : il est PARTAGÉ (tous les objets qui le portent changent ensemble). Inconnu : '
        + 'il est créé sous ce nom, dans `folder`. Omis : le matériau déjà porté, ou un nouveau.'},
      folder: {type: 'string', description: 'dossier d\'un matériau créé (défaut « Materials »)'},
      properties: {type: 'object', additionalProperties: true,
        description: 'clé de material-props.js → valeur ; pour une propriété de type texture, '
          + 'le nom d\'un asset texture (ou null pour débrancher)'}
    }, required: ['name'], additionalProperties: false},
    exec: function(a){
      const o = copFind(a.name);
      const aComponentMesh = !!(o.getComponent && o.getComponent('Mesh'));
      const isMeshLegacy = o.userData.type === 'mesh';
      if(!aComponentMesh && !isMeshLegacy && o.userData.type !== 'model')
        throw new Error('« ' + a.name + ' » n\'est ni une primitive ni un modèle importé');
      pushHistory();
      // UN MATÉRIAU NOMMÉ EST PARTAGÉ. Sans ce paramètre, l'outil ne savait qu'éditer le
      // matériau de l'objet ou en créer un par objet : un niveau de 100 blocs finissait avec des
      // couleurs locales et AUCUN asset matériau dans le projet — rien à réutiliser ni à retoucher
      // d'un seul geste.
      let asset = null;
      if(a.material){
        asset = assets.find(function(x){ return x.kind === 'material' && x.name === a.material; });
        if(!asset){
          asset = createAssetMaterial();
          asset.name = a.material;
          asset.folder = a.folder !== undefined ? a.folder : 'Materials';
        }
        if(o.userData.materialId !== asset.id) attachMaterialAsset(asset, o);
      } else {
        asset = o.userData.materialId
          && assets.find(function(x){ return x.id === o.userData.materialId && x.kind === 'material'; });
        if(!asset){
          asset = createAssetMaterial();
          attachMaterialAsset(asset, o);
        }
      }
      const refusal = [];
      Object.keys(a.properties || {}).forEach(function(key){
        const d = propMaterialByKey(key);
        if(!d){ refusal.push('propriété inconnue : ' + key); return; }
        const value = a.properties[key];
        if(d.type === 'texture'){
          if(value === null || value === ''){ asset.props[key] = null; return; }
          const tex = assets.find(function(x){ return x.kind === 'texture' && x.name === value; });
          if(!tex){
            refusal.push(d.label + ' : texture introuvable : ' + value + '. Textures disponibles : '
              + (assets.filter(function(x){ return x.kind === 'texture'; }).map(function(x){ return x.name; }).join(', ') || '(aucune)'));
            return;
          }
          asset.props[key] = tex.id;
          return;
        }
        const v = validatePropMaterial(key, value, asset.props);
        if(!v.ok){ refusal.push(v.message); return; }
        asset.props[key] = v.value;
      });
      if(refusal.length) throw new Error(refusal.join(' · '));
      applyMaterialEverywhere(asset);
      if(o === selection) syncInspector();
      return 'matériau « ' + asset.name + ' » (' + a.name + ') mis à jour : ' + JSON.stringify(a.properties || {});
    }
  },
  {
    // Sans elle, aucune commande ne pouvait poser une machine à états sur un modèle 3D :
    // seule configure_sprite_animation existait, et elle est 2D (js/anim-models.js, la suite
    // d'images d'une planche). L'Animator 3D (js/animator.js) restait à la main uniquement.
    name: 'configure_animator',
    description: 'Attache une machine à états (Animator) à un objet — modèle importé ou groupe '
      + 'qui en contient un — et crée l\'asset animator s\'il n\'en a pas encore. `target` désigne '
      + 'le descendant qui porte les clips quand ce n\'est pas l\'objet lui-même (par défaut, '
      + 'deviné). Utilisez ensuite read_animator_machine puis write_animator_machine pour '
      + 'décrire ses états, paramètres et transitions.',
    schema: {type: 'object', properties: {
      name: {type: 'string'},
      target: {type: 'string', description: 'name du descendant qui porte les clips (optionnel)'}
    }, required: ['name'], additionalProperties: false},
    exec: function(a){
      const o = copFind(a.name);
      pushHistory();
      let comp = o.getComponent('AnimatorController');
      if(!comp) comp = o.addComponent('AnimatorController', {});
      if(!comp.data.assetId) comp.data.assetId = createAssetAnimator(o.name).id;
      if(a.target !== undefined) comp.data.target = a.target;
      stopAnimator(o);
      if(o === selection) buildInspector();
      return 'Animator de ' + a.name + ' : asset « ' + comp.asset.name + ' »'
        + (comp.data.target ? ', cible « ' + comp.data.target + ' »' : '');
    }
  },
  {
    name: 'read_animator_machine',
    description: 'Renvoie la machine à états (format animator.json) d\'un objet, ainsi que les '
      + 'clips disponibles sur sa cible et les assets d\'animation du projet — de quoi écrire '
      + 'des états et transitions qui citent des noms réels. À appeler avant '
      + 'write_animator_machine, qui remplace tout le fichier.',
    schema: {type: 'object', properties: {name: {type: 'string'}}, required: ['name'], additionalProperties: false},
    exec: function(a){
      const o = copFind(a.name);
      const comp = o.getComponent('AnimatorController');
      if(!comp || !comp.asset) throw new Error('« ' + a.name + ' » n\'a pas d\'Animator. '
        + 'Utilisez d\'abord configure_animator.');
      return JSON.stringify({
        machine: comp.machine,
        target: comp.target ? comp.target.name : null,
        clipsDisponibles: clipsOf(comp.target).map(function(c){ return c.name; }),
        animationsProjet: assets.filter(function(x){ return x.kind === 'animation'; }).map(function(x){ return x.name; })
      });
    }
  },
  {
    name: 'write_animator_machine',
    description: 'Remplace ENTIÈREMENT la machine à états d\'un objet par le JSON fourni (format '
      + 'décrit dans js/animator.js : params, states, start, transitions ; `de: "*"` = depuis '
      + 'n\'importe quel état). Relisez avec read_animator_machine avant de corriger — cette '
      + 'commande écrase tout, comme paint_room pour une map de tuiles. Les problèmes '
      + '(état sans sortie, clip inconnu, paramètre non déclaré…) sont signalés, pas refusés : '
      + 'une machine qui bloque le personnage sur place n\'est pas une erreur de format.',
    schema: {type: 'object', properties: {
      name: {type: 'string'},
      machine: {type: 'string', description: 'JSON valide au format animator.json'}
    }, required: ['name', 'machine'], additionalProperties: false},
    exec: function(a){
      const o = copFind(a.name);
      const comp = o.getComponent('AnimatorController');
      if(!comp || !comp.asset) throw new Error('« ' + a.name + ' » n\'a pas d\'Animator. '
        + 'Utilisez d\'abord configure_animator.');
      let machine;
      try{ machine = JSON.parse(a.machine); }
      catch(e){ throw new Error('JSON illisible : ' + e.message); }
      pushHistory();
      comp.asset.machine = machine;
      stopAnimator(o);
      updateProject();
      if(o === selection) buildInspector();
      const clips = clipsOf(comp.target).map(function(c){ return c.name; });
      const anims = assets.filter(function(x){ return x.kind === 'animation'; }).map(function(x){ return x.id; });
      const soucis = (typeof validateAnimator === 'function')
        ? validateAnimator(machine, clips, anims.length ? anims : null) : [];
      return 'machine de ' + a.name + ' mise à jour ('
        + (machine.states || []).length + ' état(s), ' + (machine.transitions || []).length + ' transition(s))'
        + (soucis.length ? ' — ATTENTION : ' + soucis.join(' ') : '');
    }
  },
  {
    // L'interface de jeu (composant UIDocument, js/game-ui.js) était pilotable qu'à la main :
    // sélecteur de fichier ou fenêtre externe. Aucune commande ne pouvait poser un document sur
    // un objet, ni le remplir — alors que attach_script sait déjà écrire les scripts qui LISENT
    // ce document via api.uiDocument(node).
    name: 'configure_ui_document',
    description: 'Attache une interface HTML/CSS (composant UIDocument) à un objet. `document` '
      + 'référence ou crée un asset documentUI (le nom exact du projet — voir list_assets) ; '
      + 'omis, un nouveau document vide est créé pour cet objet. `stylesheets` référence ou crée '
      + 'des assets sheetStyle et les ajoute (elles s\'additionnent, elles ne remplacent pas). '
      + 'Utilisez ensuite write_ui_document et write_ui_stylesheet pour en écrire le contenu.',
    schema: {type: 'object', properties: {
      name: {type: 'string'},
      document: {type: 'string', description: 'name de l\'asset documentUI à référencer ou créer'},
      stylesheets: {type: 'array', items: {type: 'string'},
        description: 'names des assets sheetStyle à référencer ou créer et ajouter'}
    }, required: ['name'], additionalProperties: false},
    exec: function(a){
      const o = copFind(a.name);
      pushHistory();
      let comp = o.getComponent('UIDocument');
      if(!comp) comp = o.addComponent('UIDocument', {});
      let doc = null;
      if(a.document){
        doc = assets.find(function(x){ return x.kind === 'documentUI' && x.name === a.document; });
        if(!doc){ doc = createAssetDocumentUI(o.name); doc.name = a.document; }
      } else if(!comp.data.documentUIId){
        doc = createAssetDocumentUI(o.name);
      }
      if(doc) comp.data.documentUIId = doc.id;
      const sheets = [];
      (a.stylesheets || []).forEach(function(nm){
        let sheet = assets.find(function(x){ return x.kind === 'sheetStyle' && x.name === nm; });
        if(!sheet){ sheet = createAssetSheetStyle(o.name); sheet.name = nm; }
        if(comp.data.sheetStyleIds.indexOf(sheet.id) === -1) comp.data.sheetStyleIds.push(sheet.id);
        sheets.push(sheet.name);
      });
      updateProject();
      if(o === selection) buildInspector();
      const nameDoc = comp.documentUI ? comp.documentUI.name : '(aucun)';
      return 'UIDocument de ' + a.name + ' : document « ' + nameDoc + ' »'
        + (sheets.length ? ', feuilles : ' + sheets.join(', ') : '');
    }
  },
  {
    name: 'write_ui_document',
    description: 'Remplace ENTIÈREMENT le HTML de l\'interface d\'un objet (voir '
      + 'configure_ui_document pour l\'attacher d\'abord). Un élément se lie à '
      + 'api.uiDocument(node).values (écrit par un script via .set(cle, valeur)) avec '
      + '`data-bind="cle"` (texte, ou valeur d\'un champ de saisie) ou `data-bind-class="cle"` '
      + '(ajoute la valeur comme classe CSS — utile pour un bord/couleur piloté par un state).',
    schema: {type: 'object', properties: {
      name: {type: 'string'},
      html: {type: 'string'}
    }, required: ['name', 'html'], additionalProperties: false},
    exec: function(a){
      const o = copFind(a.name);
      const comp = o.getComponent('UIDocument');
      if(!comp || !comp.documentUI) throw new Error('« ' + a.name + ' » n\'a pas de document UI. '
        + 'Utilisez d\'abord configure_ui_document.');
      pushHistory();
      comp.documentUI.html = a.html;
      updateProject();
      if(o === selection) buildInspector();
      return 'document UI « ' + comp.documentUI.name + ' » mis à jour (' + a.html.length + ' caractères)';
    }
  },
  {
    name: 'write_ui_stylesheet',
    description: 'Remplace ENTIÈREMENT le CSS d\'une feuille de style attachée à un objet. '
      + '`sheet` désigne la feuille par nom quand l\'objet en porte plusieurs ; par défaut, la '
      + 'première attachée (voir configure_ui_document pour en attacher).',
    schema: {type: 'object', properties: {
      name: {type: 'string'},
      css: {type: 'string'},
      sheet: {type: 'string', description: 'name de la feuille visée (optionnel)'}
    }, required: ['name', 'css'], additionalProperties: false},
    exec: function(a){
      const o = copFind(a.name);
      const comp = o.getComponent('UIDocument');
      const feuilles = comp ? comp.feuillesStyle : [];
      if(!feuilles.length) throw new Error('« ' + a.name + ' » ne porte aucune feuille de style. '
        + 'Utilisez configure_ui_document (stylesheets) d\'abord.');
      const sheet = a.sheet
        ? feuilles.find(function(x){ return x.name === a.sheet; })
        : feuilles[0];
      if(!sheet) throw new Error('feuille introuvable : ' + a.sheet + '. Feuilles de « ' + a.name
        + ' » : ' + feuilles.map(function(x){ return x.name; }).join(', '));
      pushHistory();
      sheet.css = a.css;
      updateProject();
      return 'feuille « ' + sheet.name + ' » mise à jour (' + a.css.length + ' caractères)';
    }
  },
  {
    name: 'configure_inputs',
    description: 'Règle la table d\'entrées du projet : quelles touches déclenchent quelle action. '
      + 'Les actions par défaut sont advance, back, left, right, jump, interact ; les axes '
      + 'horizontal et vertical s\'appuient dessus. Les scripts lisent api.action(name), '
      + 'api.actionPressed(name) et api.axis(name).',
    schema: {type: 'object', properties: {
      action: {type: 'string', description: 'nom de l\'action (créée si elle n\'existe pas)'},
      keys: {type: 'array', items: {type: 'string'},
        description: 'valeurs KeyboardEvent.key, ex. ["a","ArrowLeft"] ; [" "] pour la bar d\'space'}
    }, required: ['action', 'keys'], additionalProperties: false},
    exec: function(a){
      pushHistory();
      if(!project.inputs) project.inputs = JSON.parse(JSON.stringify(INPUTS_DEFAULT));
      project.inputs.actions[a.action] = a.keys.slice();
      return 'action « ' + a.action + ' » liée à ' + JSON.stringify(a.keys);
    }
  },
  {
    name: 'create_data',
    description: 'Crée ou met à jour une TABLE DE CONTENU (JSON) : statistiques d\'ennemis, '
      + 'objets, dialogues, vagues, équipes… Les scripts la lisent avec api.data(name). '
      + 'À préférer à du code dès qu\'il s\'agit de décrire beaucoup d\'éléments semblables : '
      + 'une table de quarante ennemis vaut mieux que quarante scripts.',
    schema: {type: 'object', properties: {
      name: {type: 'string'},
      content: {type: 'string', description: 'JSON valide, généralement un tableau d\'objects'},
      folder: {type: 'string', description: 'dossier (défaut « Data »)'}
    }, required: ['name', 'content'], additionalProperties: false},
    exec: function(a){
      try{ JSON.parse(a.content); }
      catch(e){ throw new Error('contenu JSON invalide : ' + e.message); }
      const folder = String(a.folder === undefined ? 'Data' : a.folder).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      if(folder.split('/').some(function(s){ return s === '..'; })) throw new Error('chemin de dossier invalide');
      pushHistory();
      const existant = assets.find(function(x){ return x.kind === 'data' && x.name === a.name; });
      if(existant){
        existant.text = a.content;
        updateProject();
        return 'table « ' + a.name + ' » mise à jour (' + a.content.length + ' caractères)';
      }
      const created = createAssetData(a.name, a.content);
      if(folder && created) moveAssetTo(created, folder, {silent: true});
      return 'table « ' + a.name + ' » créée (' + a.content.length + ' caractères) dans ' + (folder || 'la racine');
    }
  },
  {
    name: 'analyze_scene',
    description: 'Contrôle la scène et renvoie les problèmes trouvés : erreurs d\'intégrité '
      + '(scripts invalides, links cassés) ET défauts de jouabilité (plateformes qui se '
      + 'chevauchent, trou infranchissable, objet ramassable sans rien en dessous). '
      + 'À appeler APRÈS avoir construit un niveau : les commandes peuvent toutes réussir et '
      + 'produire un niveau injouable.',
    schema: {type: 'object', properties: {}, additionalProperties: false},
    exec: function(){
      const problemes = analyzeScene();
      if(!problemes.length) return 'aucun problème détecté';
      return JSON.stringify({
        errors: problemes.filter(function(p){ return p.level === 'error'; }).map(function(p){ return p.text; }),
        avertissements: problemes.filter(function(p){ return p.level === 'warn'; }).map(function(p){ return p.text; }),
        infos: problemes.filter(function(p){ return p.level === 'info'; }).map(function(p){ return p.text; })
      });
    }
  },
  {
    name: 'add_event',
    // LES NOMS D'ACTION SONT CEUX DU MOTEUR (js/ui/panels-components.js, EVENT_THEN). La
    // description listait encore les anciens noms français (cacher, detruire, emettre…), renommés
    // en v0.89.1 : le modèle les suivait, l'action était enregistrée puis ignorée par les deux
    // moteurs, sans erreur (revue du 2026-09-29, § 1.6). La liste est écrite ici en dur — la
    // règle 3 interdit de lire EVENT_THEN au chargement — et test/copilote-evenements.test.mjs
    // vérifie qu'elle reste égale à la table.
    description: 'Ajoute un événement visuel « Quand… Alors… » à un objet. when : startup | entreeTrigger | sortieTrigger | click | event (param = tag guetté ou nom d\'événement). Chaque action : {type: montrer (rendre visible) | hide | toggle | destroy | emit (value = nom d\'événement) | jouerSon (value = nom du son) | burstParticules (value = nombre) | status (value = message) | wait (value = secondes) | changerScene (value = nom de scène) | parametreAnim (value = « vitesse = 1 » ou « saute »), target?: nom d\'objet (vide = cet objet), value?: texte/nombre selon le type}.',
    schema: {type: 'object', properties: {
      name: {type: 'string'},
      when: {type: 'string', enum: ['startup','entreeTrigger','sortieTrigger','click','event']},
      param: {type: 'string'},
      actions: {type: 'array', items: {type: 'object', properties: {
        type: {type: 'string', enum: EVENT_ACTION_TYPES}, target: {type: 'string'}, value: {type: 'string'}
      }, required: ['type'], additionalProperties: false}}
    }, required: ['name', 'when', 'actions'], additionalProperties: false},
    exec: function(a){
      const o = copFind(a.name);
      // Les anciens noms français sont TRADUITS plutôt que refusés : un modèle qui les a appris
      // ailleurs obtient l'action voulue. Un nom inconnu, lui, est refusé AVANT d'être enregistré.
      const actions = a.actions.map(function(ac){
        const type = EVENT_ACTION_ALIASES[ac.type] || ac.type;
        if(EVENT_ACTION_TYPES.indexOf(type) === -1){
          throw new Error('action inconnue « ' + ac.type + ' ». Actions : ' + EVENT_ACTION_TYPES.join(', '));
        }
        return {type: type, target: ac.target || '', value: ac.value || ''};
      });
      pushHistory();
      ensureEvents(o).push({when: a.when, param: a.param || '', actions: actions});
      if(o === selection) buildInspector();
      return 'événement « ' + a.when + ' » ajouté à ' + a.name + ' (' + a.actions.length + ' action(s))';
    }
  },
  {
    name: 'configure_particles',
    description: 'Configure un émetteur de particules (objet de type particules). Champs : forme (cone|point|box|sphere), mode (continu|burst), taux, quantite, vie, vitesse, gravite, tailleDebut/Fin, opaciteDebut/Fin, couleurDebut/Fin (hex), additif, max.',
    schema: {type: 'object', properties: {
      name: {type: 'string'},
      shape: {type: 'string', enum: ['cone','point','box','sphere']},
      mode: {type: 'string', enum: ['continu','burst']},
      rate: {type: 'number'}, amount: {type: 'number'}, life: {type: 'number'},
      speed: {type: 'number'}, gravity: {type: 'number'},
      sizeStart: {type: 'number'}, sizeEnd: {type: 'number'},
      opacityStart: {type: 'number'}, opacityEnd: {type: 'number'},
      colorStart: {type: 'string'}, colorEnd: {type: 'string'},
      additive: {type: 'boolean'}, max: {type: 'number'}
    }, required: ['name'], additionalProperties: false},
    exec: function(a){
      const o = copFind(a.name);
      if(o.userData.type !== 'particles') throw new Error('« ' + a.name + ' » n\'est pas un émetteur');
      pushHistory();
      const pa = ensurePart(o);
      Object.keys(a).forEach(function(k){ if(k !== 'name') pa[k] = a[k]; });
      resetSystemParticles(o);
      if(o === selection) buildInspector();
      return 'particules de ' + a.name + ' : ' + JSON.stringify(pa);
    }
  },
  {
    name: 'generate_terrain',
    description: 'Génère un relief procédural sur un objet de type terrain (bruit fractal), et/ou règle ses couleurs par altitude. amplitude = hauteur des montagnes en mètres, echelle = taille des formes (petit = accidenté).',
    schema: {type: 'object', properties: {
      name: {type: 'string'},
      amplitude: {type: 'number'}, scale: {type: 'number'},
      flatten: {type: 'boolean', description: 'remet le terrain à plat au lieu de générer'},
      colorBottom: {type: 'string'}, colorTop: {type: 'string'}, colorSnow: {type: 'string'},
      rockThreshold: {type: 'number'}, snowThreshold: {type: 'number'}
    }, required: ['name'], additionalProperties: false},
    exec: function(a){
      const o = copFind(a.name);
      if(o.userData.type !== 'terrain') throw new Error('« ' + a.name + ' » n\'est pas un terrain');
      pushHistory();
      const te = ensureTerrain(o);
      ['couleurBas','couleurHaut','couleurNeige','seuilRoche','seuilNeige'].forEach(function(k){
        if(a[k] !== undefined) te[k] = a[k];
      });
      if(a.flatten) flattenTerrain(o);
      else if(a.amplitude !== undefined || a.scale !== undefined)
        generateTerrain(o, a.amplitude || 6, a.scale || 8, Math.floor(Math.random() * 100000));
      else applyHeightsTerrain(o);
      if(o === selection) buildInspector();
      return 'terrain ' + a.name + ' mis à jour';
    }
  },
  {
    name: 'configure_environment',
    description: 'Règle le ciel, le brouillard et l\'éclairage global de la scène courante. L\'éclairage '
      + 'ambiant est une lumière HÉMISPHÉRIQUE : `ambient` (intensité), `ambientColor` (couleur venue du '
      + 'ciel) et `ambientGroundColor` (couleur renvoyée par le sol). Sauvegardé avec la scène.',
    schema: {type: 'object', properties: {
      sky: {type: 'string', enum: ['color','gradient']},
      skyColor: {type: 'string'}, skyTop: {type: 'string'}, skyBottom: {type: 'string'},
      fog: {type: 'boolean'}, fogColor: {type: 'string'},
      fogNear: {type: 'number'}, fogFar: {type: 'number'},
      ambient: {type: 'number'}, ambientColor: {type: 'string', description: 'hémisphère : couleur du ciel'},
      ambientGroundColor: {type: 'string', description: 'hémisphère : couleur du sol'},
      sun: {type: 'number'}
    }, additionalProperties: false},
    exec: function(a){
      pushHistory();
      // Les clés de l'outil sont anglaises, celles du format (env) en partie françaises : on
      // traduit. Écrire `env.fog` / `env.ambient` tel quel ne réglait RIEN (ces clés-là ne sont
      // lues par personne) et l'outil répondait « mis à jour ».
      Object.keys(a).forEach(function(k){ env[ENV_TOOL_KEYS[k] || k] = a[k]; });
      applyEnvironment();
      if(!selection) buildInspector();
      return 'environnement mis à jour : ' + JSON.stringify(a);
    }
  },
  {
    // Le PostVolume est la SEULE source de post-traitement depuis v0.105.0 (post-profile.js,
    // component-postvolume.js) : sans cette commande le copilote ne pouvait ni bloom, ni
    // vignette, ni color grading — le champ `env.post` qu'il connaissait encore n'est plus lu.
    name: 'configure_post_volume',
    description: 'Crée/configure un PostVolume (post-traitement façon Unity Volume) sur un '
      + 'objet, et règle le profil d\'effets qui lui est associé (créé automatiquement si absent). '
      + 'global=true applique le volume à toute la scène ; sinon shape+size/radius+blendDistance '
      + 'délimitent une zone. Chaque effet non fourni reste inchangé ; fournir un champ d\'un '
      + 'effet le marque overridden automatiquement.',
    schema: {type: 'object', properties: {
      name: {type: 'string'},
      global: {type: 'boolean'},
      shape: {type: 'string', enum: ['box', 'sphere']},
      size: {type: 'object', properties: {x:{type:'number'}, y:{type:'number'}, z:{type:'number'}}},
      radius: {type: 'number'}, blendDistance: {type: 'number'}, priority: {type: 'number'},
      effects: {type: 'object', properties: {
        bloom: {type: 'object', properties: {threshold:{type:'number'}, intensity:{type:'number'}, radius:{type:'number'}}, additionalProperties: false},
        vignette: {type: 'object', properties: {amount:{type:'number'}}, additionalProperties: false},
        grain: {type: 'object', properties: {amount:{type:'number'}}, additionalProperties: false},
        toneMapping: {type: 'object', properties: {mode:{type:'string', enum:['aces','linear','reinhard','cineon']}}, additionalProperties: false},
        colorGrading: {type: 'object', properties: {contrast:{type:'number'}, saturation:{type:'number'}, temperature:{type:'number'}, exposure:{type:'number'}}, additionalProperties: false},
      }, additionalProperties: false}
    }, required: ['name'], additionalProperties: false},
    exec: function(a){
      const o = copFind(a.name);
      pushHistory();
      let comp = o.getComponent('PostVolume');
      if(!comp) comp = o.addComponent('PostVolume', {});
      ['global', 'shape', 'radius', 'blendDistance', 'priority'].forEach(function(k){
        if(a[k] !== undefined) comp.data[k] = a[k];
      });
      if(a.size) Object.assign(comp.data.size, a.size);
      if(!comp.data.profileId){
        const created = createAssetPostProfile();
        comp.data.profileId = created.id;
      }
      const asset = assets.find(function(x){ return x.id === comp.data.profileId && x.kind === 'postProfile'; });
      if(a.effects && asset){
        Object.keys(a.effects).forEach(function(key){
          const effet = asset.effects[key];
          if(!effet) return;   // clé inconnue : déjà refusée par le schema, ignorée ici par sécurité
          Object.assign(effet, a.effects[key]);
          effet.overridden = true;
        });
        updateProject();
      }
      updatePostVolumeViz();
      if(o === selection) syncInspector();
      return 'volume post de ' + a.name + ' : ' + JSON.stringify(comp.data)
        + (asset ? ' · profil ' + asset.name + ' : ' + JSON.stringify(asset.effects) : '');
    }
  },
  {
    // create_object savait déjà fabriquer un objet de type 'probe' (TYPES_CREATABLE,
    // js/objects.js) mais son enum n'incluait pas ce type, et aucune commande ne pouvait
    // régler radius/resolution/intensity/projection boîte — tout restait à la main dans
    // l'inspecteur (composant Reflection, js/components/component-reflection.js).
    name: 'configure_reflection_probe',
    description: 'Règle une sonde de réflexion (composant Reflection, créée via create_object '
      + 'type « probe »). `box` active la projection boîte : le reflet reste accroché aux murs '
      + 'd\'une pièce de dimensions `boxSize`, plutôt que de sembler venir de l\'infini — '
      + 'indispensable dès qu\'un objet réfléchissant bouge dans un espace fermé.',
    schema: {type: 'object', properties: {
      name: {type: 'string'},
      radius: {type: 'number', description: 'rayon d\'influence en mètres (défaut 18)'},
      resolution: {type: 'number', description: 'côté du cubemap cuit, en pixels (16 à 512, défaut 128)'},
      intensity: {type: 'number', description: 'multiplie le reflet appliqué aux matériaux (défaut 1)'},
      box: {type: 'boolean', description: 'projection boîte (défaut faux : reflet à l\'infini)'},
      boxSize: {type: 'object', properties: {x:{type:'number'}, y:{type:'number'}, z:{type:'number'}},
        description: 'dimensions de la pièce en mètres, si box est actif'},
      boxOffset: {type: 'object', properties: {x:{type:'number'}, y:{type:'number'}, z:{type:'number'}},
        description: 'centre de la boîte, relatif à la sonde'}
    }, required: ['name'], additionalProperties: false},
    exec: function(a){
      const o = copFind(a.name);
      if(!o.getComponent('Reflection')) throw new Error('« ' + a.name + ' » n\'est pas une sonde '
        + 'de réflexion. Créez-la avec create_object type « probe ».');
      pushHistory();
      const s = ensureProbe(o);
      ['radius', 'resolution', 'intensity', 'box'].forEach(function(k){
        if(a[k] !== undefined) s[k] = a[k];
      });
      if(a.boxSize) s.boxSize = [
        a.boxSize.x !== undefined ? a.boxSize.x : s.boxSize[0],
        a.boxSize.y !== undefined ? a.boxSize.y : s.boxSize[1],
        a.boxSize.z !== undefined ? a.boxSize.z : s.boxSize[2]];
      if(a.boxOffset) s.boxOffset = [
        a.boxOffset.x !== undefined ? a.boxOffset.x : s.boxOffset[0],
        a.boxOffset.y !== undefined ? a.boxOffset.y : s.boxOffset[1],
        a.boxOffset.z !== undefined ? a.boxOffset.z : s.boxOffset[2]];
      disposeProbe(o);
      applyProbes();
      updateBoxProbeViz();
      if(o === selection) syncInspector();
      return 'sonde ' + a.name + ' : ' + JSON.stringify(s);
    }
  },
  {
    name: 'bake_reflection_probes',
    description: 'Cuit (ou recuit) le cubemap d\'une ou plusieurs sondes de réflexion — sans '
      + 'attendre le lancement du mode lecture. Sans `objects`, cuit toutes les sondes actives '
      + 'de la scène.',
    schema: {type: 'object', properties: {
      objects: {type: 'array', items: {type: 'string'}, description: 'sondes à cuire ; toutes si omis'}
    }, additionalProperties: false},
    exec: function(a){
      const cibles = (a.objects && a.objects.length) ? a.objects.map(copFind)
        : probesActive();
      if(!cibles.length) throw new Error('aucune sonde de réflexion active dans la scène');
      cibles.forEach(function(o){
        if(!o.getComponent('Reflection')) throw new Error('« ' + o.name + ' » n\'est pas une sonde de réflexion');
      });
      pushHistory();
      cibles.forEach(function(o){ bakeProbe(o); });
      applyProbes();
      return cibles.length + ' sonde(s) cuite(s) : ' + cibles.map(function(o){ return o.name; }).join(', ');
    }
  },
  {
    // Cuite ou pas, l'éclairage précalculé restait accessible qu'à la main (menu Rendu →
    // Cuire les lightmaps, moteur/js/lightmap-bake.js) : aucune commande ne pouvait lancer
    // une cuisson, alors que describe_material/configure_material_pbr enseignent et écrivent
    // lightmapAsset/lightmapUv depuis longtemps sans jamais pouvoir les remplir eux-mêmes.
    name: 'bake_lightmaps',
    description: 'Cuit les lightmaps (éclairage précalculé — irradiance directe et rebonds) de '
      + 'toute la scène, ou d\'objets précis. COÛTEUX : plusieurs secondes à quelques minutes '
      + 'selon résolution et nombre d\'images. Les matériaux concernés reçoivent '
      + 'automatiquement l\'asset produit (lightmapAsset). Un objet sans second game d\'UV '
      + '(dépliage de lightmap) reçoit un avertissement mais n\'empêche pas la cuisson.',
    schema: {type: 'object', properties: {
      objects: {type: 'array', items: {type: 'string'},
        description: 'objets à cuire (racines) ; toute la scène si omis. Les objets non listés '
          + 'continuent de projeter leur ombre mais n\'occupent pas de place dans l\'atlas.'},
      resolution: {type: 'number', enum: [256, 512, 1024, 2048, 4096], description: 'défaut 1024'},
      images: {type: 'number', description: 'images accumulées : moins de bruit mais plus lent (4 à 4000, défaut 240)'},
      bounces: {type: 'number', description: 'rebonds de lumière indirecte, 0 à 3 (défaut 1) ; '
        + 'chaque rebond au-delà du premier vaut l\'albédo au carré'},
      smooth: {type: 'number', description: 'douceur des ombres, gigue des lampes en unités monde (défaut 0.35, 0 = ombres dures)'},
      rgbm: {type: 'boolean', description: 'encodage HDR, portée 64 au lieu de 1 (défaut vrai)'},
      denoise: {type: 'boolean', description: 'filtre bilatéral, préserve les bords d\'ombre (défaut vrai)'},
      name: {type: 'string', description: 'name de l\'asset lightmap produit (défaut « Lightmap »)'}
    }, additionalProperties: false},
    exec: async function(a){
      if(lightmapBakeState.active) throw new Error('une cuisson est déjà en cours');
      const racines = (a.objects && a.objects.length) ? a.objects.map(copFind) : [];
      const reg = settingsLightmap();
      const settings = {
        resolution: a.resolution || reg.resolution,
        images: Math.max(4, Math.min(4000, (a.images !== undefined) ? a.images : reg.images)),
        bounces: Math.max(0, Math.min(3, (a.bounces !== undefined) ? a.bounces : reg.bounces)),
        smooth: Math.max(0, (a.smooth !== undefined) ? a.smooth : reg.smooth),
        rgbm: (a.rgbm !== undefined) ? !!a.rgbm : reg.rgbm,
        denoise: (a.denoise !== undefined) ? !!a.denoise : reg.denoise
      };
      pushHistory();
      project.lightmap = settings;
      updateProject();
      let asset;
      try {
        asset = await bakeLightmap(Object.assign({selection: racines, name: a.name}, settings));
      } catch(e){
        throw new Error('cuisson interrompue : ' + e.message);
      }
      if(!asset) throw new Error('aucun maillage à cuire — vérifiez la sélection et que les '
        + 'objets visés portent bien un dépliage de lightmap');
      return 'lightmap « ' + asset.name + ' » cuite : ' + settings.resolution + '×' + settings.resolution
        + ', ' + settings.bounces + ' rebond(s), ' + settings.images + ' images';
    }
  },
  {
    // Seule la caméra 2D avait une commande (configure_camera_2d) : field of view, near/far,
    // caméra principale et masque de calques d'une caméra 3D restaient à la main dans
    // l'inspecteur (js/ui/panels-components.js, sections cam-main et cam-layers).
    name: 'configure_camera',
    description: 'Règle une caméra 3D en perspective : field of view, plans near/far, si elle est '
      + 'la caméra principale (une seule à la fois — les autres sont désactivées), et les '
      + 'calques qu\'elle voit (un calque omis du champ layers n\'est pas affecté ; par défaut, '
      + 'sans aucun réglage, tous les calques sont visibles).',
    schema: {type: 'object', properties: {
      name: {type: 'string'},
      fov: {type: 'number', description: 'field of view verticale, en degrés'},
      near: {type: 'number'}, far: {type: 'number'},
      main: {type: 'boolean', description: 'la désigne comme caméra principale (désactive ce flag sur les autres)'},
      layers: {type: 'object', additionalProperties: {type: 'boolean'},
        description: 'name de calque → visible ou non pour cette caméra'},
      projection: {type: 'string', enum: ['perspective', 'orthographic']},
      orthoSize: {type: 'number', description: 'demi-hauteur vue, en mètres (orthographique)'},
      viewport: {type: ['object', 'null'], properties: {x: {type: 'number'}, y: {type: 'number'}, w: {type: 'number'}, h: {type: 'number'}},
        description: 'INCRUSTATION : rectangle d\'affichage normalisé 0..1, origine en bas à gauche (ex. mini-carte '
          + '{x:0.78, y:0.02, w:0.2, h:0.26}). La caméra est rendue par-dessus l\'image principale. null = pas d\'incrustation.'}
    }, required: ['name'], additionalProperties: false},
    exec: function(a){
      const o = copFind(a.name);
      const cam = o.getComponent && o.getComponent('Camera');
      if(!cam) throw new Error('« ' + a.name + ' » n\'a pas de composant Camera');
      pushHistory();
      const fait = [];
      if(a.fov !== undefined){ cam.fov = a.fov; fait.push('fov=' + a.fov); }
      if(a.near !== undefined){ cam.near = a.near; fait.push('near=' + a.near); }
      if(a.far !== undefined){ cam.far = a.far; fait.push('far=' + a.far); }
      if(a.projection !== undefined){ cam.projection = a.projection; fait.push('projection ' + a.projection); }
      if(a.orthoSize !== undefined){ cam.orthoSize = a.orthoSize; fait.push('orthoSize=' + a.orthoSize); }
      if(a.fov !== undefined || a.near !== undefined || a.far !== undefined || a.projection !== undefined || a.orthoSize !== undefined) cam.applyProjection();
      if(a.viewport !== undefined){
        const vp = a.viewport === null ? null : normalizeViewport(a.viewport);
        if(a.viewport !== null && !vp) throw new Error('viewport invalide : x, y, w, h entre 0 et 1, w et h non nuls');
        cam.data.viewport = vp;
        fait.push(vp ? 'incrustée en ' + JSON.stringify(vp) : 'plus incrustée');
      }
      if(a.main !== undefined){
        // Sur le COMPOSANT, par `setCameraMain` : c'est `Camera.main` que `rtCameraMain` lit en
        // premier (isCameraMain). N'écrire que l'ancien `userData.game.main` laissait gagner une
        // autre caméra dont le composant portait déjà `main`.
        if(a.main && typeof setCameraMain === 'function') setCameraMain(o, Registry.activeNodes('Camera'));
        else {
          cam.main = !!a.main;
          if(o.userData.game) delete o.userData.game.main;
        }
        fait.push(a.main ? 'caméra principale' : 'plus caméra principale');
      }
      if(a.layers){
        Object.keys(a.layers).forEach(function(nm){
          const l = project.layers.find(function(x){ return x.name === nm || String(x.id) === String(nm); });
          if(!l) throw new Error('calque introuvable : ' + nm + ' (utilise manage_layers action « list »)');
          setCameraLayer(cam, l.id, !!a.layers[nm]);
        });
        fait.push('calques : ' + JSON.stringify(a.layers));
      }
      if(o === selection) buildInspector();
      return 'caméra ' + a.name + (fait.length ? ' — ' + fait.join(', ') : ' — rien à changer');
    }
  },
  {
    name: 'list_assets',
    description: 'Liste les assets du projet (textures, modèles, prefabs, scripts, matériaux, sons) et les scènes. '
      + 'Chaque asset porte son `id` : c\'est lui que citent les champs assetId/scriptId des composants.',
    schema: {type: 'object', properties: {}, additionalProperties: false},
    exec: function(){
      return JSON.stringify({
        scenes: project.scenes.map(function(s, i){
          return {name: s.name, current: i === project.current};
        }),
        assets: assets.map(function(a){
          // id : ce que référencent assetId (composant Model), scriptId, prefabId…
          return {id: a.id, name: a.name, kind: a.kind, folder: a.folder || ''};
        })
      });
    }
  },
  {
    name: 'manage_scenes',
    description: 'Gère les scènes du projet : action "create" (nouvelle scène vide), "activer" (bascule vers une scène existante), "rename" (renomme, `newName`), "delete" (supprime définitivement ; le projet garde toujours au moins une scène), "reorder" (déplace la scène à la position `index`, 0 = première) ou "set_start" (scène de départ du jeu publié et de play_and_measure ; `name` vide = revenir à la scène active au lancement).',
    schema: {type: 'object', properties: {
      action: {type: 'string', enum: ['create', 'activer', 'rename', 'delete', 'reorder', 'set_start']},
      name: {type: 'string'},
      newName: {type: 'string', description: 'rename : nouveau nom'},
      index: {type: 'number', description: 'reorder : nouvelle position (0 = première)'}
    }, required: ['action', 'name'], additionalProperties: false},
    exec: function(a){
      if(a.action === 'create'){
        addScene();
        project.scenes[project.scenes.length - 1].name = a.name;
        updateScenes();
        return 'scène « ' + a.name + ' » créée et activée';
      }
      if(a.action === 'set_start' && !a.name){
        project.settings.startScene = null;
        return 'scène de départ : la scène active au lancement';
      }
      const i = project.scenes.findIndex(function(s){ return s.name === a.name; });
      if(i === -1) throw new Error('scène « ' + a.name + ' » introuvable');
      if(a.action === 'set_start'){
        project.settings.startScene = a.name;
        return 'scène de départ : « ' + a.name + ' »';
      }
      if(a.action === 'reorder'){
        const to = Math.round(Number(a.index));
        if(!isFinite(to) || to < 0 || to >= project.scenes.length)
          throw new Error('index invalide : entre 0 et ' + (project.scenes.length - 1));
        const active = project.scenes[project.current];
        const moved = project.scenes.splice(i, 1)[0];
        project.scenes.splice(to, 0, moved);
        project.current = project.scenes.indexOf(active);
        updateScenes();
        return 'ordre des scènes : ' + project.scenes.map(function(s){ return s.name; }).join(', ');
      }
      if(a.action === 'rename'){
        const n = String(a.newName || '').trim();
        if(!n) throw new Error('le nouveau nom de la scène est vide');
        if(project.scenes.some(function(s, k){ return k !== i && s.name === n; })) throw new Error('une scène s\'appelle déjà « ' + n + ' »');
        project.scenes[i].name = n;
        if(project.settings && project.settings.startScene === a.name) project.settings.startScene = n;
        updateScenes();
        return 'scène « ' + a.name + ' » renommée en « ' + n + ' »';
      }
      if(a.action === 'delete'){
        // PAS `deleteScene()` : elle demande confirmation par `confirm()`, qui bloquerait l'appel
        // MCP jusqu'à ce que quelqu'un clique. La demande de l'agent vaut ici confirmation.
        if(project.scenes.length < 2) throw new Error('le projet doit garder au moins une scène');
        const s = project.scenes[i];
        if(i === project.current) changeScene(i === 0 ? 1 : 0);
        const k = project.scenes.indexOf(s);
        project.scenes.splice(k, 1);
        if(project.current > k) project.current--;
        if(project.settings && project.settings.startScene === a.name) project.settings.startScene = null;
        updateScenes();
        return 'scène « ' + a.name + ' » supprimée ; scène active : ' + project.scenes[project.current].name;
      }
      changeScene(i);
      return 'scène active : ' + a.name;
    }
  },
  {
    name: 'instantiate_subscene',
    description: 'Instancie une AUTRE scène du projet dans la scène courante (un seul nœud qui affiche tout son contenu ; modifier la scène source met à jour toutes ses instances). Idéal pour un décor ou un module réutilisable.',
    schema: {type: 'object', properties: {
      scene: {type: 'string', description: 'nom de la scène à instancier'},
      position: {type: 'object', properties: {x:{type:'number'}, y:{type:'number'}, z:{type:'number'}}}
    }, required: ['scene'], additionalProperties: false},
    exec: function(a){
      if(indexScene(a.scene) === -1) throw new Error('scène « ' + a.scene + ' » introuvable');
      if(indexScene(a.scene) === project.current)
        throw new Error('une scène ne peut pas s\'instancier elle-même');
      const o = createSubScene(a.scene);
      if(!o) throw new Error('instanciation impossible');
      if(a.position) o.position.set(a.position.x || 0, a.position.y || 0, a.position.z || 0);
      let n = 0;
      traversesSubScene(o, function(){ n++; });
      return 'sous-scène « ' + a.scene + ' » instanciée (' + n + ' objet(s) générés)';
    }
  },
  {
    name: 'set_play_mode',
    // Il n'y a plus de mode lecture DANS l'éditeur : « ▶ Jouer » ouvre game-preview.html dans un
    // onglet indépendant (js/play-mode.js), que l'éditeur ne pilote pas. Cette commande disait
    // pouvoir « arrêter le mode lecture (scène restaurée) » : c'était faux, et le copilote le
    // croyait (docs/REVUE_2026-09-29.md § 6.1). `active: false` échoue donc en le disant.
    description: 'Ouvre l\'aperçu du jeu (▶ Jouer) dans un onglet indépendant. L\'éditeur ne pilote pas '
      + 'cet onglet : il ne peut ni l\'arrêter ni y lire quoi que ce soit (active: false échoue). '
      + 'Pour faire tourner le jeu et mesurer ce qui s\'y passe, utiliser play_and_measure.',
    schema: {type: 'object', properties: {active: {type: 'boolean'}}, required: ['active'], additionalProperties: false},
    exec: function(a){
      if(!a.active){
        throw new Error('impossible d\'arrêter le jeu depuis l\'éditeur : il tourne dans un onglet '
          + 'indépendant, que seule la personne peut fermer');
      }
      play();
      return 'aperçu du jeu ouvert dans un nouvel onglet (l\'éditeur ne peut pas l\'arrêter)';
    }
  },

  // ---------- Les commandes 2D ----------
  //
  // `create_object` fabrique des maillages 3D. Sans commandes propres, le copilote ne savait
  // rien construire en 2D — il croyait réussir et posait des cubes. (Le refus d'un composant 2D
  // sur un nœud 3D, qui justifiait autrefois ces commandes, a disparu en v0.91.0.)
  //
  // `paint_room` prend un PLAN EN TEXTE, une ligne par rangée. C'est ce qu'un modèle de
  // langage produit juste, et surtout ce qu'il peut se relire : un tableau de 1 296 entiers ne se
  // relit pas, un plan en caractères si. `read_room` rend le même format, ce qui permet de
  // corriger une salle plutôt que de la redo.

  {
    name: 'create_object_2d',
    description: 'Crée un objet 2D (plan XY). Types : sprite (affiche une '
      + 'image d\'une planche), tuiles (map de tuiles), camera (orthographique, celle qui cadre le '
      + 'jeu — la première créée devient la principale), empty (un groupe, pour un point de départ '
      + 'ou un déclencheur). C\'est un nœud comme un autre : il peut recevoir n\'importe quel '
      + 'composant, 2D ou 3D.',
    schema: {type: 'object', properties: {
      type: {type: 'string', enum: ['sprite', 'tiles', 'camera', 'empty']},
      name: {type: 'string'},
      sheet: {type: 'string', description: 'nom de l\'asset sprite à utiliser (types sprite et tuiles)'},
      position: {type: 'object', properties: {x: {type: 'number'}, y: {type: 'number'}}},
      layer: {type: 'string', description: 'Fond, Décor, Jeu, Premier plan, Interface'}
    }, required: ['type'], additionalProperties: false},
    exec: function(a){
      // La caméra passe par `createFromCreatable`, et NON par le code générique
      // en dessous : lui seul pose « la première caméra 2D devient la principale ». Sans ce marquage
      // `rtCameraMain` retombe sur `cams[0]`, et la scène de départ y met toujours sa caméra
      // 3D. Mesuré sur un jeu réel : décor, sprites et tri tous corrects, et un écran où l'on ne
      // voyait rien — le jeu rendait depuis une perspective posée à l'origine.
      if(a.type === 'camera'){
        const n = createFromCreatable('Camera');
        n.getComponent('Camera').projection = 'orthographic';
        n.getComponent('Camera').applyProjection();
        // Le NŒUD regarde le plan XY : une caméra pointe vers son +Z, et un décor 2D vit
        // derrière elle si on ne la retourne pas.
        faceCameraToPlane(n);
        if(!n.getComponent('CameraFollow')) n.addComponent('CameraFollow', {});
        // La première caméra devient la PRINCIPALE : sans ce marquage `rtCameraMain` retombe sur
        // `cams[0]`, et la scène de départ y met toujours sa caméra 3D. Mesuré sur un jeu réel :
        // décor, sprites et tri corrects, et un écran où l'on ne voyait rien.
        // Par `isCameraMain` (composant OU ancien drapeau), et marquée sur le COMPOSANT : le test
        // ne lisait que `userData.game.main`, si bien qu'une caméra dont le composant portait déjà
        // `main` passait pour « pas de principale » — deux principales, départagées par l'ordre.
        const autres = Registry.activeNodes('Camera').filter(function(x){ return x !== n; });
        const hasMain = autres.some(function(x){
          return (typeof isCameraMain === 'function') ? isCameraMain(x) : !!(x.userData.game && x.userData.game.main);
        });
        if(!hasMain) n.getComponent('Camera').main = true;
        if(a.name) n.name = a.name;
        if(a.position) n.position.set(a.position.x || 0, a.position.y || 0, 0);
        updateHierarchy();
        return 'créé en 2D : ' + JSON.stringify(copResume(n));
      }
      const sheet = a.sheet ? copSpriteByName(a.sheet) : null;
      if((a.type === 'sprite' || a.type === 'tiles') && !sheet){
        throw new Error('planche introuvable : ' + (a.sheet || '(aucune fournie)')
          + '. Planches disponibles : ' + copListSprites());
      }
      pushHistory();
      const o = createSceneNode({
        name: a.name || (a.type === 'tiles' ? 'Tuiles' : (a.type === 'sprite' ? sheet.name : 'Objet 2D')),
        position: { x: (a.position && a.position.x) || 0,
                    y: (a.position && a.position.y) || 0, z: 0 }
      });
      if(a.type === 'sprite'){
        o.addComponent('SpriteRenderer', {spriteId: sheet.id, region: '', layer: a.layer || 'Jeu',
                                          order: 0, teinte: '#ffffff', retourneX: false, retourneY: false,
                                          sortDepth: false});
      } else if(a.type === 'tiles'){
        // La planche devient une PALETTE, asset partagé : c'est elle qui porte les tuiles, et
        // deux décors peuvent la réutiliser sans recopier quoi que ce soit.
        // RÉUTILISER la palette de cette planche si elle existe déjà : chaque appel en créait une
        // neuve (« herbe — palette », « herbe — palette » …) et les posait dans le dossier COURANT,
        // c'est-à-dire à la racine des assets. Une palette neuve se range dans Palettes/, par type,
        // comme le reste (règle assets.folder).
        let pal = assets.find(function(x){
          return x.kind === 'tilePalette' && x.palette && x.palette.tiles.length === 1
            && x.palette.tiles[0].spriteId === sheet.id;
        });
        if(!pal){
          pal = createAssetTilePalette(sheet.name + ' — palette', 0.5, 'Palettes');
          pal.palette.tiles.push({name: sheet.name, spriteId: sheet.id,
                                  autotile: true, collision: 'solid'});
        }
        o.addComponent('Tilemap', {width: 48, height: 27, cellSize: 0.5,
                                   layer: a.layer || 'Décor', paletteId: pal.id});
      }
      updateHierarchy();
      select(o);
      return 'créé en 2D : ' + JSON.stringify(copResume(o));
    }
  },
  {
    name: 'configure_sprite',
    description: 'Règle l\'affichage d\'un objet 2D : quelle IMAGE de sa planche il montre, sur '
      + 'quel calque, son ordre, sa teinte, s\'il est retourné, et s\'il se trie par profondeur. '
      + 'C\'est ainsi qu\'on choisit la face d\'un coffre, l\'orientation d\'un PNJ posé, ou qu\'on '
      + 'réutilise une pose de gauche pour la droite sans dessiner une image de plus.',
    schema: {type: 'object', properties: {
      name: {type: 'string'},
      image: {type: 'string', description: 'nom de l\'image dans la planche (voir slice_sheet)'},
      layer: {type: 'string', description: 'Fond, Décor, Jeu, Premier plan, Interface'},
      order: {type: 'number', description: 'rang dans le calque ; ignoré si le tri par profondeur est active'},
      tint: {type: 'string', description: 'couleur multipliée, #rrggbb — #ffffff ne teinte pas'},
      flipX: {type: 'boolean', description: 'miroir horizontal : une pose de gauche sert à droite'},
      flipY: {type: 'boolean'},
      depthSort: {type: 'boolean',
        description: 'trier par la position : ce qui est plus bas passe devant. Vue de dessus.'}
    }, required: ['name'], additionalProperties: false},
    exec: function(a){
      const o = copFind(a.name);
      const d = o.userData.sprite2d;
      if(!d) throw new Error('« ' + a.name + ' » n\'affiche pas de sprite. Créez-le avec '
        + 'create_object_2d type « sprite ».');
      // L'IMAGE EST VÉRIFIÉE ICI. `regionOfSprite` retombe volontairement sur la première image
      // quand le nom est inconnu — utile au rendu, trompeur pour un réglage : on croirait avoir
      // posé la pose « dos » et on regarderait la pose « face », sans un mot.
      if(a.image !== undefined){
        const pl = assets.find(function(x){ return x.id === d.spriteId && x.kind === 'sprite'; });
        const names = ((pl && pl.regions) || []).map(function(r){ return r.name; });
        if(names.indexOf(a.image) < 0) throw new Error('image « ' + a.image + ' » absente de la '
          + 'planche. Images disponibles : ' + (names.join(', ') || '(aucune — découpez la planche)'));
      }
      pushHistory();
      // PARAMÈTRE DE L'OUTIL → CHAMP DU SAC. Les deux n'ont pas le même nom : le schéma a été migré
      // en anglais (`tint`, `flipX`, `depthSort`), le sac `sprite2d` garde ses champs sérialisés
      // (`teinte`, `retourneX`, `sortDepth`). La boucle d'avant lisait `a.teinte`/`a.triProfondeur`,
      // que le schéma n'autorise pas : `depthSort:true` « réussissait » et `sortDepth` restait faux.
      const FIELDS = {layer: 'layer', order: 'order', tint: 'teinte', flipX: 'retourneX',
                      flipY: 'retourneY', depthSort: 'sortDepth'};
      Object.keys(FIELDS).forEach(function(k){
        if(a[k] === undefined) return;
        d[FIELDS[k]] = (k === 'flipX' || k === 'flipY' || k === 'depthSort') ? !!a[k] : a[k];
      });
      if(a.image !== undefined) d.region = a.image;
      rebuildMeshSprite(o);
      syncInspector();
      return 'sprite de « ' + a.name + ' » : ' + JSON.stringify(d);
    }
  },
  {
    name: 'paint_room',
    description: 'Peint une map de tuiles à partir d\'un PLAN EN TEXTE : une ligne par rangée, '
      + 'un caractère par case, lu de haut en bas. « . » (ou tout caractère absent de la légende) '
      + 'est du vide. La légende associe un caractère au numéro de tuile de la palette '
      + '(1 = première tuile). Le moteur choisit tout seul la bonne tile selon les voisins, et '
      + 'regroupe les collisions. Les PENTES ne sont pas des tuiles : posez-les en objets.',
    schema: {type: 'object', properties: {
      name: {type: 'string', description: 'nom de l\'objet portant la map de tuiles'},
      plane: {type: 'string', description: 'le plan, lignes séparées par \\n'},
      caption: {type: 'object', description: 'ex. {"#": 1, "=": 2}', additionalProperties: {type: 'number'}},
      tile: {type: 'number', description: 'taille d\'une tuile en unités du monde (0,5 par défaut)'}
    }, required: ['name', 'plane'], additionalProperties: false},
    exec: function(a){
      const o = copFind(a.name);
      const map = o.getComponent && o.getComponent('Tilemap');
      if(!map) throw new Error('« ' + a.name + ' » n\'est pas une map de tuiles. Créez-la avec '
        + 'create_object_2d type « tiles ».');
      const neuve = mapFromText(a.plane, a.caption || {'#': 1}, a.tile || map.cellSize);
      pushHistory();
      // La PALETTE et le calque de la map existante sont conservés : le plan décrit la FORME
      // de la salle, pas de quoi elle est faite. Les écraser obligerait à redéclarer les
      // planches à chaque retouche du décor.
      map.width = neuve.width; map.height = neuve.height;
      map.cells = neuve.cells; map.cellSize = neuve.cellSize;
      rebuildTilemap(o);
      const pleines = map.cells.filter(function(v){ return v !== 0; }).length;
      const bands = collidingBands(map, map.tileDefs()).length;
      const soucis = validateTilemap(map, assets.filter(function(x){ return x.kind === 'sprite'; })
        .map(function(x){ return x.id; }), map.tileDefs());
      updateProject();
      syncInspector();
      return 'salle peinte : ' + map.width + ' × ' + map.height + ', ' + pleines + ' case(s), '
        + bands + ' boîte(s) de collision'
        + (soucis.length ? ' — ATTENTION : ' + soucis.join(' ') : '');
    }
  },
  {
    name: 'read_room',
    description: 'Rend le plan en texte d\'une map de tuiles, au même format que paint_room. '
      + 'À utiliser AVANT de corriger une salle : repeindre à l\'aveugle écrase le décor existant.',
    schema: {type: 'object', properties: {
      name: {type: 'string'},
      caption: {type: 'object', additionalProperties: {type: 'number'}}
    }, required: ['name'], additionalProperties: false},
    exec: function(a){
      const o = copFind(a.name);
      const map = o.getComponent && o.getComponent('Tilemap');
      if(!map) throw new Error('« ' + a.name + ' » n\'est pas une map de tuiles.');
      return textFromMap(map, a.caption || {'#': 1});
    }
  },
  {
    name: 'configure_physics_2d',
    description: 'Règle la physique 2D d\'un objet : body (mobile ou statique), boîte de '
      + 'collision, et contrôleur de personnage. Le contrôleur a DEUX vues : « plateforme » '
      + '(de côté — gravité, saut) et « dessus » (vue de dessus, huit directions, sans gravité). '
      + 'La hauteur de saut se règle en unités, pas en vitesse, et ne sert qu\'en plateforme.',
    schema: {type: 'object', properties: {
      name: {type: 'string'},
      static: {type: 'boolean', description: 'un corps statique sert d\'obstacle : sol, mur, plateforme'},
      // Un ennemi qui plane, une plateforme volante, un projectile qui va tout droit : trois objets
      // mobiles qui ne doivent pas tomber. Le champ existait, aucune commande ne l'écrivait.
      withoutGravity: {type: 'boolean', description: 'le corps ne tombe pas (vol, projectile, plateforme mobile)'},
      maxSpeed: {type: 'number', description: 'plafond de vitesse, en unités par seconde'},
      collider: {type: 'object', properties: {
        l: {type: 'number'}, h: {type: 'number'},
        // Sans décalage, la boîte reste centrée sur le sprite : un personnage vu de dessus bute
        // alors avec sa tête, à une demi-hauteur au-dessus de ses pieds. Mesuré en montant un
        // essai jouable — il fallait écrire `dy` à la main, la commande ne l'offrait pas.
        dx: {type: 'number', description: 'décalage de la boîte par rapport au centre de l\'object'},
        dy: {type: 'number', description: 'décalage vertical : négatif pour poser la boîte aux PIEDS'},
        shape: {type: 'string', enum: ['box', 'slope']},
        stepUp: {type: 'string', enum: ['right', 'left'], description: 'pour une pente : le côté haut'},
        walkThrough: {type: 'boolean', description: 'plateforme à sens unique'}
      }},
      controller: {type: 'object', properties: {
        // La vue de dessus était joignable par l'inspecteur et par personne d'autre : le copilote
        // pouvait créer le personnage, pas le faire marcher en huit directions.
        mode: {type: 'string', enum: ['platform', 'topdown'],
               description: 'plateforme = vue de côté ; dessus = huit directions, sans gravité'},
        speed: {type: 'number'}, jumpHeight: {type: 'number'},
        coyote: {type: 'number'}, jumpBuffer: {type: 'number'},
        // QUELLE ACTION pilote ce personnage. Sans ces cinq champs, tous les personnages d'une
        // scène obéissent aux mêmes keys : deux joueurs sur le même clavier était impossible,
        // et un personnage téléguidé par un script devait subir les entrées du joueur.
        actionLeft: {type: 'string'}, actionRight: {type: 'string'},
        actionUp: {type: 'string'}, actionDown: {type: 'string'},
        actionJump: {type: 'string'}
      }}
    }, required: ['name'], additionalProperties: false},
    exec: function(a){
      const o = copFind(a.name);
      // (plus de refus : les deux mondes ne sont plus séparés, la physique 2D se pose sur
      //  le nœud qu'on lui désigne)
      pushHistory();
      const fait = [];
      if(a.static !== undefined || !o.getComponent('Rigidbody2D')){
        if(!o.getComponent('Rigidbody2D')) o.addComponent('Rigidbody2D', {});
        o.userData.body2d.static = !!a.static;
        fait.push(a.static ? 'statique' : 'mobile');
      }
      if(a.withoutGravity !== undefined || a.maxSpeed !== undefined){
        if(!o.getComponent('Rigidbody2D')) o.addComponent('Rigidbody2D', {});
        if(a.withoutGravity !== undefined){
          o.userData.body2d.withoutGravity = !!a.withoutGravity;
          fait.push(a.withoutGravity ? 'sans gravité' : 'soumis à la gravité');
        }
        if(a.maxSpeed !== undefined){
          o.userData.body2d.maxSpeed = a.maxSpeed;
          fait.push('vitesse max ' + a.maxSpeed);
        }
      }
      if(a.collider){
        if(!o.getComponent('Collider2D')) o.addComponent('Collider2D', {});
        Object.assign(o.userData.collider2d, a.collider);
        fait.push('collider ' + (a.collider.l || o.userData.collider2d.l) + ' × '
          + (a.collider.h || o.userData.collider2d.h));
      }
      if(a.controller){
        if(!o.getComponent('CharacterController2D')) o.addComponent('CharacterController2D', {});
        Object.assign(o.userData.controller2d, a.controller);
        fait.push('contrôleur');
      }
      syncInspector();
      return 'physique 2D de « ' + a.name + ' » : ' + fait.join(', ');
    }
  },
  {
    name: 'configure_sprite_animation',
    description: 'Crée des suites d\'animation SUR LA PLANCHE (elles appartiennent à la planche, '
      + 'pas à l\'objet) et/ou règle l\'animateur d\'un objet. Une suite est une plage d\'images '
      + 'de la planche jouée à une cadence. Sans boucle, la suite rend la main à la suite par '
      + 'défaut quand elle s\'achève.',
    schema: {type: 'object', properties: {
      sheet: {type: 'string', description: 'nom de l\'asset sprite'},
      sequences: {type: 'array', items: {type: 'object', properties: {
        name: {type: 'string'},
        from: {type: 'number', description: 'index de la première image (0 = la première)'},
        count: {type: 'number'},
        fps: {type: 'number', description: 'images par seconde'},
        loop: {type: 'boolean'}
      }, required: ['name', 'from', 'count'], additionalProperties: false}},
      object: {type: 'string', description: 'objet à animer (optionnel)'},
      defaultValue: {type: 'string', description: 'suite par défaut de cet objet'}
    }, required: ['sheet'], additionalProperties: false},
    exec: function(a){
      const sheet = copSpriteByName(a.sheet);
      if(!sheet) throw new Error('planche introuvable : ' + a.sheet
        + '. Planches disponibles : ' + copListSprites());
      pushHistory();
      const regions = sheet.regions || [];
      const faits = [];
      (a.sequences || []).forEach(function(s){
        const choisies = regions.slice(s.from, s.from + s.count).map(function(r){ return r.name; });
        if(!choisies.length){
          throw new Error('la suite « ' + s.name + ' » ne prend aucune image : la planche en a '
            + regions.length + ', on demandait ' + s.count + ' à partir de ' + s.from + '.');
        }
        sheet.sequences = (sheet.sequences || []).filter(function(x){ return x.name !== s.name; })
          .concat([{name: s.name, images: choisies, fps: Math.max(1, s.fps || 12),
                    loop: s.loop !== false, events: []}]);
        faits.push(s.name + ' (' + choisies.length + ' img)');
      });
      let onObject = '';
      if(a.object){
        const o = copFind(a.object);
        if(!o.getComponent('SpriteAnimator')) o.addComponent('SpriteAnimator', {});
        if(a.defaultValue) o.userData.animSprite.defaultValue = a.defaultValue;
        // On rejoue tout de suite : régler une suite par défaut sans rien voir changer dans la
        // view laisserait croire que la commande n'a pas pris.
        playAnimSprite(o, o.userData.animSprite.defaultValue, true);
        onObject = ' · animateur posé sur « ' + a.object + ' »'
          + (a.defaultValue ? ' (défaut : ' + a.defaultValue + ')' : '');
      }
      const soucis = validateSequences(sheet.sequences, regions);
      updateProject();
      syncInspector();
      return 'planche « ' + sheet.name + ' » : ' + (faits.join(', ') || 'aucune suite ajoutée')
        + onObject + (soucis.length ? ' — ATTENTION : ' + soucis.join(' ') : '');
    }
  },
  {
    name: 'slice_sheet',
    description: 'Découpe une planche (asset sprite) en grille : cellule, marge (bord extérieur), '
      + 'espacement (entre deux cases). Lecture de gauche à droite puis de haut en bas. Indispensable '
      + 'avant de créer des suites d\'animation ou d\'utiliser une planche de tuiles (qui doit donner 16 '
      + 'images). `ppu` règle les pixels par unité (défaut : largeur de la case) ; sans `cell`, seul le '
      + 'ppu est changé.',
    schema: {type: 'object', properties: {
      sheet: {type: 'string'},
      cell: {type: 'object', properties: {l: {type: 'number'}, h: {type: 'number'}},
        required: ['l', 'h']},
      margin: {type: 'number'}, spacing: {type: 'number'},
      ppu: {type: 'number', description: 'pixels par unité de la planche (défaut : largeur de la case)'}
    }, required: ['sheet'], additionalProperties: false},
    exec: function(a){
      const sheet = copSpriteByName(a.sheet);
      if(!sheet) throw new Error('planche introuvable : ' + a.sheet
        + '. Planches disponibles : ' + copListSprites());
      if(a.ppu !== undefined && !(Number(a.ppu) > 0)) throw new Error('le ppu doit être positif');
      if(!a.cell){
        if(a.ppu === undefined) throw new Error('donner `cell` (découpe) et/ou `ppu`');
        pushHistory();
        sheet.ppu = Number(a.ppu);
        refreshSpritesOfLAsset(sheet);
        updateProject();
        return 'planche « ' + sheet.name + ' » : ' + sheet.ppu + ' pixels par unité';
      }
      const tex = assets.find(function(x){ return x.id === sheet.textureId; });
      const dims = dimensionsTexture(tex);
      const regions = sliceGrid(dims.l, dims.h, a.cell.l, a.cell.h,
        {margin: a.margin || 0, spacing: a.spacing || 0, prefixe: 'img'});
      if(!regions.length) throw new Error('cette grille ne donne aucune image : la cellule est '
        + 'plus grande que la texture (' + dims.l + ' × ' + dims.h + ' px), '
        + 'ou la marge la déborde.');
      pushHistory();
      // La case de la découpe PRÉCÉDENTE : un ppu qui lui est égal a été posé automatiquement
      // (import_image avec `cell` le pose à la largeur de la case), pas réglé à la main.
      const previousCell = (sheet.regions && sheet.regions[0]) ? Math.round(Number(sheet.regions[0].l) || 0) : 0;
      sheet.regions = regions;
      // Le ppu se décide sur la TUILE (la case, hors marge et espacement), pas sur la planche :
      // huit images de 24 px font 192 px de large, donc un personnage six fois trop petit. Un ppu
      // réglé à la main n'est pas touché, sauf `ppu` explicite. « À la main » = ni le défaut de la
      // planche, ni la case de la découpe précédente : sans ce second cas, une planche importée en
      // cases de 26 px puis redécoupée en tuiles de 24 (marge 1) gardait 26.
      const defaultSheet = ppuByDefault(dims.l, dims.h);
      const auto = Number(sheet.ppu) === defaultSheet || (previousCell > 0 && Number(sheet.ppu) === previousCell)
        || !(Number(sheet.ppu) > 0);
      let note = '';
      if(a.ppu !== undefined){
        sheet.ppu = Number(a.ppu);
        note = ', ' + sheet.ppu + ' pixels par unité';
      } else if(auto && Number(sheet.ppu) !== Math.round(a.cell.l)){
        sheet.ppu = Math.round(a.cell.l);
        note = ', pixels par unité passés à ' + sheet.ppu;
      }
      refreshSpritesOfLAsset(sheet);
      updateProject();
      return 'planche « ' + sheet.name + ' » (id ' + sheet.id + ') découpée : ' + regions.length + ' image(s)' + note
        + (note ? '' : ', ppu ' + sheet.ppu);
    }
  }
];

/** Un asset sprite par son nom. Le copilote raisonne en noms, l'éditeur en identifiants. */
export function copSpriteByName(name){
  return assets.find(function(a){ return a.kind === 'sprite' && a.name === name; }) || null;
}

/**
 * La liste des planches, pour le message d'erreur.
 *
 * Un « planche introuvable » sec relance le modèle sur une devinette ; lui donner les noms
 * disponibles lui permet de se corriger au coup suivant. C'est la différence entre une erreur qui
 * fait tourner en rond et une erreur qui avance.
 */
export function copListSprites(){
  const l = assets.filter(function(a){ return a.kind === 'sprite'; }).map(function(a){ return a.name; });
  return l.length ? l.join(', ') : '(aucune — importez une texture puis « 🖼 Nouveau sprite »)';
}

// ---------------------------------------------------------------------------
// LE REGISTRE DES OUTILS DU COPILOTE.
//
// `COMMANDS` était déjà un tableau ouvert : `copilot-observer.js` et `copilot-workshop.js` y
// poussent leurs outils sans toucher ce fichier, et le commentaire de l'un des deux le dit en
// clair. Ce qui manquait n'est donc pas le point d'extension — c'est le CONTRÔLE : rien ne
// refusait deux outils du même nom, et `copRun` fait un `find`, donc le second serait
// silencieusement inatteignable. Trois fichiers, soixante-huit outils, aucun garde-fou.
// Voir docs/REVUE_2026-09-10.md § 4.3.
//
// `CopilotTools.register` remplace le `COMMANDS.push` brut : même effet, plus le refus du
// doublon et la vérification qu'un outil déclare bien ce qu'il faut pour être appelé.
export const CopilotTools = {
  register(outil){
    if(!outil || !outil.name) throw new Error('CopilotTools.register : outil sans nom');
    if(typeof outil.exec !== 'function'){
      throw new Error('CopilotTools.register : « ' + outil.name + ' » sans exec()');
    }
    const deja = COMMANDS.find(function(x){ return x.name === outil.name; });
    if(deja){
      // On LÈVE au lieu de remplacer : deux outils du même nom sont une erreur de conception,
      // et le choix silencieux du premier venu rendrait le second introuvable sans un mot.
      throw new Error('CopilotTools.register : « ' + outil.name + ' » est déjà enregistré');
    }
    COMMANDS.push(outil);
    return outil;
  },

  get(name){ return COMMANDS.find(function(x){ return x.name === name; }) || null; }
};

if(typeof globalThis !== 'undefined') globalThis.CopilotTools = CopilotTools;

// ---------- Outils d'inspection, chargement par domaine, lot, salle ----------
INSPECTION_TOOLS.forEach(function(t){ CopilotTools.register(t); });

CopilotTools.register({
  name: 'load_tools',
  description: 'Charge les outils d\'un ou plusieurs domaines pour le reste de la conversation '
    + '(ils apparaissent à la requête suivante). Domaines : ' + Object.keys(TOOL_DOMAINS).join(', ') + '.',
  schema: {type: 'object', properties: {
    domains: {type: 'array', items: {type: 'string', enum: Object.keys(TOOL_DOMAINS)}}
  }, required: ['domains'], additionalProperties: false},
  exec: function(a){
    const unknown = [];
    (a.domains || []).forEach(function(d){
      if(!TOOL_DOMAINS[d]){ unknown.push(d); return; }
      if(engineCopilot.loadedDomains.indexOf(d) === -1) engineCopilot.loadedDomains.push(d);
    });
    // Ordre canonique : deux conversations qui chargent les mêmes domaines envoient le même
    // catalogue, donc le même préfixe de cache.
    engineCopilot.loadedDomains.sort();
    const got = (a.domains || []).filter(function(d){ return TOOL_DOMAINS[d]; });
    return 'chargés : ' + got.map(function(d){ return d + ' (' + TOOL_DOMAINS[d].tools.join(', ') + ')'; }).join(' · ')
      + (unknown.length ? ' — inconnus : ' + unknown.join(', ') : '');
  }
});

CopilotTools.register({
  name: 'batch',
  description: 'Exécute plusieurs commandes À LA SUITE en un seul appel : {commands:[{name, input}]}. '
    + 'Rend un résultat court par commande. Continue après une erreur (sauf stopOnError). '
    + 'Accepte tout outil, même d\'un domaine non chargé.',
  schema: {type: 'object', properties: {
    commands: {type: 'array', items: {type: 'object', properties: {
      name: {type: 'string'}, input: {type: 'object'}
    }, required: ['name']}},
    stopOnError: {type: 'boolean'}
  }, required: ['commands'], additionalProperties: false},
  exec: async function(a){
    const lines = [];
    const list = a.commands || [];
    for(let i = 0; i < list.length; i++){
      const c = list[i];
      if(c.name === 'batch'){ lines.push((i + 1) + '. batch : ✗ imbrication refusée'); continue; }
      try{
        const res = await copRun(c.name, c.input || {}, {origin: 'batch', quiet: i >= TRACE_BATCH_MAX});
        const text = (res && typeof res === 'object' && res.text !== undefined) ? res.text : res;
        lines.push((i + 1) + '. ' + c.name + ' : ✓ ' + String(text).slice(0, 160));
      } catch(e){
        lines.push((i + 1) + '. ' + c.name + ' : ✗ ' + e.message);
        if(a.stopOnError) break;
      }
    }
    if(list.length > TRACE_BATCH_MAX && traceEnabled(globalThis.localStorage)){
      logConsole('log', '[IA] … ' + (list.length - TRACE_BATCH_MAX) + ' sous-commande(s) du batch non tracées une à une', null);
    }
    return capOutput(lines.join('\n'));
  }
});

CopilotTools.register({
  name: 'build_room',
  description: 'Construit une PIÈCE : sol, quatre murs (percés de portes) et plafond en option, '
    + 'regroupés sous un parent. center = centre du sol (face supérieure à center[1]), '
    + 'size = [largeur X, hauteur Y, profondeur Z] hors-tout en mètres (tailles RÉELLES, pas des '
    + 'échelles). Porte : {wall: north(−Z)|south(+Z)|west(−X)|east(+X), width, height, offset}.',
  schema: {type: 'object', properties: {
    name: {type: 'string', description: 'nom du parent (défaut « Salle »)'},
    center: {type: 'array', items: {type: 'number'}},
    size: {type: 'array', items: {type: 'number'}},
    wallThickness: {type: 'number'},
    ceiling: {type: 'boolean'},
    doors: {type: 'array', items: {type: 'object', properties: {
      wall: {type: 'string', enum: ['north', 'south', 'east', 'west']},
      width: {type: 'number'}, height: {type: 'number'}, offset: {type: 'number'}
    }, required: ['wall']}},
    material: {type: 'object', properties: {color: {type: 'string'}}}
  }, required: ['size'], additionalProperties: false},
  exec: function(a){
    const boxes = roomLayout(a);
    const base = a.name || 'Salle';
    let name = base, n = 2;
    while(objects.some(function(o){ return o.name === name; })) name = base + ' ' + (n++);
    const group = createObject('group');
    if(!group) throw new Error('création impossible (mode Lecture ?)');
    group.name = name;
    const CUBE = 1.6;   // arête du cube primitif : l'échelle se déduit de la taille voulue
    boxes.forEach(function(b){
      const o = createObject('cube');
      o.name = name + '_' + b.name;
      o.position.set(b.center[0], b.center[1], b.center[2]);
      o.scale.set(b.size[0] / CUBE, b.size[1] / CUBE, b.size[2] / CUBE);
      if(a.material && a.material.color && o.material && o.material.color) o.material.color.set(a.material.color);
      group.attach(o);
    });
    updateHierarchy();
    syncInspector();
    return 'pièce « ' + name + ' » : ' + boxes.map(function(b){
      return b.name + ' ' + b.size.join('×');
    }).join(', ');
  }
});

// ---------- Le catalogue, pour un consommateur externe (pont MCP) ----------
/**
 * Le catalogue COMPLET (tous domaines) : `[{name, description, input_schema, execute}]`.
 * `execute(input)` rend une promesse du résultat brut (chaîne, ou `{text, image}`).
 * Accès : `import { getCopilotCatalog, runCopilotCommand } from './copilot.js'`, ou
 * `globalThis.getCopilotCatalog` / `globalThis.runCopilotCommand` depuis la page.
 */
export function getCopilotCatalog(){
  return COMMANDS.map(function(c){
    return {name: c.name, description: c.description, input_schema: c.schema,
      execute: function(input){ return copRun(c.name, input, {origin: 'MCP'}); }};
  });
}
export function runCopilotCommand(name, input){ return copRun(name, input, {origin: 'MCP'}); }
if(typeof globalThis !== 'undefined'){
  globalThis.getCopilotCatalog = getCopilotCatalog;
  globalThis.runCopilotCommand = runCopilotCommand;
}

export function copToolsApi(){
  return COMMANDS.map(function(c){
    return {name: c.name, description: c.description, input_schema: c.schema};
  });
}

// ---------- Règles appliquées : le delta d'un outil qui écrit (js/ai-rules.js) ----------
function snapshotForRules(){
  return {objects: new Set(objects), assets: new Set(assets)};
}
function diffForRules(before){
  const inScene = new Set(objects);
  const depthOf = function(o){
    let d = 0, p = o.parent;
    while(p && inScene.has(p)){ d++; p = p.parent; }
    return d;
  };
  return {
    newObjects: objects.filter(function(o){ return !before.objects.has(o); }).map(function(o){
      return {name: o.name, depth: depthOf(o), isGroup: !!o.userData && [TYPE_NODE_DEFAULT].indexOf(o.userData.type) !== -1, generic: isGenericName(o.name)};
    }),
    newAssets: assets.filter(function(a){ return !before.assets.has(a); }).map(function(a){
      return {kind: a.kind, name: a.name, folder: a.folder || ''};
    })
  };
}
/** Ajoute du texte au résultat d'un outil (chaîne, ou `{text, image}`). */
function appendText(res, more){
  if(!more) return res;
  if(res && typeof res === 'object' && res.text !== undefined) return Object.assign({}, res, {text: String(res.text) + more});
  return String(res) + more;
}
/** Ajoute les infractions au texte du résultat (qui peut être une chaîne ou `{text, image}`). */
function appendViolations(res, list){
  if(!list.length) return res;
  list.forEach(function(v){ recordViolation(v.id); });
  return appendText(res, formatViolations(list));
}

/**
 * Exécute une commande. TOUJOURS asynchrone, et le résultat peut porter une IMAGE.
 *
 * Le contrat d'origine était `String(exec(args))` : synchrone, et du texte. Il suffisait à des
 * commandes qui créent et transforment, et il interdisait exactement les trois choses qui manquaient
 * au copilote — voir une capture (une image), lancer le jeu (asynchrone), attendre son résultat.
 *
 * L'élargissement est RÉTROCOMPATIBLE : une commande peut rendre une chaîne comme avant, une promesse,
 * ou `{texte, image}` où `image` est un PNG en data URL. Les 31 commandes existantes n'ont pas bougé
 * d'une ligne.
 */
export async function copRun(name, args, opts){
  const o = opts || {};
  const origin = o.origin || 'copilote';
  // Une ligne `[IA]` par appel (js/ai-trace.js) : c'est le passage obligé du copilote, du pont MCP
  // local et du relais hébergé, donc le seul endroit où tout appel laisse une trace.
  const trace = !o.quiet && traceEnabled(globalThis.localStorage);
  const t0 = Date.now();
  const c = COMMANDS.find(function(x){ return x.name === name; });
  let res;
  try{
    if(!c) throw new Error('outil inconnu : ' + name);
    const watch = o.origin !== 'batch' && READ_ONLY_TOOLS.indexOf(name) === -1;
    const before = watch ? snapshotForRules() : null;
    res = await c.exec(args || {});
    if(name === 'save_project') noteSave();
    // Les points graves de l'audit suivent chaque enregistrement et chaque mesure de jeu.
    if((name === 'save_project' || name === 'play_and_measure') && typeof CopilotTools.auditGrave === 'function'){
      try{ res = appendText(res, CopilotTools.auditGrave()); } catch(e){ /* un audit en échec ne doit pas faire échouer l'outil */ }
    }
    if(watch) res = appendViolations(res, checkAfterWrite(Object.assign(diffForRules(before), {writes: noteWrite()})));
  } catch(e){
    if(trace) logConsole('error', formatTraceLine({name: name, args: args, ms: Date.now() - t0, origin: origin,
      status: 'error', message: e && e.message}), null);
    throw e;
  }
  const text = (res && typeof res === 'object' && res.text !== undefined) ? res.text : res;
  if(trace){
    // Un outil de lecture (audit_project, read_console) cite des ⚠ sans en avoir commis un.
    const warned = READ_ONLY_TOOLS.indexOf(name) === -1 && resultHasWarning(text);
    logConsole(warned ? 'warn' : 'log', formatTraceLine({name: name, args: args, ms: Date.now() - t0, origin: origin,
      status: warned ? 'warn' : 'ok'}), null);
  }
  return res;
}

/**
 * Le résultat d'une commande, mis dans la forme des blocs de contenu de l'API.
 *
 * Une image devient un bloc `image` À CÔTÉ du texte, et non une chaîne base64 DANS le texte : dans le
 * texte, le modèle ne la voit pas — il lit quarante mille caractères de bruit et y perd son contexte.
 */
export function copContentResult(res, provider){
  if(res && typeof res === 'object' && res.image){
    const virgule = String(res.image).indexOf(',');
    const data = virgule === -1 ? String(res.image) : String(res.image).slice(virgule + 1);
    // La forme d'un contenu à image est propre au fournisseur : un bloc chez l'un, et chez l'autre
    // rien du tout — un message d'outil OpenAI ne porte pas d'image, et il le DIT plutôt que de
    // laisser croire au modèle qu'il a regardé quelque chose.
    const f = provider || ((typeof copProvider === 'function') ? copProvider() : null);
    if(f && typeof f.contentWithImage === 'function') return f.contentWithImage(res.text, data);
    const blocks = [];
    if(res.text) blocks.push({type: 'text', text: String(res.text)});
    blocks.push({type: 'image', source: {type: 'base64', media_type: 'image/png', data: data}});
    return blocks;
  }
  const text = (res && typeof res === 'object' && res.text !== undefined) ? res.text : res;
  return String(text);
}

// ---------- interface ----------
export let copEl = null;

/**
 * Ouvre le copilote : c'est un panneau du dock (id `copilot`, déclaré dans `ui/panels-shell.js`),
 * donc l'ouvrir veut dire le rouvrir s'il est fermé et le passer devant s'il est derrière un
 * autre onglet — exactement le geste de `openPanelDock` (ui.js), recopié ici pour ne pas faire
 * dépendre le copilote de ui.js.
 */
export function openCopilot(){
  ensureCopilotUI();
  if(typeof Dock !== 'undefined' && Dock && typeof Dock.open === 'function'){
    if(!Dock.open('copilot')) Dock.reopen('copilot');
    const zone = Dock.zoneOf('copilot');
    if(zone) Dock.activate(zone, 'copilot');
  }
  if(!localStorage.getItem('copilot-key')) copToggleConfig(true);
  document.getElementById('cop-text').focus();
}

/** Construit l'interface du copilote une seule fois ; le dock l'adopte ensuite (`adopt: 'copilot'`). */
export function ensureCopilotUI(){
  if(!copEl) copBuildUI();
  return copEl;
}

export function copBuildUI(){
  // Les deux éléments sont écrits dans editor.html (comme #console-body et #tools-console) : le
  // dock doit pouvoir les adopter dès son montage. Créés ici seulement hors de l'éditeur.
  copEl = document.getElementById('copilot');
  const created = !copEl;
  if(created){ copEl = document.createElement('div'); copEl.id = 'copilot'; copEl.style.display = 'none'; }
  // La barre d'outils (⚙, 🗑) est un élément À PART : le dock la range dans la barre d'onglets de
  // la zone, comme celle de la Console (`toolbar: 'cop-toolbar'`). Le titre et la croix de
  // fermeture sont ceux du dock — le copilote n'a plus son propre chrome de fenêtre.
  let toolbar = document.getElementById('cop-toolbar');
  if(!toolbar){ toolbar = document.createElement('span'); toolbar.id = 'cop-toolbar'; toolbar.style.display = 'none'; }
  toolbar.innerHTML = '<button id="cop-config-btn" title="Clé API et modèle">⚙</button>'
    + '<button id="cop-clear" title="Nouvelle conversation">🗑</button>';
  copEl.innerHTML =
    '<div id="cop-config" style="display:none">'
    + '<div class="field"><label>Clé API</label><input type="password" id="cop-key" '
    + 'placeholder="sk-ant-…" spellcheck="false"></div>'
    // Le FOURNISSEUR d'abord, le modèle ensuite : changer de fournisseur change la liste des modèles,
    // et proposer un modèle Claude à OpenAI donne un 404 dont le message ne dit rien d'utile.
    + '<div class="field"><label>Fournisseur</label><select id="cop-provider">'
    + Object.keys(PROVIDERS).map(function(id){
        return '<option value="' + id + '">' + escapeHtml(PROVIDERS[id].name) + '</option>'; }).join('')
    + '</select></div>'
    + '<div class="field"><label>Modèle</label><select id="cop-model"></select></div>'
    // Une adresse personnalisée : c'est ce qui rend l'abstraction utile au-delà des deux noms codés —
    // un serveur local, un fournisseur compatible. Vide = l'adresse officielle du fournisseur.
    + '<div class="field"><label>Adresse (option)</label><input type="text" id="cop-url" '
    + 'placeholder="laisser vide pour l\'adresse officielle" spellcheck="false"></div>'
    + '<div class="field"><label><input type="checkbox" id="cop-trace"> Tracer les appels d\'outils dans la Console</label></div>'
    + '<div class="cop-note" id="cop-help-key">La clé reste dans ce navigateur (localStorage) — elle '
    + 'n\'est jamais enregistrée dans les projets.</div>'
    + '<button class="btn-modal accent" id="cop-config-ok">Enregistrer</button></div>'
    + '<div id="cop-messages" role="log" aria-live="polite"><div class="cop-msg ai">Bonjour ! Décrivez ce que vous voulez '
    + 'construire (« ajoute une salle avec 4 colonnes et une lumière chaude », « fais patrouiller '
    + 'l\'ennemi », « crée un feu de camp »…) et je le fais dans la scène. Tout est annulable '
    + 'par Ctrl+Z.</div></div>'
    + '<div id="cop-input"><textarea id="cop-text" rows="2" '
    + 'placeholder="Que faut-il construire ?" spellcheck="false"></textarea>'
    + '<button id="cop-send" title="Envoyer (Entrée)">➤</button>'
    + '<button id="cop-stop" style="display:none" title="Arrêter">⏹</button></div>';
  if(created) document.body.appendChild(copEl);
  if(!toolbar.parentNode) document.body.appendChild(toolbar);
  mountMcpSettings(document.getElementById('cop-config'), {instructions: function(){ return COPILOT_SYSTEM; }});

  const traceBox = document.getElementById('cop-trace');
  traceBox.checked = traceEnabled(localStorage);
  traceBox.addEventListener('change', function(){
    localStorage.setItem(TRACE_STORAGE_KEY, traceBox.checked ? '1' : '0');
  });
  document.getElementById('cop-config-btn').addEventListener('click', function(){
    copToggleConfig();
  });
  document.getElementById('cop-clear').addEventListener('click', function(){
    // Effacer une conversation ne se rattrape pas : on le demande (revue du 2026-09-29, § 4.10).
    if(engineCopilot.conv.length && !confirm('Effacer la conversation en cours ? Elle ne pourra pas être récupérée.')) return;
    engineCopilot.conv = [];
    engineCopilot.loadedDomains = [];
    engineCopilot.session = {cost: 0, unknown: false, input: 0, cacheRead: 0, cacheWrite: 0, output: 0};
    document.getElementById('cop-messages').innerHTML =
      '<div class="cop-msg ai">Nouvelle conversation.</div>';
  });
  /** Remplit la liste des modèles du fournisseur choisi, et son aide de clé. */
  const updateModels = function(){
    const id = document.getElementById('cop-provider').value;
    const f = PROVIDERS[id];
    const sel = document.getElementById('cop-model');
    const garde = localStorage.getItem('copilot-modele') || '';
    sel.innerHTML = f.models.map(function(m){
      return '<option value="' + m + '"' + (m === garde ? ' selected' : '') + '>' + m + '</option>';
    }).join('');
    document.getElementById('cop-help-key').textContent =
      'La clé reste dans ce navigateur (localStorage) — elle n\'est jamais enregistrée dans les '
      + 'projets. ' + f.helpKey;
  };
  document.getElementById('cop-provider').addEventListener('change', updateModels);
  copEl.__updateModels = updateModels;

  document.getElementById('cop-config-ok').addEventListener('click', function(){
    const key = document.getElementById('cop-key').value.trim();
    // Un champ VIDÉ efface la clé : vider puis Enregistrer la conservait, et rien ne permettait de
    // la retirer de ce navigateur (§ 4.10).
    if(key) localStorage.setItem('copilot-key', key);
    else localStorage.removeItem('copilot-key');
    const id = document.getElementById('cop-provider').value;
    const model = document.getElementById('cop-model').value;
    localStorage.setItem('copilot-fournisseur', id);
    localStorage.setItem('copilot-modele', model);
    // Une adresse vide EFFACE le réglage plutôt que d'enregistrer une chaîne vide : `getItem` rendrait
    // '', qui est faux, donc le repli sur l'adresse officielle marcherait par accident — et cesserait
    // le jour où quelqu'un écrirait `?? f.url` au lieu de `|| f.url`.
    const url = document.getElementById('cop-url').value.trim();
    if(url) localStorage.setItem('copilot-url', url);
    else localStorage.removeItem('copilot-url');
    const soucis = validateProvider(id, model, key || localStorage.getItem('copilot-key') || '');
    copToggleConfig(false);
    setStatus('Copilote : ' + PROVIDERS[id].name + ' / ' + model
      + (soucis.length ? ' — ⚠ ' + soucis.join(' ') : ''), soucis.length ? 7000 : 2500);
  });
  document.getElementById('cop-send').addEventListener('click', copSend);
  document.getElementById('cop-stop').addEventListener('click', function(){
    if(engineCopilot.controller) engineCopilot.controller.abort();
  });
  document.getElementById('cop-text').addEventListener('keydown', function(e){
    if(e.key === 'Enter' && !e.shiftKey){
      e.preventDefault();
      copSend();
    }
    e.stopPropagation();   // pas de raccourcis éditeur pendant la saisie
  });
}

export function copToggleConfig(forcer){
  const z = document.getElementById('cop-config');
  const visible = (forcer !== undefined) ? forcer : z.style.display === 'none';
  z.style.display = visible ? 'block' : 'none';
  if(visible){
    document.getElementById('cop-key').value = localStorage.getItem('copilot-key') || '';
    document.getElementById('cop-url').value = localStorage.getItem('copilot-url') || '';
    document.getElementById('cop-provider').value =
      localStorage.getItem('copilot-fournisseur') || 'anthropic';
    // La liste des modèles est refaite APRÈS avoir posé le fournisseur : la remplir avant afficherait
    // les modèles de l'autre, et register aurait envoyé un modèle Claude à OpenAI.
    if(copEl && copEl.__updateModels) copEl.__updateModels();
  }
}

export function copMsg(classe, text){
  const zone = document.getElementById('cop-messages');
  const div = document.createElement('div');
  div.className = 'cop-msg ' + classe;
  if(classe === 'image'){
    // L'auteur doit voir CE QUE LE MODÈLE VOIT. Sans ça, une capture ratée — un rendu empty, un
    // cadrage à côté — se lit dans le raisonnement du modèle sans qu'on puisse la vérifier.
    // `src` posé par la propriété et non par du HTML : la donnée est longue et vient d'un canvas.
    const img = document.createElement('img');
    img.src = text;
    img.style.cssText = 'max-width:100%;border:1px solid var(--edge);border-radius:4px;display:block';
    div.appendChild(img);
  } else {
    div.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');
  }
  zone.appendChild(div);
  zone.scrollTop = zone.scrollHeight;
  return div;
}

export function copBusy(active){
  engineCopilot.inProgress = active;
  document.getElementById('cop-send').style.display = active ? 'none' : '';
  document.getElementById('cop-stop').style.display = active ? '' : 'none';
}

// ---------- loop d'agent ----------

/** Le fournisseur choisi, et son adresse — qu'un service compatible peut remplacer. */
export function copProvider(){
  const id = localStorage.getItem('copilot-fournisseur') || 'anthropic';
  return providerBy(id);
}
export function copUrl(f){
  // Une adresse personnalisée permet tout service « compatible OpenAI » : un serveur local, un
  // fournisseur tiers. Sans ce champ, l'abstraction ne servirait qu'aux deux noms qu'on a codés.
  return localStorage.getItem('copilot-url') || f.url;
}

/**
 * Un tour de requête, quel que soit le fournisseur.
 *
 * Tout ce qui diffère — adresse, en-têtes, forme du body — vient de js/copilot-providers.js. Ce
 * qui reste ici est ce qui ne dépend d'aucun fournisseur : le catalogue d'outils (les commandes de
 * l'éditeur), la conversation, et le traitement des erreurs HTTP.
 */
export async function copRequest(){
  const key = localStorage.getItem('copilot-key') || '';
  const f = copProvider();
  const model = localStorage.getItem('copilot-modele') || f.models[0];
  const soucis = validateProvider(localStorage.getItem('copilot-fournisseur') || 'anthropic', model, key);
  // Un modèle envoyé au bad fournisseur donne un 404 ou un 400 dont le message ne dit rien
  // d'utile. Le dire AVANT la requête coûte une ligne et fait gagner un quart d'heure.
  if(soucis.some(function(s){ return s.indexOf('clé') !== -1; })) throw new Error(soucis.join(' '));
  if(soucis.length) copMsg('error', '⚠ ' + soucis.join(' '));

  // Compactage PAR PAQUETS : rien ne change tant que la conversation reste sous le seuil, puis
  // tout ce qui est ancien est résumé d'un coup — le préfixe en cache n'est invalidé qu'alors.
  const compact = compactHistory(engineCopilot.conv, {thresholdTokens: 40000, keepMessages: 6});
  if(compact.compacted) engineCopilot.conv = compact.messages;
  engineCopilot.lastModel = model;

  const rep = await fetch(copUrl(f), {
    method: 'POST',
    signal: engineCopilot.controller.signal,
    headers: f.headers(key),
    body: JSON.stringify(f.body({
      model: model,
      // 8192 et non 4096 : un tour de conception enchaîne facilement une dizaine d'appels d'outils
      // avec leurs arguments, et la réponse était coupée en plein milieu d'un appel — que l'API
      // rejette ensuite en 400 (« tool_use sans tool_result »). Le coût ne monte qu'avec ce qui est
      // réellement produit, donc relever le plafond ne coûte rien aux tours courts.
      maxTokens: 8192,
      system: COPILOT_SYSTEM,
      // Noyau + domaines chargés seulement : c'est le catalogue qui pèse le plus dans chaque requête.
      commands: selectTools(COMMANDS, engineCopilot.loadedDomains),
      messages: engineCopilot.conv
    }))
  });
  if(!rep.ok){
    let detail = '';
    try{
      const j = await rep.json();
      detail = (j.error && (j.error.message || j.error.type)) || '';
    } catch(e){}
    if(rep.status === 401) throw new Error('clé API refusée (401) — vérifiez-la dans ⚙');
    throw new Error(f.name + ' : error ' + rep.status + (detail ? ' — ' + detail : ''));
  }
  return rep.json();
}

/** Coût d'un tour et total de la session, affichés sous la réponse. */
export function copShowCost(usage, model){
  if(!usage) return;
  const c = costOfUsage(usage, model);
  const s = engineCopilot.session;
  s.input += c.tokens.input; s.cacheRead += c.tokens.cacheRead;
  s.cacheWrite += c.tokens.cacheWrite; s.output += c.tokens.output;
  if(c.cost === null) s.unknown = true; else s.cost += c.cost;
  copMsg('cost', 'Coût : ' + formatCost(c.cost) + ' (entrée ' + c.tokens.input + ', cache lu '
    + c.tokens.cacheRead + ', cache écrit ' + c.tokens.cacheWrite + ', sortie ' + c.tokens.output
    + ' jetons) · session : ' + formatCost(s.cost) + (s.unknown ? ' + tours au prix inconnu' : ''));
}

export async function copSend(){
  if(engineCopilot.inProgress) return;
  const ta = document.getElementById('cop-text');
  const text = ta.value.trim();
  if(!text) return;
  if(!(localStorage.getItem('copilot-key') || '').trim()){
    copToggleConfig(true);
    const f = PROVIDERS[localStorage.getItem('copilot-fournisseur')] || null;
    copMsg('error', 'Entrez d\'abord votre clé API' + (f ? ' ' + f.name : '') + ' dans ⚙.');
    return;
  }
  ta.value = '';
  copMsg('me', text);
  // répare un historique interrompu : un tool_use resté sans tool_result ferait un 400
  const last = engineCopilot.conv[engineCopilot.conv.length - 1];
  if(last && last.role === 'assistant' && Array.isArray(last.content)){
    const inPending = last.content.filter(function(b){ return b.type === 'tool_use'; });
    if(inPending.length){
      engineCopilot.conv.push({role: 'user', content: inPending.map(function(b){
        return {type: 'tool_result', tool_use_id: b.id,
                content: 'interrompu par l\'utilisateur', is_error: true};
      })});
    }
  }
  engineCopilot.conv.push({role: 'user', content: text});
  engineCopilot.controller = new AbortController();
  copBusy(true);
  const pending = copMsg('ai pending', '…');

  try{
    for(let tour = 0; tour < 20; tour++){
      const f = copProvider();
      const rep = await copRequest();
      // LA RÉPONSE EST LUE PAR LE FOURNISSEUR, et le message d'assistant réinjecté dans SA forme :
      // OpenAI exige que `tool_calls` revienne avec le message, sans quoi il ne sait pas à quoi
      // répondent les messages `tool` qui suivent — et il refuse toute la conversation.
      const l = f.read(rep);
      engineCopilot.conv.push(f.messageAssistant(rep));
      if(l.text && l.text.trim()) copMsg('ai', l.text);
      copShowCost(rep && rep.usage, engineCopilot.lastModel);
      if(l.refusal){
        copMsg('error', 'Le modèle a refusé cette demande.');
        break;
      }
      if(!l.appels.length) break;
      const resultats = [];
      // `for…of` et non `forEach` : les commandes sont asynchrones, et un `await` dans un callback de
      // `forEach` ne serait pas attendu — les résultats partiraient vides, et le modèle enchaînerait
      // sur un état qu'il ne connaît pas. Séquentiel et non parallèle, aussi : deux commandes qui
      // modifient la scène en même temps se marcheraient dessus.
      for(const appel of l.appels){
        copMsg('action', '⚙ ' + appel.name + ' ' + JSON.stringify(appel.args).slice(0, 130));
        let content, error = false;
        try{ content = copContentResult(await copRun(appel.name, appel.args), f); }
        catch(e){ content = 'Erreur : ' + e.message; error = true; }
        resultats.push({id: appel.id, name: appel.name, content: content, error: error});
        // Une image dans le fil : l'auteur doit voir ce que le modèle voit, sinon il ne peut pas juger
        // si le modèle a bien lu sa propre capture.
        if(Array.isArray(content)){
          const img = content.find(function(b){ return b.type === 'image'; });
          if(img) copMsg('image', 'data:image/png;base64,' + img.source.data);
        }
      }
      // UN message chez Anthropic, UN PAR APPEL chez OpenAI : c'est le fournisseur qui décide, et
      // c'est la différence qui se recopie le plus mal des deux formats. Grouper là où il faut séparer
      // donne une conversation refusée, avec un message d'erreur qui parle de `tool_call_id` sans dire
      // lequel manque.
      f.messagesResultats(resultats).forEach(function(m){ engineCopilot.conv.push(m); });
      if(tour === 19) copMsg('error', 'Limite de 20 tours atteinte — reformulez pour continuer.');
    }
  } catch(e){
    if(e.name === 'AbortError') copMsg('error', 'Arrêté.');
    else copMsg('error', e.message);
  } finally {
    pending.remove();
    copBusy(false);
    engineCopilot.controller = null;
  }
}

// Le bouton « IA » de la barre du haut a rejoint le menu Fenêtres (panneau « Copilote IA »).
const btnCopilot = document.getElementById('btn-copilot');
if(btnCopilot) btnCopilot.addEventListener('click', openCopilot);
