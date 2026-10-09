// moteur/js/shader-graph.js
// Fondation du graphe de shader (TSL) — un asset `graphShader` est la LOGIQUE pure (comme
// un Shader Unity) : nœuds, links, sorties. Il n'est jamais assigné directement à un objet —
// c'est un asset `material` (js/materials.js) qui le référence via `shaderId` et fournit les
// DONNÉES (`valeursParams`, l'équivalent des « Properties » d'un materiau Unity), qui overrident
// les défauts des nœuds `param.*` du graphe. Voir docs/superpowers/specs/2026-08-10-fondation-graphe-shader-design.md
// pour la fondation initiale — Shader/Materiau est une révision de son « Portée du graphe »,
// pas encore documentée dans un fichier de spec séparé.
//
// Fichier RÉELLEMENT PARTAGÉ éditeur/runtime (comme retargeting.js, voir son en-tête dans
// game-runtime.js) : chargé tel quel par l'éditeur ET embarqué par build.js. `resoudreTexture`,
// passé à buildMaterialFromGraph, est le seul point qui diffère entre les deux
// environnements — textureMaterial côté éditeur, textureMaterialRuntime côté game exporté.
//
// Le graphe stocké N'EST PAS le format natif de sérialisation de three (NodeLoader/toJSON) :
// vérifié pendant le design, ce format a besoin d'un registre de types de nœuds qui ne se peuple
// qu'en effet de bord du chargement de three/tsl (navigateur uniquement, via l'import map) —
// invérifiable dans ce harnais de test. Le graphe est donc {noeuds, links, sorties}, un format à
// nous, mais CHAQUE nœud est construit avec de vraies fonctions TSL (aucune sémantique de shader
// réinventée).

// inputs: noms des entrées attendues (déclarées dans `links`, dans cet ordre n'a pas
// d'importance — c'est un ensemble). construire(params, inputs, ctx) -> nœud TSL réel.
export const REGISTRY_GRAPH_SHADER = {
  'constant.float': {
    inputs: [],
    build: function(params){ return TSL.float(Number(params.value) || 0); }
  },
  // Vector 2/3/4 : dans Shader Graph, chaque COMPOSANTE est un port branchable, et le champ
  // n'apparaît que tant que rien n'y est branché. Le param homonyme reste la valeur par
  // défaut du port, donc un graphe écrit avant cette bascule rend exactement pareil.
  'constant.vec2': {
    inputs: ['x', 'y'],
    defaults: {x: componentDefault('x'), y: componentDefault('y')},
    build: function(params, inputs){ return TSL.vec2(inputs.x, inputs.y); }
  },
  'constant.vec3': {
    inputs: ['x', 'y', 'z'],
    defaults: {x: componentDefault('x'), y: componentDefault('y'), z: componentDefault('z')},
    build: function(params, inputs){ return TSL.vec3(inputs.x, inputs.y, inputs.z); }
  },
  'constant.vec4': {
    inputs: ['x', 'y', 'z', 'w'],
    defaults: {x: componentDefault('x'), y: componentDefault('y'), z: componentDefault('z'),
               w: componentDefault('w', 1)},
    build: function(params, inputs){ return TSL.vec4(inputs.x, inputs.y, inputs.z, inputs.w); }
  },
  'constant.color': {
    inputs: [],
    build: function(params){ return TSL.color(params.color || '#ffffff'); }
  },
  'uv': {
    inputs: [],
    build: function(){ return TSL.uv(); }
  },
  'time': {
    inputs: [],
    build: function(){ return TSL.time; }
  },
  'math.add': {
    inputs: ['a', 'b'],
    build: function(params, inputs){ return inputs.a.add(inputs.b); }
  },
  'math.sub': {
    inputs: ['a', 'b'],
    build: function(params, inputs){ return inputs.a.sub(inputs.b); }
  },
  'math.mul': {
    inputs: ['a', 'b'],
    build: function(params, inputs){ return inputs.a.mul(inputs.b); }
  },
  'math.mix': {
    inputs: ['a', 'b', 't'],
    build: function(params, inputs){ return TSL.mix(inputs.a, inputs.b, inputs.t); }
  },
  'math.clamp': {
    inputs: ['v', 'min', 'max'],
    defaults: {
      min: function(p){ return TSL.float(numberOr(p.min, 0)); },
      max: function(p){ return TSL.float(numberOr(p.max, 1)); }
    },
    build: function(params, inputs){ return TSL.clamp(inputs.v, inputs.min, inputs.max); }
  },
  'texture': {
    inputs: ['uv'],
    // Défaut par-entrée : TSL.uv() plutôt que le TSL.float(0) générique, un vec2 nul
    // n'aurait aucun sens comme coordonnée UV. Voir `defauts` sur buildNodeGraph.
    defaults: { uv: function(){ return TSL.uv(); } },
    build: function(params, inputs, ctx){
      const tex = ctx && ctx.resolveTexture ? ctx.resolveTexture(params.assetTexture) : null;
      if(!tex) return TSL.color('#000000');
      return TSL.texture(tex, inputs.uv);
    }
  },
  'math.step': {
    inputs: ['threshold', 'v'],
    build: function(params, inputs){ return TSL.step(inputs.threshold, inputs.v); }
  },
  'math.smoothstep': {
    inputs: ['min', 'max', 'v'],
    build: function(params, inputs){ return TSL.smoothstep(inputs.min, inputs.max, inputs.v); }
  },
  'math.remap': {
    inputs: ['v', 'fromMin', 'fromMax', 'toMin', 'toMax'],
    defaults: {
      fromMin: function(p){ return TSL.float(numberOr(p.eMin, 0)); },
      fromMax: function(p){ return TSL.float(numberOr(p.eMax, 1)); },
      toMin: function(p){ return TSL.float(numberOr(p.sMin, 0)); },
      toMax: function(p){ return TSL.float(numberOr(p.sMax, 1)); }
    },
    build: function(params, inputs){
      return TSL.remap(inputs.v, inputs.fromMin, inputs.fromMax, inputs.toMin, inputs.toMax);
    }
  },
  // Vector3 assemblé depuis trois entrées — le « Combine » de Shader Graph. Son inverse
  // (« Split ») demanderait plusieurs sorties par nœud, ce que ce format ne modélise pas.
  'vec.combine3': {
    inputs: ['x', 'y', 'z'],
    build: function(params, inputs){ return TSL.vec3(inputs.x, inputs.y, inputs.z); }
  },
  // ---- Géométrie et scène ----
  'geo.position': {
    inputs: [],
    build: function(params){
      if(params.space === 'world') return TSL.positionWorld;
      if(params.space === 'view') return TSL.positionView;
      return TSL.positionLocal;
    }
  },
  'geo.tangent': {
    inputs: [],
    build: function(params){
      return (params.space === 'world') ? TSL.tangentWorld : TSL.tangentLocal;
    }
  },
  'geo.vertexColor': {
    inputs: [],
    build: function(){ return TSL.vertexColor(); }
  },
  'geo.normale': {
    inputs: [],
    build: function(params){
      if(params.space === 'world') return TSL.normalWorld;
      if(params.space === 'view') return TSL.normalView;
      return TSL.normalLocal;
    }
  },
  'input.screenUv': {inputs: [], build: function(){ return TSL.screenUV; }},
  'input.viewDirection': {inputs: [], build: function(){ return TSL.positionViewDirection; }},
  // « Is Front Face » d'Unity. faceDirection rend +1 devant / -1 derrière : exploitable
  // directement dans un calcul, là où un booléen demanderait un branchement.
  'logic.isFrontFace': {inputs: [], build: function(){ return TSL.faceDirection; }},
  'input.cameraPosition': {inputs: [], build: function(){ return TSL.cameraPosition; }},
  // La couleur PORTÉE PAR LE MATÉRIAU (material.color), lue comme uniforme : c'est la seule
  // entrée du graphe qu'un script peut changer à chaque image (`node.material.color.set`). Les
  // propriétés, elles, sont figées dans le shader à sa construction.
  'input.materialColor': {inputs: [], build: function(){ return TSL.materialColor; }},
  // ---- UV ----
  'uv.tilingOffset': {
    inputs: ['uv', 'tiling', 'offset'],
    defaults: {
      uv: function(){ return TSL.uv(); },
      tiling: function(p){ return TSL.vec2(numberOr(p.tileX, 1), numberOr(p.tileY, 1)); },
      offset: function(p){ return TSL.vec2(numberOr(p.offsetX, 0), numberOr(p.offsetY, 0)); }
    },
    build: function(params, inputs){ return inputs.uv.mul(inputs.tiling).add(inputs.offset); }
  },
  'uv.rotate': {
    inputs: ['uv', 'angle', 'center'],
    defaults: {
      uv: function(){ return TSL.uv(); },
      angle: function(p){ return TSL.float(numberOr(p.angle, 0)); },
      center: function(p){ return TSL.vec2(numberOr(p.centerX, 0.5), numberOr(p.centerY, 0.5)); }
    },
    build: function(params, inputs){ return TSL.rotateUV(inputs.uv, inputs.angle, inputs.center); }
  },
  'uv.spherize': {
    inputs: ['uv', 'strength'],
    defaults: {uv: function(){ return TSL.uv(); }, strength: floatDefault('strength', 1)},
    build: function(params, inputs){ return TSL.spherizeUV(inputs.uv, inputs.strength); }
  },
  // ---- Artistic (Adjustment / Blend) ----
  'color.saturation': {
    inputs: ['v', 'amount'],
    defaults: {amount: floatDefault('amount', 1)},
    build: function(params, inputs){ return TSL.saturation(inputs.v, inputs.amount); }
  },
  'color.hue': {
    inputs: ['v', 'offset'],
    defaults: {offset: floatDefault('offset', 0)},
    build: function(params, inputs){ return TSL.hue(inputs.v, inputs.offset); }
  },
  'color.vibrance': {
    inputs: ['v', 'amount'],
    defaults: {amount: floatDefault('amount', 0)},
    build: function(params, inputs){ return TSL.vibrance(inputs.v, inputs.amount); }
  },
  'color.posterize': {
    inputs: ['v', 'steps'],
    defaults: {steps: floatDefault('steps', 4)},
    build: function(params, inputs){ return TSL.posterize(inputs.v, inputs.steps); }
  },
  // Le nœud « Blend » d'Unity : un mode, une base, un calque, une opacité. Les quatre modes
  // retenus sont ceux que three fournit tels quels ; en add un ne coûte qu'une ligne.
  'color.blend': {
    inputs: ['base', 'blend', 'opacity'],
    defaults: {opacity: floatDefault('opacity', 1)},
    build: function(params, inputs){
      const fn = MODES_BLEND_GRAPH_SHADER[params.mode] || 'blendOverlay';
      return TSL.mix(inputs.base, TSL[fn](inputs.base, inputs.blend), inputs.opacity);
    }
  },
  // « Fresnel Effect » : three n'a pas de fonction dédiée, mais la formule d'Unity tient en
  // une ligne de TSL — l'angle de vue rasant, élevé à une puissance.
  'math.fresnel': {
    inputs: ['normal', 'viewDir', 'power'],
    defaults: {
      normal: function(){ return TSL.normalWorld; },
      viewDir: function(){ return TSL.positionViewDirection; },
      power: floatDefault('power', 1)
    },
    build: function(params, inputs){
      return TSL.pow(TSL.oneMinus(TSL.saturate(TSL.dot(inputs.normal, inputs.viewDir))), inputs.power);
    }
  },
  // « Swizzle » : réordonne/extrait des composantes. Le masque est un param et non un port —
  // c'est une opération de compilation, elle ne peut pas dépendre d'une valeur calculée.
  'vec.swizzle': {
    inputs: ['v'],
    build: function(params, inputs){
      const mask = String(params.channels || 'x').replace(/[^xyzw]/g, '') || 'x';
      return inputs.v[mask];
    }
  },
  // ---- Procédural ----
  // Les fonctions `mx_*` sont les nœuds MaterialX embarqués par three : c'est ce sur quoi
  // Shader Graph s'appuie lui aussi pour son Simple Noise et son Voronoi. `echelle` multiplie
  // les UV avant échantillonnage — sans elle, un bruit sur des UV 0→1 ne montre presque rien.
  'procedural.bruit': {
    inputs: ['uv', 'scale'],
    defaults: { uv: function(){ return TSL.uv(); }, scale: scaleDefault(8) },
    build: function(params, inputs){ return TSL.mx_noise_float(inputs.uv.mul(inputs.scale)); }
  },
  'procedural.bruitFractal': {
    // octaves/lacunarite/falloff restent des params : mx_fractal_noise_float les veut en
    // nombres JS (ils pilotent une boucle deroulee a la compilation), pas en noeuds TSL.
    inputs: ['uv', 'scale'],
    defaults: { uv: function(){ return TSL.uv(); }, scale: scaleDefault(6) },
    build: function(params, inputs){
      return TSL.mx_fractal_noise_float(inputs.uv.mul(inputs.scale),
        Math.max(1, Math.round(numberOr(params.octaves, 3))), numberOr(params.lacunarite, 2),
        numberOr(params.falloff, 0.5), 1);
    }
  },
  'procedural.voronoi': {
    inputs: ['uv', 'scale', 'jitter'],
    defaults: {
      uv: function(){ return TSL.uv(); }, scale: scaleDefault(8),
      jitter: function(p){ return TSL.float(numberOr(p.desordre, 1)); }
    },
    build: function(params, inputs){
      return TSL.mx_worley_noise_float(inputs.uv.mul(inputs.scale), inputs.jitter);
    }
  },
  'procedural.cellules': {
    inputs: ['uv', 'scale'],
    defaults: { uv: function(){ return TSL.uv(); }, scale: scaleDefault(8) },
    build: function(params, inputs){ return TSL.mx_cell_noise_float(inputs.uv.mul(inputs.scale)); }
  },
  'procedural.damier': {
    inputs: ['uv', 'scale'],
    defaults: { uv: function(){ return TSL.uv(); }, scale: scaleDefault(8) },
    build: function(params, inputs){ return TSL.checker(inputs.uv.mul(inputs.scale)); }
  },
  // Nœuds « param.* » : point d'entrée nommé (`params.name`) que l'asset matériau qui
  // référence ce shader peut surcharger via sa propre `valeursParams` (voir materials.js,
  // assignShaderOnMaterial/applyMaterialOn) — l'équivalent des « Properties »
  // exposées par un Shader Graph Unity. Sans override, la valeur par défaut du nœud
  // (`params.defaultValue`/`defaultTextureAsset`) s'applique.
  // Renvoi vers une propriété du BLACKBOARD (`asset.properties`), comme dans Shader Graph :
  // la propriété existe indépendamment du graphe, et le même `propertyId` peut être posé
  // autant de fois qu'on veut sur le plan. Les nœuds `param.*` ci-dessous sont l'ANCIEN
  // modèle (une propriété = un nœud unique portant son défaut) : ils restent constructibles
  // pour les graphes qui n'ont pas encore été rouverts dans l'éditeur, qui les convertit.
  //
  // `uv` ne sert qu'aux propriétés de texture ; sur les autres, l'entrée reste sans effet
  // (l'éditeur ne dessine d'ailleurs le port que pour une texture).
  'property.ref': {
    inputs: ['uv'],
    defaults: { uv: function(){ return TSL.uv(); } },
    build: function(params, inputs, ctx){
      const prop = (ctx && ctx.property) ? ctx.property(params.propertyId) : null;
      return buildPropertyGraphShader(prop, ctx, inputs.uv);
    }
  },
  'param.float': {
    inputs: [],
    build: function(params, inputs, ctx){
      const v = valueParam(params, ctx, 'defaultValue');
      return TSL.float(Number(v) || 0);
    }
  },
  'param.vec3': {
    inputs: [],
    build: function(params, inputs, ctx){
      const v = valueParam(params, ctx, null);
      if(v && typeof v === 'object') return TSL.vec3(Number(v.x) || 0, Number(v.y) || 0, Number(v.z) || 0);
      return TSL.vec3(Number(params.x) || 0, Number(params.y) || 0, Number(params.z) || 0);
    }
  },
  'param.color': {
    inputs: [],
    build: function(params, inputs, ctx){
      return TSL.color(valueParam(params, ctx, 'defaultValue') || '#ffffff');
    }
  },
  'param.texture': {
    inputs: ['uv'],
    defaults: { uv: function(){ return TSL.uv(); } },
    build: function(params, inputs, ctx){
      const idAsset = valueParam(params, ctx, 'defaultTextureAsset');
      const tex = ctx && ctx.resolveTexture ? ctx.resolveTexture(idAsset) : null;
      if(!tex) return TSL.color('#000000');
      return TSL.texture(tex, inputs.uv);
    }
  }
};

// `Number(x) || defaut` trahit sur les valeurs légitimement nulles : une échelle de 0 ou un
// décalage de 0 y repassaient silencieusement au défaut. On ne retombe sur le défaut que si
// la valeur n'est pas un nombre exploitable.
// Defaut de l'entree `scale` d'un noeud procedural : la valeur du param homonyme, pour qu'un
// graphe ecrit avant que l'echelle ne devienne un port garde exactement son rendu.
// Défaut d'un port qui reprend le param homonyme du nœud (`amount`, `power`, `strength`…).
export function floatDefault(key, fallback){
  return function(p){ return TSL.float(numberOr(p[key], fallback)); };
}

// Idem pour une composante de Vector 2/3/4.
export function componentDefault(key, fallback){
  return function(p){ return TSL.float(numberOr(p[key], fallback || 0)); };
}

export const MODES_BLEND_GRAPH_SHADER = {overlay:'blendOverlay', screen:'blendScreen',
  burn:'blendBurn', dodge:'blendDodge'};

export function scaleDefault(fallback){
  return function(p){ return TSL.float(numberOr(p.scale, fallback)); };
}

export function numberOr(v, defaultValue){
  const n = Number(v);
  return Number.isFinite(n) ? n : defaultValue;
}

// Opérateurs à UNE entrée : même forme, seule la fonction TSL change. Une table plutôt que
// quinze blocs identiques — add un opérateur ne coûte qu'une ligne, et le bâtisseur n'est
// jamais touché (voir l'en-tête : « add un type = add une entrée »).
export const UNARY_GRAPH_SHADER = {
  'math.sin':'sin', 'math.cos':'cos', 'math.tan':'tan', 'math.abs':'abs',
  'math.floor':'floor', 'math.ceil':'ceil', 'math.fract':'fract', 'math.round':'round',
  'math.sign':'sign', 'math.sqrt':'sqrt', 'math.negate':'negate', 'math.oneMinus':'oneMinus',
  'math.saturate':'saturate', 'math.normalize':'normalize', 'math.length':'length',
  'math.exp':'exp', 'math.log':'log', 'math.log2':'log2', 'math.inverseSqrt':'inverseSqrt',
  'math.acos':'acos', 'math.asin':'asin', 'math.atan':'atan',
  'math.degrees':'degrees', 'math.radians':'radians', 'math.trunc':'trunc',
  'math.ddx':'dFdx', 'math.ddy':'dFdy', 'math.ddxy':'fwidth'
};
Object.keys(UNARY_GRAPH_SHADER).forEach(function(type){
  const fn = UNARY_GRAPH_SHADER[type];
  REGISTRY_GRAPH_SHADER[type] = {
    inputs: ['v'],
    build: function(params, inputs){ return TSL[fn](inputs.v); }
  };
});

export const BINARY_GRAPH_SHADER = {
  'math.div':'div', 'math.pow':'pow', 'math.mod':'mod', 'math.min':'min', 'math.max':'max',
  'math.dot':'dot', 'math.cross':'cross', 'math.distance':'distance', 'math.reflect':'reflect'
};
Object.keys(BINARY_GRAPH_SHADER).forEach(function(type){
  const fn = BINARY_GRAPH_SHADER[type];
  REGISTRY_GRAPH_SHADER[type] = {
    inputs: ['a', 'b'],
    build: function(params, inputs){ return TSL[fn](inputs.a, inputs.b); }
  };
});

// Valeur effective d'un nœud param.* : celle fournie par le matériau instance
// (`ctx.valeursParams[params.name]`) si présente, sinon le défaut du graphe lui-même
// (`params[cleDefaut]`). `cleDefaut` null pour param.vec3, dont le défaut vit dans
// x/y/z à plat plutôt que dans un unique field.
// Valeur effective d'une propriété du blackboard : celle fournie par le matériau instance
// (`ctx.valuesParams[nom]`), sinon le défaut porté par la propriété elle-même.
// Nœud TSL d'une propriété du blackboard. Partagé entre le nœud `property.ref` du graphe et
// l'API `graph.property(nom)` offerte au code TSL : les deux chemins doivent rendre le MÊME
// nœud, sinon lire une propriété depuis le code ne voudrait pas dire la même chose que la lire
// depuis le plan.
export function buildPropertyGraphShader(prop, ctx, uvNode){
  if(!prop) return TSL.float(0);
  const v = valuePropertyGraphShader(prop, ctx);
  // LES PROPRIÉTÉS NUMÉRIQUES SONT DES UNIFORMES, modifiables en jeu sans reconstruire le
  // shader (l'équivalent de material.SetFloat/SetColor d'Unity) : voir setShaderProperty.
  // Une constante aurait figé la valeur à la construction — un script ne pouvait alors rien
  // animer, sauf en recompilant le matériau à chaque image.
  const uniform = uniformPropertyGraphShader(prop, v, ctx);
  if(uniform) return uniform;
  if(prop.type === 'color') return TSL.color(v || '#ffffff');
  if(prop.type === 'vec3'){
    const o = (v && typeof v === 'object') ? v : {};
    return TSL.vec3(numberOr(o.x, 0), numberOr(o.y, 0), numberOr(o.z, 0));
  }
  if(prop.type === 'texture'){
    const tex = (ctx && ctx.resolveTexture) ? ctx.resolveTexture(v) : null;
    if(!tex) return TSL.color('#000000');
    return TSL.texture(tex, uvNode || TSL.uv());
  }
  return TSL.float(numberOr(v, 0));
}

// Un uniforme PAR PROPRIÉTÉ et par matériau : deux nœuds qui lisent la même propriété
// partagent la même valeur. Rend null quand l'environnement n'a pas d'uniformes (faux TSL des
// tests) ou pour une texture : l'appelant retombe alors sur une constante.
export function uniformPropertyGraphShader(prop, v, ctx){
  if(!ctx || !ctx.uniforms || !prop.name || typeof TSL === 'undefined' || !TSL.uniform) return null;
  if(prop.type !== 'color' && prop.type !== 'vec3' && prop.type !== 'float') return null;
  if(ctx.uniforms[prop.name]) return ctx.uniforms[prop.name];
  let u;
  if(prop.type === 'color') u = TSL.uniform(new THREE.Color(v || '#ffffff'));
  else if(prop.type === 'vec3'){
    const o = (v && typeof v === 'object') ? v : {};
    u = TSL.uniform(new THREE.Vector3(numberOr(o.x, 0), numberOr(o.y, 0), numberOr(o.z, 0)));
  } else u = TSL.uniform(numberOr(v, 0));
  ctx.uniforms[prop.name] = u;
  return u;
}

/**
 * Change une propriété d'un matériau construit depuis un graphe, EN JEU, sans le reconstruire.
 * `value` : un nombre, une couleur ('#rrggbb' ou THREE.Color), un vecteur ({x,y,z} ou [x,y,z]).
 * Rend false si le matériau n'a pas cette propriété.
 *
 * Chaque maillage porte sa PROPRE instance du matériau : pour changer tout ce qui utilise un
 * asset, il faut l'appliquer à chacune.
 */
export function setShaderProperty(material, name, value){
  const props = material && material.userData && material.userData.shaderProperties;
  const u = props && props[name];
  if(!u) return false;
  const cur = u.value;
  if(cur && cur.isColor) cur.set(value);
  else if(cur && cur.isVector3){
    if(Array.isArray(value)) cur.set(value[0], value[1], value[2]);
    else cur.set(numberOr(value.x, cur.x), numberOr(value.y, cur.y), numberOr(value.z, cur.z));
  } else u.value = numberOr(value, cur);
  return true;
}

export function valuePropertyGraphShader(prop, ctx){
  const vp = ctx && ctx.valuesParams;
  if(vp && prop.name && vp[prop.name] !== undefined) return vp[prop.name];
  return prop.defaultValue;
}

export function valueParam(params, ctx, keyDefault){
  const vp = ctx && ctx.valuesParams;
  if(vp && params.name && vp[params.name] !== undefined) return vp[params.name];
  return keyDefault ? params[keyDefault] : undefined;
}

// Construit récursivement le nœud `id` du graphe `def` ({noeuds, links}), en mémoïsant dans
// `hidden` (partagé entre tous les appels d'un même bâtisseur : un nœud branché sur deux sorties
// n'est construit qu'une fois). `ctx` porte ce dont certains types de nœuds ont besoin en plus
// de leurs params (ex. `resoudreTexture` pour le type `texture`).
export function buildNodeGraph(id, def, hidden, ctx){
  if(hidden[id]) return hidden[id];
  const nodeDef = (def.nodes || []).find(function(n){ return n.id === id; });
  if(!nodeDef) throw new Error('graphe de shader : nœud « ' + id + ' » introuvable');
  const inputRegistry = REGISTRY_GRAPH_SHADER[nodeDef.type];
  if(!inputRegistry) throw new Error('graphe de shader : type de nœud inconnu « ' + nodeDef.type + ' »');
  const inputs = {};
  inputRegistry.inputs.forEach(function(nameInput){
    const link = (def.links || []).find(function(l){
      return l.node === id && l.entry === nameInput;
    });
    // Entrée non branchée : défaut neutre TSL.float(0), sauf si le registre déclare un
    // défaut type-approprié pour cette entrée précise (ex. TSL.uv() pour l'entrée `uv`
    // de `texture` — un vec2 nul n'a pas de sens comme coordonnée). Un défaut par-opérateur
    // plus fin (1 pour math.mul, 0.5 pour le t de math.mix...) reste à faire quand l'éditeur
    // nodal (spec suivante) exposera vraiment des entrées débranchables à l'utilisateur.
    const defaultInput = inputRegistry.defaults && inputRegistry.defaults[nameInput];
    inputs[nameInput] = link
      ? buildNodeGraph(link.source, def, hidden, ctx)
      : (defaultInput ? defaultInput(nodeDef.params || {}) : TSL.float(0));
  });
  const node = inputRegistry.build(nodeDef.params || {}, inputs, ctx);
  hidden[id] = node;
  return node;
}

// Slots du matériau three pilotables par une sortie du graphe, selon la cible. `unlit` n'a
// qu'un seul slot sensé (colorNode) — MeshBasicNodeMaterial n'a pas de roughness/metalness/etc.
// Les slots du Master, calqués sur les blocs du Master Node de Shader Graph : `position` est
// le bloc VERTEX (position locale des sommets, seul slot évalué au stage vertex — d'où sa
// présence même en unlit, déformer un maillage n'ayant rien à voir avec l'éclairage), le reste
// est le bloc FRAGMENT.
//
// `smoothness` porte le nom ET la convention d'Unity : 1 = lisse. three raisonne à l'inverse
// (roughness), d'où l'inversion de TRANSFORMS_SLOT_GRAPH_SHADER. La clé `roughness` reste
// acceptée telle quelle pour les graphes écrits avant, sans inversion : leur rendu ne bouge pas.
export const SLOTS_FRAGMENT_LIT = {color:'colorNode', smoothness:'roughnessNode',
  roughness:'roughnessNode', metalness:'metalnessNode', normal:'normalNode',
  emissive:'emissiveNode', ao:'aoNode', opacity:'opacityNode', alphaTest:'alphaTestNode'};

// Cible « Physical » : tout le lit, plus les couches de MeshPhysicalNodeMaterial (vernis,
// velours, iridescence, transmission…) que le PBR standard n'a pas.
export const SLOTS_PHYSICAL = {clearcoat:'clearcoatNode', clearcoatRoughness:'clearcoatRoughnessNode',
  sheen:'sheenNode', sheenRoughness:'sheenRoughnessNode', iridescence:'iridescenceNode',
  iridescenceThickness:'iridescenceThicknessNode', transmission:'transmissionNode',
  thickness:'thicknessNode', ior:'iorNode', specularColor:'specularColorNode',
  anisotropy:'anisotropyNode'};

export const SLOTS_BY_TARGET = {
  lit: Object.assign({position:'positionNode'}, SLOTS_FRAGMENT_LIT),
  physical: Object.assign({position:'positionNode'}, SLOTS_FRAGMENT_LIT, SLOTS_PHYSICAL),
  unlit: {color:'colorNode', opacity:'opacityNode', alphaTest:'alphaTestNode',
          position:'positionNode'}
};

// Un slot dont la valeur du graphe n'est pas celle attendue par three s'ajuste ici, une fois,
// plutôt qu'au fil des appelants.
export const TRANSFORMS_SLOT_GRAPH_SHADER = {
  smoothness: function(node){ return TSL.oneMinus(node); }
};

export const CLASSES_MATERIAL_GRAPH_SHADER = {unlit:'MeshBasicNodeMaterial',
  physical:'MeshPhysicalNodeMaterial', lit:'MeshStandardNodeMaterial'};

// Construit le THREE.NodeMaterial complet d'un asset grapheShader (la LOGIQUE). `resoudreTexture(assetId)`
// est le seul point qui diffère entre éditeur (textureMaterial) et runtime (textureMaterialRuntime)
// — voir l'en-tête de ce fichier. `valeursParams` vient du MATÉRIAU instance qui référence ce
// shader (asset.shaderId côté materials.js) — override des nœuds `param.*` du graphe, voir
// REGISTRY_GRAPH_SHADER/valueParam ci-dessus.
export function buildMaterialFromGraph(asset, resolveTexture, valuesParams){
  const nameClass = CLASSES_MATERIAL_GRAPH_SHADER[asset.target] || CLASSES_MATERIAL_GRAPH_SHADER.lit;
  const m = new THREE[nameClass]();
  const slots = SLOTS_BY_TARGET[asset.target] || SLOTS_BY_TARGET.lit;
  const hidden = {};
  const properties = asset.properties || [];
  const ctx = {
    resolveTexture: resolveTexture, valuesParams: valuesParams || {}, uniforms: {},
    property: function(id){
      return properties.find(function(pr){ return pr.id === id; }) || null;
    }
  };
  // Les uniformes des propriétés, par nom : c'est ce que lit setShaderProperty.
  if(!m.userData) m.userData = {};
  m.userData.shaderProperties = ctx.uniforms;
  const outputs = asset.outputs || {};
  Object.keys(outputs).forEach(function(key){
    const idNode = outputs[key];
    const field = slots[key];
    if(!idNode || !field) return;   // slot non branché, ou sans correspondance pour cette cible
    const node = buildNodeGraph(idNode, asset, hidden, ctx);
    const transform = TRANSFORMS_SLOT_GRAPH_SHADER[key];
    m[field] = transform ? transform(node) : node;
  });
  return m;
}

// Graphe d'un grapheShader tout juste créé depuis le panneau Assets (voir assets.js) : une
// couleur grise unie, cible lit — le même défaut visuel qu'un MATERIAL_DEFAULT (materials.js).
export const GRAPH_SHADER_DEFAULT = {
  target: 'lit',
  properties: [],
  nodes: [{id:'n1', type:'constant.color', params:{color:'#8899aa'}}],
  links: [],
  outputs: {color:'n1'},
  layout: {n1: {x:0, y:0}}
};

export function createAssetGraphShader(){
  const n = assets.filter(function(x){ return x.kind === 'graphShader'; }).length + 1;
  const a = Object.assign({id:'a'+(nextAssetId()), kind:'graphShader', name:'Graphe de shader ' + n,
    folder:folderCurrent}, JSON.parse(JSON.stringify(GRAPH_SHADER_DEFAULT)));
  assets.push(a);
  updateProject();
  // openEditorGraphShader vit dans shader-graph-editor.js, chargé APRÈS ce fichier
  // (comme openEditorScriptAsset pour createAssetScript, assets.js) — toujours défini au
  // moment du clic réel, mais pas forcément dans les harnais de test qui ne chargent que
  // ce fichier-ci.
  if(typeof openEditorGraphShader === 'function') openEditorGraphShader(a);
  else selectAsset(a);
  return a;
}

// Guardé : ce fichier est aussi chargé par external-editor.html (REGISTRY_GRAPH_SHADER y
// est nécessaire à l'éditeur nodal, voir shader-graph-editor.js), qui n'a pas ce bouton.
// Le bouton dédié a disparu : la création passe par « ＋ Créer » (ASSET_CREATORS, js/assets.js).


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.BINARY_GRAPH_SHADER = BINARY_GRAPH_SHADER;
globalThis.CLASSES_MATERIAL_GRAPH_SHADER = CLASSES_MATERIAL_GRAPH_SHADER;
globalThis.MODES_BLEND_GRAPH_SHADER = MODES_BLEND_GRAPH_SHADER;
globalThis.REGISTRY_GRAPH_SHADER = REGISTRY_GRAPH_SHADER;
globalThis.SLOTS_BY_TARGET = SLOTS_BY_TARGET;
globalThis.TRANSFORMS_SLOT_GRAPH_SHADER = TRANSFORMS_SLOT_GRAPH_SHADER;
globalThis.UNARY_GRAPH_SHADER = UNARY_GRAPH_SHADER;
globalThis.buildMaterialFromGraph = buildMaterialFromGraph;
globalThis.createAssetGraphShader = createAssetGraphShader;
globalThis.numberOr = numberOr;