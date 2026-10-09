// moteur/js/shader-graph-editor.js
// Éditeur nodal (canvas) d'un asset grapheShader, dans une VRAIE fenêtre séparée — comme
// Shader Graph d'Unity dans son propre tab — via le protocole window.open + postMessage
// déjà posé par external-editor.js (voir son en-tête : "éditeur de nœuds TSL... même
// protocole"). Consomme le format posé par shader-graph.js (REGISTRY_GRAPH_SHADER pour les
// entrées de chaque type, SLOTS_BY_TARGET pour les slots de sortie selon `cible`). Fichier
// ÉDITEUR SEUL : pas de nœud requis pour RENDRE un grapheShader (ça, c'est shader-graph.js,
// embarqué par build.js) — celui-ci n'a donc rien à faire dans le build exporté.
//
// Chargé par LES DEUX pages (editor.html ET external-editor.html) — voir external-editor.js
// pour le même patron (rôle décidé par la présence de `window.opener`).
//
// Les mutations de graphe (add/supprimer un nœud, brancher un link, poser une sortie,
// éditer la valeur inline d'un port non branché) sont des fonctions PURES ci-dessous, testées
// par graphe-shader-editeur.test.mjs sans DOM. Le reste (rendu du canvas, glisser-déposer,
// clic droit, molette) est vérifié manuellement en navigateur, comme tout ce qui touche à
// l'interaction directe (pas de navigateur dans le harnais de test — voir CLAUDE.md).

// Métadonnées d'ÉDITION pour chaque type du registre (libellé affiché, champs de params
// propres au nœud — PAS ses entrées/ports, voir TYPE_INPUT_GRAPH_SHADER plus bas).
// Délibérément séparé de REGISTRY_GRAPH_SHADER (qui, lui, est embarqué au runtime) : ce ne
// sont que des libellés, aucune fonction TSL.
// `category` reprend l'arborescence du « Create Node » de Shader Graph (Input/…, Math/…),
// et `cat` la famille qui colore la bar de titre du nœud — là aussi comme Unity, où la
// couleur dit d'un coup d'œil de quelle famille est un nœud.
import { warnOnceMissing } from './dev-guards.js';
import { lastAssetEditedBy, openEditorExternal } from './external-editor.js';

export const META_NODES_GRAPH_SHADER = {
  'constant.float':  {caption:'Float', category:'Input / Basic', cat:'input', fields:[
    {key:'value', type:'number', label:'', defaultValue:0}]},
  // Vector 2/3/4 : aucun champ propre, leurs composantes sont des PORTS (voir le registre).
  'constant.vec2':   {caption:'Vector 2', category:'Input / Basic', cat:'input', fields:[]},
  'constant.vec3':   {caption:'Vector 3', category:'Input / Basic', cat:'input', fields:[]},
  'constant.vec4':   {caption:'Vector 4', category:'Input / Basic', cat:'input', fields:[]},
  'constant.color':{caption:'Color', category:'Input / Basic', cat:'input', fields:[
    {key:'color', type:'color', label:'', defaultValue:'#8899aa'}]},
  'time':             {caption:'Time', category:'Input / Scene', cat:'input', fields:[]},
  'uv':                {caption:'UV', category:'Input / Geometry', cat:'input', fields:[]},
  'texture':           {caption:'Sample Texture', category:'Input / Texture', cat:'texture', fields:[
    {key:'assetTexture', type:'texture', label:'Texture', defaultValue:null}]},
  'math.add':          {caption:'Add', category:'Math / Basic', cat:'math', fields:[]},
  'math.sub':          {caption:'Subtract', category:'Math / Basic', cat:'math', fields:[]},
  'math.mul':          {caption:'Multiply', category:'Math / Basic', cat:'math', fields:[]},
  'math.mix':          {caption:'Lerp', category:'Math / Interpolation', cat:'math', fields:[]},
  'math.clamp':        {caption:'Clamp', category:'Math / Range', cat:'math', fields:[]},
  'geo.tangent': {caption:'Tangent Vector', category:'Input / Geometry', cat:'input', fields:[
    {key:'space', type:'list', label:'Espace', defaultValue:'local',
     options:[['local', 'Local'], ['world', 'Monde']]}]},
  'geo.vertexColor': {caption:'Vertex Color', category:'Input / Geometry', cat:'input', fields:[]},
  'input.viewDirection': {caption:'View Direction', category:'Input / Geometry', cat:'input', fields:[]},
  'logic.isFrontFace': {caption:'Is Front Face', category:'Utility / Logic', cat:'input', fields:[]},
  'uv.spherize': {caption:'Spherize', category:'UV', cat:'uv', fields:[]},
  'color.saturation': {caption:'Saturation', category:'Artistic / Adjustment', cat:'artistic', fields:[]},
  'color.hue': {caption:'Hue', category:'Artistic / Adjustment', cat:'artistic', fields:[]},
  'color.vibrance': {caption:'Vibrance', category:'Artistic / Adjustment', cat:'artistic', fields:[]},
  'color.posterize': {caption:'Posterize', category:'Artistic / Adjustment', cat:'artistic', fields:[]},
  'color.blend': {caption:'Blend', category:'Artistic / Blend', cat:'artistic', fields:[
    {key:'mode', type:'list', label:'Mode', defaultValue:'overlay',
     options:[['overlay', 'Overlay'], ['screen', 'Screen'], ['burn', 'Burn'], ['dodge', 'Dodge']]}]},
  'math.fresnel': {caption:'Fresnel Effect', category:'Math / Vector', cat:'math', fields:[]},
  'vec.swizzle': {caption:'Swizzle', category:'Channel', cat:'math', fields:[
    {key:'channels', type:'text', label:'Masque', defaultValue:'xyz'}]},
  // Le nœud de renvoi vers une propriété : jamais dans le « Create Node » (on le pose en
  // glissant une propriété depuis le blackboard, comme dans Shader Graph), son libellé étant
  // le nom de la propriété visée — calculé au rendu, pas ici.
  'property.ref': {caption:'Propriété', category:'Property', cat:'property', hidden:true, fields:[]},
  'param.float':       {caption:'Property : Float', category:'Property', cat:'property', hidden:true, fields:[
    {key:'name', type:'text', label:'Nom exposé', defaultValue:'valeur'},
    {key:'defaultValue', type:'number', label:'Défaut', defaultValue:0}]},
  'param.vec3':        {caption:'Property : Vector3', category:'Property', cat:'property', hidden:true, fields:[
    {key:'name', type:'text', label:'Nom exposé', defaultValue:'valeur'},
    {key:'x', type:'number', label:'X défaut', defaultValue:0}, {key:'y', type:'number', label:'Y défaut', defaultValue:0},
    {key:'z', type:'number', label:'Z défaut', defaultValue:0}]},
  'param.color':     {caption:'Property : Color', category:'Property', cat:'property', hidden:true, fields:[
    {key:'name', type:'text', label:'Nom exposé', defaultValue:'color'},
    {key:'defaultValue', type:'color', label:'Défaut', defaultValue:'#8899aa'}]},
  'param.texture':     {caption:'Property : Texture', category:'Property', cat:'property', hidden:true, fields:[
    {key:'name', type:'text', label:'Nom exposé', defaultValue:'texture'},
    {key:'defaultTextureAsset', type:'texture', label:'Défaut', defaultValue:null}]}
};

// Opérateurs SANS champ propre — leur seule donnée, ce sont leurs entrées. Table compacte
// `type → [libellé, catégorie, famille]` plutôt qu'un bloc par nœud, même intention que les
// tables UNAIRES/BINAIRES de shader-graph.js. Les libellés et l'arborescence sont ceux de
// Shader Graph, à la lettre : quelqu'un qui vient d'Unity doit retrouver ses nœuds au même
// endroit et sous le même nom.
export const META_OPERATORS_GRAPH_SHADER = {
  'math.div':      ['Divide', 'Math / Basic'],
  'math.pow':      ['Power', 'Math / Basic'],
  'math.sqrt':     ['Square Root', 'Math / Basic'],
  'math.abs':      ['Absolute', 'Math / Advanced'],
  'math.negate':   ['Negate', 'Math / Advanced'],
  'math.mod':      ['Modulo', 'Math / Advanced'],
  'math.normalize':['Normalize', 'Math / Advanced'],
  'math.length':   ['Length', 'Math / Advanced'],
  'math.min':      ['Minimum', 'Math / Range'],
  'math.max':      ['Maximum', 'Math / Range'],
  'math.fract':    ['Fraction', 'Math / Range'],
  'math.oneMinus': ['One Minus', 'Math / Range'],
  'math.saturate': ['Saturate', 'Math / Range'],
  'math.floor':    ['Floor', 'Math / Round'],
  'math.ceil':     ['Ceiling', 'Math / Round'],
  'math.round':    ['Round', 'Math / Round'],
  'math.sign':     ['Sign', 'Math / Round'],
  'math.step':     ['Step', 'Math / Round'],
  'math.sin':      ['Sine', 'Math / Trigonometry'],
  'math.cos':      ['Cosine', 'Math / Trigonometry'],
  'math.tan':      ['Tangent', 'Math / Trigonometry'],
  'math.dot':      ['Dot Product', 'Math / Vector'],
  'math.cross':    ['Cross Product', 'Math / Vector'],
  'math.distance': ['Distance', 'Math / Vector'],
  'math.smoothstep':['Smoothstep', 'Math / Interpolation'],
  'vec.combine3':  ['Combine', 'Channel', 'math'],
  'input.cameraPosition':['Camera Position', 'Input / Scene', 'input'],
  'input.materialColor':['Material Color', 'Input / Scene', 'input'],
  'input.screenUv':['Screen Position', 'Input / Geometry', 'input'],
  // Le reste des Math de Shader Graph, aux mêmes noms et aux mêmes rayons.
  'math.exp':      ['Exponential', 'Math / Advanced'],
  'math.log':      ['Logarithm', 'Math / Advanced'],
  'math.log2':     ['Log Base 2', 'Math / Advanced'],
  'math.inverseSqrt':['Reciprocal Square Root', 'Math / Advanced'],
  'math.reflect':  ['Reflection', 'Math / Vector'],
  'math.acos':     ['Arccosine', 'Math / Trigonometry'],
  'math.asin':     ['Arcsine', 'Math / Trigonometry'],
  'math.atan':     ['Arctangent', 'Math / Trigonometry'],
  'math.degrees':  ['Radians To Degrees', 'Math / Trigonometry'],
  'math.radians':  ['Degrees To Radians', 'Math / Trigonometry'],
  'math.trunc':    ['Truncate', 'Math / Round'],
  'math.ddx':      ['DDX', 'Math / Derivative'],
  'math.ddy':      ['DDY', 'Math / Derivative'],
  'math.ddxy':     ['DDXY', 'Math / Derivative']
};
Object.keys(META_OPERATORS_GRAPH_SHADER).forEach(function(type){
  const d = META_OPERATORS_GRAPH_SHADER[type];
  META_NODES_GRAPH_SHADER[type] = {caption:d[0], category:d[1], cat:d[2] || 'math', fields:[]};
});

// Nœuds à champs propres : le reste de la palette procédurale/UV/géométrie.
Object.assign(META_NODES_GRAPH_SHADER, {
  'math.remap': {caption:'Remap', category:'Math / Range', cat:'math', fields:[]},
  'geo.position': {caption:'Position', category:'Input / Geometry', cat:'input', fields:[
    {key:'space', type:'list', label:'Espace', defaultValue:'local',
     options:[['local', 'Local'], ['world', 'Monde'], ['view', 'Vue']]}]},
  'geo.normale': {caption:'Normal Vector', category:'Input / Geometry', cat:'input', fields:[
    {key:'space', type:'list', label:'Espace', defaultValue:'local',
     options:[['local', 'Local'], ['world', 'Monde'], ['view', 'Vue']]}]},
  // Tiling/Offset, Rotate, Échelle des procéduraux : ce sont des PORTS et non des champs
  // figés — comme dans Shader Graph, où l'on branche un Time sur l'offset pour faire défiler
  // une texture. Les anciens params (tileX, angle, scale…) restent lus comme VALEUR PAR DÉFAUT
  // du port tant qu'il n'est pas branché (voir `defaults` du registre, shader-graph.js).
  'uv.tilingOffset': {caption:'Tiling And Offset', category:'UV', cat:'uv', fields:[]},
  'uv.rotate': {caption:'Rotate', category:'UV', cat:'uv', fields:[]},
  'procedural.bruit': {caption:'Simple Noise', category:'Procedural / Noise', cat:'proc', fields:[]},
  'procedural.bruitFractal': {caption:'Fractal Noise', category:'Procedural / Noise', cat:'proc', fields:[
    {key:'octaves', type:'number', label:'Octaves', defaultValue:3},
    {key:'lacunarite', type:'number', label:'Lacunarité', defaultValue:2},
    {key:'falloff', type:'number', label:'Atténuation', defaultValue:0.5}]},
  'procedural.voronoi': {caption:'Voronoi', category:'Procedural / Noise', cat:'proc', fields:[]},
  'procedural.cellules': {caption:'Cell Noise', category:'Procedural / Noise', cat:'proc', fields:[]},
  'procedural.damier': {caption:'Checkerboard', category:'Procedural', cat:'proc', fields:[]}
});

// Ordre d'affichage des catégories dans le « Create Node ». Une catégorie qu'un nœud
// déclarerait sans figurer ici est simplement rejetée à la fin, jamais perdue.
export const CATEGORIES_GRAPH_SHADER = ['Input / Basic', 'Input / Geometry', 'Input / Scene',
  'Input / Texture', 'Artistic / Adjustment', 'Artistic / Blend', 'UV',
  'Procedural', 'Procedural / Noise',
  'Math / Basic', 'Math / Advanced', 'Math / Range', 'Math / Round', 'Math / Trigonometry',
  'Math / Vector', 'Math / Interpolation', 'Math / Derivative', 'Channel',
  'Utility / Logic', 'Property'];

// Type de widget inline pour une ENTRÉE (port) non branchée — Unity affiche un champ éditable
// directement sur le port plutôt que d'obliger à glisser un nœud séparé. Seules les entrées
// scalaires ont un widget ; `uv` (vec2) n'en a pas de sensé, on laisse le défaut TSL implicite.
export const TYPE_INPUT_GRAPH_SHADER = {
  'math.add': {a:'number', b:'number'}, 'math.sub': {a:'number', b:'number'},
  'math.mul': {a:'number', b:'number'}, 'math.mix': {a:'number', b:'number', t:'number'},
  'math.clamp': {v:'number', min:'number', max:'number'},
  'math.step': {threshold:'number', v:'number'},
  'math.smoothstep': {min:'number', max:'number', v:'number'},
  'math.remap': {v:'number', fromMin:'number', fromMax:'number', toMin:'number', toMax:'number'},
  'vec.combine3': {x:'number', y:'number', z:'number'},
  'uv.tilingOffset': {tiling:'vec2', offset:'vec2'},
  'uv.rotate': {angle:'number', center:'vec2'},
  'procedural.bruit': {scale:'number'},
  'procedural.bruitFractal': {scale:'number'},
  'procedural.voronoi': {scale:'number', jitter:'number'},
  'procedural.cellules': {scale:'number'},
  'procedural.damier': {scale:'number'},
  'constant.vec2': {x:'number', y:'number'},
  'constant.vec3': {x:'number', y:'number', z:'number'},
  'constant.vec4': {x:'number', y:'number', z:'number', w:'number'},
  'uv.spherize': {strength:'number'},
  'color.saturation': {amount:'number'}, 'color.hue': {offset:'number'},
  'color.vibrance': {amount:'number'}, 'color.posterize': {steps:'number'},
  'color.blend': {opacity:'number'},
  'math.fresnel': {power:'number'}
};

// Valeur affichée sur un port non branché tant qu'aucun nœud __auto ne le pilote. Sans cette
// table, un Tiling And Offset ouvert dans l'éditeur montrerait « 0 » sur des ports qui, au
// rendu, valent 1 — et un graphe d'avant la bascule champs → ports afficherait 0 là où ses
// anciens params disent 2. On lit donc le param historique, exactement comme le registre.
// Mêmes défauts que ceux du registre (shader-graph.js), côté affichage : un port montre la
// valeur avec laquelle il est RÉELLEMENT construit tant que rien n'y est branché.
export function component(key, fallback){
  return function(p){ return numberOr(p[key], fallback || 0); };
}
export const field = component;   // même forme, nom lisible pour les params qui ne sont pas des composantes

export const DEFAULT_INPUT_GRAPH_SHADER = {
  'uv.tilingOffset': {
    tiling: function(p){ return {x:numberOr(p.tileX, 1), y:numberOr(p.tileY, 1)}; },
    offset: function(p){ return {x:numberOr(p.offsetX, 0), y:numberOr(p.offsetY, 0)}; }
  },
  'uv.rotate': {
    angle: function(p){ return numberOr(p.angle, 0); },
    center: function(p){ return {x:numberOr(p.centerX, 0.5), y:numberOr(p.centerY, 0.5)}; }
  },
  'math.clamp': {
    min: function(p){ return numberOr(p.min, 0); }, max: function(p){ return numberOr(p.max, 1); }
  },
  'math.remap': {
    fromMin: function(p){ return numberOr(p.eMin, 0); }, fromMax: function(p){ return numberOr(p.eMax, 1); },
    toMin: function(p){ return numberOr(p.sMin, 0); }, toMax: function(p){ return numberOr(p.sMax, 1); }
  },
  'procedural.bruit': {scale: function(p){ return numberOr(p.scale, 8); }},
  'procedural.bruitFractal': {scale: function(p){ return numberOr(p.scale, 6); }},
  'procedural.voronoi': {scale: function(p){ return numberOr(p.scale, 8); },
                         jitter: function(p){ return numberOr(p.desordre, 1); }},
  'procedural.cellules': {scale: function(p){ return numberOr(p.scale, 8); }},
  'procedural.damier': {scale: function(p){ return numberOr(p.scale, 8); }},
  'constant.vec2': {x: component('x'), y: component('y')},
  'constant.vec3': {x: component('x'), y: component('y'), z: component('z')},
  'constant.vec4': {x: component('x'), y: component('y'), z: component('z'), w: component('w', 1)},
  'uv.spherize': {strength: field('strength', 1)},
  'color.saturation': {amount: field('amount', 1)},
  'color.hue': {offset: field('offset', 0)},
  'color.vibrance': {amount: field('amount', 0)},
  'color.posterize': {steps: field('steps', 4)},
  'color.blend': {opacity: field('opacity', 1)},
  'math.fresnel': {power: field('power', 1)}
};

export function defaultInputGraphShader(typeNode, nameInput, params, typeField){
  const table = DEFAULT_INPUT_GRAPH_SHADER[typeNode];
  if(table && table[nameInput]) return table[nameInput](params || {});
  if(typeField === 'vec2') return {x:0, y:0};
  if(typeField === 'color') return '#8899aa';
  return 0;
}

// ---------- Types de port (le « filtre » de Shader Graph) ----------
// Chaque port porte un type ; un branchement n'est proposé que s'il a un sens. `dynamic` =
// le type dépend de ce qu'on branche (un Add rend ce qu'on lui donne) — il accepte tout.
// `out` absent ⇒ dynamic.
export const TYPE_PORTS_GRAPH_SHADER = {
  'constant.float': {out:'float'}, 'time': {out:'float'}, 'param.float': {out:'float'},
  'constant.vec2': {out:'vec2'}, 'uv': {out:'vec2'}, 'input.screenUv': {out:'vec2'},
  'constant.vec3': {out:'vec3'}, 'constant.color': {out:'vec3'}, 'param.vec3': {out:'vec3'},
  'param.color': {out:'vec3'}, 'input.cameraPosition': {out:'vec3'},
  'input.materialColor': {out:'vec3'},
  'geo.position': {out:'vec3'}, 'geo.normale': {out:'vec3'},
  'vec.combine3': {out:'vec3', in:{x:'float', y:'float', z:'float'}},
  'texture': {out:'vec4', in:{uv:'vec2'}},
  'param.texture': {out:'vec4', in:{uv:'vec2'}},
  'uv.tilingOffset': {out:'vec2', in:{uv:'vec2', tiling:'vec2', offset:'vec2'}},
  'uv.rotate': {out:'vec2', in:{uv:'vec2', angle:'float', center:'vec2'}},
  'procedural.bruit': {out:'float', in:{uv:'vec2', scale:'float'}},
  'procedural.bruitFractal': {out:'float', in:{uv:'vec2', scale:'float'}},
  'procedural.voronoi': {out:'float', in:{uv:'vec2', scale:'float', jitter:'float'}},
  'procedural.cellules': {out:'float', in:{uv:'vec2', scale:'float'}},
  'procedural.damier': {out:'float', in:{uv:'vec2', scale:'float'}},
  'math.clamp': {in:{min:'float', max:'float'}},
  'math.remap': {in:{fromMin:'float', fromMax:'float', toMin:'float', toMax:'float'}},
  'math.mix': {in:{t:'float'}},
  'math.length': {out:'float'}, 'math.distance': {out:'float'}, 'math.dot': {out:'float'},
  'constant.vec2': {out:'vec2', in:{x:'float', y:'float'}},
  'constant.vec3': {out:'vec3', in:{x:'float', y:'float', z:'float'}},
  'constant.vec4': {out:'vec4', in:{x:'float', y:'float', z:'float', w:'float'}},
  'geo.tangent': {out:'vec3'}, 'geo.vertexColor': {out:'vec4'},
  'input.viewDirection': {out:'vec3'}, 'logic.isFrontFace': {out:'float'},
  'uv.spherize': {out:'vec2', in:{uv:'vec2', strength:'float'}},
  'color.saturation': {in:{amount:'float'}}, 'color.hue': {in:{offset:'float'}},
  'color.vibrance': {in:{amount:'float'}}, 'color.posterize': {in:{steps:'float'}},
  'color.blend': {in:{opacity:'float'}},
  'math.fresnel': {out:'float', in:{normal:'vec3', viewDir:'vec3', power:'float'}},
  'math.reflect': {out:'vec3'},
  'math.exp': {out:'float'}, 'math.log': {out:'float'}, 'math.log2': {out:'float'},
  'math.inverseSqrt': {out:'float'}, 'math.acos': {out:'float'}, 'math.asin': {out:'float'},
  'math.atan': {out:'float'}, 'math.degrees': {out:'float'}, 'math.radians': {out:'float'}
};

// Types attendus par les slots du Master. `position` est un vec3 (position locale du sommet),
// les slots scalaires un float — y brancher une couleur n'aurait aucun sens.
export const TYPES_SLOT_GRAPH_SHADER = {color:'vec3', smoothness:'float', roughness:'float',
  metalness:'float', normal:'vec3', emissive:'vec3', ao:'float', opacity:'float',
  alphaTest:'float', position:'vec3',
  clearcoat:'float', clearcoatRoughness:'float', sheen:'vec3', sheenRoughness:'float',
  iridescence:'float', iridescenceThickness:'float', transmission:'float', thickness:'float',
  ior:'float', specularColor:'vec3', anisotropy:'float'};

export const RANK_TYPE_GRAPH_SHADER = {float:1, vec2:2, vec3:3, vec4:4};

// Slots où la diffusion d'un scalaire est un PIÈGE et non une commodité. Brancher un bruit
// (float) sur Position pose (n, n, n) à chaque sommet : tout le maillage s'écrase sur la
// diagonale et « disparaît ». Ces slots-là exigent donc un vrai vecteur — comme le bloc
// Vertex de Shader Graph, dont les entrées sont des Vector 3.
export const SLOTS_VECTOR_STRICT_GRAPH_SHADER = {
  position: 'Position (Vertex) attend un vecteur 3 : partez du nœud Position et ajoutez-y '
    + 'votre déplacement (par exemple Normal Vector × un bruit).',
  normal: 'Normal attend un vecteur 3, pas une valeur scalaire.'
};

// Un scalaire se diffuse sur n'importe quel vecteur (TSL le fait, Shader Graph aussi) ; un
// vec4 se laisse lire comme un vec3 (une texture branchée sur une couleur, cas courant). Le
// reste est refusé : brancher un vec3 sur une entrée float ne veut rien dire.
export function portsCompatibleGraphShader(typeOut, typeIn){
  if(!typeOut || !typeIn || typeOut === 'dynamic' || typeIn === 'dynamic') return true;
  if(typeOut === typeIn) return true;
  if(typeOut === 'float') return true;
  if(typeOut === 'vec4' && typeIn === 'vec3') return true;
  return false;
}

export function typeInputGraphShader(asset, idNode, nameInput){
  const node = (asset.nodes || []).find(function(n){ return n.id === idNode; });
  const def = node && TYPE_PORTS_GRAPH_SHADER[node.type];
  return (def && def.in && def.in[nameInput]) || 'dynamic';
}

// Type de sortie d'un nœud. Les opérateurs `dynamic` (Add, Multiply…) prennent le type le
// plus large de ce qui les alimente : c'est ce que fait TSL à la compilation, et sans cette
// remontée un Multiply de deux vec3 se présenterait comme « inconnu » à toute la chaîne.
export function typeOutputGraphShader(asset, idNode, vus){
  const node = (asset.nodes || []).find(function(n){ return n.id === idNode; });
  if(!node) return 'dynamic';
  if(node.type === 'property.ref'){
    const prop = (asset.properties || []).find(function(pr){
      return pr.id === (node.params || {}).propertyId;
    });
    return (prop && TYPES_OUT_PROPERTY_GRAPH_SHADER[prop.type]) || 'dynamic';
  }
  const def = TYPE_PORTS_GRAPH_SHADER[node.type];
  if(def && def.out) return def.out;
  vus = vus || new Set();
  if(vus.has(idNode)) return 'dynamic';   // graphe en cours d'édition : jamais de récursion infinie
  vus.add(idNode);
  let best = null;
  (asset.links || []).forEach(function(l){
    if(l.node !== idNode) return;
    if(def && def.in && def.in[l.entry] === 'float') return;   // entrée de contrôle, pas la donnée
    const t = typeOutputGraphShader(asset, l.source, vus);
    if(!RANK_TYPE_GRAPH_SHADER[t]) return;
    if(!best || RANK_TYPE_GRAPH_SHADER[t] > RANK_TYPE_GRAPH_SHADER[best]) best = t;
  });
  return best || 'dynamic';
}

// Les opérateurs qui travaillent sur des VECTEURS n'ont pas de widget scalaire : proposer un
// field « 0 » sur l'entrée d'un Normalize ou d'un Dot Product laisserait croire qu'un nombre
// y a un sens.
export const INPUTS_VECTOR_GRAPH_SHADER = ['math.normalize', 'math.length', 'math.dot',
  'math.cross', 'math.distance'];

// Complété depuis les tables d'opérateurs de shader-graph.js (chargé avant celui-ci) plutôt
// que recopié : une ligne ajoutée là-bas donne ici son champ inline sans rien toucher.
if(typeof UNARY_GRAPH_SHADER !== 'undefined'){
  Object.keys(UNARY_GRAPH_SHADER).forEach(function(type){
    if(INPUTS_VECTOR_GRAPH_SHADER.indexOf(type) === -1) TYPE_INPUT_GRAPH_SHADER[type] = {v:'number'};
  });
}
if(typeof BINARY_GRAPH_SHADER !== 'undefined'){
  Object.keys(BINARY_GRAPH_SHADER).forEach(function(type){
    if(INPUTS_VECTOR_GRAPH_SHADER.indexOf(type) === -1) TYPE_INPUT_GRAPH_SHADER[type] = {a:'number', b:'number'};
  });
}
export function typeFieldInputGraphShader(typeNode, nameInput){
  return (TYPE_INPUT_GRAPH_SHADER[typeNode] && TYPE_INPUT_GRAPH_SHADER[typeNode][nameInput]) || null;
}

// ---------- Blackboard : les propriétés vivent hors du graphe ----------
// Comme dans Shader Graph : une propriété existe dans le blackboard qu'elle soit posée sur le
// plan ou non, son défaut s'édite DANS la liste, et on peut en déposer autant de nœuds qu'on
// veut (tous renvoyant à la même propriété). Le nœud, lui, ne porte qu'un `propertyId`.
export const TYPES_PROPERTY_GRAPH_SHADER = {
  float:   {caption:'Float',    defaultValue:0},
  vec3:    {caption:'Vector 3', defaultValue:{x:0, y:0, z:0}},
  color:   {caption:'Color',    defaultValue:'#8899aa'},
  texture: {caption:'Texture',  defaultValue:null}
};

// Type de la SORTIE d'un nœud de propriété, selon le type de la propriété visée.
export const TYPES_OUT_PROPERTY_GRAPH_SHADER = {float:'float', vec3:'vec3', color:'vec3', texture:'vec4'};

export function idPropertyGraphShaderFree(asset){
  const taken = new Set((asset.properties || []).map(function(p){ return p.id; }));
  let n = (asset.properties || []).length + 1;
  while(taken.has('p' + n)) n++;
  return 'p' + n;
}

// Le NOM est la clé que le matériau instance utilise dans `valuesParams` : deux propriétés
// qui le partageraient seraient indiscernables côté matériau.
export function nameFreePropertyGraphShader(asset, base, idIgnored){
  const taken = new Set((asset.properties || [])
    .filter(function(p){ return p.id !== idIgnored; })
    .map(function(p){ return p.name; }));
  if(!taken.has(base)) return base;
  let n = 2;
  while(taken.has(base + ' ' + n)) n++;
  return base + ' ' + n;
}

export function addPropertyGraphShader(asset, type, name){
  const def = TYPES_PROPERTY_GRAPH_SHADER[type] ? type : 'float';
  const meta = TYPES_PROPERTY_GRAPH_SHADER[def];
  asset.properties = asset.properties || [];
  const prop = {id: idPropertyGraphShaderFree(asset), type: def,
    name: nameFreePropertyGraphShader(asset, name || meta.caption),
    defaultValue: JSON.parse(JSON.stringify(meta.defaultValue))};
  asset.properties.push(prop);
  return prop;
}

export function propertyGraphShader(asset, id){
  return (asset.properties || []).find(function(p){ return p.id === id; }) || null;
}

export function propertyOfNodeGraphShader(asset, node){
  if(!node || node.type !== 'property.ref') return null;
  return propertyGraphShader(asset, (node.params || {}).propertyId);
}

export function renamePropertyGraphShader(asset, id, name){
  const prop = propertyGraphShader(asset, id);
  if(!prop) return null;
  prop.name = nameFreePropertyGraphShader(asset, String(name || '').trim() || 'Propriété', id);
  return prop.name;
}

// Supprimer une propriété emporte les nœuds qui y renvoyaient : les laisser en place
// donnerait des nœuds qui ne désignent plus rien (Shader Graph les retire aussi).
export function deletePropertyGraphShader(asset, id){
  asset.properties = (asset.properties || []).filter(function(p){ return p.id !== id; });
  (asset.nodes || []).filter(function(n){
    return n.type === 'property.ref' && (n.params || {}).propertyId === id;
  }).map(function(n){ return n.id; })
    .forEach(function(idNode){ deleteNodeGraphShader(asset, idNode); });
}

export function addNodePropertyGraphShader(asset, idProperty, x, y){
  const id = addNodeGraphShader(asset, 'property.ref', x, y);
  const node = asset.nodes.find(function(n){ return n.id === id; });
  node.params = {propertyId: idProperty};
  return id;
}

// Conversion de l'ANCIEN modèle (une propriété = un nœud `param.*` portant son nom et son
// défaut) vers le blackboard. Deux nœuds param de même nom et même type désignaient déjà la
// même propriété côté matériau : ils fusionnent donc en une seule entrée, et deviennent deux
// renvois — ce qui est exactement ce que l'ancien modèle ne savait pas exprimer.
export function migratePropertiesGraphShader(asset){
  let count = 0;
  (asset.nodes || []).forEach(function(n){
    if(String(n.type).indexOf('param.') !== 0) return;
    const type = n.type.replace('param.', '');
    const params = n.params || {};
    const name = String(params.name || '').trim() || TYPES_PROPERTY_GRAPH_SHADER[type].caption;
    let prop = (asset.properties || []).find(function(p){
      return p.name === name && p.type === type;
    });
    if(!prop){
      prop = addPropertyGraphShader(asset, type, name);
      prop.defaultValue = type === 'vec3'
        ? {x:numberOr(params.x, 0), y:numberOr(params.y, 0), z:numberOr(params.z, 0)}
        : type === 'texture' ? (params.defaultTextureAsset || null)
        : type === 'color' ? (params.defaultValue || '#8899aa')
        : numberOr(params.defaultValue, 0);
    }
    n.type = 'property.ref';
    n.params = {propertyId: prop.id};
    count++;
  });
  return count;
}

// Un id de nœud LIBRE dans cet asset (jamais Date.now() — voir MIGRATIONS/serialization.js :
// interdit dans le harnais de test node:vm, et un compteer déterministe suffit très bien ici).
export function idNodeGraphShaderFree(asset){
  const taken = new Set((asset.nodes || []).map(function(n){ return n.id; }));
  let n = (asset.nodes || []).length + 1;
  while(taken.has('n' + n)) n++;
  return 'n' + n;
}

export function addNodeGraphShader(asset, type, x, y){
  const meta = META_NODES_GRAPH_SHADER[type];
  const params = {};
  (meta ? meta.fields : []).forEach(function(c){ params[c.key] = c.defaultValue; });
  const id = idNodeGraphShaderFree(asset);
  asset.nodes = asset.nodes || [];
  asset.links = asset.links || [];
  asset.outputs = asset.outputs || {};
  asset.layout = asset.layout || {};
  asset.nodes.push({id:id, type:type, params:params});
  asset.layout[id] = {x:x || 0, y:y || 0};
  return id;
}

export function deleteNodeGraphShader(asset, id){
  asset.nodes = (asset.nodes || []).filter(function(n){ return n.id !== id; });
  asset.links = (asset.links || []).filter(function(l){ return l.node !== id && l.source !== id; });
  Object.keys(asset.outputs || {}).forEach(function(key){
    if(asset.outputs[key] === id) asset.outputs[key] = null;
  });
  if(asset.layout) delete asset.layout[id];
}

// Un link va de `source` vers `node` (les données circulent source → node). Brancher
// `source` sur `noeudCible` referme donc une boucle si `source` est DÉJÀ atteignable depuis
// `noeudCible` en suivant les links. Ce n'est pas un raffinement d'UX : buildNodeGraph
// (shader-graph.js) descend récursivement et ne pose sa mémoïsation qu'APRÈS construction —
// un cycle y part en récursion infinie, donc en RangeError, pas en message d'erreur lisible.
// Shader Graph refuse le branchement pour la même raison.
export function wouldCreateCycleGraphShader(asset, nodeTarget, source){
  if(!source || !nodeTarget) return false;
  if(source === nodeTarget) return true;
  const links = asset.links || [];
  const vus = new Set();
  const pile = [nodeTarget];
  while(pile.length){
    const current = pile.pop();
    if(current === source) return true;
    if(vus.has(current)) continue;
    vus.add(current);
    links.forEach(function(l){ if(l.source === current) pile.push(l.node); });
  }
  return false;
}

// source falsy = débranche (supprime le link s'il existait). Retourne false — sans rien
// modifier — si le branchement demandé fermerait une boucle.
export function setLinkGraphShader(asset, nodeTarget, entry, source){
  if(source && wouldCreateCycleGraphShader(asset, nodeTarget, source)) return false;
  asset.links = (asset.links || []).filter(function(l){
    return !(l.node === nodeTarget && l.entry === entry);
  });
  if(source) asset.links.push({node:nodeTarget, entry:entry, source:source});
  return true;
}

export function setOutputGraphShader(asset, key, nodeId){
  asset.outputs = asset.outputs || {};
  asset.outputs[key] = nodeId || null;
}

// ---------- Valeur inline sur un port non branché ----------
// Comme Unity : taper une valeur directement sur un port crée/réutilise en coulisse un nœud
// constante.* marqué __auto (jamais dessiné comme un nœud à part, voir geRendreNoeud) — le
// FORMAT de graphe (noeuds/links) ne change pas, ce sont juste des fonctions de commodité.
export const TYPE_CONSTANT_BY_FIELD = {number:'constant.float', color:'constant.color', vec2:'constant.vec2'};

export function nodeAutoOf(asset, nodeTarget, entry){
  const link = (asset.links || []).find(function(l){ return l.node === nodeTarget && l.entry === entry; });
  if(!link) return null;
  const source = (asset.nodes || []).find(function(n){ return n.id === link.source; });
  return (source && source.params && source.params.__auto) ? source : null;
}

// `component` ('x' ou 'y') n'a de sens que pour un port vec2 : ses deux champs éditent le
// MÊME nœud constant.vec2, chacun sa composante — taper dans Y ne doit pas effacer X.
// `valeurInitiale` fournit l'état complet du port au moment où le nœud auto est créé, sinon
// éditer une seule composante remettrait l'autre à zéro.
export function setValueInputGraphShader(asset, nodeTarget, entry, typeField, value, component, valueInitial){
  const auto = nodeAutoOf(asset, nodeTarget, entry);
  function write(node){
    if(typeField === 'color') node.params.color = value;
    else if(typeField === 'vec2') node.params[component === 'y' ? 'y' : 'x'] = Number(value);
    else node.params.value = Number(value);
  }
  if(auto){ write(auto); return auto.id; }
  const type = TYPE_CONSTANT_BY_FIELD[typeField] || 'constant.float';
  const posTarget = (asset.layout && asset.layout[nodeTarget]) || {x:0, y:0};
  const id = addNodeGraphShader(asset, type, posTarget.x - 170, posTarget.y);
  const node = asset.nodes.find(function(n){ return n.id === id; });
  node.params.__auto = true;
  if(typeField === 'vec2' && valueInitial && typeof valueInitial === 'object'){
    node.params.x = Number(valueInitial.x) || 0;
    node.params.y = Number(valueInitial.y) || 0;
  }
  write(node);
  setLinkGraphShader(asset, nodeTarget, entry, id);
  return id;
}

export function unbindInputGraphShader(asset, nodeTarget, entry){
  const auto = nodeAutoOf(asset, nodeTarget, entry);
  setLinkGraphShader(asset, nodeTarget, entry, null);
  if(auto) deleteNodeGraphShader(asset, auto.id);
}

// ---------- Génération du code TSL équivalent au graphe ----------
// Lecture seule, pour comprendre ce que le graphe fabrique vraiment et pour recopier un bout
// de shader dans un script ou un plugin. Ce n'est PAS le chemin de rendu : le matériau reste
// construit par buildMaterialFromGraph (shader-graph.js), jamais par ce texte.
//
// Les opérateurs unaires et binaires sont DÉRIVÉS des mêmes tables que le rendu
// (UNARY_GRAPH_SHADER / BINARY_GRAPH_SHADER) : ils ne peuvent pas diverger. Les autres
// portent leur modèle ici, en double du `construire` du registre — un test vérifie au moins
// que chaque type constructible a bien son modèle, mais la FIDÉLITÉ de l'expression, elle,
// reste à la charge de qui modifie l'un des deux. Le signaler plutôt que de le taire.
export const CODE_NODE_GRAPH_SHADER = {
  'constant.float':  function(p){ return 'float(' + numberOr(p.value, 0) + ')'; },
  'constant.vec3':   function(p, e){ return 'vec3(' + e.x + ', ' + e.y + ', ' + e.z + ')'; },
  'constant.vec4':   function(p, e){ return 'vec4(' + e.x + ', ' + e.y + ', ' + e.z + ', ' + e.w + ')'; },
  'geo.tangent':     function(p){ return p.space === 'world' ? 'tangentWorld' : 'tangentLocal'; },
  'geo.vertexColor': function(){ return 'vertexColor()'; },
  'input.viewDirection': function(){ return 'positionViewDirection'; },
  'logic.isFrontFace': function(){ return 'faceDirection'; },
  'uv.spherize':     function(p, e){ return 'spherizeUV(' + e.uv + ', ' + e.strength + ')'; },
  'color.saturation':function(p, e){ return 'saturation(' + e.v + ', ' + e.amount + ')'; },
  'color.hue':       function(p, e){ return 'hue(' + e.v + ', ' + e.offset + ')'; },
  'color.vibrance':  function(p, e){ return 'vibrance(' + e.v + ', ' + e.amount + ')'; },
  'color.posterize': function(p, e){ return 'posterize(' + e.v + ', ' + e.steps + ')'; },
  'color.blend':     function(p, e){
    const fn = MODES_BLEND_GRAPH_SHADER[p.mode] || 'blendOverlay';
    // Opacité laissée à 1 (le défaut, port non branché) : le fondu ne sert à rien et,
    // surtout, il se relirait en un nœud Lerp de plus à chaque aller-retour.
    if(e.opacity === 'float(1)') return fn + '(' + e.base + ', ' + e.blend + ')';
    return 'mix(' + e.base + ', ' + fn + '(' + e.base + ', ' + e.blend + '), ' + e.opacity + ')'; },
  'math.fresnel':    function(p, e){ return 'pow(oneMinus(saturate(dot(' + e.normal + ', '
    + e.viewDir + '))), ' + e.power + ')'; },
  'vec.swizzle':     function(p, e){ return e.v + '.' + (String(p.channels || 'x').replace(/[^xyzw]/g, '') || 'x'); },
  'constant.vec2':   function(p, e){ return 'vec2(' + e.x + ', ' + e.y + ')'; },
  'constant.color':function(p){ return 'color(\'' + (p.color || '#ffffff') + '\')'; },
  'uv':               function(){ return 'uv()'; },
  'time':            function(){ return 'time'; },
  'math.add':         function(p, e){ return e.a + '.add(' + e.b + ')'; },
  'math.sub':         function(p, e){ return e.a + '.sub(' + e.b + ')'; },
  'math.mul':         function(p, e){ return e.a + '.mul(' + e.b + ')'; },
  'math.mix':         function(p, e){ return 'mix(' + e.a + ', ' + e.b + ', ' + e.t + ')'; },
  'math.clamp':       function(p, e){ return 'clamp(' + e.v + ', ' + e.min + ', ' + e.max + ')'; },
  'math.step':        function(p, e){ return 'step(' + e.threshold + ', ' + e.v + ')'; },
  'math.smoothstep':  function(p, e){ return 'smoothstep(' + e.min + ', ' + e.max + ', ' + e.v + ')'; },
  'math.remap':       function(p, e){ return 'remap(' + e.v + ', ' + e.fromMin + ', ' + e.fromMax
    + ', ' + e.toMin + ', ' + e.toMax + ')'; },
  'vec.combine3':     function(p, e){ return 'vec3(' + e.x + ', ' + e.y + ', ' + e.z + ')'; },
  'texture':          function(p, e){ return 'texture(graph.texture(\'' + (p.assetTexture || '') + '\'), ' + e.uv + ')'; },
  'geo.position':     function(p){ return p.space === 'world' ? 'positionWorld' : 'positionLocal'; },
  'geo.normale':      function(p){
    return p.space === 'world' ? 'normalWorld' : (p.space === 'view' ? 'normalView' : 'normalLocal'); },
  'input.screenUv':   function(){ return 'screenUV'; },
  'input.cameraPosition': function(){ return 'cameraPosition'; },
  'input.materialColor': function(){ return 'materialColor'; },
  'uv.tilingOffset':  function(p, e){ return e.uv + '.mul(' + e.tiling + ').add(' + e.offset + ')'; },
  'uv.rotate':        function(p, e){ return 'rotateUV(' + e.uv + ', ' + e.angle + ', ' + e.center + ')'; },
  'procedural.bruit': function(p, e){ return 'mx_noise_float(' + e.uv + '.mul(' + e.scale + '))'; },
  'procedural.bruitFractal': function(p, e){ return 'mx_fractal_noise_float(' + e.uv + '.mul(' + e.scale
    + '), ' + Math.max(1, Math.round(numberOr(p.octaves, 3))) + ', '
    + numberOr(p.lacunarite, 2) + ', ' + numberOr(p.falloff, 0.5) + ', 1)'; },
  'procedural.voronoi': function(p, e){ return 'mx_worley_noise_float(' + e.uv + '.mul(' + e.scale
    + '), ' + e.jitter + ')'; },
  'procedural.cellules': function(p, e){ return 'mx_cell_noise_float(' + e.uv + '.mul(' + e.scale + '))'; },
  'procedural.damier':function(p, e){ return 'checker(' + e.uv + '.mul(' + e.scale + '))'; },
  'param.float':      function(p){ return 'graph.property(\'' + (p.name || '') + '\')'; },
  'param.vec3':       function(p){ return 'graph.property(\'' + (p.name || '') + '\')'; },
  'param.color':    function(p){ return 'graph.property(\'' + (p.name || '') + '\')'; },
  'param.texture':    function(p, e){ return 'graph.property(\'' + (p.name || '') + '\', ' + e.uv + ')'; },
  // Le modèle a besoin du graphe pour retrouver la propriété visée : c'est le seul, d'où le
  // troisième argument passé à TOUS les modèles par generateCodeTslFromGraph.
  'property.ref':     function(p, e, asset){
    const prop = ((asset || {}).properties || []).find(function(pr){ return pr.id === p.propertyId; });
    if(!prop) return 'float(0) /* propriété supprimée */';
    // La propriété est lue par son NOM, et porte son défaut : la ligne suffit donc à la
    // DÉCLARER. Écrire `graph.property('Vitesse', 0.5)` dans le code crée l'entrée au
    // blackboard si elle n'y est pas — les deux vues partagent la même liste.
    // Une texture s'échantillonne, d'où sa forme à elle (`graph.sample`), qui prend les UV.
    return prop.type === 'texture'
      ? 'graph.sample(\'' + prop.name + '\', ' + e.uv + ')'
      : 'graph.property(\'' + prop.name + '\', ' + codeDefaultPropertyGraphShader(prop) + ')';
  }
};
if(typeof UNARY_GRAPH_SHADER !== 'undefined'){
  Object.keys(UNARY_GRAPH_SHADER).forEach(function(type){
    const fn = UNARY_GRAPH_SHADER[type];
    CODE_NODE_GRAPH_SHADER[type] = function(p, e){ return fn + '(' + e.v + ')'; };
  });
}
if(typeof BINARY_GRAPH_SHADER !== 'undefined'){
  Object.keys(BINARY_GRAPH_SHADER).forEach(function(type){
    const fn = BINARY_GRAPH_SHADER[type];
    CODE_NODE_GRAPH_SHADER[type] = function(p, e){ return fn + '(' + e.a + ', ' + e.b + ')'; };
  });
}

// Noms TSL susceptibles d'apparaître dans le code produit : sert à n'écrire dans l'en-tête
// que ce dont le graphe se sert réellement.
export const NAMES_TSL_GRAPH_SHADER = ['float', 'vec2', 'vec3', 'vec4', 'color', 'uv', 'time', 'texture', 'mix',
  'tangentLocal', 'tangentWorld', 'vertexColor', 'positionViewDirection', 'faceDirection',
  'positionView', 'spherizeUV', 'saturation', 'hue', 'vibrance', 'posterize', 'oneMinus',
  'saturate', 'dot', 'pow', 'blendOverlay', 'blendScreen', 'blendBurn', 'blendDodge',
  'clamp', 'step', 'smoothstep', 'remap', 'rotateUV', 'checker', 'mx_noise_float',
  'mx_fractal_noise_float', 'mx_worley_noise_float', 'mx_cell_noise_float', 'positionLocal',
  'positionWorld', 'normalLocal', 'normalWorld', 'normalView', 'screenUV', 'cameraPosition', 'materialColor']
  .concat(typeof UNARY_GRAPH_SHADER !== 'undefined' ? Object.values(UNARY_GRAPH_SHADER) : [])
  .concat(typeof BINARY_GRAPH_SHADER !== 'undefined' ? Object.values(BINARY_GRAPH_SHADER) : []);

// Écriture TSL de la valeur par défaut d'une entrée non branchée — le pendant textuel des
// `defaults` du registre (shader-graph.js), qui, eux, rendent de vrais nœuds.
// Entrées RÉELLEMENT dessinées/consommées par un nœud. Seul `property.ref` en a de variables :
// une propriété de texture s'échantillonne, donc a une entrée `uv` ; une propriété de couleur
// ou de nombre n'a rien à échantillonner et ne doit pas afficher de port inutile.
export function inputsOfNodeGraphShader(asset, node){
  const def = (typeof REGISTRY_GRAPH_SHADER !== 'undefined') && REGISTRY_GRAPH_SHADER[node.type];
  if(!def) return [];
  if(node.type === 'property.ref'){
    const prop = (asset.properties || []).find(function(pr){
      return pr.id === (node.params || {}).propertyId;
    });
    return (prop && prop.type === 'texture') ? ['uv'] : [];
  }
  return def.inputs;
}

// Le défaut d'une propriété, écrit tel qu'on le relira : un nombre nu, une couleur en chaîne,
// un vec3 littéral.
export function codeDefaultPropertyGraphShader(prop){
  if(prop.type === 'color') return '\'' + (prop.defaultValue || '#8899aa') + '\'';
  if(prop.type === 'vec3'){
    const v = prop.defaultValue || {};
    return 'vec3(' + numberOr(v.x, 0) + ', ' + numberOr(v.y, 0) + ', ' + numberOr(v.z, 0) + ')';
  }
  return String(numberOr(prop.defaultValue, 0));
}

export function codeDefaultInputGraphShader(typeNode, nameInput, params, aDefault){
  if(nameInput === 'uv') return 'uv()';
  // Une composante non branchée de Vector 2/3/4 s'écrit NUE : `vec2(3, 3)`, et non
  // `vec2(float(3), float(3))`. Sans quoi l'aller-retour changerait de forme à chaque passage —
  // le paramètre deviendrait un nœud Float branché, qui se réécrirait, sans jamais se stabiliser.
  if(String(typeNode).indexOf('constant.vec') === 0){
    return String(numberOr(params[nameInput], nameInput === 'w' ? 1 : 0));
  }
  const table = DEFAULT_INPUT_GRAPH_SHADER[typeNode];
  if(table && table[nameInput]){
    const v = table[nameInput](params);
    if(v && typeof v === 'object') return 'vec2(' + numberOr(v.x, 0) + ', ' + numberOr(v.y, 0) + ')';
    return 'float(' + numberOr(v, 0) + ')';
  }
  return aDefault ? 'uv()' : 'float(0)';
}

export function generateCodeTslFromGraph(asset){
  const lines = [];
  const variables = {};
  let counter = 0;

  // Même descente récursive mémoïsée que buildNodeGraph : les dépendances d'un nœud
  // sont donc toujours déclarées AVANT lui, et un nœud partagé n'est écrit qu'une fois.
  function expression(id){
    if(variables[id]) return variables[id];
    const node = (asset.nodes || []).find(function(n){ return n.id === id; });
    if(!node) return 'float(0) /* nœud introuvable */';
    const def = (typeof REGISTRY_GRAPH_SHADER !== 'undefined') && REGISTRY_GRAPH_SHADER[node.type];
    const model = CODE_NODE_GRAPH_SHADER[node.type];
    if(!def || !model) return 'float(0) /* type inconnu : ' + node.type + ' */';
    const inputs = {};
    inputsOfNodeGraphShader(asset, node).forEach(function(name){
      const link = (asset.links || []).find(function(l){ return l.node === id && l.entry === name; });
      // Défaut d'une entrée non branchée. Le registre ne déclare de `defauts` que pour les
      // entrées `uv` ; tout le reste retombe sur float(0), comme buildNodeGraph.
      inputs[name] = link ? expression(link.source)
        : codeDefaultInputGraphShader(node.type, name, node.params || {}, !!(def.defaults && def.defaults[name]));
    });
    const v = 'n' + (++counter);
    variables[id] = v;
    lines.push('const ' + v + ' = ' + model(node.params || {}, inputs, asset) + ';');
    return v;
  }

  const slots = SLOTS_BY_TARGET[asset.target] || SLOTS_BY_TARGET.lit;
  // La cible en premier : elle décide des slots qui suivent, et permet de coller le texte
  // dans un graphe qui n'est pas encore dans le bon mode.
  const branchements = ['material.target = \'' + (asset.target || 'lit') + '\';'];
  Object.keys(asset.outputs || {}).forEach(function(key){
    const id = asset.outputs[key];
    if(!id || !slots[key]) return;
    if(!(asset.nodes || []).some(function(n){ return n.id === id; })) return;
    // `smoothness` s'écrit inversé, exactement comme le fait buildMaterialFromGraph.
    const v = expression(id);
    branchements.push('material.' + slots[key] + ' = '
      + (TRANSFORMS_SLOT_GRAPH_SHADER[key] ? 'oneMinus(' + v + ')' : v) + ';');
  });

  const body = lines.join('\n');
  // Les affectations comptent autant que le corps : `oneMinus` (Smoothness) n'apparaît QUE
  // là, et l'en-tête l'aurait oublié — le code produit n'aurait alors pas compilé.
  // Dédoublonné : `oneMinus` figure dans la table des unaires ET dans la liste explicite,
  // et `const { oneMinus, oneMinus } = TSL;` est une erreur de syntaxe.
  const utilises = Array.from(new Set(NAMES_TSL_GRAPH_SHADER)).filter(function(name){
    return new RegExp('\\b' + name + '\\b').test(body + '\n' + branchements.join('\n'));
  });
  const classe = CLASSES_MATERIAL_GRAPH_SHADER[asset.target] || CLASSES_MATERIAL_GRAPH_SHADER.lit;

  // Les propriétés que le graphe n'utilise (encore) nulle part n'apparaîtraient pas du tout :
  // le blackboard serait alors visible d'un seul côté. On les déclare en tête, où elles se
  // lisent — et se créent — comme les autres.
  const utiliseesParLeGraphe = new Set((asset.nodes || [])
    .filter(function(n){ return n.type === 'property.ref'; })
    .map(function(n){ return (n.params || {}).propertyId; }));
  const orphelines = (asset.properties || []).filter(function(pr){
    return !utiliseesParLeGraphe.has(pr.id);
  });
  const declarationsProperties = orphelines.length
    ? '// Propriétés du blackboard pas encore lues par le graphe. En ajouter une ici la crée.\n'
      + orphelines.map(function(pr){
          return pr.type === 'texture'
            ? 'graph.sample(\'' + pr.name + '\', uv());'
            : 'graph.property(\'' + pr.name + '\', ' + codeDefaultPropertyGraphShader(pr) + ');';
        }).join('\n') + '\n\n'
    : '';

  // Ce texte n'est pas un compte rendu : c'est l'AUTRE forme du graphe. « Appliquer au
  // graphe » le relit (parseGraphFromCodeTsl) et repose les nœuds et les liens qu'il décrit.
  return '// ' + (asset.name || 'Graphe de shader') + ' — le graphe, en TSL.\n'
    + '// Les deux formes disent la même chose : modifiez le plan, ce texte suit ; modifiez ce\n'
    + '// texte et « Appliquer au graphe » repose les nœuds et les liens correspondants.\n'
    + '//\n'
    + '// material est un THREE.' + classe + ', posé par la ligne « material.target » ci-dessous.\n'
    + '// graph.property(nom, défaut) lit une propriété du blackboard — et la CRÉE si elle n\'y\n'
    + '// est pas encore. graph.sample(nom, uv) pour une texture, graph.texture(id) pour un asset.\n'
    + '// Seul ce qui remonte au Master figure ici : un nœud branché à rien ne figure pas.\n\n'
    + (utilises.length ? 'const { ' + utilises.join(', ') + ' } = TSL;\n\n' : '')
    + declarationsProperties
    + (body ? body + '\n\n' : '')
    + (branchements.length ? branchements.join('\n') + '\n' : '// aucune sortie branchée\n');
}

// ---------- Code TSL → graphe : l'aller-retour ----------
// Le panneau de code n'est pas un compte rendu du plan, c'est le MÊME graphe écrit autrement.
// generateCodeTslFromGraph va du plan au texte ; ce qui suit fait le retour — le texte redevient
// des nœuds et des liens. Les deux directions parlent donc du même modèle, et il n'y a pas de
// « code qui prend le dessus » : il n'y a qu'un graphe, avec deux vues.
//
// Le dialecte reconnu est exactement celui que le générateur écrit, augmenté de ce qu'un humain
// écrit naturellement (parenthèses, méthodes `.mul()` chaînées, littéraux). Ce qu'il ne reconnaît
// PAS, il le refuse en nommant la ligne — jamais en écrasant le graphe à moitié.
//
// Deux nœuds composites se relisent sous leur forme développée : `Tiling And Offset` revient en
// Multiply + Add, et `Blend` en Blend + Lerp. Le rendu est le même, le plan un cran plus explicite.

// Un jeton = un mot, un numberOf, une chaîne ou un signe. Commentaires et blancs sautés, mais la
// LIGNE est retenue : un message d'erreur sans numéro de ligne ne sert à rien.
export function tokensCodeTslGraphShader(code){
  const re = /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_$][A-Za-z0-9_$]*|\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+|'[^']*'|"[^"]*"|[(){},.;=]|[\s\S]/g;
  const out = [];
  let m, line = 1;
  while((m = re.exec(code)) !== null){
    const t = m[0];
    const start = line;
    line += (t.match(/\n/g) || []).length;
    if(/^\s/.test(t) || t.indexOf('//') === 0 || t.indexOf('/*') === 0) continue;
    out.push({t: t, line: start});
  }
  return out;
}

// Entrées « nues » : un identifiant qui EST un nœud, sans call.
export const IDENTS_CODE_GRAPH_SHADER = {
  time: ['time', {}],
  positionLocal: ['geo.position', {space:'local'}],
  positionWorld: ['geo.position', {space:'world'}],
  positionView: ['geo.position', {space:'view'}],
  normalLocal: ['geo.normale', {space:'local'}],
  normalWorld: ['geo.normale', {space:'world'}],
  normalView: ['geo.normale', {space:'view'}],
  tangentLocal: ['geo.tangent', {space:'local'}],
  tangentWorld: ['geo.tangent', {space:'world'}],
  screenUV: ['input.screenUv', {}],
  cameraPosition: ['input.cameraPosition', {}],
  materialColor: ['input.materialColor', {}],
  positionViewDirection: ['input.viewDirection', {}],
  faceDirection: ['logic.isFrontFace', {}]
};

// Appels dont les arguments se branchent un pour un sur les entrées du nœud.
export const CALLS_CODE_GRAPH_SHADER = {
  uv: ['uv', []],
  vertexColor: ['geo.vertexColor', []],
  mix: ['math.mix', ['a', 'b', 't']],
  clamp: ['math.clamp', ['v', 'min', 'max']],
  step: ['math.step', ['threshold', 'v']],
  smoothstep: ['math.smoothstep', ['min', 'max', 'v']],
  remap: ['math.remap', ['v', 'fromMin', 'fromMax', 'toMin', 'toMax']],
  rotateUV: ['uv.rotate', ['uv', 'angle', 'center']],
  spherizeUV: ['uv.spherize', ['uv', 'strength']],
  saturation: ['color.saturation', ['v', 'amount']],
  hue: ['color.hue', ['v', 'offset']],
  vibrance: ['color.vibrance', ['v', 'amount']],
  posterize: ['color.posterize', ['v', 'steps']],
  blendOverlay: ['color.blend', ['base', 'blend']],
  blendScreen: ['color.blend', ['base', 'blend']],
  blendBurn: ['color.blend', ['base', 'blend']],
  blendDodge: ['color.blend', ['base', 'blend']]
};

// Les procéduraux s'écrivent `fn(uv.mul(echelle))` : l'échelle est DANS l'expression, pas dans
// un argument à elle. On la ressort au retour, sinon un aller-retour transformerait le port
// « Échelle » en un Multiply de plus à chaque passage.
export const PROCEDURAL_CODE_GRAPH_SHADER = {
  mx_noise_float: 'procedural.bruit',
  mx_fractal_noise_float: 'procedural.bruitFractal',
  mx_worley_noise_float: 'procedural.voronoi',
  mx_cell_noise_float: 'procedural.cellules',
  checker: 'procedural.damier'
};

export const MODES_BLEND_CODE_GRAPH_SHADER = {blendOverlay:'overlay', blendScreen:'screen',
  blendBurn:'burn', blendDodge:'dodge'};

// name TSL → type de nœud, pour les opérateurs des tables partagées avec le rendu.
export function tableOperatorsCodeGraphShader(){
  const unary = {}, binary = {};
  if(typeof UNARY_GRAPH_SHADER !== 'undefined'){
    Object.keys(UNARY_GRAPH_SHADER).forEach(function(type){ unary[UNARY_GRAPH_SHADER[type]] = type; });
  }
  if(typeof BINARY_GRAPH_SHADER !== 'undefined'){
    Object.keys(BINARY_GRAPH_SHADER).forEach(function(type){ binary[BINARY_GRAPH_SHADER[type]] = type; });
  }
  // `add`, `sub` et `mul` ne sont pas dans les tables : ce sont des méthodes de nœud TSL.
  binary.add = 'math.add';
  binary.sub = 'math.sub';
  binary.mul = 'math.mul';
  return {unary: unary, binary: binary};
}

// ---- analyse syntaxique : le texte devient un tree, PUIS l'tree devient des nœuds.
// En deux temps parce que certaines formes ne se reconnaissent qu'en regardant la FORME de
// l'argument (l'échelle d'un procédural, cachée dans un `.mul()`).
export function astCodeTslGraphShader(code){
  const tokens = tokensCodeTslGraphShader(code);
  let i = 0;

  function done(){ return i >= tokens.length; }
  function peek(){ return tokens[i] || {t:'(done du code)', line: (tokens[tokens.length - 1] || {line:1}).line}; }
  function raise(message){
    const j = peek();
    throw new Error('ligne ' + j.line + ' : ' + message + ' (« ' + j.t + ' »)');
  }
  function eat(t){
    if(done() || tokens[i].t !== t) raise('« ' + t + ' » attendu');
    return tokens[i++];
  }
  function nextIs(t){ return !done() && tokens[i].t === t; }

  function args(){
    const list = [];
    eat('(');
    if(nextIs(')')){ eat(')'); return list; }
    for(;;){
      list.push(expression());
      if(nextIs(',')){ eat(','); continue; }
      eat(')');
      return list;
    }
  }

  function primary(){
    if(done()) raise('expression attendue');
    const j = tokens[i];
    if(j.t === '-'){ i++; const e = primary(); return {kind:'neg', arg:e, line:j.line}; }
    if(j.t === '('){ i++; const e = expression(); eat(')'); return e; }
    if(/^['"]/.test(j.t)){ i++; return {kind:'str', value:j.t.slice(1, -1), line:j.line}; }
    if(/^[\d.]/.test(j.t)){ i++; return {kind:'num', value:Number(j.t), line:j.line}; }
    if(/^[A-Za-z_$]/.test(j.t)){
      i++;
      if(nextIs('(')) return {kind:'call', name:j.t, args:args(), line:j.line};
      return {kind:'ident', name:j.t, line:j.line};
    }
    return raise('expression attendue');
  }

  function expression(){
    let e = primary();
    while(nextIs('.')){
      eat('.');
      if(done() || !/^[A-Za-z_$]/.test(peek().t)) raise('nom de méthode attendu après « . »');
      const name = tokens[i++].t;
      e = nextIs('(')
        ? {kind:'method', recv:e, name:name, args:args(), line:e.line}
        : {kind:'field', recv:e, name:name, line:e.line};
    }
    return e;
  }

  // ---- instructions
  const bindings = [];       // {name, ast}
  const assignments = [];    // {field, ast, line}
  const declarations = [];   // graph.property(...) / graph.sample(...) posées seules
  while(!done()){
    const j = peek();
    if(j.t === ';'){ i++; continue; }
    if(j.t === 'const' || j.t === 'let' || j.t === 'var'){
      i++;
      if(nextIs('{')){   // const { float, uv } = TSL;  → rien à en tirer
        while(!done() && tokens[i].t !== ';') i++;
        continue;
      }
      if(done() || !/^[A-Za-z_$]/.test(peek().t)) raise('nom de variable attendu');
      const name = tokens[i++].t;
      eat('=');
      bindings.push({name:name, ast:expression(), line:j.line});
      if(nextIs(';')) eat(';');
      continue;
    }
    if(j.t === 'graph'){
      // Déclaration seule : `graph.property('Vitesse', 0.5);` — elle ne calcule rien, elle
      // dit juste que cette propriété existe. C'est ce qui rend le blackboard partagé.
      declarations.push(expression());
      if(nextIs(';')) eat(';');
      continue;
    }
    if(/^[A-Za-z_$]/.test(j.t)){
      // material.colorNode = … ;  (ou n'importe quel receveur : c'est le CHAMP qui compte)
      i++;
      if(!nextIs('.')) raise('affectation « material.xxxNode = … » attendue');
      eat('.');
      if(done() || !/^[A-Za-z_$]/.test(peek().t)) raise('nom de slot attendu');
      const champ = tokens[i++].t;
      eat('=');
      assignments.push({field:champ, ast:expression(), line:j.line});
      if(nextIs(';')) eat(';');
      continue;
    }
    raise('instruction inattendue');
  }
  return {bindings: bindings, outputs: assignments, declarations: declarations};
}

// L'arbre devient {nodes, links, outputs}. Lève une Error explicite au premier terme inconnu :
// un graphe à moitié reconstruit serait pire que pas de reconstruction du tout.
export function parseGraphFromCodeTsl(code, asset){
  const tree = astCodeTslGraphShader(code);
  const ops = tableOperatorsCodeGraphShader();
  const nodes = [], links = [], outputs = {};
  // Copie de travail du blackboard : le code peut y AJOUTER (une propriété écrite ici existe),
  // jamais en retirer — supprimer reste un geste explicite, dans le panneau de gauche.
  const properties = JSON.parse(JSON.stringify(asset.properties || []));
  const bindings = {};
  let counter = 0;

  function makeNode(type, params){
    const id = 'n' + (++counter);
    nodes.push({id:id, type:type, params:params || {}});
    return id;
  }
  function connect(node, entry, source){ links.push({node:node, entry:entry, source:source}); }
  function failAt(ast, message){
    throw new Error('ligne ' + (ast && ast.line ? ast.line : '?') + ' : ' + message);
  }
  function numberOf(ast){
    if(ast.kind === 'num') return ast.value;
    if(ast.kind === 'neg' && ast.arg.kind === 'num') return -ast.arg.value;
    return null;
  }
  function connectArgs(id, entries, listArgs){
    entries.forEach(function(name, k){
      if(listArgs[k] === undefined) return;
      connect(id, name, build(listArgs[k]));
    });
  }

  // Type et défaut déduits de la valeur écrite : 0.5 → Float, '#8fd8ff' → Color,
  // vec3(0, 1, 0) → Vector 3. Rien d'autre n'est accepté — une expression calculée ne peut pas
  // être un défaut, elle n'a pas de valeur avant le rendu.
  function declaredProperty(ast, astValue){
    if(!astValue) return null;
    if(astValue.kind === 'num') return {type:'float', defaultValue: astValue.value};
    if(astValue.kind === 'neg' && astValue.arg.kind === 'num'){
      return {type:'float', defaultValue: -astValue.arg.value};
    }
    if(astValue.kind === 'str'){
      return {type:'color', defaultValue: astValue.value};
    }
    if(astValue.kind === 'call' && astValue.name === 'vec3'){
      const c = astValue.args.map(function(x){
        return x.kind === 'num' ? x.value : (x.kind === 'neg' && x.arg.kind === 'num' ? -x.arg.value : null);
      });
      if(c.every(function(v){ return v !== null; })){
        return {type:'vec3', defaultValue:{x:c[0] || 0, y:c[1] || 0, z:c[2] || 0}};
      }
    }
    return failAt(ast, 'défaut de propriété illisible — attendu un nombre, une couleur '
      + '« #rrggbb » ou vec3(x, y, z)');
  }

  // Retrouve la propriété par son NOM, ou la CRÉE quand le code la déclare. Une propriété qui
  // existe déjà garde son défaut : c'est le blackboard qui en est propriétaire, le code ne le
  // réécrit pas dans son dos (et le générateur y réécrit toujours la valeur courante).
  function propertyByName(ast, nameProp, declared){
    let prop = properties.find(function(p){ return p.name === nameProp; });
    if(prop) return prop;
    if(!declared){
      failAt(ast, 'propriété « ' + nameProp + ' » introuvable — écrivez son défaut pour la '
        + 'créer, par exemple graph.property(\'' + nameProp + '\', 1)');
    }
    prop = {id: idPropertyGraphShaderFree({properties: properties}), name: nameProp,
      type: declared.type, defaultValue: declared.defaultValue};
    properties.push(prop);
    return prop;
  }

  function propertyRef(ast, nameProp, declared, astUv){
    const prop = propertyByName(ast, nameProp, declared);
    const id = makeNode('property.ref', {propertyId: prop.id});
    if(astUv) connect(id, 'uv', build(astUv));
    return id;
  }

  function build(ast){
    if(ast.kind === 'num'){ return makeNode('constant.float', {value: ast.value}); }
    if(ast.kind === 'neg'){
      const v = numberOf(ast);
      if(v !== null) return makeNode('constant.float', {value: v});
      return failAt(ast, 'le signe « - » ne se pose que devant un numberOf ici');
    }
    if(ast.kind === 'str') return failAt(ast, 'chaîne inattendue');
    if(ast.kind === 'field'){
      // `TSL.time`, ou un champ sur un identifiant connu
      if(ast.recv.kind === 'ident' && IDENTS_CODE_GRAPH_SHADER[ast.name]) return build({kind:'ident', name:ast.name, line:ast.line});
      // Un swizzle s'écrit SANS parenthèses (`n1.xy`, `positionLocal.y`) : c'est la forme que
      // le générateur produit lui-même, et celle qu'on écrit naturellement.
      if(/^[xyzw]{1,4}$/.test(ast.name)){
        const idSwizzle = makeNode('vec.swizzle', {channels: ast.name});
        connect(idSwizzle, 'v', build(ast.recv));
        return idSwizzle;
      }
      return failAt(ast, 'terme inconnu « .' + ast.name + ' »');
    }
    if(ast.kind === 'ident'){
      if(bindings[ast.name] !== undefined) return bindings[ast.name];
      const def = IDENTS_CODE_GRAPH_SHADER[ast.name];
      if(def) return makeNode(def[0], Object.assign({}, def[1]));
      return failAt(ast, 'identifiant inconnu « ' + ast.name + ' »');
    }
    if(ast.kind === 'method') return method(ast);
    if(ast.kind === 'call') return call(ast);
    return failAt(ast, 'expression incomprise');
  }

  function method(ast){
    // graph.property('name'[, uv]) · graph.texture('idAsset') · graph.node('id')
    if(ast.recv.kind === 'ident' && ast.recv.name === 'graph'){
      const a0 = ast.args[0];
      if(ast.name === 'property'){
        if(!a0 || a0.kind !== 'str') failAt(ast, 'graph.property attend le NOM de la propriété');
        return propertyRef(ast, a0.value, declaredProperty(ast, ast.args[1]), null);
      }
      // Une propriété de texture s'échantillonne : `graph.sample('Diffuse', uv())`.
      if(ast.name === 'sample'){
        if(!a0 || a0.kind !== 'str') failAt(ast, 'graph.sample attend le NOM de la propriété');
        return propertyRef(ast, a0.value, {type:'texture', defaultValue:null}, ast.args[1]);
      }
      if(ast.name === 'node'){
        if(!a0 || a0.kind !== 'str') failAt(ast, 'graph.node attend un identifiant de nœud');
        const source = (asset.nodes || []).find(function(n){ return n.id === a0.value; });
        if(!source) failAt(ast, 'nœud « ' + a0.value + ' » introuvable dans le graphe');
        // Le nœud est RECOPIÉ : le code décrit tout le graphe, il ne renvoie pas à un état qui
        // aurait disparu au prochain aller-retour.
        return makeNode(source.type, Object.assign({}, source.params || {}));
      }
      failAt(ast, 'graph.' + ast.name + ' ne se relit pas — utilisez graph.property, '
        + 'graph.sample, graph.texture ou graph.node');
    }
    const swizzle = /^[xyzw]{1,4}$/.test(ast.name);
    if(ops.binary[ast.name] && ast.args.length === 1){
      const id = makeNode(ops.binary[ast.name], {});
      connect(id, 'a', build(ast.recv));
      connect(id, 'b', build(ast.args[0]));
      return id;
    }
    if(ops.unary[ast.name] && !ast.args.length){
      const id = makeNode(ops.unary[ast.name], {});
      connect(id, 'v', build(ast.recv));
      return id;
    }
    if(swizzle && !ast.args.length){
      const id = makeNode('vec.swizzle', {channels: ast.name});
      connect(id, 'v', build(ast.recv));
      return id;
    }
    return failAt(ast, 'méthode inconnue « .' + ast.name + '() »');
  }

  function call(ast){
    const name = ast.name, a = ast.args;
    if(name === 'float'){
      const v = a.length ? numberOf(a[0]) : 0;
      if(v === null) return build(a[0]);   // float(expr) : le nœud est déjà un flottant
      return makeNode('constant.float', {value: v === null ? 0 : v});
    }
    if(name === 'color'){
      if(!a.length || a[0].kind !== 'str') failAt(ast, 'color attend une couleur « #rrggbb »');
      return makeNode('constant.color', {color: a[0].value});
    }
    if(name === 'vec2' || name === 'vec3' || name === 'vec4'){
      const keys = ['x', 'y', 'z', 'w'].slice(0, name === 'vec2' ? 2 : (name === 'vec3' ? 3 : 4));
      const params = {};
      const toConnect = [];
      keys.forEach(function(key, k){
        const v = a[k] ? numberOf(a[k]) : 0;
        if(v !== null) params[key] = (v === null ? 0 : v);
        else toConnect.push([key, a[k]]);
      });
      const id = makeNode('constant.' + name, params);
      toConnect.forEach(function(pair){ connect(id, pair[0], build(pair[1])); });
      return id;
    }
    if(name === 'texture'){
      // texture(graph.texture('a12'), uv)
      const src = a[0];
      let idAsset = '';
      if(src && src.kind === 'method' && src.name === 'texture' && src.args[0] && src.args[0].kind === 'str'){
        idAsset = src.args[0].value;
      } else if(src && src.kind === 'str'){
        idAsset = src.value;
      } else {
        failAt(ast, 'texture attend graph.texture(\'idAsset\') en premier argument');
      }
      const id = makeNode('texture', {assetTexture: idAsset || null});
      if(a[1]) connect(id, 'uv', build(a[1]));
      return id;
    }
    if(PROCEDURAL_CODE_GRAPH_SHADER[name]){
      const type = PROCEDURAL_CODE_GRAPH_SHADER[name];
      const params = {};
      let astUv = a[0], astScale = null;
      if(astUv && astUv.kind === 'method' && astUv.name === 'mul' && astUv.args.length === 1){
        astScale = astUv.args[0];
        astUv = astUv.recv;
      }
      if(type === 'procedural.bruitFractal'){
        params.octaves = a[1] ? (numberOf(a[1]) || 3) : 3;
        params.lacunarite = a[2] ? (numberOf(a[2]) || 2) : 2;
        params.falloff = a[3] !== undefined ? numberOf(a[3]) : 0.5;
      }
      const id = makeNode(type, params);
      if(astUv) connect(id, 'uv', build(astUv));
      if(astScale) connect(id, 'scale', build(astScale));
      if(type === 'procedural.voronoi' && a[1]) connect(id, 'jitter', build(a[1]));
      return id;
    }
    if(CALLS_CODE_GRAPH_SHADER[name]){
      const def = CALLS_CODE_GRAPH_SHADER[name];
      const params = MODES_BLEND_CODE_GRAPH_SHADER[name]
        ? {mode: MODES_BLEND_CODE_GRAPH_SHADER[name]} : {};
      const id = makeNode(def[0], params);
      connectArgs(id, def[1], a);
      return id;
    }
    if(ops.binary[name] && a.length >= 2){
      const id = makeNode(ops.binary[name], {});
      connect(id, 'a', build(a[0]));
      connect(id, 'b', build(a[1]));
      return id;
    }
    if(ops.unary[name] && a.length >= 1){
      const id = makeNode(ops.unary[name], {});
      connect(id, 'v', build(a[0]));
      return id;
    }
    return failAt(ast, 'fonction inconnue « ' + name + '() »');
  }

  // Les déclarations d'abord : une propriété doit exister avant d'être lue, quel que soit
  // l'ordre des lignes. Elles ne posent AUCUN nœud — déclarer n'est pas utiliser.
  tree.declarations.forEach(function(ast){
    if(ast.kind !== 'method' || (ast.name !== 'property' && ast.name !== 'sample')){
      failAt(ast, 'seules graph.property(...) et graph.sample(...) se posent seules sur une ligne');
    }
    const a0 = ast.args[0];
    if(!a0 || a0.kind !== 'str') failAt(ast, 'le NOM de la propriété est attendu');
    propertyByName(ast, a0.value, ast.name === 'sample'
      ? {type:'texture', defaultValue:null} : declaredProperty(ast, ast.args[1]));
  });

  tree.bindings.forEach(function(b){ bindings[b.name] = build(b.ast); });

  // La CIBLE fait partie du code : `material.target = 'physical';`. Sans elle, coller un
  // shader Physical dans un graphe resté en Lit refusait ses onze couches sans dire pourquoi —
  // alors que le texte décrit le shader en entier, cible comprise. Lue en premier : c'est elle
  // qui dit quels slots existent.
  let target = asset.target || 'lit';
  tree.outputs.forEach(function(o){
    if(o.field !== 'target') return;
    if(o.ast.kind !== 'str' || !CLASSES_MATERIAL_GRAPH_SHADER[o.ast.value]){
      throw new Error('ligne ' + o.line + ' : cible inconnue — attendu \'lit\', \'physical\' ou \'unlit\'');
    }
    target = o.ast.value;
  });

  // Champ de matériau → slot du graphe, dans le sens inverted de SLOTS_BY_TARGET.
  const slots = (typeof SLOTS_BY_TARGET !== 'undefined')
    ? (SLOTS_BY_TARGET[target] || SLOTS_BY_TARGET.lit) : {};
  tree.outputs.forEach(function(o){
    if(o.field === 'target') return;
    let ast = o.ast, key = null;
    Object.keys(slots).forEach(function(k){
      if(slots[k] === o.field && k !== 'smoothness' && k !== 'roughness') key = k;
    });
    if(o.field === 'roughnessNode'){
      // `oneMinus(x)` sur la rugosité, c'est le slot Smoothness — l'écriture même que le
      // générateur produit pour lui.
      const inverted = (ast.kind === 'call' && ast.name === 'oneMinus' && ast.args.length === 1)
        || (ast.kind === 'method' && ast.name === 'oneMinus' && !ast.args.length);
      key = inverted ? 'smoothness' : 'roughness';
      if(inverted) ast = (ast.kind === 'call') ? ast.args[0] : ast.recv;
    }
    if(!key){
      // Nommer la cible qui, elle, possède ce slot : « pas un slot de cette cible » laissait
      // chercher tout seul.
      let ailleurs = null;
      Object.keys(SLOTS_BY_TARGET).forEach(function(t){
        Object.keys(SLOTS_BY_TARGET[t]).forEach(function(k){
          if(SLOTS_BY_TARGET[t][k] === o.field && t !== target) ailleurs = t;
        });
      });
      throw new Error('ligne ' + o.line + ' : « material.' + o.field + ' » n\'existe pas en cible « '
        + target + ' »' + (ailleurs ? ' — ajoutez « material.target = \'' + ailleurs
        + '\'; » au code, ou changez le Mode en haut' : ''));
    }
    outputs[key] = build(ast);
  });

  return {nodes: nodes, links: links, outputs: outputs, properties: properties, target: target};
}

// Une constante qui n'alimente qu'UN port, et un port qui sait afficher un champ : c'est une
// valeur inline (nœud __auto), pas un nœud à dessiner. Sans cette passe, un aller-retour
// transformerait chaque champ tapé sur un port en nœud Float posé sur le plan.
export function markInlineGraphShader(asset){
  const usages = {};
  (asset.links || []).forEach(function(l){
    (usages[l.source] = usages[l.source] || []).push(l);
  });
  (asset.nodes || []).forEach(function(n){
    if(['constant.float', 'constant.color', 'constant.vec2'].indexOf(n.type) === -1) return;
    const list = usages[n.id] || [];
    if(list.length !== 1) return;
    const consumer = (asset.nodes || []).find(function(x){ return x.id === list[0].node; });
    if(!consumer) return;
    const widget = typeFieldInputGraphShader(consumer.type, list[0].entry);
    if(!widget) return;
    if((widget === 'color') !== (n.type === 'constant.color')) return;
    if((widget === 'vec2') !== (n.type === 'constant.vec2')) return;
    n.params.__auto = true;
  });
}

// Place les nœuds neufs en colonnes, du plus profond vers le Master — la disposition connue
// est conservée telle quelle pour tout nœud qui n'a pas changé de type.
export function layoutGraphShader(asset, layoutOld){
  const layout = {};
  if(layoutOld && layoutOld.__sortie) layout.__sortie = layoutOld.__sortie;
  const depth = {};
  function walk(id, d){
    if(depth[id] !== undefined && depth[id] >= d) return;
    depth[id] = d;
    (asset.links || []).forEach(function(l){ if(l.node === id) walk(l.source, d + 1); });
  }
  Object.keys(asset.outputs || {}).forEach(function(k){
    if(asset.outputs[k]) walk(asset.outputs[k], 0);
  });
  let max = 0;
  (asset.nodes || []).forEach(function(n){
    if(depth[n.id] === undefined) depth[n.id] = 0;
    max = Math.max(max, depth[n.id]);
  });
  const perColumn = {};
  (asset.nodes || []).forEach(function(n){
    if(n.params && n.params.__auto) return;   // jamais dessiné : pas de place à lui donner
    const previous = layoutOld && layoutOld[n.id];
    const column = max - depth[n.id];
    const row = (perColumn[column] = (perColumn[column] || 0) + 1) - 1;
    layout[n.id] = previous ? previous : {x: 60 + column * 230, y: 40 + row * 120};
  });
  return layout;
}

// Relit le code et REMPLACE le graphe par ce qu'il décrit. Le blackboard, lui, n'appartient
// pas au texte : les propriétés survivent (le code les désigne par leur name).
export function applyCodeToGraphGraphShader(asset, code){
  const parsed = parseGraphFromCodeTsl(code, asset);
  const layoutOld = Object.assign({}, asset.layout || {});
  asset.nodes = parsed.nodes;
  asset.links = parsed.links;
  asset.outputs = parsed.outputs;
  asset.properties = parsed.properties;
  asset.target = parsed.target;
  markInlineGraphShader(asset);
  asset.layout = layoutGraphShader(asset, layoutOld);
  return asset;
}

// Une pastille est une cible valide pour le fil en cours si elle est du BOUT OPPOSÉ (une
// sortie cherche une entrée, et réciproquement) et n'appartient pas au nœud d'où part le fil.
// `dataset` est celui de la pastille visée ; `liaison` décrit le fil tiré.
//
// Fonction PURE et hors de l'éditeur À DESSEIN : sa version précédente vivait dans la
// fermeture et lisait la variable `liaison` directement. Or l'appelant met cette variable à
// null AVANT de valider la cible — la fonction, qui commençait par `if(!liaison) return
// false`, répondait donc toujours « incompatible » au moment de conclure, et AUCUN
// branchement n'aboutissait jamais. Passer l'état en argument rend la faute impossible, et
// rend surtout la règle testable sans DOM.
// `asset` est facultatif : sans lui, seule la règle de géométrie s'applique (c'est ce que
// testent les cas sans graphe). Avec lui, le TYPE des deux ports est confronté en plus —
// le « filtre » de Shader Graph, qui éteint les pastilles où le fil n'aurait pas de sens.
export function badgeCompatibleGraphShader(dataset, liaison, asset){
  if(!dataset || !liaison) return false;
  const isInput = !!(dataset.inputNode || dataset.targetOutput);
  if(isInput !== (liaison.sens === 'depuis-sortie')) return false;
  if(liaison.sens === 'depuis-sortie'){
    if(dataset.inputNode === liaison.node) return false;
  } else if(dataset.outputNode === liaison.node) return false;
  if(!asset) return true;
  let typeOut, typeIn;
  let slot = null;
  if(liaison.sens === 'depuis-sortie'){
    typeOut = typeOutputGraphShader(asset, liaison.node);
    slot = dataset.targetOutput || null;
    typeIn = slot ? TYPES_SLOT_GRAPH_SHADER[slot]
      : typeInputGraphShader(asset, dataset.inputNode, dataset.inputName);
  } else {
    typeOut = typeOutputGraphShader(asset, dataset.outputNode);
    slot = liaison.keyOutput || null;
    typeIn = slot ? TYPES_SLOT_GRAPH_SHADER[slot]
      : typeInputGraphShader(asset, liaison.node, liaison.entry);
  }
  if(slot && SLOTS_VECTOR_STRICT_GRAPH_SHADER[slot] && typeOut === 'float') return false;
  return portsCompatibleGraphShader(typeOut, typeIn);
}

// ---------- Fenêtre principale : ouvre l'éditeur externe pour un asset grapheShader ----------
// N'existe QUE côté fenêtre principale (openEditorExternal, posé par external-editor.js,
// n'est chargé — via editor.html — que là). La fenêtre externe, elle, utilise
// initEditorGraphShaderExternal ci-dessous, appelée par external-editor.html.
export function openEditorGraphShader(a){
  // `preview` est la VIGNETTE de la texture (data URL déjà calculée par le panneau Projet), pas
  // le fichier source : elle voyage par postMessage vers une autre fenêtre, et une texture 4K
  // en base64 y passerait très mal. Assez fidèle pour l'aperçu du shader, qui ne sert pas à
  // juger la finesse d'une texture — le rendu réel de la vue, lui, utilise l'originale.
  const texturesDisponibles = (typeof assets !== 'undefined' ? assets : [])
    .filter(function(x){ return x.kind === 'texture'; })
    .map(function(x){ return {id:x.id, name:x.name, preview:x.preview || null}; });
  const listFiles = assets.filter(function(x){ return x.kind === 'graphShader'; })
    .map(function(x){ return {id:x.id, name:x.name}; });
  openEditorExternal('tsl', {
    id:a.id, name:a.name, target:a.target || 'lit',
    properties:JSON.parse(JSON.stringify(a.properties || [])),
    nodes:JSON.parse(JSON.stringify(a.nodes || [])),
    links:JSON.parse(JSON.stringify(a.links || [])),
    outputs:Object.assign({}, a.outputs || {}),
    layout:Object.assign({}, a.layout || {}),
    texturesDisponibles:texturesDisponibles,
    listFiles:listFiles
  }, function(data){
    a.name = data.name || a.name;
    a.target = data.target;
    // `|| a.properties` et non `|| []` : une mise à jour qui n'apporterait pas le champ
    // (message tronqué, fenêtre d'une version antérieure) ne doit pas EFFACER le blackboard.
    a.properties = data.properties || a.properties || [];
    a.nodes = data.nodes;
    a.links = data.links;
    a.outputs = data.outputs;
    a.layout = data.layout;
    updateProject();
    // Un shader édité doit se refléter immédiatement sur tout objet qui le porte via un
    // materiau — même mécanisme que materiaux.js pour un materiau édité directement.
    if(typeof applyMaterialEverywhere === 'function'){
      assets.filter(function(m){ return m.kind === 'material' && m.shaderId === a.id; })
        .forEach(function(m){ applyMaterialEverywhere(m); });
    }
  }, function(id){
    const n = assets.find(function(x){ return x.id === id && x.kind === 'graphShader'; });
    if(n) openEditorGraphShader(n);
  });
}

// Ouvre le graphe de shader à empty, ou sur le dernier édité cette session — appelée par le
// menu Fenêtres.
export function openLastWindowShader(){
  const lastId = lastAssetEditedBy('tsl');
  const graphes = assets.filter(function(x){ return x.kind === 'graphShader'; });
  const a = (lastId && graphes.find(function(x){ return x.id === lastId; }))
    || graphes[0] || null;
  if(a){ openEditorGraphShader(a); return; }
  openEditorExternal('tsl', {id: null, name: '', target: 'lit', properties: [], nodes: [],
    links: [], outputs: {}, layout: {}, texturesDisponibles: [], listFiles: []});
}

// ---------- Aperçu temps réel du shader (sphère) ----------
// Le « Main Preview » de Shader Graph. Il lui faut un VRAI WebGPURenderer : le renderer WebGL
// classique n'exécute pas un NodeMaterial (il choisit son programme d'après `material.type`
// dans sa ShaderLib, où les types à nœuds ne figurent pas) — c'est déjà la raison pour laquelle
// la vignette d'un matériau à nœuds, dans le panneau Projet, est une sphère neutre et non le
// vrai matériau (materials.js, materialPreviewNeutral). D'où l'import map + le pont ESM ajoutés à
// external-editor.html : cette fenêtre a SON renderer, deux fenêtres ne pouvant pas partager un
// contexte GPU.
//
// `data` est la référence vive mutée par l'éditeur : rafraichir() relit son état current.
export function createPreviewGraphShader(data){
  const SIZE = 200;
  const cv = document.getElementById('ge-preview-canvas');
  const elNote = document.getElementById('ge-preview-note');
  const texturesById = new Map();
  const orbite = {x:0, y:0};
  let ready = false, inPending = false, maillage = null, material = null;
  let rendererPreview = null;

  function note(msg){ if(elNote) elNote.textContent = msg || ''; }

  // Vignette (data URL) reçue par postMessage — voir openEditorGraphShader. `null` en
  // mémoire pour une texture sans vignette : le nœud retombe alors sur son noir habituel,
  // sans retenter un chargement à chaque reconstruction.
  function resolveTexturePreview(assetId){
    if(!assetId) return null;
    if(texturesById.has(assetId)) return texturesById.get(assetId);
    const info = (data.texturesDisponibles || []).find(function(t){ return t.id === assetId; });
    let tex = null;
    if(info && info.preview){
      tex = new THREE.TextureLoader().load(info.preview);
      if(THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    }
    texturesById.set(assetId, tex);
    return tex;
  }

  function refresh(){
    if(!ready){ inPending = true; return; }
    try{
      // Pas de valeursParams : on prévisualise le SHADER, donc ses défauts — comme le Main
      // Preview d'Unity, qui ignore les overrides d'un materiau particulier.
      const neuf = buildMaterialFromGraph(data, resolveTexturePreview, {});
      if(material && material.dispose) material.dispose();
      material = neuf;
      maillage.material = neuf;
      note('');
    } catch(e){
      // Un graphe en cours de construction est souvent invalide (sortie branchée sur un nœud
      // qu'on vient de supprimer, entrée manquante…) : on le DIT dans l'aperçu et on garde le
      // matériau précédent, plutôt que de laisser une sphère noire sans explication.
      note(e.message);
    }
  }

  async function start(){
    if(typeof THREE === 'undefined' || !THREE.WebGPURenderer){
      note('Aperçu indisponible : le pont WebGPU n\'a pas chargé.');
      return;
    }
    const renderer = rendererPreview = new THREE.WebGPURenderer({canvas:cv, antialias:true, alpha:true});
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(SIZE, SIZE, false);
    await renderer.init();   // asynchrone : rien ne doit être rendu avant (voir ARCHITECTURE.md)
    if(rendererPreview !== renderer) return;   // démonté pendant l'attente : ne rien accrocher
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    camera.position.set(0, 0, 4.2);
    scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x2a2a26, 2.0));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(2.5, 3, 2.5);
    scene.add(sun);
    maillage = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40), new THREE.MeshStandardMaterial());
    scene.add(maillage);
    ready = true;
    // Boucle continue, et pas un rendu à la demande : un graphe qui utilise le nœud Time doit
    // s'animer dans l'aperçu comme il s'animera dans la vue.
    renderer.setAnimationLoop(function(){
      maillage.rotation.set(orbite.x, orbite.y, 0);
      renderer.render(scene, camera);
    });
    if(inPending){ inPending = false; }
    refresh();
  }

  if(cv){
    let tourne = null;
    cv.addEventListener('pointerdown', function(ev){
      ev.stopPropagation();   // ne pas déclencher le glisser de nœud du canvas nodal
      tourne = {x:ev.clientX, y:ev.clientY, ox:orbite.x, oy:orbite.y};
      cv.setPointerCapture(ev.pointerId);
    });
    cv.addEventListener('pointermove', function(ev){
      if(!tourne) return;
      orbite.y = tourne.oy + (ev.clientX - tourne.x) * 0.01;
      orbite.x = Math.max(-1.4, Math.min(1.4, tourne.ox + (ev.clientY - tourne.y) * 0.01));
    });
    cv.addEventListener('pointerup', function(){ tourne = null; });
    start();
  }
  // Démontage : la boucle de rendu s'arrête et le contexte GPU est rendu. Sans quoi une
  // réouverture laisserait tourner un renderer sur un canvas qui n'est plus dans la page.
  return {
    refresh: refresh,
    dispose: function(){
      ready = false;
      if(rendererPreview){
        rendererPreview.setAnimationLoop(null);
        if(rendererPreview.dispose) rendererPreview.dispose();
        rendererPreview = null;
      }
      if(material && material.dispose) material.dispose();
      material = null;
    }
  };
}

// ---------- Fenêtre externe : rendu du canvas nodal ----------
// Appelée par external-editor.html (branche type === 'tsl' de _initEditeurExterne) dans le
// conteneur #zones. `data` est la COPIE reçue par postMessage (structuredClone) — on la
// mute librement en local, `envoyerMaj` (déjà debounced 300 ms côté external-editor.js)
// renvoie l'état complet à la fenêtre principale à chaque mutation.
// Rouvrir un graphe alors que la fenêtre externe est DÉJÀ ouverte ne recharge pas la page :
// external-editor.js repose un `init` et cette fonction est rejouée. Ses écouteurs posés sur
// `document` (pointermove/pointerup/keydown), eux, survivaient à l'ancienne instance — chacun
// fermé sur SON `data`. Le moindre geste réveillait alors l'instance périmée, dont le `save()`
// réécrivait l'asset avec un état d'avant : les propriétés créées entre-temps disparaissaient
// « d'une ouverture à l'autre ». Un jeton de session neutralise l'ancienne instance, et
// l'aperçu de la précédente est démonté (son WebGPURenderer pointait de toute façon sur un
// canvas remplacé par la reconstruction du DOM).
export let sessionGraphShaderEditor = 0;
export let previewGraphShaderEditor = null;

export function initEditorGraphShaderExternal(data, sendUpdate){
  const session = ++sessionGraphShaderEditor;
  // Vrai dès qu'une instance plus récente a pris la main : tout écouteur global commence par
  // là et se tait pour toujours.
  function obsolete(){ return session !== sessionGraphShaderEditor; }
  if(previewGraphShaderEditor && previewGraphShaderEditor.dispose){
    previewGraphShaderEditor.dispose();
    previewGraphShaderEditor = null;
  }
  // Les libellés du Master Node de Shader Graph, à la lettre. `roughness` est la seule
  // exception : c'est la clé HÉRITÉE des graphes écrits avant l'arrivée de `smoothness`
  // (convention Unity, 1 = lisse), et elle ne s'affiche que si un graphe s'en sert encore.
  const LABELS_OUTPUTS = {position:'Position', color:'Base Color', normal:'Normal (Tangent Space)',
    metalness:'Metallic', smoothness:'Smoothness', roughness:'Roughness (hérité)',
    emissive:'Emission', ao:'Ambient Occlusion', opacity:'Alpha',
    alphaTest:'Alpha Clip Threshold',
    clearcoat:'Coat Mask', clearcoatRoughness:'Coat Smoothness', sheen:'Sheen Color',
    sheenRoughness:'Sheen Roughness', iridescence:'Iridescence',
    iridescenceThickness:'Iridescence Thickness', transmission:'Transmission',
    thickness:'Thickness', ior:'Index Of Refraction', specularColor:'Specular Color',
    anisotropy:'Anisotropy'};
  const ID_MASTER = '__sortie';   // pseudo-nœud fixe, comme le Master Node d'Unity

  let selection = new Set(); // ids de nœuds sélectionnés (jamais ID_MASTER)
  let marquee = null;        // {x0, y0, x1, y1, additif} pendant un rectangle de sélection
  // Câble en cours de tirage, façon Shader Graph : on ATTRAPE une pastille et on TIRE, le fil
  // suit le curseur, on LÂCHE sur la pastille d'en face. Deux sens, parce qu'Unity accepte les
  // deux — {sens:'depuis-sortie', node} cherche une entrée ; {sens:'depuis-entree', node,
  // entree} ou {sens:'depuis-entree', cleSortie} cherche une sortie. `pos` = curseur en
  // coordonnées du plan, pour dessiner le fil d'aperçu.
  let liaison = null;
  let cableSelected = null;  // 'link:<node>:<entree>' ou 'sortie:<key>' — Suppr le coupe
  let drag = null;           // {id, offX, offY} pendant un glisser de nœud (ou ID_MASTER)
  let pan = null;            // {x0, y0, vx0, vy0} pendant un glisser molette (pan de la vue)
  // La vue est une TRANSFORMATION du plan, pas un scroll : le plan n'a donc plus de taille
  // finie, aucune barre ne s'affiche, et rien n'arrête le déplacement — un graphe peut
  // s'étendre où il veut, y compris en coordonnées négatives (Shader Graph fait pareil).
  const view = {x:0, y:0, zoom:1};
  const ZOOM_MIN = 0.25, ZOOM_MAX = 2.5;
  let menuContext = null; // {x, y} du dernier clic droit sur le canvas empty, ou null
  let menuFilter = '';           // texte tapé dans la recherche du « Create Node »
  let menuIndex = 0;             // item mis en avant (flèches du clavier)
  let menuTypesVisibles = [];    // types affichés, à plat, dans l'ordre — indexés par menuIndex
  const groupesReplies = new Set();
  const PREFIX_DRAG_PROPERTY = 'ge-property:';
  const ORIGIN_SVG = 10000;   // décalage de la nappe SVG, cf. renderCables et .ge-svg

  data.layout = data.layout || {};
  if(!data.layout[ID_MASTER]) data.layout[ID_MASTER] = {x:900, y:60};

  // Toute mutation du graphe passe par ici : c'est donc le seul point où rebrancher l'aperçu
  // et le panneau de code.
  let preview = null;
  let codeView = null;      // éditeur en lecture seule, créé à la première ouverture du panneau
  function save(){
    sendUpdate(data);
    if(preview) preview.refresh();
    updatePanelCode();
  }

  // Le panneau de code n'est construit qu'à la première ouverture, et n'est régénéré que
  // lorsqu'il est VISIBLE : régénérer tout le texte à chaque frappe dans un champ, panneau
  // fermé, serait du travail pur perdu.
  // Le panneau n'est construit qu'à la première ouverture. Il SUIT le graphe tant que
  // personne n'y a touché ; dès que le texte est modifié à la main, il appartient à
  // l'utilisateur et n'est plus réécrit sous ses doigts — c'est « Appliquer au graphe » qui
  // referme la boucle, ou « Régénérer » qui repart du plan.
  let codeModified = false;

  function updatePanelCode(){
    const panel = document.getElementById('ge-code');
    if(!panel || panel.hidden) return;
    if(!codeView){
      if(typeof createEditorCode !== 'function'){ warnOnceMissing('createEditorCode'); return; }
      codeView = createEditorCode(document.getElementById('ge-code-host'), {
        value: generateCodeTslFromGraph(data), langage: 'js', playbackSeule: false,
        onChange: function(){ codeModified = true; reportCode(); }
      });
      return;
    }
    if(!codeModified) codeView.setValue(generateCodeTslFromGraph(data));
  }

  function regenerateCode(){
    if(!codeView) return;
    codeView.setValue(generateCodeTslFromGraph(data));
    codeModified = false;
    reportCode();
  }

  // Le texte redevient des nœuds. En cas de terme incompris, on NOMME la ligne et on ne touche
  // à rien : un graphe à moitié reconstruit serait pire que pas de reconstruction.
  function applyCodeToGraph(){
    if(!codeView) return;
    const el = document.getElementById('ge-code-note');
    try {
      applyCodeToGraphGraphShader(data, codeView.value());
    } catch(e){
      if(el) el.textContent = '⚠ ' + e.message;
      return;
    }
    selection = new Set();
    cableSelected = null;
    codeModified = false;
    save();
    render();
    // On réécrit le texte depuis le graphe reconstruit : les deux vues affichent alors
    // exactement la même chose, ce qui est tout l'intérêt.
    codeView.setValue(generateCodeTslFromGraph(data));
    if(el) el.textContent = '✓ graphe reconstruit — ' + (data.nodes || []).length + ' nœud(s)';
  }

  function reportCode(){
    const el = document.getElementById('ge-code-note');
    if(!el) return;
    el.textContent = codeModified
      ? 'texte modifié — « Appliquer au graphe » pour poser les nœuds'
      : 'à jour avec le graphe';
  }

  function echap(s){
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Le Master de Shader Graph est fait de deux BLOCS : Vertex (ce qui s'évalue par sommet)
  // et Fragment (par pixel). On rend la même chose, dans le même ordre, sous les mêmes titres.
  const SLOTS_VERTEX = ['position'];
  const SLOTS_FRAGMENT = {
    unlit: ['color', 'opacity', 'alphaTest'],
    lit: ['color', 'normal', 'metalness', 'smoothness', 'emissive', 'ao', 'opacity', 'alphaTest'],
    physical: ['color', 'normal', 'metalness', 'smoothness', 'emissive', 'ao', 'opacity',
      'alphaTest', 'clearcoat', 'clearcoatRoughness', 'sheen', 'sheenRoughness', 'iridescence',
      'iridescenceThickness', 'transmission', 'thickness', 'ior', 'specularColor', 'anisotropy']
  };

  function slotsFragmentForTarget(target){
    const list = (SLOTS_FRAGMENT[target] || SLOTS_FRAGMENT.lit).slice();
    // Slot hérité : présent uniquement tant qu'un graphe s'en sert, pour ne pas proposer deux
    // fois la même chose à qui part d'une feuille blanche.
    if((data.outputs || {}).roughness) list.splice(list.indexOf('smoothness') + 1, 0, 'roughness');
    return list;
  }

  function slotsForTarget(target){
    return SLOTS_VERTEX.concat(slotsFragmentForTarget(target));
  }

  // Libellés affichés des ports (l'INTERFACE est en français, les clés du format restent
  // en anglais). Une entrée absente de la table s'affiche telle quelle.
  const LABELS_PORTS = {uv:'UV', tiling:'Tuile', offset:'Décalage', angle:'Angle',
    center:'Centre', scale:'Échelle', jitter:'Désordre', min:'Min', max:'Max',
    fromMin:'De min', fromMax:'De max', toMin:'À min', toMax:'À max',
    threshold:'Seuil', t:'Mélange', x:'X', y:'Y', z:'Z', w:'W', v:'Entrée', a:'A', b:'B',
    amount:'Intensité', steps:'Paliers', strength:'Force',
    opacity:'Opacité', base:'Base', blend:'Calque', power:'Puissance', normal:'Normale',
    viewDir:'Direction de vue'};

  function inputsOfType(type){
    const entry = (typeof REGISTRY_GRAPH_SHADER !== 'undefined') && REGISTRY_GRAPH_SHADER[type];
    return entry ? entry.inputs : [];
  }

  // ---- rendu d'un champ (widget) : valeur inline sur un port, OU un vrai champ de nœud ----
  function widgetValue(idField, type, value, attrsExtra, options){
    if(type === 'list'){
      let html = '<select class="ge-w ge-w-list" data-field="' + idField + '" ' + (attrsExtra || '') + '>';
      (options || []).forEach(function(o){
        html += '<option value="' + o[0] + '"' + (o[0] === value ? ' selected' : '') + '>'
          + echap(o[1]) + '</option>';
      });
      return html + '</select>';
    }
    if(type === 'color'){
      return '<input type="color" class="ge-w" data-field="' + idField + '" value="' + (value || '#8899aa') + '" ' + (attrsExtra || '') + '>';
    }
    if(type === 'texture'){
      let html = '<select class="ge-w" data-field="' + idField + '" ' + (attrsExtra || '') + '>';
      html += '<option value="">—</option>';
      (data.texturesDisponibles || []).forEach(function(t){
        html += '<option value="' + t.id + '"' + (t.id === value ? ' selected' : '') + '>' + echap(t.name) + '</option>';
      });
      html += '</select>';
      return html;
    }
    if(type === 'vec2'){
      // Deux champs sur la MÊME ligne de port, comme le X/Y d'un port Vector2 de Shader Graph.
      const v = (value && typeof value === 'object') ? value : {x:0, y:0};
      return '<input type="number" step="0.01" class="ge-w ge-w-number ge-w-vec2" data-field="' + idField + ':x" '
        + 'value="' + (Number(v.x) || 0) + '" ' + (attrsExtra || '') + '>'
        + '<input type="number" step="0.01" class="ge-w ge-w-number ge-w-vec2" data-field="' + idField + ':y" '
        + 'value="' + (Number(v.y) || 0) + '" ' + (attrsExtra || '') + '>';
    }
    if(type === 'text'){
      return '<input type="text" class="ge-w ge-w-text" data-field="' + idField + '" value="' + echap(value) + '" ' + (attrsExtra || '')+ '>';
    }
    return '<input type="number" step="0.01" class="ge-w ge-w-number" data-field="' + idField + '" value="' + Number(value || 0) + '" ' + (attrsExtra || '') + '>';
  }

  function renderNode(node){
    const meta = META_NODES_GRAPH_SHADER[node.type] || {caption:node.type, fields:[]};
    const pos = data.layout[node.id] || {x:0, y:0};
    const inputs = inputsOfNodeGraphShader(data, node);
    // Un renvoi de propriété porte le NOM de sa propriété, comme dans Shader Graph — il n'a
    // pas de champ : le défaut s'édite dans le blackboard, à un seul endroit.
    let caption = meta.caption;
    if(node.type === 'property.ref'){
      const prop = propertyOfNodeGraphShader(data, node);
      caption = prop ? prop.name : '⚠ propriété supprimée';
    }
    let html = '<div class="ge-node' + (selection.has(node.id) ? ' ge-selected' : '') + '" '
      + 'data-cat="' + (meta.cat || 'divers') + '" '
      + 'data-id="' + node.id + '" style="left:' + pos.x + 'px;top:' + pos.y + 'px">'
      + '<div class="ge-node-title" data-title="' + node.id + '">' + echap(caption) + '</div>'
      + '<div class="ge-node-body">';
    // Ports d'entrée : pastille + libellé + widget inline si non branché
    inputs.forEach(function(nameInput){
      const link = (data.links || []).find(function(l){ return l.node === node.id && l.entry === nameInput; });
      const typeWidget = typeFieldInputGraphShader(node.type, nameInput);
      const typePort = typeInputGraphShader(data, node.id, nameInput);
      // Un port piloté par un nœud __auto (une valeur tapée à la main) reste un port LIBRE du
      // point de vue de l'affichage : il garde son champ. Sans cette distinction, taper une
      // valeur créait le nœud auto, donc un link, donc la disparition du champ qu'on venait
      // d'utiliser — impossible de le corriger sans détacher quelque chose d'invisible.
      const auto = nodeAutoOf(data, node.id, nameInput);
      const bound = !!link && !auto;
      html += '<div class="ge-port ge-port-in">'
        + '<span class="ge-badge' + (bound ? ' ge-bound' : '') + '" data-port-type="' + typePort + '" '
        + 'data-input-node="' + node.id + '" data-input-name="' + nameInput + '"></span>'
        + '<span class="ge-port-label" title="' + typePort + '">' + echap(LABELS_PORTS[nameInput] || nameInput) + '</span>';
      if(!bound && typeWidget){
        let val;
        if(auto) val = (typeWidget === 'color') ? auto.params.color
          : (typeWidget === 'vec2' ? {x:auto.params.x, y:auto.params.y} : auto.params.value);
        else val = defaultInputGraphShader(node.type, nameInput, node.params || {}, typeWidget);
        html += widgetValue('entree:' + node.id + ':' + nameInput + ':' + typeWidget, typeWidget, val,
          'data-input-node="' + node.id + '" data-input-name="' + nameInput + '" data-input-type="' + typeWidget + '"');
      }
      html += '</div>';
    });
    // Champs propres au nœud (constantes, params exposés, min/max...)
    meta.fields.forEach(function(c){
      const val = (node.params && node.params[c.key] !== undefined) ? node.params[c.key] : c.defaultValue;
      html += '<div class="ge-field-node">' + (c.label ? '<span class="ge-field-label">' + echap(c.label) + '</span>' : '')
        + widgetValue('field:' + node.id + ':' + c.key + ':' + c.type, c.type, val,
          'data-field-node="' + node.id + '" data-field-key="' + c.key + '" data-field-type="' + c.type + '"',
          c.options)
        + '</div>';
    });
    // Port de sortie (sauf les nœuds auto, jamais dessinés à part — voir noeudsVisibles)
    const typeOut = typeOutputGraphShader(data, node.id);
    html += '<div class="ge-port ge-port-out"><span class="ge-port-label" title="' + typeOut + '">Out</span>'
      + '<span class="ge-badge" data-port-type="' + typeOut + '" data-output-node="' + node.id + '"></span></div>';
    html += '</div></div>';
    return html;
  }

  const CAPTIONS_TARGET = {unlit:'Unlit', physical:'Lit (Physical)', lit:'Lit (PBR)'};

  function renderMaster(){
    const pos = data.layout[ID_MASTER];
    let html = '<div class="ge-node ge-node-master" data-id="' + ID_MASTER + '" style="left:' + pos.x + 'px;top:' + pos.y + 'px">'
      + '<div class="ge-node-title">Master · ' + (CAPTIONS_TARGET[data.target] || CAPTIONS_TARGET.lit)
      + '</div><div class="ge-node-body">';

    function block(caption, keys){
      if(!keys.length) return;
      html += '<div class="ge-block-title">' + caption + '</div>';
      keys.forEach(function(key){
        const nodeId = (data.outputs || {})[key];
        const branche = data.nodes.some(function(n){ return n.id === nodeId; });
        const aide = SLOTS_VECTOR_STRICT_GRAPH_SHADER[key] || (TYPES_SLOT_GRAPH_SHADER[key] || '');
        html += '<div class="ge-port ge-port-in">'
          + '<span class="ge-badge' + (branche ? ' ge-bound' : '') + '" data-target-output="' + key + '" '
          + 'data-port-type="' + (TYPES_SLOT_GRAPH_SHADER[key] || 'dynamic') + '"></span>'
          + '<span class="ge-port-label" title="' + echap(aide) + '">'
          + (LABELS_OUTPUTS[key] || key) + '</span></div>';
      });
    }
    block('Vertex', SLOTS_VERTEX);
    block('Fragment', slotsFragmentForTarget(data.target));

    html += '</div></div>';
    return html;
  }

  // Un nœud constante.* __auto (valeur inline gérée automatiquement, voir plus haut) n'est
  // JAMAIS dessiné comme un nœud à part — sa valeur vit dans le port qui le consomme.
  function nodesVisibles(){
    return (data.nodes || []).filter(function(n){ return !(n.params && n.params.__auto); });
  }

  // ---- géométrie des câbles ----
  // Un fil arrive sur SA pastille, pas au milieu de la hauteur du nœud : sur un nœud à trois
  // entrées (Lerp), tout convergeait au même point et on ne voyait plus quel fil allait où.
  function badgeOutput(id){
    return document.querySelector('.ge-badge[data-output-node="' + id + '"]');
  }
  function badgeInput(id, name){
    return document.querySelector('.ge-badge[data-input-node="' + id + '"][data-input-name="' + name + '"]');
  }
  function badgeMaster(key){
    return document.querySelector('.ge-badge[data-target-output="' + key + '"]');
  }

  // Coordonnées du PLAN (celles de `layout`) sous le curseur, zoom et déplacement défaits.
  function posPlane(ev){
    const cv = document.getElementById('ge-canvas');
    const r = cv.getBoundingClientRect();
    return {x: (ev.clientX - r.left - view.x) / view.zoom,
            y: (ev.clientY - r.top - view.y) / view.zoom};
  }

  // Applique la vue au plan (et fait suivre la trame de fond, sinon le graphe glisserait
  // sur des points immobiles et le déplacement ne se verrait plus).
  function applyView(){
    const plan = document.getElementById('ge-plane');
    const cv = document.getElementById('ge-canvas');
    if(!plan || !cv) return;
    plan.style.transform = 'translate(' + view.x + 'px, ' + view.y + 'px) scale(' + view.zoom + ')';
    cv.style.backgroundSize = (18 * view.zoom) + 'px ' + (18 * view.zoom) + 'px';
    cv.style.backgroundPosition = view.x + 'px ' + view.y + 'px';
  }

  // Zoom centré sur le curseur : le point visé reste sous la souris, comme partout ailleurs.
  function zoomTo(zoom, xEcran, yEcran){
    const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
    view.x = xEcran - (xEcran - view.x) * (z / view.zoom);
    view.y = yEcran - (yEcran - view.y) * (z / view.zoom);
    view.zoom = z;
    applyView();
    renderCables();
  }

  // Les rectangles rendus sont en pixels ÉCRAN, donc déjà multipliés par le zoom : on les
  // ramène aux coordonnées du plan, seul repère dans lequel les câbles sont tracés.
  function ancrageBadge(el){
    const plan = document.getElementById('ge-plane');
    if(!el || !plan) return null;
    const r = el.getBoundingClientRect(), rp = plan.getBoundingClientRect();
    return {x: (r.left - rp.left + r.width / 2) / view.zoom,
            y: (r.top - rp.top + r.height / 2) / view.zoom};
  }

  // Poignées horizontales proportionnelles à l'écart : un fil court ne fait plus de boucle
  // absurde, un fil long garde la courbe franche de Shader Graph.
  function filePathCable(a, b){
    const dx = Math.max(35, Math.abs(b.x - a.x) * 0.5);
    return 'M' + a.x + ',' + a.y + ' C' + (a.x + dx) + ',' + a.y + ' '
      + (b.x - dx) + ',' + b.y + ' ' + b.x + ',' + b.y;
  }

  function ancrageLiaison(){
    if(!liaison) return null;
    if(liaison.sens === 'depuis-sortie') return ancrageBadge(badgeOutput(liaison.node));
    if(liaison.keyOutput) return ancrageBadge(badgeMaster(liaison.keyOutput));
    return ancrageBadge(badgeInput(liaison.node, liaison.entry));
  }

  function renderCables(){
    const svg = document.getElementById('ge-svg');
    if(!svg) return;
    // Pendant un tirage, les doublures de clic des câbles cessent d'exister pour le pointeur :
    // un fil qui passe devant une pastille interceptait sinon le lâcher, et le branchement
    // échouait sans un mot.
    const plan = document.getElementById('ge-plane');
    if(plan) plan.classList.toggle('ge-link-active', !!liaison);
    const chemins = [];
    function add(key, a, b){
      if(!a || !b) return;
      const d = filePathCable(a, b);
      // Chemin large et transparent D'ABORD : c'est LUI qui reçoit le clic. Viser un trait
      // de 2 px à la souris est un supplice ; le trait visible se dessine par-dessus.
      chemins.push('<path class="ge-cable-hit" data-wire="' + key + '" d="' + d + '"/>');
      chemins.push('<path class="ge-cable' + (cableSelected === key ? ' ge-cable-selected' : '')
        + '" data-wire="' + key + '" d="' + d + '"/>');
    }
    (data.links || []).forEach(function(l){
      // Un link dont la source est un nœud __auto n'a pas de câble visible : sa valeur est
      // affichée inline dans le port lui-même (pas de nœud, pas de fil qui part de nulle part).
      const source = data.nodes.find(function(n){ return n.id === l.source; });
      if(!source || (source.params && source.params.__auto)) return;
      if(!data.nodes.some(function(n){ return n.id === l.node; })) return;
      add('link:' + l.node + ':' + l.entry,
        ancrageBadge(badgeOutput(l.source)), ancrageBadge(badgeInput(l.node, l.entry)));
    });
    Object.keys(data.outputs || {}).forEach(function(key){
      const nodeId = data.outputs[key];
      if(!nodeId || !data.nodes.some(function(n){ return n.id === nodeId; })) return;
      add('sortie:' + key,
        ancrageBadge(badgeOutput(nodeId)), ancrageBadge(badgeMaster(key)));
    });
    // Fil d'aperçu qui suit le curseur pendant le tirage (toujours dessiné sortie → entrée,
    // quel que soit le bout par lequel on a commencé).
    if(liaison && liaison.pos){
      const anchor = ancrageLiaison();
      if(anchor){
        const fromOutput = (liaison.sens === 'depuis-sortie');
        chemins.push('<path class="ge-cable-preview" d="'
          + filePathCable(fromOutput ? anchor : liaison.pos, fromOutput ? liaison.pos : anchor) + '"/>');
      }
    }
    // La nappe SVG couvre une grande surface DÉCALÉE (voir .ge-svg) : ce groupe ramène les
    // coordonnées du plan — négatives comprises, un nœud pouvant vivre à gauche de l'origine —
    // dans le repère de cette surface. Une nappe de taille nulle, elle, ne peignait rien.
    svg.innerHTML = '<g transform="translate(' + ORIGIN_SVG + ',' + ORIGIN_SVG + ')">'
      + chemins.join('') + '</g>';
    svg.querySelectorAll('[data-wire]').forEach(function(p){
      p.addEventListener('pointerdown', function(ev){
        ev.stopPropagation();
        cableSelected = p.dataset.wire;
        selection = new Set();
        render();
      });
    });
  }

  // Le blackboard de Shader Graph : la liste des propriétés exposées, avec leur nom et leur
  // VALEUR PAR DÉFAUT éditables ici — et non sur un nœud. On glisse une entrée sur le plan
  // pour y poser un renvoi, autant de fois qu'on veut.
  function renderBlackboard(){
    const props = data.properties || [];
    let html = '<div class="ge-bb-title">Blackboard</div>';
    if(!props.length){
      html += '<div class="ge-help">Aucune propriété exposée. Ajoutez-en une ci-dessous : elle '
        + 'devient un champ du matériau une fois ce shader assigné, et se glisse sur le graphe '
        + 'pour y être lue.</div>';
    } else {
      html += '<div class="ge-help">Glissez une propriété sur le graphe pour l\'y lire.</div>';
    }
    props.forEach(function(p){
      const usages = (data.nodes || []).filter(function(n){
        return n.type === 'property.ref' && (n.params || {}).propertyId === p.id;
      }).length;
      html += '<div class="ge-bb-item" data-property="' + p.id + '" draggable="true" '
        + 'title="Glissez-la sur le graphe · ' + usages + ' renvoi(s) posé(s)">'
        + '<div class="ge-bb-head"><span class="ge-bb-bullet"></span>'
        + widgetValue('prop:' + p.id + ':name:text', 'text', p.name, 'data-prop="' + p.id + '"')
        + '<span class="ge-bb-type">' + p.type + '</span>'
        + '<button class="ge-bb-del" data-prop-del="' + p.id + '" '
        + 'title="Supprimer la propriété et ses renvois">✕</button></div>'
        + '<div class="ge-bb-default">' + widgetDefaultProperty(p) + '</div></div>';
    });
    document.getElementById('ge-blackboard-body').innerHTML = html;
    bindBlackboard();
  }

  function widgetDefaultProperty(p){
    if(p.type === 'vec3'){
      const v = p.defaultValue || {};
      return ['x', 'y', 'z'].map(function(k){
        return widgetValue('prop:' + p.id + ':' + k + ':number', 'number', numberOr(v[k], 0));
      }).join('');
    }
    const type = (p.type === 'color') ? 'color' : (p.type === 'texture' ? 'texture' : 'number');
    return widgetValue('prop:' + p.id + ':defaultValue:' + type, type, p.defaultValue);
  }

  function bindBlackboard(){
    document.querySelectorAll('[data-prop-del]').forEach(function(el){
      el.addEventListener('click', function(ev){
        ev.stopPropagation();
        deletePropertyGraphShader(data, el.dataset.propDel);
        save();
        render();
      });
    });
    // Glisser-déposer d'une propriété vers le plan. Le champ de nom reste éditable : un
    // pointerdown dedans ne doit pas être confisqué par le glisser de la ligne.
    document.querySelectorAll('[data-property]').forEach(function(el){
      el.querySelectorAll('input, select, button').forEach(function(champ){
        champ.addEventListener('pointerdown', function(){ el.draggable = false; });
        champ.addEventListener('pointerup', function(){ el.draggable = true; });
      });
      el.addEventListener('dragstart', function(ev){
        ev.dataTransfer.setData('text/plain', PREFIX_DRAG_PROPERTY + el.dataset.property);
        ev.dataTransfer.effectAllowed = 'copy';
      });
    });
  }

  // ---- « Create Node », calqué sur celui de Shader Graph : champ de recherche en haut,
  // catégories repliables, flèches + Entrée au clavier. L'ancienne version déversait les
  // quinze types à plat sous des intitulés bruts ('constant', 'math', 'param'…).
  function groupesMenu(){
    const f = menuFilter.trim().toLowerCase();
    const byCategorie = {};
    Object.keys(META_NODES_GRAPH_SHADER).forEach(function(type){
      const meta = META_NODES_GRAPH_SHADER[type];
      const cat = meta.category || 'Divers';
      // La recherche porte sur le libellé ET la catégorie : taper « math » sort les cinq
      // opérateurs, taper « lerp » sort le seul Lerp.
      if(meta.hidden) return;   // param.* (modèle hérité) et property.ref : jamais au menu
      if(f && (meta.caption + ' ' + cat).toLowerCase().indexOf(f) === -1) return;
      (byCategorie[cat] = byCategorie[cat] || []).push(type);
    });
    const connues = CATEGORIES_GRAPH_SHADER.filter(function(c){ return byCategorie[c]; });
    const autres = Object.keys(byCategorie).filter(function(c){
      return CATEGORIES_GRAPH_SHADER.indexOf(c) === -1;
    });
    return connues.concat(autres).map(function(c){
      return {category:c, types:byCategorie[c]};
    });
  }

  function render(){
    document.getElementById('ge-name').value = data.name || '';
    document.getElementById('ge-target').value = data.target || 'lit';
    document.getElementById('ge-plane').innerHTML = '<svg class="ge-svg" id="ge-svg"></svg>'
      + nodesVisibles().map(renderNode).join('') + renderMaster();
    applyView();
    renderCables();
    renderBlackboard();
    renderMenuContext();
    bindEvents();
  }

  function addFromMenu(type){
    if(!type || !menuContext) return;
    addNodeGraphShader(data, type, menuContext.x, menuContext.y);
    closeMenu();
    save();
    render();
  }

  function closeMenu(){
    menuContext = null;
    menuFilter = '';
    menuIndex = 0;
    menuTypesVisibles = [];
  }

  function renderMenuContext(){
    const old = document.getElementById('ge-menu-ctx');
    if(old) old.remove();
    if(!menuContext) return;
    const el = document.createElement('div');
    el.id = 'ge-menu-ctx';
    el.className = 'ge-menu-ctx';
    el.style.left = menuContext.sx + 'px';
    el.style.top = menuContext.sy + 'px';

    const filterActive = !!menuFilter.trim();
    const groupes = groupesMenu();
    menuTypesVisibles = [];
    let html = '<input type="text" class="ge-menu-search" id="ge-menu-search" '
      + 'placeholder="Rechercher un nœud…" spellcheck="false" value="' + echap(menuFilter) + '">'
      + '<div class="ge-menu-list">';
    if(!groupes.length) html += '<div class="ge-menu-empty">Aucun nœud ne correspond</div>';
    groupes.forEach(function(g){
      // Une recherche en cours déplie tout : garder un groupe replié cacherait justement le
      // résultat que l'utilisateur vient de taper.
      const folded = !filterActive && groupesReplies.has(g.category);
      html += '<div class="ge-menu-group" data-group="' + echap(g.category) + '">'
        + (folded ? '▸' : '▾') + ' ' + echap(g.category) + '</div>';
      if(folded) return;
      g.types.forEach(function(type){
        const i = menuTypesVisibles.length;
        menuTypesVisibles.push(type);
        html += '<div class="ge-menu-item' + (i === menuIndex ? ' ge-menu-active' : '')
          + '" data-add-type="' + type + '" data-index="' + i + '">'
          + echap(META_NODES_GRAPH_SHADER[type].caption) + '</div>';
      });
    });
    html += '</div>';
    el.innerHTML = html;
    // Enfant du CANVAS et non du plan : accroché au plan, il serait zoomé avec le graphe
    // (illisible à 0.3×) et suivrait le déplacement pendant qu'on tape sa recherche.
    document.getElementById('ge-canvas').appendChild(el);

    // `pointerdown` et NON `click` : le menu vit dans #ge-plane, donc un pointerdown sur un item
    // remonte jusqu'au handler du canvas, qui referme le menu. L'item quittait alors le DOM
    // entre le pointerdown et le pointerup — et un `click` n'est jamais émis sur un élément
    // retiré entre les deux. « Ajouter un nœud » ne faisait donc rien du tout.
    el.querySelectorAll('[data-add-type]').forEach(function(it){
      it.addEventListener('pointerdown', function(ev){
        ev.preventDefault();
        ev.stopPropagation();
        addFromMenu(it.dataset.addType);
      });
    });
    el.querySelectorAll('[data-group]').forEach(function(g){
      g.addEventListener('pointerdown', function(ev){
        ev.preventDefault();
        ev.stopPropagation();
        const cat = g.dataset.group;
        if(groupesReplies.has(cat)) groupesReplies.delete(cat);
        else groupesReplies.add(cat);
        menuIndex = 0;
        renderMenuContext();
      });
    });

    const recherche = el.querySelector('#ge-menu-search');
    recherche.addEventListener('pointerdown', function(ev){ ev.stopPropagation(); });
    recherche.addEventListener('input', function(){
      menuFilter = recherche.value;
      menuIndex = 0;
      renderMenuContext();
    });
    recherche.addEventListener('keydown', function(ev){
      if(ev.key === 'Escape'){ closeMenu(); renderMenuContext(); return; }
      if(ev.key === 'Enter'){
        ev.preventDefault();
        addFromMenu(menuTypesVisibles[menuIndex]);
        return;
      }
      if(ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
      ev.preventDefault();
      if(!menuTypesVisibles.length) return;
      menuIndex = (menuIndex + (ev.key === 'ArrowDown' ? 1 : -1) + menuTypesVisibles.length)
        % menuTypesVisibles.length;
      renderMenuContext();
    });
    // Le champ est recréé à chaque frappe (re-rendu complet) : sans ces deux lignes, le focus
    // partirait après le premier caractère et la recherche serait inutilisable.
    recherche.focus();
    recherche.setSelectionRange(recherche.value.length, recherche.value.length);
    const active = el.querySelector('.ge-menu-active');
    if(active && active.scrollIntoView) active.scrollIntoView({block:'nearest'});
  }

  function applyField(el){
    // 'entree:<noeud>:<entree>:<type>[:x|y]'  ou  'field:<noeud>:<cle>:<type>'
    const target = el.dataset.field.split(':');
    const node = data.nodes.find(function(n){ return n.id === target[1]; });
    if(target[0] === 'prop'){
      const prop = propertyGraphShader(data, target[1]);
      if(prop){
        if(target[2] === 'name') renamePropertyGraphShader(data, prop.id, el.value);
        else if(target[2] === 'defaultValue'){
          prop.defaultValue = (target[3] === 'number') ? Number(el.value) : (el.value || null);
        } else {
          prop.defaultValue = Object.assign({x:0, y:0, z:0}, prop.defaultValue);
          prop.defaultValue[target[2]] = Number(el.value);
        }
      }
      save();
      render();
      return;
    }
    if(target[0] === 'entree'){
      const initial = defaultInputGraphShader(node ? node.type : '', target[2],
        (node && node.params) || {}, target[3]);
      setValueInputGraphShader(data, target[1], target[2], target[3], el.value, target[4], initial);
    } else if(node){
      node.params = node.params || {};
      node.params[target[2]] = (target[3] === 'number') ? Number(el.value) : el.value;
    }
    save();
    render();
  }

  function bindEvents(){
    document.querySelectorAll('.ge-w').forEach(function(el){
      el.addEventListener('change', function(){ applyField(el); });
      // Empêche le glisser de nœud de démarrer quand on clique dans un champ.
      el.addEventListener('pointerdown', function(ev){ ev.stopPropagation(); });
    });
    document.querySelectorAll('.ge-node').forEach(function(el){
      el.addEventListener('pointerdown', function(ev){
        if(ev.button !== 0 || ev.target.closest('.ge-badge') || ev.target.closest('.ge-w')) return;
        const id = el.dataset.id;
        const multi = ev.shiftKey || ev.ctrlKey || ev.metaKey;
        if(id !== ID_MASTER){
          if(multi){
            // Maj/Ctrl+clic ajoute ou retire de la sélection, et ne démarre PAS de glisser —
            // c'est le comportement d'Unity, où l'on compose sa sélection avant de la move.
            if(selection.has(id)) selection.delete(id);
            else selection.add(id);
            cableSelected = null;
            render();
            return;
          }
          // Cliquer un nœud DÉJÀ dans la sélection la conserve : sinon, attraper un groupe
          // de cinq nœuds pour le déplacer le réduirait à celui qu'on a typed.
          if(!selection.has(id)) selection = new Set([id]);
          cableSelected = null;
          render();
        }
        // Glisser : tout ce qui est sélectionné suit. Décalages en coordonnées du PLAN (et
        // non clientX raw) : sinon les nœuds sautent dès que le canvas défile.
        const p = posPlane(ev);
        const ids = (id === ID_MASTER) ? [ID_MASTER] : Array.from(selection);
        drag = {ids:ids, depuis:p, origines:{}};
        ids.forEach(function(i){
          const pos = data.layout[i] || {x:0, y:0};
          drag.origines[i] = {x:pos.x, y:pos.y};
        });
      });
      el.addEventListener('contextmenu', function(ev){
        ev.preventDefault();
        if(el.dataset.id === ID_MASTER) return;
        deleteNodeGraphShader(data, el.dataset.id);
        selection.delete(el.dataset.id);
        save();
        render();
      });
    });
    // UNE seule règle pour toutes les pastilles — entrée, sortie, slot du Master. Le sélecteur
    // porte sur `.ge-badge` et non sur [data-input-node] : les CHAMPS inline portent eux
    // aussi cet attribut (voir rendreNoeud/widgetValeur), et l'ancienne version branchait donc
    // la liaison sur le champ numérique lui-même — taper une valeur terminait un câble.
    document.querySelectorAll('.ge-badge').forEach(function(el){
      el.addEventListener('pointerdown', function(ev){
        if(ev.button !== 0) return;
        ev.preventDefault();
        ev.stopPropagation();   // ne pas démarrer en plus un glisser de nœud
        startLiaison(el, ev);
      });
    });
    document.querySelectorAll('[data-bb-select]').forEach(function(el){
      el.addEventListener('click', function(){
        selection = new Set([el.dataset.bbSelect]);
        render();
      });
    });
    updateHighlightLiaison();
  }

  // ---- tirage d'un câble ----
  // Attraper une pastille DÉJÀ branchée reprend le fil existant au lieu d'en commencer un
  // second : c'est le geste d'Unity pour rebrancher ailleurs, et sans ça le seul medium de
  // débrancher était de supprimer le nœud.
  function startLiaison(el, ev){
    // Un fil déjà « collé » au curseur (clic sur une pastille, sans glisser) se termine sur
    // la pastille cliquée ensuite, au lieu d'en repartir un nouveau.
    if(liaison){ finirLiaisonOn(el); return; }
    const d = el.dataset;
    const pos = posPlane(ev);
    let detache = false;
    if(d.outputNode){
      liaison = {sens:'depuis-sortie', node:d.outputNode};
    } else if(d.inputNode){
      const link = (data.links || []).find(function(l){
        return l.node === d.inputNode && l.entry === d.inputName;
      });
      const source = link && data.nodes.find(function(n){ return n.id === link.source; });
      if(link && source && !(source.params && source.params.__auto)){
        setLinkGraphShader(data, d.inputNode, d.inputName, null);
        liaison = {sens:'depuis-sortie', node:link.source};
        detache = true;
      } else {
        liaison = {sens:'depuis-entree', node:d.inputNode, entry:d.inputName};
      }
    } else if(d.targetOutput){
      const idSource = (data.outputs || {})[d.targetOutput];
      if(idSource && data.nodes.some(function(n){ return n.id === idSource; })){
        setOutputGraphShader(data, d.targetOutput, null);
        liaison = {sens:'depuis-sortie', node:idSource};
        detache = true;
      } else {
        liaison = {sens:'depuis-entree', keyOutput:d.targetOutput};
      }
    } else {
      return;
    }
    liaison.pos = pos;
    liaison.start = pos;   // pour distinguer un CLIC d'un vrai glisser (voir terminerLiaison)
    liaison.aBouge = false;
    cableSelected = null;
    if(detache){ save(); render(); }
    else { updateHighlightLiaison(); renderCables(); }
  }

  // Une pastille est une cible valide si elle est du BOUT OPPOSÉ (une sortie cherche une
  // entrée et réciproquement) et n'appartient pas au nœud d'où part le fil.
  function updateHighlightLiaison(){
    document.querySelectorAll('.ge-badge').forEach(function(el){
      el.classList.remove('ge-compatible', 'ge-incompatible');
      if(!liaison) return;
      el.classList.add(badgeCompatibleGraphShader(el.dataset, liaison, data) ? 'ge-compatible' : 'ge-incompatible');
    });
  }

  // Ce qui se trouve sous le curseur, à la tolérance de Shader Graph près : lâcher n'importe
  // où sur la LIGNE du port count pour sa pastille. Exiger la bille de 11 px, c'est très
  // exactement ce qui fait dire « je peux rien connecter ».
  function badgeSub(ev){
    const sous = document.elementFromPoint(ev.clientX, ev.clientY);
    if(!sous || !sous.closest) return null;
    const directe = sous.closest('.ge-badge');
    if(directe) return directe;
    const port = sous.closest('.ge-port');
    return port ? port.querySelector('.ge-badge') : null;
  }

  function terminerLiaison(ev){
    // Un CLIC sans déplacement laisse le fil collé au curseur : on clique la sortie, puis
    // l'entrée. Shader Graph accepte les deux gestes — tirer ET cliquer-cliquer — et
    // n'accepter que le glisser rendait le branchement introuvable pour qui cliquait.
    if(!liaison.aBouge) return;
    finirLiaisonOn(badgeSub(ev));
  }

  function finirLiaisonOn(target){
    const l = liaison;
    liaison = null;
    let change = false;
    if(l && target && !badgeCompatibleGraphShader(target.dataset, l, data)
      && badgeCompatibleGraphShader(target.dataset, l)){
      // Bonne extrémité, mais mauvais type : le dire, sinon le lâcher semble n'avoir rien fait.
      // Sur les slots vectoriels stricts, dire AUSSI par quoi commencer.
      const slot = target.dataset.targetOutput || l.keyOutput;
      report(SLOTS_VECTOR_STRICT_GRAPH_SHADER[slot]
        || 'Branchement refusé : types de port incompatibles.');
    }
    if(l && target && badgeCompatibleGraphShader(target.dataset, l, data)){
      const d = target.dataset;
      if(l.sens === 'depuis-sortie'){
        if(d.inputNode){
          change = setLinkGraphShader(data, d.inputNode, d.inputName, l.node);
          if(!change) report('Branchement refusé : ce fil refermerait une boucle.');
        } else {
          setOutputGraphShader(data, d.targetOutput, l.node);
          change = true;
        }
      } else if(l.keyOutput){
        setOutputGraphShader(data, l.keyOutput, d.outputNode);
        change = true;
      } else {
        change = setLinkGraphShader(data, l.node, l.entry, d.outputNode);
        if(!change) report('Branchement refusé : ce fil refermerait une boucle.');
      }
    }
    // `rendre` dans tous les cas : il efface le fil d'aperçu et la surbrillance, même quand
    // on a lâché dans le vide (ou quand un détachement a déjà eu lieu au pointerdown).
    if(change) save();
    render();
  }

  // ---- rectangle de sélection ----
  function rectMarquee(){
    return {x0:Math.min(marquee.x0, marquee.x1), y0:Math.min(marquee.y0, marquee.y1),
            x1:Math.max(marquee.x0, marquee.x1), y1:Math.max(marquee.y0, marquee.y1)};
  }

  function drawMarquee(){
    const plan = document.getElementById('ge-plane');
    if(!plan) return;
    let el = document.getElementById('ge-marquee');
    if(!el){
      el = document.createElement('div');
      el.id = 'ge-marquee';
      el.className = 'ge-marquee';
      plan.appendChild(el);
    }
    const r = rectMarquee();
    el.style.left = r.x0 + 'px';
    el.style.top = r.y0 + 'px';
    el.style.width = (r.x1 - r.x0) + 'px';
    el.style.height = (r.y1 - r.y0) + 'px';
  }

  function applyMarquee(){
    const r = rectMarquee();
    const plan = document.getElementById('ge-plane');
    // Un simple clic (rectangle quasi nul) ne sélectionne rien : il a déjà vidé la sélection
    // au pointerdown, et attraper un nœud effleuré de 2 px serait une surprise.
    if(plan && (r.x1 - r.x0 > 3 || r.y1 - r.y0 > 3)){
      const rp = plan.getBoundingClientRect();
      plan.querySelectorAll('.ge-node').forEach(function(el){
        const id = el.dataset.id;
        if(id === ID_MASTER) return;   // le Master ne se supprime ni ne se déplace en groupe
        const rn = el.getBoundingClientRect();
        const nx0 = rn.left - rp.left, ny0 = rn.top - rp.top;
        // INTERSECTION et non inclusion complète : Shader Graph attrape tout nœud effleuré,
        // ce qui évite d'avoir à englober largement chaque nœud.
        if(nx0 < r.x1 && nx0 + rn.width > r.x0 && ny0 < r.y1 && ny0 + rn.height > r.y0){
          selection.add(id);
        }
      });
    }
    const el = document.getElementById('ge-marquee');
    if(el) el.remove();
    marquee = null;
    render();
  }

  let effaceStatus = null;
  function report(message){
    const el = document.getElementById('ge-status');
    if(!el) return;
    el.textContent = message;
    clearTimeout(effaceStatus);
    effaceStatus = setTimeout(function(){ el.textContent = ''; }, 4000);
  }

  // Construit le DOM de la fenêtre AVANT toute référence à ses éléments (#ge-canvas, #ge-plane…)
  // — #zones existe déjà (posé par external-editor.html), le reste est à nous.
  const zones = document.getElementById('zones');
  zones.innerHTML =
    '<div class="ge-page">'
    + '<div class="ge-bar">'
    + '<input type="text" id="ge-name" class="ge-name" spellcheck="false">'
    + '<label>Mode <select id="ge-target"><option value="lit">Lit (PBR)</option>'
    + '<option value="physical">Lit (Physical)</option>'
    + '<option value="unlit">Unlit</option></select></label>'
    + '<span class="ge-help">Tirez d\'une pastille à l\'autre pour brancher · clic droit : '
    + 'add un nœud · glissez dans le vide pour sélectionner en rectangle, Maj+clic pour '
    + 'add, Ctrl+A pour tout · Suppr efface la sélection ou le fil choisi · molette : déplacer, Ctrl+molette : zoom</span>'
    + '<button class="ge-button" id="ge-btn-code" title="Voir le code TSL équivalent">&lt;/&gt; Code</button>'
    + '<span class="ge-status" id="ge-status"></span>'
    + '</div>'
    + '<div class="ge-body">'
    + '<div class="ge-blackboard"><div id="ge-blackboard-body"></div>'
    + '<select id="ge-add-property"><option value="">+ Propriété…</option>'
    + '<option value="float">Float</option><option value="vec3">Vector 3</option>'
    + '<option value="color">Color</option><option value="texture">Texture</option></select></div>'
    + '<div class="ge-canvas" id="ge-canvas"><div class="ge-plane" id="ge-plane"></div></div>'
    + '<div class="ge-preview"><div class="ge-preview-title">Aperçu</div>'
    + '<canvas id="ge-preview-canvas" width="200" height="200"></canvas>'
    + '<div class="ge-preview-note" id="ge-preview-note"></div></div>'
    + '<div class="ge-code" id="ge-code" hidden>'
    + '<div class="ge-code-bar"><span class="ge-code-title">Code TSL</span>'
    + '<button class="ge-button" id="ge-code-apply" title="Relire ce texte et reposer les nœuds '
    + 'et les liens qu\'il décrit">Appliquer au graphe</button>'
    + '<button class="ge-button" id="ge-code-regen" title="Réécrire le texte depuis le graphe — '
    + 'les modifications faites ici sont perdues">Régénérer</button>'
    + '<span class="ge-help" id="ge-code-note"></span>'
    + '<button class="ge-button" id="ge-code-close">Fermer</button></div>'
    + '<div class="ge-code-host" id="ge-code-host"></div></div>'
    + '</div>'
    + '</div>';
  document.getElementById('ge-name').addEventListener('change', function(){
    data.name = this.value.trim() || data.name;
    save();
  });
  document.getElementById('ge-target').addEventListener('change', function(){
    data.target = this.value;
    save();
    render();
  });
  document.getElementById('ge-add-property').addEventListener('change', function(){
    if(!this.value) return;
    // Une propriété neuve n'est PAS posée sur le plan : elle rejoint le blackboard, et c'est
    // en la glissant qu'on décide où (et combien de fois) on la lit.
    addPropertyGraphShader(data, this.value);
    this.value = '';
    save();
    render();
  });

  const canvas = document.getElementById('ge-canvas');
  canvas.addEventListener('pointerdown', function(ev){
    // Le menu contextuel est un enfant de #ge-plane : sans cette garde, tout pointerdown DANS
    // le menu remonte ici et le referme avant que l'item ait pu agir (voir rendreMenuContextuel).
    if(ev.target.closest && ev.target.closest('#ge-menu-ctx')) return;
    // Fil resté collé au curseur (clic sans glisser) : cliquer dans le vide l'abandonne.
    if(liaison){ liaison = null; closeMenu(); render(); return; }
    closeMenu();
    renderMenuContext();
    if(ev.button === 1){   // molette : pan
      ev.preventDefault();
      pan = {x0:ev.clientX, y0:ev.clientY, vx0:view.x, vy0:view.y};
    } else if(ev.button === 0 && (ev.target === canvas || ev.target.id === 'ge-plane')){
      // Rectangle de sélection (le « marquee » de Shader Graph). Maj/Ctrl l'ajoute à la
      // sélection en place au lieu de la remplacer.
      const additif = ev.shiftKey || ev.ctrlKey || ev.metaKey;
      if(!additif) selection = new Set();
      cableSelected = null;
      const p = posPlane(ev);
      marquee = {x0:p.x, y0:p.y, x1:p.x, y1:p.y, additif:additif};
      render();
    }
  });
  // Dépôt d'une propriété venue du blackboard : un renvoi de plus, là où on l'a lâchée.
  canvas.addEventListener('dragover', function(ev){
    if(ev.dataTransfer.types.indexOf('text/plain') === -1) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';
  });
  canvas.addEventListener('drop', function(ev){
    const paquet = ev.dataTransfer.getData('text/plain') || '';
    if(paquet.indexOf(PREFIX_DRAG_PROPERTY) !== 0) return;
    ev.preventDefault();
    const p = posPlane(ev);
    addNodePropertyGraphShader(data, paquet.slice(PREFIX_DRAG_PROPERTY.length), p.x, p.y);
    save();
    render();
  });

  // Molette = déplacement du plan, sans butée d'aucune sorte (l'ancien canvas défilait dans
  // un plan de 2400×1400 px et se bloquait à ses bords). Ctrl/⌘ + molette = zoom.
  canvas.addEventListener('wheel', function(ev){
    if(ev.target.closest && ev.target.closest('#ge-menu-ctx')) return;   // la liste du menu défile
    ev.preventDefault();
    const r = canvas.getBoundingClientRect();
    if(ev.ctrlKey || ev.metaKey){
      zoomTo(view.zoom * (ev.deltaY < 0 ? 1.1 : 1 / 1.1), ev.clientX - r.left, ev.clientY - r.top);
      return;
    }
    // Maj inverse les axes : c'est la convention de tous les canvas, et une souris sans
    // molette horizontale doit pouvoir déplacer latéralement.
    const dx = ev.shiftKey ? ev.deltaY : ev.deltaX;
    const dy = ev.shiftKey ? ev.deltaX : ev.deltaY;
    view.x -= dx;
    view.y -= dy;
    applyView();
  }, {passive:false});
  canvas.addEventListener('contextmenu', function(ev){
    if(ev.target !== canvas && ev.target.id !== 'ge-plane') return;
    ev.preventDefault();
    const r = canvas.getBoundingClientRect();
    closeMenu();   // repart d'une recherche empty, comme le « Create Node » d'Unity
    const pPlan = posPlane(ev);
    menuContext = {x: pPlan.x, y: pPlan.y, sx: ev.clientX - r.left, sy: ev.clientY - r.top};
    renderMenuContext();
  });
  document.addEventListener('pointermove', function(ev){
    if(obsolete()) return;
    if(liaison){
      const p = posPlane(ev);
      if(liaison.start && (Math.abs(p.x - liaison.start.x) > 4
        || Math.abs(p.y - liaison.start.y) > 4)) liaison.aBouge = true;
      liaison.pos = p;
      renderCables();
      return;
    }
    if(marquee){
      const p = posPlane(ev);
      marquee.x1 = p.x;
      marquee.y1 = p.y;
      drawMarquee();
      return;
    }
    if(pan){
      view.x = pan.vx0 + (ev.clientX - pan.x0);
      view.y = pan.vy0 + (ev.clientY - pan.y0);
      applyView();
      return;
    }
    if(!drag) return;
    // Tous les nœuds saisis se déplacent du MÊME écart, calculé une fois : les déplacer
    // chacun vers la position du curseur les empilerait au même endroit.
    const p = posPlane(ev);
    const dx = p.x - drag.depuis.x, dy = p.y - drag.depuis.y;
    drag.ids.forEach(function(id){
      const o = drag.origines[id];
      if(!o) return;
      data.layout[id] = {x:o.x + dx, y:o.y + dy};
      const el = document.querySelector('.ge-node[data-id="' + id + '"]');
      if(el){
        el.style.left = data.layout[id].x + 'px';
        el.style.top = data.layout[id].y + 'px';
      }
    });
    renderCables();
  });
  document.addEventListener('pointerup', function(ev){
    if(obsolete()) return;
    if(liaison){
      terminerLiaison(ev);
      return;
    }
    if(marquee){
      applyMarquee();
      return;
    }
    if(drag) save();
    drag = null;
    pan = null;
  });
  document.addEventListener('keydown', function(ev){
    if(obsolete()) return;
    if(ev.key === 'Escape' && liaison){   // abandonner un câble en cours de tirage
      liaison = null;
      render();
      return;
    }
    const inField = document.activeElement
      && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    if((ev.ctrlKey || ev.metaKey) && (ev.key === 'a' || ev.key === 'A')){
      if(inField) return;   // Ctrl+A dans la recherche du menu sélectionne son texte
      ev.preventDefault();
      selection = new Set(nodesVisibles().map(function(n){ return n.id; }));
      cableSelected = null;
      render();
      return;
    }
    if(ev.key !== 'Delete' && ev.key !== 'Backspace') return;
    if(inField) return;
    if(cableSelected){
      const morceaux = cableSelected.split(':');   // 'link:<node>:<entree>' | 'sortie:<key>'
      if(morceaux[0] === 'link') setLinkGraphShader(data, morceaux[1], morceaux[2], null);
      else setOutputGraphShader(data, morceaux[1], null);
      cableSelected = null;
      save();
      render();
      return;
    }
    const aDelete = Array.from(selection).filter(function(id){ return id !== ID_MASTER; });
    if(!aDelete.length) return;
    aDelete.forEach(function(id){ deleteNodeGraphShader(data, id); });
    selection = new Set();
    save();
    render();
  });

  const panelCode = document.getElementById('ge-code');
  document.getElementById('ge-btn-code').addEventListener('click', function(){
    panelCode.hidden = !panelCode.hidden;
    this.classList.toggle('ge-button-active', !panelCode.hidden);
    updatePanelCode();
    reportCode();
  });
  document.getElementById('ge-code-apply').addEventListener('click', applyCodeToGraph);
  document.getElementById('ge-code-regen').addEventListener('click', regenerateCode);
  document.getElementById('ge-code-close').addEventListener('click', function(){
    panelCode.hidden = true;
    document.getElementById('ge-btn-code').classList.remove('ge-button-active');
  });

  // Un graphe écrit avant le blackboard porte ses propriétés en nœuds `param.*` : on les
  // convertit à l'ouverture, et on renvoie l'état converti à la fenêtre principale tout de
  // suite — sans quoi la conversion serait refaite à chaque ouverture.
  data.properties = data.properties || [];
  if(migratePropertiesGraphShader(data)) sendUpdate(data);

  preview = previewGraphShaderEditor = createPreviewGraphShader(data);
  render();
  applyView();
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.field = field;
globalThis.openEditorGraphShader = openEditorGraphShader;