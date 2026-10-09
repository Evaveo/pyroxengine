// moteur/js/plugin-host.js
//
// L'HÔTE DE PLUGINS DU JEU PUBLIÉ.
//
// Un plugin rangé DANS LE PROJET (`project.settings.plugins`, voir js/plugins.js) part dans
// data.js avec le reste des réglages. Le lecteur autonome (js/game-runtime.js) le rejoue ici,
// avec un `Editor` réduit à ce qui a un sens hors de l'éditeur :
//
//   registerComponent, registerSystem   → le Registry et les Systèmes, les MÊMES que l'éditeur ;
//   registerTypeObject                   → `make` + `restore`, pour reconstruire ses objets ;
//   registerMaterial                     → `make`, pour que le jeu rende le shader du plugin ;
//   le reste (panneaux, inspecteur, menus, préférences, importeurs, validateurs) → sans effet.
//
// Sans cet hôte, un matériau de plugin retombait sur le matériau natif dans le jeu, et un
// composant de plugin n'y était tout simplement pas reposé : la divergence éditeur/jeu que
// systems.js a été écrit pour fermer.
//
// Aucune dépendance d'éditeur : ce fichier est embarqué dans le build (js/build.js).
import { Registry } from './component-registry.js';
import { Component } from './component.js';
import { System } from './systems.js';

export const PluginHost = {
  types: {},        // type → {make, restore, plugin}
  materials: {},    // nom → {make, properties, plugin}

  /** Un `Editor` pour le jeu : même forme que celui de l'éditeur, `runtime: true`. */
  editorFor(pluginName){
    const noop = function(def){ return (def && (def.id || def.key || def.type || def.name)) || null; };
    const host = this;
    return {
      version: '2.0',
      runtime: true,
      registerComponent(classe){
        if(typeof classe !== 'function' || !(classe.prototype instanceof Component)){
          throw new Error('registerComponent : attend une sous-classe de Editor.api.Component');
        }
        Registry.registerClass(classe);
        return classe.typeName;
      },
      registerSystem(def){
        checkSystem(def);
        System.register(Object.assign({}, def, {plugin: pluginName}));
        return def.name;
      },
      registerTypeObject(def){
        if(!def || !def.type || typeof def.make !== 'function'){
          throw new Error('registerTypeObject : { type, make } sont obligatoires');
        }
        host.types[def.type] = {make: def.make, restore: def.restore || null, plugin: pluginName};
        return def.type;
      },
      registerMaterial(def){
        if(!def || !def.name || typeof def.make !== 'function'){
          throw new Error('registerMaterial : { name, make } sont obligatoires');
        }
        host.materials[def.name] = {make: def.make, properties: def.properties || [],
                                    plugin: pluginName};
        return def.name;
      },
      registerInspectorSection: noop, registerPanel: noop, registerFieldType: noop,
      definePref: noop, defineProjectSetting: noop, registerImporter: noop,
      registerCommandMenu: noop, registerValidator: noop,
      api: {
        THREE: (typeof THREE !== 'undefined') ? THREE : null,
        get TSL(){ return (typeof TSL !== 'undefined') ? TSL : null; },
        Component: Component,
        runtime: true,
        journal(level, msg){ (console[level] || console.log)('[plugin ' + pluginName + '] ' + msg); },
        setStatus(){}
      }
    };
  },

  /** Rejoue les plugins du projet. Une erreur n'arrête ni les autres plugins ni le jeu. */
  run(list){
    (Array.isArray(list) ? list : []).forEach((p) => {
      if(!p || typeof p.code !== 'string' || p.active === false) return;
      const E = this.editorFor(p.name || 'plugin');
      try { new Function('Editor', 'Editeur', '"use strict";\n' + p.code)(E, E); }
      catch(e){ console.error('plugin « ' + p.name + ' » : ' + e.message); }
    });
  },

  typeOf(type){ return (type && this.types[type]) || null; },
  materialOf(name){ return (name && this.materials[name]) || null; }
};

/** Contrôle partagé avec `Editor.registerSystem` (js/plugins.js). */
export function checkSystem(def){
  if(!def || !def.name || typeof def.onFrame !== 'function'){
    throw new Error('registerSystem : { name, onFrame } sont obligatoires');
  }
  if(def.requires !== undefined && !Array.isArray(def.requires)){
    throw new Error('registerSystem : `requires` doit être un tableau de typeName');
  }
}

