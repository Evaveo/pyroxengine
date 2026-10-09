// ---------- Registre neutre de l'interface ----------
// Il ne SAIT rien et ne FAIT rien : il retient ce qui a été déclaré, et rend l'ordre de
// déclaration. C'est le tiers qui casse un cycle réel : form.js a besoin de savoir si son
// panneau est visible, dock.js a besoin des tailles minimales portées par le descripteur.
// Sans lui, `dock → panel → form → dock`. Avec lui, chacun ne parle qu'au registre.
//
// Deux niveaux, à ne pas confondre :
//   · le DESCRIPTEUR — les données déclarées par l'auteur du panneau. JAMAIS mutées : un
//     plugin qui déclare un panneau doit pouvoir relire ce qu'il a écrit.
//   · l'objet RÉSOLU — ce que panel.js dépose après construction (hôte DOM, tailles
//     effectives, état de visibilité). C'est celui que dock.js lit.

export const UIRegistry = (function(){
  const panelsById = new Map();      // id -> descripteur
  const resolvedById = new Map();    // id -> objet vivant
  const fieldTypes = new Map();      // type -> {create, write, read}

  function declarePanel(descriptor){
    if(!descriptor || !descriptor.id){
      throw new Error('un panneau doit porter un identifiant (`id`)');
    }
    panelsById.set(descriptor.id, descriptor);
    return descriptor.id;
  }

  function declareFieldType(def){
    if(!def || !def.type) throw new Error('un type de champ doit porter un `type`');
    if(typeof def.create !== 'function') throw new Error('le type de champ « ' + def.type + ' » n\'a pas de `create`');
    fieldTypes.set(def.type, def);
    return def.type;
  }

  return {
    declarePanel: declarePanel,
    declareFieldType: declareFieldType,
    panel: function(id){ return panelsById.get(id) || null; },
    panels: function(){ return Array.from(panelsById.values()); },
    fieldType: function(type){ return fieldTypes.get(type) || null; },
    fieldTypes: function(){ return Array.from(fieldTypes.keys()); },
    resolve: function(id, live){
      const d = panelsById.get(id);
      if(!d) throw new Error('panneau inconnu : ' + id);
      // Le descripteur est copié, jamais muté.
      resolvedById.set(id, Object.assign({}, d, live || {}));
      return resolvedById.get(id);
    },
    resolved: function(id){ return resolvedById.get(id) || null; },
    forget: function(id){ panelsById.delete(id); resolvedById.delete(id); }
  };
})();
