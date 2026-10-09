// ---------- Système de plugins — API v2 ----------
// API publique `Editor` : un plugin est un fichier .js qui reçoit cet objet et enregistre ses
// extensions. Les plugins actifs sont conservés dans le localStorage du navigateur (pas dans le
// projet) et rejoués au démarrage.
//
//   Editor.registerTypeObject({type, name, icon, make, serialize, restore, inspector:{sections}})
//   Editor.registerInspectorSection({forType, id, title, sections})
//   Editor.registerPanel({id, title, icon, sections, targets})
//   Editor.registerFieldType({type, create, write, read})
//   Editor.definePref({key, label, type, default, category})
//   Editor.defineProjectSetting({key, label, type, default, section})
//   Editor.registerImporter({name, extensions, importer})
//   Editor.registerCommandMenu({menu, caption, shortcut, active, action})
//   Editor.registerValidator({name, check})
//   Editor.registerMaterial({name, category, properties, make})
//   Editor.registerComponent(classe)   // sous-classe de Component
//
// CE QUI A CHANGÉ EN v2, et pourquoi. Une section d'inspecteur n'est plus
// `{html, sync, input, click}` mais un DESCRIPTEUR déclaratif rendu par le socle
// (js/ui/form.js) : les cinq fabriques `Editor.api.fields` construisaient des chaînes HTML et
// obligeaient chaque plugin à router ses propres événements par identifiant DOM — c'est
// exactement ce que la refonte a retiré de l'éditeur, et le laisser aux plugins aurait gardé
// vivante l'interface qu'on venait de supprimer. `Editor.api.fields` a donc DISPARU, et
// `registerInspector` avec lui (voir ChangeLogs, section « Cassant »).
//
// LE PRÉFIXE NE PROTÈGE QUE L'INTERFACE. Un id de panneau, de section d'inspecteur, de type de
// champ ou de clé de préférence est préfixé par un identifiant unique attribué à
// l'INSTALLATION — et non par le nom du fichier, parce que deux plugins peuvent porter le même
// nom. En revanche `def.type` et `classe.typeName` ne sont PAS préfixés : ils finissent dans
// `userData.type` et dans le projet SÉRIALISÉ, et les préfixer casserait tout projet enregistré.
//
// Un plugin s'exécute avec tous les droits de la page : n'installez que du code dont vous
// connaissez la provenance (avertissement affiché à l'installation).
import { assets, importFiles, updateProject } from './assets.js';
import { Registry } from './component-registry.js';
import { Component } from './component.js';
// Cycle assumé (copilot.js importe plugins.js) : ces deux fonctions ne sont appelées qu'à l'exécution.
import { copRun, copToolsApi } from './copilot.js';
import { logConsole } from './console.js';
import { env } from './environment.js';
import { setStatus, updateHierarchy } from './hierarchy.js';
import { pushHistory, restore } from './history.js';
import { buildInspector } from './inspector.js';
import { PROPS_MATERIAL, checkTableMaterial, defaultsFromTable, describeMaterialForAI } from './material-props.js';
import { createAssetMaterial, ensurePropsMaterial, previewMaterial, textureMaterial } from './materials.js';
import { addTypeCreatable, createObject, escapeHtml, objects, register } from './objects.js';
import { project } from './project.js';
import { scene } from './scene.js';
import { select, selectAsset, selection } from './selection.js';
import { addMenuDom, closeModal, defMenus, openModal, openPanelDock } from './ui.js';
import { createForm } from './ui/form.js';
import { Panels } from './ui/panel.js';
import { Prefs } from './ui/prefs.js';
import { UIRegistry } from './ui/registry.js';
import { CATALOG_URL, CHANNEL_CATALOG, MESSAGE_DONE, MESSAGE_INSTALL, catalogCategories, filterCatalog, installRequestFile, isPluginFileName, newCatalogKey, pluginNameForFile } from './plugin-catalog.js';
import { System } from './systems.js';
import { checkSystem } from './plugin-host.js';

export const Editor = {
  version: '2.0',
  typesObjects: [],
  inspectorSections: [],
  importers: [],
  validators: [],
  panels: [],           // {id, descriptor, plugin}
  fieldTypes: [],       // {type, plugin}
  prefs: [],            // {key, plugin}
  projectSettings: [],  // {key, def, plugin}
  materials: [],        // {name, category, properties, defaults, make, plugin}
  components: [],       // {typeName, classe, plugin}
  systems: [],          // {name, plugin}
  plugins: [],          // {name, code, active}
  inProgress: null,        // nom du plugin en cours d'exécution (pour les messages)

  // Déclare un nouveau TYPE DE COMPOSANT. Il rejoint le Registry exactement comme
  // les composants natifs : il apparaît dans « + Component », il est reconstruit
  // à la duplication et au rechargement, et les Systèmes le trouvent par
  // Registry.activeNodes(typeName).
  //
  // C'était le trou de l'API : un plugin pouvait add un type d'OBJET, un
  // inspecteur, un importateur, un matériau — mais pas un composant, alors que
  // c'est l'unité d'extension du moteur. Registry.registerClass existait et
  // n'était appelée que par les onze fichiers natifs.
  registerComponent: function(classe){
    if(typeof classe !== 'function' || !(classe.prototype instanceof Component)){
      throw new Error('registerComponent : attend une sous-classe de Editor.api.Component');
    }
    const typeName = classe.typeName;
    if(!typeName || typeName === 'Component'){
      throw new Error('registerComponent : la classe doit définir `static get typeName()`');
    }
    // Un plugin ne remplace pas un composant natif : il en ajoute. Écraser Mesh
    // ou Physics casserait la scène de l'utilisateur sans le moindre message,
    // et les projets déjà enregistrés qui s'y réfèrent.
    if(COMPONENTS_NATIVE.indexOf(typeName) !== -1){
      throw new Error('le composant « ' + typeName + ' » est un composant natif de l\'éditeur');
    }
    Registry.registerClass(classe);
    Editor.components = Editor.components.filter(function(c){ return c.typeName !== typeName; });
    Editor.components.push({typeName: typeName, classe: classe, plugin: Editor.inProgress});
    return typeName;
  },

  /**
   * Un SYSTÈME : le travail par image, exactement comme les systèmes natifs (js/systems.js).
   * `onFrame(instances, dt, ctx)` reçoit les composants actifs des types listés dans `requires`,
   * et `ctx.mode` vaut 'edit' ou 'play' — un système de jeu teste `ctx.mode === 'play'`.
   * Un plugin rangé dans le projet voit ses systèmes rejoués dans le jeu publié.
   */
  registerSystem: function(def){
    checkSystem(def);
    // Réenregistrer (mise à jour du plugin) remplace, n'empile pas un second passage par image.
    removeSystems(function(s){ return s.name === def.name && s.plugin === Editor.inProgress; });
    System.register(Object.assign({}, def, {plugin: Editor.inProgress}));
    Editor.systems = Editor.systems.filter(function(s){ return s.name !== def.name; });
    Editor.systems.push({name: def.name, plugin: Editor.inProgress});
    return def.name;
  },

  registerTypeObject: function(def){
    if(!def || !def.type || typeof def.make !== 'function'){
      throw new Error('registerTypeObject : { type, make } sont obligatoires');
    }
    if(TYPES_NATIVE.indexOf(def.type) !== -1){
      throw new Error('le type « ' + def.type + ' » est un type natif de l\'éditeur');
    }
    Editor.typesObjects = Editor.typesObjects.filter(function(t){ return t.type !== def.type; });
    Editor.typesObjects.push({
      type: def.type,
      name: def.name || def.type,
      icon: def.icon || '🧱 ',
      make: def.make,
      serialize: def.serialize || null,
      restore: def.restore || null,
      inspector: def.inspector || null,
      plugin: Editor.inProgress
    });
    laterUiPlugin(function(){ addTypeCreatable(def); });
    return def.type;
  },

  /**
   * Une section d'inspecteur, DÉCLARATIVE.
   *
   * `sections` est un tableau de sections du socle (`{id, title, fields}`) dont la cible est
   * l'objet sélectionné : chaque champ porte son `get`/`set`, et c'est le socle qui construit,
   * synchronise et route. L'ancien contrat `{html, sync, input, click}` demandait à l'auteur du
   * plugin de faire ces quatre choses à la main, avec des identifiants DOM qu'il devait
   * lui-même rendre uniques.
   */
  registerInspectorSection: function(def){
    if(!def || !Array.isArray(def.sections) || !def.sections.length){
      throw new Error('registerInspectorSection : { sections: [...] } est obligatoire');
    }
    const id = prefixedIdPlugin(def.id || 'section');
    Editor.inspectorSections = Editor.inspectorSections.filter(function(x){ return x.id !== id; });
    Editor.inspectorSections.push({
      id: id,
      forType: def.forType || null,      // null = tous les objets
      descriptor: {id: id, sections: def.sections, title: def.title || ''},
      plugin: Editor.inProgress
    });
    return id;
  },

  /**
   * Un PANNEAU du dock, comme ceux de l'éditeur : dockable, en onglet, listé dans le menu
   * `Fenêtres`. C'était le trou de l'API v1 — un plugin ne pouvait ajouter d'interface que dans
   * l'inspecteur d'un objet sélectionné.
   */
  registerPanel: function(def){
    if(!def || !def.id || !def.title){
      throw new Error('registerPanel : { id, title } sont obligatoires');
    }
    const id = prefixedIdPlugin(def.id);
    // UNE ZONE PAR DÉFAUT, SINON LE PANNEAU N'EXISTE NULLE PART.
    //
    // `Dock.listable()` — la source du menu Fenêtres — écarte tout descripteur sans zone. Un
    // plugin qui suivait la documentation à la lettre (`{id, title, sections}`, les seuls
    // champs annoncés obligatoires) obtenait donc un panneau déclaré, enregistré, SANS ERREUR,
    // et introuvable : absent du menu, jamais monté, aucun message. Mesuré le 2026-09-30 en
    // installant un plugin réel.
    //
    // On ne rend pas `defaultZone` obligatoire — ce serait casser les plugins existants pour
    // une raison qui n'est pas la leur. On pose la valeur que la documentation laissait
    // supposer, et le panneau apparaît là où l'inspecteur apparaît.
    const descriptor = Object.assign({defaultZone: 'right'}, def, {id: id});
    Editor.panels = Editor.panels.filter(function(x){ return x.id !== id; });
    Editor.panels.push({id: id, descriptor: descriptor, plugin: Editor.inProgress});
    // Enregistrement PARESSEUX réconcilié par `Panels.boot()` : les plugins s'exécutent en
    // dernier (startup.js) et le dock est monté après eux, donc déclarer ici et construire là
    // est le seul ordre qui marche sans détruire les panneaux déjà montés.
    if(typeof Panels !== 'undefined') Panels.register(descriptor);
    return id;
  },

  /** Un TYPE DE CHAMP du socle — un curseur, un sélecteur de courbe, ce que l'éditeur n'a pas. */
  registerFieldType: function(def){
    if(!def || !def.type || typeof def.create !== 'function'){
      throw new Error('registerFieldType : { type, create } sont obligatoires');
    }
    const type = prefixedIdPlugin(def.type);
    if(typeof UIRegistry !== 'undefined'){
      UIRegistry.declareFieldType(Object.assign({}, def, {type: type}));
    }
    Editor.fieldTypes.push({type: type, plugin: Editor.inProgress});
    return type;
  },

  /** Une PRÉFÉRENCE d'éditeur : elle apparaît seule dans la fenêtre Préférences. */
  definePref: function(def){
    if(!def || !def.key) throw new Error('definePref : { key } est obligatoire');
    const key = prefixedIdPlugin(def.key);
    Prefs.define(Object.assign({}, def, {key: key}));
    Editor.prefs.push({key: key, plugin: Editor.inProgress});
    return key;
  },

  /**
   * Un RÉGLAGE DE PROJET : il voyage avec le projet, donc sa clé n'est PAS préfixée par
   * l'installation — elle finit dans le fichier de projet, que la machine d'à côté doit relire.
   * Le préfixe est le nom du plugin, choisi par son auteur, exactement comme un `typeName`.
   */
  defineProjectSetting: function(def){
    if(!def || !def.key) throw new Error('defineProjectSetting : { key } est obligatoire');
    Editor.projectSettings = Editor.projectSettings
      .filter(function(x){ return x.key !== def.key; });
    Editor.projectSettings.push({key: def.key, def: def, plugin: Editor.inProgress});
    if(project.settings
       && project.settings[def.key] === undefined){
      project.settings[def.key] = (def.default === undefined) ? null : def.default;
    }
    return def.key;
  },

  registerImporter: function(def){
    if(!def || !Array.isArray(def.extensions) || typeof def.importer !== 'function'){
      throw new Error('registerImporter : { extensions:[], importer } sont obligatoires');
    }
    Editor.importers.push({
      name: def.name || 'importer',
      extensions: def.extensions.map(function(e){ return String(e).toLowerCase().replace(/^\./, ''); }),
      importer: def.importer, plugin: Editor.inProgress
    });
  },

  registerCommandMenu: function(def){
    if(!def || !def.caption || typeof def.action !== 'function'){
      throw new Error('registerCommandMenu : { caption, action } sont obligatoires');
    }
    const title = def.menu || 'Extensions';
    let menu = defMenus.find(function(m){ return m.title === title; });
    if(!menu){
      menu = {title: title, items: []};
      defMenus.push(menu);
      laterUiPlugin(function(){ addMenuDom(menu); });
    }
    // Marquée du plugin : sans ça, réinstaller (ou réactiver) le plugin AJOUTAIT une seconde
    // entrée identique, que rien ne savait retirer (removePluginExtensions ne la voyait pas).
    menu.items.push({label: def.caption, shortcut: def.shortcut || null,
                     active: def.active || null, action: def.action, plugin: Editor.inProgress});
  },

  registerValidator: function(def){
    if(!def || typeof def.check !== 'function') throw new Error('registerValidator : { check } est obligatoire');
    Editor.validators.push({name: def.name || 'validator', check: def.check,
                            plugin: Editor.inProgress});
  },

  // Enregistre un MATÉRIAU, c'est-à-dire un shader et le formulaire qui le pilote.
  //
  //   name        identifiant ET libellé affiché (unique ; un second enregistrement remplace)
  //   category  regroupement dans le menu (défaut : 'Extensions')
  //   properties table déclarative AU FORMAT EXACT de js/material-props.js — c'est elle,
  //              et rien d'autre, qui produit l'inspecteur, clamped les saisies et décrit le
  //              matériau au copilote. L'auteur du shader ne dessine aucune interface.
  //   make       function(p, ctx) -> THREE.Material. `p` porte les propriétés déclarées
  //              ci-dessus ; `ctx` = {THREE, TSL, texture(key), props}.
  //
  // Le rendu passe par WebGPURenderer : un matériau s'écrit en NŒUDS (TSL), pas en GLSL.
  // `ctx.TSL` vaut null si le pont ESM n'a pas fini de charger — le vérifier plutôt que de
  // déréférencer, c'est le seul cas où la fabrication doit renoncer proprement.
  registerMaterial: function(def){
    if(!def || !def.name || typeof def.make !== 'function'){
      throw new Error('registerMaterial : { name, make } sont obligatoires');
    }
    const verdict = checkTableMaterial(def.properties, slugMaterial(def.name));
    // On refuse AVANT d'enregistrer : une table fautive donne un inspecteur plausible et
    // faux (voir les contrôles de checkTableMaterial), et un plugin à moitié installé
    // est plus difficile à diagnostiquer qu'un plugin refusé avec sa raison.
    if(verdict.errors.length){
      throw new Error('registerMaterial « ' + def.name + ' » : ' + verdict.errors.join(' · '));
    }
    Editor.materials = Editor.materials.filter(function(m){ return m.name !== def.name; });
    Editor.materials.push({
      name: def.name,
      category: def.category || 'Extensions',
      properties: verdict.table,
      defaults: defaultsFromTable(verdict.table),
      make: def.make,
      plugin: Editor.inProgress
    });
    // Une entrée de menu plutôt qu'un bouton : le menu se crée tout seul (defMenus), donc un
    // matériau de plugin devient créable SANS toucher editor.html.
    // Réenregistrer le même matériau (mise à jour d'un plugin sans recharger la page) remplace
    // sa définition mais NE DOIT PAS empiler une seconde entrée de menu identique — le
    // registre se dédoublonne par nom, pas les menus.
    if(menusMaterialPoses.indexOf(def.name) === -1){
      menusMaterialPoses.push(def.name);
      Editor.registerCommandMenu({
        menu: 'Extensions', caption: '🎨 Matériau « ' + def.name + ' »',
        // L'entrée survit au retrait du plugin (un menu construit ne se démonte pas) : elle
        // doit alors expliquer, pas lever une exception dans un gestionnaire de clic.
        action: function(){
          if(!materialPluginByName(def.name)){
            setStatus('Le plugin qui fournissait « ' + def.name + ' » a été retiré — '
              + 'rechargez l\'éditeur pour faire disparaître cette entrée', 5000);
            return;
          }
          createAssetMaterialPlugin(def.name);
        }
      });
    }
    return def.name;
  },

  // raccourcis vers le cœur de l'éditeur (évite aux plugins de deviner les globales)
  api: {
    get scene(){ return scene; },
    get objects(){ return objects; },
    get selection(){ return selection; },
    get project(){ return project; },
    get assets(){ return assets; },
    get env(){ return env; },
    THREE: (typeof THREE !== 'undefined') ? THREE : null,
    // La classe de base des composants : sans elle `registerComponent` était inutilisable depuis
    // un plugin, qui n'a pas d'`import` (il s'exécute via `new Function`).
    get Component(){ return Component; },
    // Accesseur, pas valeur figée. Le pont ESM (js/render-webgpu-bridge.mjs) s'exécute bien
    // AVANT ce fichier dans editor.html, donc un `TSL: TSL` marcherait là ; il gèlerait en
    // revanche `null` pour toute la session partout où le pont manque ou échoue — page
    // d'aperçu, harnais de test, erreur de module. Le coût d'un getter est nul, celui d'un
    // matériau de plugin muet pour le reste de la session ne l'est pas.
    get TSL(){ return (typeof TSL !== 'undefined') ? TSL : null; },
    createMaterialPlugin: function(name){ return createAssetMaterialPlugin(name); },
    /**
     * IMPORTE DES FICHIERS DANS LE PROJET, par le MÊME chemin que le glisser-déposer du panneau
     * Projet : modèles (.glb/.gltf/.fbx), images, sons, et les formats qu'un `registerImporter`
     * a pris en charge.
     *
     * POURQUOI ELLE MANQUAIT, ET POURQUOI L'AJOUTER NE DONNE AUCUN DROIT. Un plugin qui va
     * chercher un modèle ailleurs — un studio d'asset local, une bibliothèque en ligne — pouvait
     * le télécharger et ne pouvait rien en faire : `importFiles` n'était ni globale ni dans
     * `api`, et le plugin devait demander à la personne de glisser le fichier elle-même. Or un
     * plugin s'exécute DÉJÀ avec tous les droits de la page (c'est écrit en tête de
     * docs/PLUGINS.md) : ne pas l'exposer n'était pas une protection, seulement un mètre manquant.
     *
     * `files` est une liste de `File`. Un plugin qui a des octets en fabrique un :
     * `new File([octets], 'modele.glb')` — et c'est L'EXTENSION du nom qui décide du traitement,
     * exactement comme pour un fichier glissé.
     */
    importFiles: function(files, opts){ return importFiles(files, opts); },
    select: function(o){ return select(o); },
    addObject: function(o, height){ return register(o, height || 1); },
    createObject: function(type){ return createObject(type); },
    pushHistory: function(){ return pushHistory(); },
    updateHierarchy: function(){ return updateHierarchy(); },
    buildInspector: function(){ return buildInspector(); },
    setStatus: function(m, d){ return setStatus(m, d); },
    journal: function(level, msg, obj){ return logConsole(level, msg, obj || null); },
    openModal: function(title, html){ return openModal(title, html); },
    closeModal: function(){ return closeModal(); },
    // Ouvre (ou passe devant) un panneau, avec l'id rendu par registerPanel. Les plugins
    // testaient `typeof Dock`, qui n'est pas une globale : le panneau ne s'ouvrait jamais.
    openPanel: function(id){ return openPanelDock(id); },
    // Les commandes du copilote, pour un plugin qui les expose ailleurs (Pont MCP) : il appelait
    // les globales `copToolsApi`/`copRun`, disparues avec le passage en modules.
    copilotTools: function(){ return copToolsApi(); },
    copilotRun: function(name, args){ return copRun(name, args); },
    escapeHtml: function(s){ return escapeHtml(s); }
    // `api.fields` A DISPARU en v2. Les cinq fabriques (number, text, color, select, vec3)
    // rendaient des chaînes HTML, et le plugin devait ensuite router ses propres événements par
    // identifiant DOM. Une section d'inspecteur est maintenant un descripteur : voir
    // `registerInspectorSection`, et docs/API-IA.md pour l'avant/après.
  }
};

// Les collections qu'un plugin alimente, par leur VRAI nom de propriété. Elles étaient citées
// en dur, deux fois, sous leurs anciens noms français (`typesObjets`, `materiaux`) : depuis le
// renommage, `Editor['typesObjets']` valait `undefined` et le `.filter` juste après levait —
// la modale des plugins ne s'ouvrait plus dès qu'un plugin était installé, et retirer un plugin
// ne purgeait ni ses types d'objets ni ses matériaux.
/**
 * Une écriture dans le DOM de la coquille, DIFFÉRÉE.
 *
 * `addTypeCreatable` (js/objects.js) et `addMenuDom` (js/ui.js) modifient la barre d'outils et
 * la barre de menus sur-le-champ. Les plugins s'exécutent en dernier (startup.js) mais rien ne
 * garantit que ces deux fonctions existent déjà — un test qui charge `plugins.js` seul, une
 * page qui ne monte pas la coquille — et un `ReferenceError` au chargement d'un plugin lui
 * coûte tout le reste de son fichier. On enregistre donc l'intention, et `bootPluginsUi()` la
 * réalise quand la coquille est là. Rejouable : la file est vidée à chaque passage.
 */
export const A_FAIRE_UI_PLUGIN = [];

export function laterUiPlugin(fn){
  A_FAIRE_UI_PLUGIN.push(fn);
  // La coquille est déjà là (plugin installé à chaud) : rien à attendre.
  if(typeof document !== 'undefined' && document.getElementById
     && document.getElementById('menubar')) bootPluginsUi();
}

/** Réalise les écritures différées. Appelée par startup.js, après les plugins. */
export function bootPluginsUi(){
  while(A_FAIRE_UI_PLUGIN.length){
    const fn = A_FAIRE_UI_PLUGIN.shift();
    try { fn(); }
    catch(e){ logConsole('error', 'plugin (interface) : ' + e.message, null); }
  }
}

/**
 * Le PRÉFIXE d'un plugin, pour ses identifiants d'INTERFACE.
 *
 * Il est tiré d'un identifiant unique attribué à l'INSTALLATION, et non du nom du fichier :
 * deux plugins peuvent s'appeler `outils.js`, et deux `outils.js` différents qui déclarent tous
 * deux un panneau `palette` se voleraient l'un l'autre son id sans qu'aucun message ne le dise.
 *
 * Ne préfixent RIEN, et c'est délibéré : `def.type` d'un type d'objet et `typeName` d'un
 * composant. Ils partent dans `userData.type` et dans le projet SÉRIALISÉ — les préfixer
 * rendrait illisible tout projet déjà enregistré, et rendrait un projet illisible sur une autre
 * machine où le même plugin porterait un autre identifiant d'installation.
 */
export function prefixedIdPlugin(id){
  const p = Editor.plugins.find(function(x){ return x.name === Editor.inProgress; });
  const uid = (p && p.uid) ? p.uid : 'plug';
  return uid + ':' + id;
}

/**
 * Un identifiant d'installation : attribué une fois, conservé avec le plugin.
 *
 * Court et lisible — il apparaît dans des ids DOM, qu'on lit dans l'inspecteur du navigateur.
 */
export function newUidPlugin(){
  return 'p' + Math.random().toString(36).slice(2, 8);
}

export const COLLECTIONS_PLUGIN = ['typesObjects', 'inspectorSections', 'importers', 'validators',
                            'materials', 'components', 'panels', 'fieldTypes', 'prefs',
                            'projectSettings', 'systems'];

/** Retire de la boucle d'image les systèmes qui satisfont `pred` (la liste est partagée). */
function removeSystems(pred){
  for(let i = System.list.length - 1; i >= 0; i--){
    if(pred(System.list[i])) System.list.splice(i, 1);
  }
}

/** Retire tout ce qu'un plugin a enregistré, y compris ses systèmes. */
export function removePluginExtensions(name){
  COLLECTIONS_PLUGIN.forEach(function(key){
    Editor[key] = Editor[key].filter(function(x){ return x.plugin !== name; });
  });
  removeSystems(function(s){ return s.plugin === name; });
  removePluginMenuItems(name);
}

/** Les entrées de menu d'un plugin. Un menu se redessine à l'ouverture depuis items : les retirer suffit. */
export function removePluginMenuItems(name){
  let menus;
  // Le harnais node:vm charge ce fichier sans ui.js : l'import n'y existe pas, et il n'y a pas de menu à purger.
  try{ menus = defMenus; } catch(e){ if(e instanceof ReferenceError) return; throw e; }
  menus.forEach(function(m){
    if(Array.isArray(m.items)) m.items = m.items.filter(function(it){ return !it || it.plugin !== name; });
  });
}

// `sousScene` y RESTE a cote de `subScene` : c'etait la valeur du type natif avant son
// renommage, et un plugin ecrit a l'epoque la designe peut-etre encore. La liberer laisserait
// ce plugin enregistrer un type qui entre en collision avec un noeud natif d'un ancien projet.
export const TYPES_NATIVE = ['mesh', 'model', 'group', 'camera', 'point', 'spot', 'directional',
                      'particles', 'terrain', 'subScene', 'sousScene', 'probe'];

// Les composants du moteur, qu'un plugin ne peut pas remplacer (voir
// registerComponent). Liste explicite et non « tout ce qui est déjà dans le
// Registry » : les plugins sont rejoués au démarrage APRÈS les fichiers natifs,
// mais rien ne garantit qu'un plugin rechargé à chaud ne se réenregistre pas
// lui-même — et il doit pouvoir le faire.
export const COMPONENTS_NATIVE = ['Mesh', 'Model', 'Light', 'Camera', 'Collider', 'Physics',
                           'Terrain', 'Particles', 'Reflection', 'ScriptJS', 'Events', 'SubScene', 'Tag', 'AudioSource',
                           'UIDocument', 'AnimatorController'];

// ---------- Les sections d'inspecteur d'un plugin, montées par le socle ----------
//
// Même mécanique que `ComponentViews` pour les composants, et pour la même raison :
// `buildInspector` assemble une seule chaîne HTML qu'il pose d'un coup, on ne peut donc pas y
// construire de DOM en chemin. Le HTML porte un HÔTE VIDE par section, et le formulaire y est
// construit après (`mountPluginSections`).
export const PluginSections = {
  forms: [],

  /** Les sections qui s'appliquent à cet objet — celles d'un type dédié, puis les génériques. */
  forObject(o){
    if(typeof Editor === 'undefined' || !o) return [];
    const t = o.userData.type;
    const out = [];
    const tp = (typeof typePlugin === 'function') ? typePlugin(t) : null;
    if(tp && tp.inspector && Array.isArray(tp.inspector.sections)){
      out.push({id: 'plug-type-' + t,
                descriptor: {id: 'plug-type-' + t, sections: tp.inspector.sections},
                plugin: tp.plugin});
    }
    Editor.inspectorSections.forEach(function(x){
      if(x.forType && x.forType !== t) return;
      out.push(x);
    });
    return out;
  },

  hostId(id){ return 'plug-host-' + String(id).replace(/[^A-Za-z0-9_-]/g, '-'); },

  html(o){
    return this.forObject(o)
      .map((x) => '<div id="' + this.hostId(x.id) + '"></div>').join('');
  },

  /** Construit les formulaires, une fois le HTML de l'inspecteur posé. */
  mount(o){
    this.forms = [];
    this.forObject(o).forEach((x) => {
      const host = document.getElementById(this.hostId(x.id));
      if(!host) return;
      // Un descripteur de plugin est du code TIERS : une exception à la construction ne doit
      // pas emporter le reste de l'inspecteur, elle doit dire quel plugin l'a levée.
      try {
        const form = createForm(host, x.descriptor);
        form.setTargets([o]);
        this.forms.push(form);
      } catch(e){
        logConsole('error', 'plugin « ' + x.plugin + ' » (inspecteur) : ' + e.message, o);
      }
    });
  },

  sync(){
    this.forms.forEach(function(f){
      try { f.sync(); } catch(e){ /* déjà signalé à la construction */ }
    });
  }
};

// ---------- registre : recherches utilitaires ----------
export function typePlugin(type){
  return Editor.typesObjects.find(function(t){ return t.type === type; }) || null;
}
export function importForFile(fileName){
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  return Editor.importers.find(function(i){ return i.extensions.indexOf(ext) !== -1; }) || null;
}
export function extensionsPlugins(){
  const s = [];
  Editor.importers.forEach(function(i){
    i.extensions.forEach(function(e){ if(s.indexOf(e) === -1) s.push(e); });
  });
  return s;
}

// ---------- matériaux de plugin : le registre vu par le moteur ----------
// Ce bloc est le SEUL point par lequel le reste de l'éditeur (materials.js, import-settings.js,
// copilot.js) touche au registre des matériaux. Les fonctions de recherche répondent `null`
// quand le matériau n'en est pas un : le natif reste le chemin par défaut du moteur, jamais
// une branche à part réservée aux plugins.

// Noms pour lesquels une entrée de menu a déjà été posée. Volontairement JAMAIS purgé quand
// on retire un plugin : l'entrée de menu, elle, ne peut pas être retirée d'un menu déjà
// construit (c'est ce que dit le message « rechargez l'éditeur »). Oublier le nom ici
// rajouterait donc une SECONDE entrée à la réinstallation.
export const menusMaterialPoses = [];

export function slugMaterial(name){
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'material';
}

export function materialPluginByName(name){
  return Editor.materials.find(function(m){ return m.name === name; }) || null;
}

// Le matériau de plugin d'un jeu de props, ou null. `props.materiauPlugin` est une chaîne
// sérialisée avec le projet : elle survit à la sauvegarde, et retombe naturellement sur null
// quand le projet est rouvert SANS le plugin — cas traité, pas ignoré (voir tablePropsMaterial).
export function materialPluginOf(p){
  return (p && p.materialPlugin) ? materialPluginByName(p.materialPlugin) : null;
}

// La table qui décrit CE matériau. C'est elle qu'on pass à renderPropsMaterial,
// readPropsMaterialFromDom, validatePropMaterial et describeMaterialForAI : une seule
// projection, deux origines de table possibles.
export function tablePropsMaterial(p){
  const def = materialPluginOf(p);
  return def ? def.properties : PROPS_MATERIAL;
}

export let warnedMakingMaterial = {};

// Construit le matériau three d'un matériau de plugin, ou null si ce n'en est pas un / si la
// fabrication échoue. Un plugin qui lève ou qui rend autre chose qu'un matériau ne doit pas
// faire disparaître l'objet de la scène sans un mot : on journalise UNE fois par matériau
// (pas une fois par image — makeMaterialThree est rappelé à chaque édition) et on laisse
// l'appelant retomber sur le matériau natif.
export function makeMaterialPlugin(p){
  const def = materialPluginOf(p);
  if(!def) return null;
  const ctx = {
    THREE: (typeof THREE !== 'undefined') ? THREE : null,
    TSL: (typeof TSL !== 'undefined') ? TSL : null,
    // Résout un emplacement de texture déclaré `type:'texture'` en THREE.Texture, avec le
    // tuilage et les paramètres d'import du moteur — un plugin n'a pas à les réimplémenter.
    texture: function(key){
      return textureMaterial(p[key], p);
    },
    props: p
  };
  let m = null;
  try { m = def.make(p, ctx); }
  catch(e){
    if(!warnedMakingMaterial[def.name]){
      warnedMakingMaterial[def.name] = true;
      logConsole('error', 'matériau « ' + def.name + ' » : make() a levé — '
        + e.message + '. Le matériau natif est utilisé à la place.', null);
    }
    return null;
  }
  if(!m || !m.isMaterial){
    if(!warnedMakingMaterial[def.name]){
      warnedMakingMaterial[def.name] = true;
      logConsole('error', 'matériau « ' + def.name + ' » : make() doit renvoyer un '
        + 'matériau three (reçu ' + (m === null ? 'null' : typeof m) + '). Le matériau natif '
        + 'est utilisé à la place.', null);
    }
    return null;
  }
  return m;
}

// Crée un asset matériau piloté par un matériau de plugin. Passe par createAssetMaterial pour
// que la numérotation, le dossier current et l'entrée dans l'historique restent d'une seule
// source, puis rebascule l'asset sur le plugin.
export function createAssetMaterialPlugin(name){
  const def = materialPluginByName(name);
  if(!def) throw new Error('matériau de plugin inconnu : ' + name);
  const a = createAssetMaterial();
  a.name = def.name;
  a.props.materialPlugin = def.name;
  ensurePropsMaterial(a);              // pose les défauts déclarés par la table du plugin
  a.preview = previewMaterial(a);         // la vignette du natif ne veut plus rien dire ici
  updateProject();
  selectAsset(a);
  return a;
}

// Ce que le copilote reçoit : la même table que l'inspecteur, matériau par matériau.
export function describeMaterialsPluginForAI(){
  return Editor.materials.map(function(m){
    return {material: m.name, category: m.category, plugin: m.plugin,
            properties: describeMaterialForAI(m.properties)};
  });
}

// ---------- exécution / persistance ----------
export function runPlugin(p){
  // Réinstaller ou réactiver rejoue le plugin : sans cette purge, chaque fois ajoutait une
  // entrée de plus dans son menu (Extensions → Pont MCP… en double).
  removePluginMenuItems(p.name);
  // v0.188.0 — le plugin EVAVEO Studio (et l'application Python qu'il pilotait) est remplacé par
  // Fenêtres → Atelier Blender, intégré au moteur. Il marche encore s'il est installé ; on le dit.
  if(/^plugin-evaveo-studio\.js$/i.test(p.name)){
    logConsole('warn', 'plugin « ' + p.name + ' » : remplacé par Fenêtres → Atelier Blender (addon Blender '
      + 'seul, sans Studio Python). Il peut être retiré de Fichier → Plugins → Plugins installés.', null);
  }
  Editor.inProgress = p.name;
  try{
    // `Editor` est passé en paramètre : l'éditeur est fait de modules ES, ce n'est PAS une
    // globale. Le paramètre s'appelait `Editeur` (reliquat du renommage) alors que toute la doc
    // écrit `Editor.register…` : chaque plugin levait un ReferenceError au chargement, masqué
    // en test par le pont global du harnais. `Editeur` reste un alias pour les anciens plugins.
    const f = new Function('Editor', 'Editeur', '"use strict";\n' + p.code);
    f(Editor, Editor);
    p.error = null;
    logConsole('log', 'plugin « ' + p.name + ' » chargé', null);
  } catch(e){
    p.error = e.message;
    logConsole('error', 'plugin « ' + p.name + ' » : ' + e.message, null);
    setStatus('Plugin « ' + p.name + ' » en erreur — voir la Console', 4000);
  }
  Editor.inProgress = null;
}

// ---------- plugins DU PROJET ----------
// Un plugin coché « Dans le projet » est COPIÉ dans `project.settings.plugins` : il voyage avec
// le projet (p3d, dossier, cloud), se rejoue à l'ouverture du projet sur une autre machine, et
// part dans le build, où js/plugin-host.js exécute ses composants, systèmes, types et matériaux.
// Un plugin non coché reste dans ce navigateur seulement.

function projectPlugins(){
  if(!project || !project.settings) return [];
  if(!Array.isArray(project.settings.plugins)) project.settings.plugins = [];
  return project.settings.plugins;
}

export function isPluginInProject(p){
  return projectPlugins().some(function(x){ return x.name === p.name; });
}

/** Range (ou retire) la copie d'un plugin dans le projet ouvert. */
export function setPluginInProject(p, inProject){
  const list = projectPlugins();
  const i = list.findIndex(function(x){ return x.name === p.name; });
  if(i !== -1) list.splice(i, 1);
  if(inProject) list.push({name: p.name, code: p.code, uid: p.uid});
  updateProject();
}

/** Les plugins du projet, sous la forme que js/script-trust.js sait interroger. */
export function projectPluginsAsCode(){
  return projectPlugins().map(function(x){ return {kind: 'plugin', name: x.name, code: x.code}; });
}

/**
 * À l'OUVERTURE d'un projet : rejoue ses plugins que ce navigateur n'a pas déjà.
 *
 * Même garde que les scripts (js/script-trust.js) : le code d'un projet reçu d'autrui ne
 * s'exécute pas sans qu'on l'ait accepté. Un plugin du même nom déjà installé ici avec le MÊME
 * code n'est pas rejoué ; avec un code DIFFÉRENT, la version du projet l'emporte pour la session
 * (c'est celle que le jeu publié exécutera) sans écraser la copie locale.
 * Les plugins venus d'un projet précédent sont d'abord retirés.
 */
export async function loadProjectPlugins(){
  Editor.plugins = Editor.plugins.map(function(p){
    if(p.source !== 'project') return p;
    removePluginExtensions(p.name);
    // Une copie locale mise de côté reprend sa place (elle sera rejouée au prochain démarrage).
    return p.localCopy || null;
  }).filter(Boolean);
  const todo = projectPlugins().filter(function(x){
    const local = Editor.plugins.find(function(p){ return p.name === x.name; });
    return !(local && local.code === x.code && local.active !== false);
  });
  if(!todo.length) return 0;
  // `allowRunScripts` ne pose la question que pour le code qui n'a pas déjà reçu la confiance.
  if(typeof allowRunScripts === 'function'){
    const asCode = todo.map(function(x){ return {kind: 'plugin', name: x.name, code: x.code}; });
    if(!(await allowRunScripts(asCode))){
      setStatus('Plugins du projet non exécutés', 4000);
      return 0;
    }
  }
  todo.forEach(function(x){
    const local = Editor.plugins.find(function(p){ return p.name === x.name; });
    if(local) removePluginExtensions(local.name);
    // La copie locale est REMPLACÉE pour la session et gardée à part : `savePlugins` la réécrit
    // telle quelle, la version du projet ne s'installe pas dans le navigateur à son insu.
    const p = {name: x.name, code: x.code, active: true, uid: x.uid || newUidPlugin(),
               source: 'project', localCopy: local || null};
    Editor.plugins = Editor.plugins.filter(function(q){ return q !== local; }).concat([p]);
    runPlugin(p);
  });
  bootPluginsUi();
  setStatus(todo.length + ' plugin(s) du projet chargé(s)', 3000);
  return todo.length;
}

export function savePlugins(){
  try{
    localStorage.setItem('moteur3d-plugins', JSON.stringify(
      Editor.plugins.map(function(p){ return p.source === 'project' ? p.localCopy : p; })
        .filter(Boolean).map(function(p){
        return {name: p.name, code: p.code, active: p.active, uid: p.uid};
      })));
  } catch(e){ setStatus('Plugins : stockage local indisponible', 3000); }
}

export function loadPluginsAtStartup(){
  let list = [];
  try{ list = JSON.parse(localStorage.getItem('moteur3d-plugins') || '[]'); }
  catch(e){ list = []; }
  Editor.plugins = list.filter(function(p){ return p && p.name && typeof p.code === 'string'; });
  // Un plugin installé AVANT la v2 n'a pas d'identifiant d'installation : on lui en attribue un
  // au premier chargement, plutôt que de le laisser partager le préfixe de repli avec tous les
  // autres — deux plugins d'avant la v2 se voleraient sinon leurs ids d'interface.
  let neufs = 0;
  Editor.plugins.forEach(function(p){ if(!p.uid){ p.uid = newUidPlugin(); neufs++; } });
  if(neufs) savePlugins();
  Editor.plugins.filter(function(p){ return p.active !== false; }).forEach(runPlugin);
  const n = Editor.plugins.filter(function(p){ return p.active !== false; }).length;
  if(n) setStatus(n + ' plugin(s) chargé(s)', 2500);
  // Le projet a pu être rouvert AVANT ce point (autosave) : ses plugins passent maintenant.
  pluginsState.booted = true;
  listenPluginCatalog();
  loadProjectPlugins();
}

export function installPlugin(name, code, after){
  if(!confirm('Installer le plugin « ' + name + ' » ?\n\n'
    + 'Un plugin exécute du code JavaScript avec tous les droits de l\'éditeur '
    + '(scène, projet, réseau). N\'installez que du code dont vous connaissez la provenance.')) return;
  const existant = Editor.plugins.find(function(p){ return p.name === name; });
  if(existant){
    existant.code = code;
    existant.active = true;
    // Installer explicitement un plugin venu du projet le rend LOCAL aussi.
    delete existant.source; delete existant.localCopy;
    setStatus('Plugin « ' + name + ' » mis à jour — rechargez l\'éditeur pour repartir d\'un état propre', 5000);
  } else {
    Editor.plugins.push({name: name, code: code, active: true, uid: newUidPlugin()});
  }
  // Vous venez d'installer ce code : il reçoit la confiance, comme un script que vous tapez.
  if(typeof trustCode === 'function') trustCode(code);
  const installed = Editor.plugins.find(function(p){ return p.name === name; });
  // Une mise à jour d'un plugin rangé dans le projet met aussi à jour la copie du projet.
  if(isPluginInProject(installed)) setPluginInProject(installed, true);
  savePlugins();
  runPlugin(Editor.plugins.find(function(p){ return p.name === name; }));
  // Le catalogue rouvre SA vue après une installation : sinon le gestionnaire le remplaçait.
  (after || modalPlugins)();
}

// ---------- catalogue (page `/editeur/plugins.html`) ----------
//
// Le catalogue est une PAGE, pas une modale : elle se lit à côté de l'éditeur, elle garde ses
// filtres pendant qu'on regarde la scène, et elle s'ouvre aussi seule (un lien qu'on envoie à
// quelqu'un). Elle n'a aucun droit sur l'éditeur : elle ne peut que DEMANDER, par postMessage,
// l'installation d'un fichier du catalogue. Tout le reste se passe ici.
//
// `catalogGate` retient le JETON tiré pour cette ouverture. Une demande qui ne le porte pas ne
// franchit pas `installRequestFile()` — voir les trois verrous dans js/plugin-catalog.js.
export const catalogGate = {key: '', origin: null, channel: null};

/** La page `plugins.html` seule, pour un lien qu'on envoie : liste et téléchargement. */
export function openPluginCatalogPage(){
  // Le jeton est tiré à CHAQUE ouverture : une page de catalogue fermée ne rouvre pas la porte.
  catalogGate.key = newCatalogKey();
  catalogGate.origin = location.origin;
  const win = window.open('plugins.html#k=' + catalogGate.key, 'evaveo3d-catalogue-plugins');
  if(!win) setStatus('Le navigateur a bloqué l\'ouverture du catalogue', 4000);
  return win;
}

// LE CATALOGUE, DANS L'ÉDITEUR (modale). Il s'ouvrait dans un onglet à part : l'installation
// passait par un jeton gardé en mémoire par l'onglet d'origine, et le lien « ← Éditeur » de la
// page ouvrait un éditeur NEUF, sans le projet — dont le jeton ne correspondait plus : plus rien
// ne s'installait, sans un message. Ici on installe dans l'éditeur qui affiche le catalogue.
export const catalogView = {catalog: null, query: '', category: '', states: {}};

export function openPluginCatalog(){
  if(catalogView.catalog){ renderPluginCatalog(); return; }
  openModal('Catalogue de plugins', '<div class="none">Chargement du catalogue…</div>');
  fetch(CATALOG_URL)
    .then(function(r){ if(!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function(catalog){ catalogView.catalog = catalog; renderPluginCatalog(); })
    .catch(function(e){
      openModal('Catalogue de plugins', '<div class="none">Le catalogue (' + escapeHtml(CATALOG_URL)
        + ') n\'a pas pu être lu : ' + escapeHtml(e.message) + '</div>');
    });
}

function catalogCardHtml(p, installed){
  const isInstalled = installed.indexOf(pluginNameForFile(p.file)) >= 0;
  const state = catalogView.states[p.file];
  return '<div style="border:1px solid var(--edge);border-radius:6px;padding:10px;margin-bottom:8px">'
    + '<div style="display:flex;gap:8px;align-items:center"><span>' + escapeHtml(p.icon || '🧩') + '</span>'
    + '<b>' + escapeHtml(p.title) + '</b><span style="color:var(--txt-dim);font-size:11.5px">'
    + escapeHtml(p.category || '') + '</span>'
    + (isInstalled ? '<span style="margin-left:auto;color:var(--ok)">✓ Installé</span>' : '') + '</div>'
    + '<p style="margin:6px 0;line-height:1.5">' + escapeHtml(p.summary) + '</p>'
    + (p.warning ? '<p style="margin:6px 0;color:var(--txt-dim)">⚠ ' + escapeHtml(p.warning) + '</p>' : '')
    + '<button class="btn-modal accent pcat-install" data-file="' + escapeHtml(p.file) + '">'
    + (isInstalled ? '↻ Réinstaller' : '⇩ Installer') + '</button>'
    + (state === 'pending' ? ' <span>Installation…</span>'
      : state === 'ok' ? ' <span style="color:var(--ok)">Installé. S\'il ajoute un menu, rechargez l\'éditeur.</span>'
      : state === 'refused' ? ' <span style="color:var(--txt-dim)">Non installé.</span>' : '')
    + '</div>';
}

function renderPluginCatalog(){
  const v = catalogView;
  const installed = Editor.plugins.map(function(p){ return p.name; });
  const chips = [''].concat(catalogCategories(v.catalog)).map(function(c){
    return '<button type="button" class="btn-modal' + (v.category === c ? ' accent' : '')
      + ' pcat-chip" data-category="' + escapeHtml(c) + '">' + escapeHtml(c || 'Tous') + '</button>';
  }).join(' ');
  const list = filterCatalog(v.catalog, v.query, v.category)
    .map(function(p){ return catalogCardHtml(p, installed); }).join('')
    || '<div class="none">Aucun plugin ne correspond à cette recherche.</div>';
  openModal('Catalogue de plugins',
    '<input type="search" id="pcat-q" placeholder="Rechercher un plugin…" value="' + escapeHtml(v.query)
    + '" style="width:100%;margin-bottom:8px"><div style="margin-bottom:8px">' + chips + '</div>'
    + '<div style="max-height:60vh;overflow:auto">' + list + '</div>'
    + '<div style="display:flex;justify-content:space-between;margin-top:10px">'
    + '<button class="btn-modal" id="pcat-manage">← Plugins installés</button>'
    + '<button class="btn-modal" id="pcat-close">Fermer</button></div>');
  const q = document.getElementById('pcat-q');
  q.addEventListener('input', function(){
    v.query = q.value;
    renderPluginCatalog();
    const q2 = document.getElementById('pcat-q');
    q2.focus(); q2.setSelectionRange(q2.value.length, q2.value.length);
  });
  document.getElementById('pcat-manage').addEventListener('click', function(){ modalPlugins(); });
  document.getElementById('pcat-close').addEventListener('click', closeModal);
  document.querySelectorAll('#modal-body .pcat-chip').forEach(function(b){
    b.addEventListener('click', function(){ v.category = b.dataset.category; renderPluginCatalog(); });
  });
  document.querySelectorAll('#modal-body .pcat-install').forEach(function(b){
    b.addEventListener('click', function(){
      const file = b.dataset.file;
      // Le nom vient du manifeste affiché, mais il construit un chemin : on le revérifie.
      if(!isPluginFileName(file)) return;
      v.states[file] = 'pending';
      renderPluginCatalog();
      installFromCatalog(file, renderPluginCatalog).then(function(ok){
        v.states[file] = ok ? 'ok' : 'refused';
        renderPluginCatalog();
      });
    });
  });
}

/**
 * Installe un plugin du catalogue. `file` a DÉJÀ franchi `installRequestFile()` : il vient du
 * manifeste, pas du message. Le chemin est construit ici, jamais reçu.
 */
export function installFromCatalog(file, after){
  const name = pluginNameForFile(file);
  return fetch('exemples/' + file)
    .then(function(r){
      if(!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    })
    .then(function(code){
      installPlugin(name, code, after);
      // `installPlugin` peut s'arrêter sur le `confirm()` : on rapporte ce qui EST, pas ce
      // qu'on a demandé — sinon le catalogue afficherait « installé » sur un refus.
      return !!Editor.plugins.find(function(p){ return p.name === name; });
    })
    .catch(function(e){
      setStatus('Catalogue : « ' + name + ' » n\'a pas pu être lu (' + e.message + ')', 6000);
      return false;
    });
}

/** Branche l'écoute des demandes du catalogue. Appelé une fois, au démarrage. */
export function listenPluginCatalog(){
  if(typeof BroadcastChannel !== 'function') return null;
  const channel = new BroadcastChannel(CHANNEL_CATALOG);
  catalogGate.channel = channel;
  channel.addEventListener('message', function(e){
    if(!e || !e.data || e.data.type !== MESSAGE_INSTALL) return;
    // On relit le manifeste à CHAQUE demande : l'éditeur reste ouvert des heures, et une
    // liste mise en cache au démarrage refuserait un plugin ajouté entre-temps.
    fetch(CATALOG_URL)
      .then(function(r){ return r.ok ? r.json() : null; })
      .catch(function(){ return null; })
      .then(function(catalog){
        const file = installRequestFile(e, catalogGate, catalog);
        if(!file){
          // Plus de refus muet : la page restait « en attente » sans jamais rien dire.
          channel.postMessage({type: MESSAGE_DONE, key: e.data.key, file: e.data.file, ok: false});
          return;
        }
        installFromCatalog(file).then(function(ok){
          channel.postMessage({type: MESSAGE_DONE, key: catalogGate.key, file: file, ok: ok});
        });
      });
  });
  return channel;
}

// ---------- gestionnaire (modale) ----------
export function modalPlugins(){
  let lines = '';
  Editor.plugins.forEach(function(p, i){
    const count = COLLECTIONS_PLUGIN.reduce(function(n, key){
      return n + Editor[key].filter(function(x){ return x.plugin === p.name; }).length;
    }, 0);
    lines += '<tr><td><input type="checkbox" class="plug-active" data-i="' + i + '"'
      + (p.active !== false ? ' checked' : '') + '></td>'
      + '<td>' + escapeHtml(p.name) + (p.error
          ? '<br><span style="color:#e06c75;font-size:11px">' + escapeHtml(p.error) + '</span>' : '')
      + '</td>'
      + '<td style="color:var(--txt-dim);font-size:11.5px">' + count + ' extension(s)'
      + (p.source === 'project' ? '<br>fourni par le projet' : '') + '</td>'
      + '<td style="font-size:11.5px;white-space:nowrap"><label title="Enregistre le plugin dans '
      + 'le projet : il le suit sur une autre machine et part dans le jeu publié">'
      + '<input type="checkbox" class="plug-project" data-i="' + i + '"'
      + (isPluginInProject(p) ? ' checked' : '') + '> Dans le projet</label></td>'
      + '<td><button class="btn-modal plug-del" data-i="' + i + '">Retirer</button></td></tr>';
  });
  openModal('Plugins',
    '<p style="margin-bottom:8px;line-height:1.5">Un plugin est un fichier <code>.js</code> '
    + 'qui reçoit l\'objet <code>Editor</code> et enregistre ses extensions : types d\'objets, '
    + 'sections d\'inspecteur, importeurs de fichiers, commandes de menu, règles d\'analyse, '
    + '<b>matériaux</b> (shaders écrits en nœuds TSL). '
    + 'Un plugin est conservé dans ce navigateur ; cochez <b>Dans le projet</b> pour qu\'il '
    + 'voyage avec le projet et parte dans le jeu publié.</p>'
    + '<p style="margin-bottom:8px;line-height:1.5;color:var(--txt-dim);font-size:11.5px">'
    + 'Dans le jeu publié, seuls comptent les composants, systèmes, types d\'objets et '
    + 'matériaux d\'un plugin ; son interface d\'édition (panneaux, menus…) n\'y existe pas. '
    + 'Guide : <code>moteur/docs/PLUGINS.md</code>.</p>'
    + (lines ? '<table>' + lines + '</table>'
              : '<div class="none">Aucun plugin installé.</div>')
    + '<div style="display:flex;gap:8px;margin-top:12px;justify-content:space-between">'
    + '<span><button class="btn-modal accent" id="plug-catalog">🏪 Parcourir le catalogue…</button> '
    + '<button class="btn-modal" id="plug-add">＋ Installer un .js…</button> '
    + '<button class="btn-modal" id="plug-example">📄 Voir un exemple</button></span>'
    + '<button class="btn-modal" id="plug-close">Fermer</button></div>'
    + '<input type="file" id="plug-file" accept=".js" style="display:none">');

  const inputF = document.getElementById('plug-file');
  document.getElementById('plug-add').addEventListener('click', function(){ inputF.click(); });
  inputF.addEventListener('change', function(){
    const f = inputF.files[0];
    if(!f) return;
    f.text().then(function(code){
      installPlugin(f.name.replace(/\.js$/i, ''), code);
    });
  });
  document.getElementById('plug-catalog').addEventListener('click', openPluginCatalog);
  document.getElementById('plug-example').addEventListener('click', modalExamplePlugin);
  document.getElementById('plug-close').addEventListener('click', closeModal);
  document.getElementById('modal-body').addEventListener('click', function(e){
    if(e.target.classList.contains('plug-del')){
      const i = parseInt(e.target.dataset.i, 10);
      const p = Editor.plugins[i];
      if(!p || !confirm('Retirer le plugin « ' + p.name + ' » ?')) return;
      removePluginExtensions(p.name);
      if(isPluginInProject(p)) setPluginInProject(p, false);
      Editor.plugins.splice(i, 1);
      savePlugins();
      setStatus('Plugin retiré — rechargez l\'éditeur pour purger ses commandes de menu', 4000);
      modalPlugins();
    }
  });
  document.getElementById('modal-body').addEventListener('input', function(e){
    if(e.target.classList.contains('plug-project')){
      const pp = Editor.plugins[parseInt(e.target.dataset.i, 10)];
      if(!pp) return;
      setPluginInProject(pp, e.target.checked);
      setStatus(e.target.checked
        ? 'Plugin « ' + pp.name + ' » rangé dans le projet — enregistrez le projet'
        : 'Plugin « ' + pp.name + ' » retiré du projet — enregistrez le projet', 4000);
      return;
    }
    if(!e.target.classList.contains('plug-active')) return;
    const p = Editor.plugins[parseInt(e.target.dataset.i, 10)];
    if(!p) return;
    p.active = e.target.checked;
    savePlugins();
    setStatus(p.active
      ? 'Plugin activé — rechargez l\'éditeur pour l\'exécuter'
      : 'Plugin désactivé — rechargez l\'éditeur pour retirer ses extensions', 4000);
  });
}

export function modalExamplePlugin(){
  openModal('Exemple de plugin',
    '<p style="margin-bottom:8px">Enregistrez ce code dans un fichier <code>.js</code> puis '
    + 'installez-le depuis Fichier → Plugins. Il est écrit au contrat <b>v2</b> : une section '
    + 'd\'inspecteur est un DESCRIPTEUR, pas du HTML.</p>'
    + '<textarea spellcheck="false" style="height:340px">'
    + escapeHtml(
      '// Plugin d\'exemple : un objet « borne », son inspecteur, une préférence, une règle.\n'
      + 'const T = Editor.api.THREE;\n\n'
      + 'Editor.registerTypeObject({\n'
      + '  type: \'borne\', name: \'Borne\', icon: \'🚧 \',\n'
      + '  make: function(){\n'
      + '    const m = new T.Mesh(new T.CylinderGeometry(0.3, 0.4, 1.2, 12),\n'
      + '      new T.MeshStandardMaterial({color: 0xff8800}));\n'
      + '    m.userData.borne = {range: 5};   // état sérialisable\n'
      + '    return m;\n'
      + '  },\n'
      + '  serialize: function(o){ return o.userData.borne; },\n'
      + '  restore: function(o, d){ o.userData.borne = d || {range: 5}; },\n'
      + '  // La section est DÉCLARATIVE : le socle la construit, la synchronise et route ses\n'
      + '  // événements. Pas de chaîne HTML, pas de getElementById, pas d\'identifiant à\n'
      + '  // rendre unique soi-même.\n'
      + '  inspector: {\n'
      + '    sections: [{ id: \'borne\', title: \'Borne\', fields: [\n'
      + '      { label: \'Portée\', type: \'number\', step: 0.5, min: 1, max: 50,\n'
      + '        get: function(o){ return o.userData.borne.range; },\n'
      + '        set: function(o, v){ o.userData.borne.range = v || 5; } }\n'
      + '    ]}]\n'
      + '  }\n'
      + '});\n\n'
      + '// Une préférence d\'éditeur : elle apparaît seule dans la fenêtre Préférences.\n'
      + 'Editor.definePref({ key: \'borne.couleur\', label: \'Couleur des bornes\',\n'
      + '  type: \'color\', category: \'Extensions\', default: \'#ff8800\' });\n\n'
      + '// registerTypeObject ajoute déjà « Borne » à la barre et au menu Objet ; cette\n'
      + '// commande est un raccourci additionnel, pas une obligation.\n'
      + 'Editor.registerCommandMenu({\n'
      + '  menu: \'Objet\', caption: \'🚧 Borne\',\n'
      + '  action: function(){ Editor.api.createObject(\'borne\'); }\n'
      + '});\n\n'
      + 'Editor.registerValidator({\n'
      + '  name: \'bornes\',\n'
      + '  check: function(probleme){\n'
      + '    Editor.api.objects.forEach(function(o){\n'
      + '      if(o.userData.type === \'borne\' && o.userData.borne.range > 30)\n'
      + '        probleme(\'warn\', o.name + \' : portée de borne très grande\');\n'
      + '    });\n'
      + '  }\n'
      + '});\n')
    + '</textarea>');
}

// Appelés par des fichiers qui ne peuvent pas importer plugins.js sans cycle (project.js,
// play-mode.js) : même régime que les autres globales « éditeur seulement ».
globalThis.loadProjectPlugins = loadProjectPlugins;
globalThis.projectPluginsAsCode = projectPluginsAsCode;
export const pluginsState = {booted: false};
globalThis.pluginsState = pluginsState;
