// ---------- Description déclarative des propriétés de matériau ----------
// UNE seule table décrit chaque propriété : son type, sa plage, son libellé, ce dont elle
// dépend et pourquoi elle existe. L'inspecteur en est le RENDU, le lecteur de formulaire
// en est l'INVERSE, et le copilote la lit pour savoir ce qu'il a le droit d'écrire.
//
// POURQUOI. Avant, `sectionMaterialHtml()` écrivait du HTML à la main avec les dépendances
// en `if` à l'intérieur. Ça marche très bien pour UN matériau et pas du tout pour deux —
// mais surtout, ces règles étaient illisibles pour une machine. Le modèle savait créer un
// objet parce que `COMMANDS` le décrit ; il ne savait pas qu'un lissage va de 0 à 1, qu'il
// multiplie sa map, ou qu'une intensité de normale est sans effet sans map de normales.
// Ces règles existaient, en commentaires et en infobulles : lisibles par un humain, par
// personne d'autre.
//
// C'est le seul endroit de l'éditeur où l'on ne rattrape personne : chez Unity l'inspecteur
// est engendré par le shader, écrit pour des humains qui cliquent. Ici la même description
// sert l'humain ET le modèle.
//
// DÉPENDANCES, deux formes qui ne disent pas la même chose :
//   requiert + 'greyed'  : le champ reste visible mais inert — on veut qu'on VOIE qu'il
//                         existe et qu'on comprenne pourquoi il ne fait rien.
//   requiert + 'hidden' : le champ disparaît — il n'aurait aucun sens à afficher.
// `requiert` est une liste : au moins une des clés doit être renseignée.

export const PROPS_MATERIAL = [
  {section:'Base'},
  {key:'color', id:'ip-mcouleur', type:'color', label:'Couleur',
   help:'Multiplie l\'albédo : laissez-la blanche quand une texture porte déjà la teinte.'},
  {key:'smoothness', id:'ip-mliss', type:'number', label:'Lissage', min:0, max:1, step:0.05,
   help:'Smoothness : 1 = miroir, 0 = mat. MULTIPLIE la map de lissage quand il y en a une '
      + '(masque combiné ou map de rugosité) : 1 la laisse passer telle quelle.'},
  {key:'metal', id:'ip-mmet', type:'number', label:'Métal', min:0, max:1, step:0.05,
   help:'Multiplie la map de métal quand il y en a une : 1 la laisse passer telle quelle.'},
  {key:'emissive', id:'ip-memi', type:'color', label:'Émissif',
   help:'Multiplie la map émissive. Noir par défaut ; brancher une map le passe à blanc, '
      + 'la débrancher le remet à noir.'},
  {key:'opacity', id:'ip-mopa', type:'number', label:'Opacité', min:0, max:1, step:0.05},
  {key:'doubleSided', id:'ip-mdouble', type:'checkbox', label:'Double face'},

  {section:'Maps PBR'},
  {key:'texAsset', type:'texture', label:'Albedo'},
  {key:'normalAsset', type:'texture', label:'Normale'},
  {key:'normalIntensity', id:'ip-mnormint', type:'number', label:'Int. normale',
   min:0, max:4, step:0.1, requires:['normalAsset'], ifMissing:'greyed',
   help:'Sans effet tant qu\'aucune map de normales n\'est branchée.'},
  {key:'normalDirectX', id:'ip-mnormdx', type:'checkbox', label:'Normale DirectX',
   requires:['normalAsset'], ifMissing:'hidden',
   help:'À cocher si la map de normales a été exportée en convention DirectX (vert vers '
      + 'le bottom) au lieu d\'OpenGL, la convention de glTF et de three. Sans ça, le relief '
      + 'est INVERSÉ : les bosses deviennent des creux, sans la moindre erreur pour le dire. '
      + 'Substance exporte les deux selon le préréglage ; l\'extraction des matériaux checked '
      + 'cette case toute seule quand le nom du fichier l\'annonce.'},
  {key:'combineAsset', type:'texture', label:'Masque comb.',
   help:'Une seule texture pour trois canaux. Convention native glTF (Khronos) : R occlusion · '
      + 'G rugosité · B métal — celle qu\'exportent Blender, Substance et tout .glb. Un masque '
      + 'peint pour Unity HDRP se déclare tel quel (Empaquetage ci-dessous) et il est converti. '
      + 'Prioritaire sur les trois maps séparées.'},
  {key:'combinePacking', id:'ip-mpack', type:'choice', label:'Empaquetage',
   requires:['combineAsset'], ifMissing:'hidden',
   options:[['orm', 'glTF / ORM — R occl. · G rugosité · B métal'],
            ['unity', 'Unity HDRP — R métal · G occl. · A lissage']],
   help:'Dans quel ordre les canaux de CETTE texture sont peints. glTF est notre convention '
      + 'native : la texture part au GPU telle quelle. Les autres sont converties au '
      + 'chargement — même résultat à l\'écran, une passe et une copie en mémoire en plus.'},
  {key:'roughnessAsset', type:'texture', label:'Rugosité (map)'},
  {key:'metalAsset', type:'texture', label:'Métal (map)'},
  {key:'aoAsset', type:'texture', label:'Occlusion'},
  {key:'aoIntensity', id:'ip-maoint', type:'number', label:'Int. AO', min:0, max:2, step:0.1,
   requires:['combineAsset', 'aoAsset'], ifMissing:'greyed',
   help:'Sans effet tant qu\'aucune occlusion (map séparée ou masque combiné) n\'est branchée.'},
  {key:'emissiveAsset', type:'texture', label:'Émissive (map)'},
  {key:'lightmapAsset', type:'texture', label:'Lightmap'},
  {key:'lightmapIntensity', id:'ip-mlmint', type:'number', label:'Int. lightmap',
   min:0, max:5, step:0.1, requires:['lightmapAsset'], ifMissing:'hidden',
   help:'Multiplie l\'éclairage précalculé. 1 = tel qu\'il a été cuit.'},
  {key:'lightmapUv', id:'ip-mlmuv', type:'choice', label:'Jeu d\'UV',
   requires:['lightmapAsset'], ifMissing:'hidden',
   options:[[1, '2ᵉ game (uv1) — dépliage de lightmap'], [0, '1er game (uv) — mêmes UV que les textures']],
   help:'Une lightmap est défoldée sur son PROPRE game d\'UV, sans chevauchement — c\'est le '
      + '2ᵉ, et c\'est ce que produit un export depuis Blender. Le 1er n\'a de sens que pour '
      + 'une lightmap peinte à la main sur les UV de texture. L\'éditeur ne CUIT pas les '
      + 'lightmaps : il accepte celles cuites ailleurs (Blender exporte le dépliage en 2e game '
      + 'd\'UV dans le .glb). Si le maillage n\'a qu\'un seul game d\'UV et que le 2e est '
      + 'demandé, l\'éclairage est plaqué n\'importe où — la bar d\'état le signale.'},
  {key:'heightAsset', type:'texture', label:'Hauteur',
   help:'La hauteur n\'est pas de la parallaxe : three ne sait pas décaler les UV dans le '
      + 'shader comme le fait le hauteur Map d\'Unity. Relief/Déplacement (ci-dessous) sont ce '
      + 'qu\'il sait faire, et ils sont honnêtes sur leur coût.'},
  {key:'heightMode', id:'ip-mhmode', type:'choice', label:'Mode hauteur',
   requires:['heightAsset'], ifMissing:'hidden',
   options:[['relief', 'Relief (bump) — toute géométrie'],
            ['move', 'Déplacement — maillage subdivisé requis']],
   help:'Relief : la lumière fait croire au creux, la silhouette ne bouge pas — marche sur '
      + 'n\'importe quel maillage. Déplacement : les sommets bougent vraiment, mais un cube '
      + 'en a huit et il ne se passera RIEN de visible tant que le maillage n\'est pas '
      + 'subdivisé — le mode Relief donne un résultat immédiat partout.'},
  {key:'heightIntensity', id:'ip-mhint', type:'number', label:'Int. hauteur',
   min:0, max:5, step:0.05, requires:['heightAsset'], ifMissing:'hidden',
   help:'En mode Déplacement, c\'est une hauteur EN MÈTRES : 1 est énorme, essayez 0,05. '
      + 'Le gris medium de la map vaut « surface d\'origine ».'},

  {section:'UV (toutes les maps)'},
  {key:'tiling', id:['ip-mtx', 'ip-mty'], type:'pair', label:'Tuilage X/Y', step:0.5,
   help:'Vaut pour TOUTES les cartes du matériau à la fois : il n\'y a pas de tuilage par '
      + 'emplacement.'},
  {key:'offset', id:['ip-mdx', 'ip-mdy'], type:'pair', label:'Décalage X/Y', step:0.05}
];

// ---------- La table devient un PARAMÈTRE, elle n'est plus une constante ----------
// Tout ce qui suit accepte une table et retombe sur PROPS_MATERIAL quand on ne lui en donne
// pas. C'est ce qui permet à un matériau de plugin (Editor.enregistrerMateriau) d'être
// rendu, relu, validé et décrit par EXACTEMENT le même code que le matériau natif — et non
// par une seconde implémentation « pour les plugins », qui divergerait au premier champ
// ajouté. Un spécialiste shader décrit ses uniformes dans ce format et hérite de
// l'inspecteur, du bornage et du copilote sans écrire une ligne d'interface.
export function tableOr(table){ return Array.isArray(table) ? table : PROPS_MATERIAL; }

// État d'une propriété pour un matériau donné : visible, active, et pourquoi pas.
export function statePropMaterial(d, p){
  if(!d.requires) return {visible:true, active:true, reason:null};
  const satisfait = d.requires.some(function(k){ return !!p[k]; });
  if(satisfait) return {visible:true, active:true, reason:null};
  const reason = 'demande ' + d.requires.join(' ou ');
  return {visible:(d.ifMissing !== 'hidden'), active:false, reason:reason};
}

export function propMaterialByKey(key, table){
  return tableOr(table).find(function(d){ return d.key === key; }) || null;
}

// ---------- Rendu : l'inspecteur est la PROJECTION de la table ----------
export function renderPropsMaterial(p, table){
  return tableOr(table).map(function(d){
    if(d.section) return '<div class="sec">' + escapeHtml(d.section) + '</div>';
    if(d.note) return (d.when && !d.when(p)) ? '' : '<div class="ip-note">' + d.note + '</div>';
    const e = statePropMaterial(d, p);
    if(!e.visible) return '';
    if(d.type === 'texture') return ipSlotTexture(d.key, d.label, p, d.help);
    if(d.type === 'color') return ipColor(d.id, d.label, p[d.key], d.help);
    if(d.type === 'checkbox')    return ipCell(d.id, d.label, p[d.key], d.help);
    if(d.type === 'choice')   return ipSelect(d.id, d.label, d.options, p[d.key], d.help);
    if(d.type === 'pair')   return ipTwoNumbers(d.id[0], d.id[1], d.label, p[d.key], d.step);
    return ipNumber(d.id, d.label, p[d.key], d.step, d.min, d.max, !e.active, d.help);
  }).join('');
}

// ---------- Lecture : l'inverse exact du rendu ----------
// Un champ absent du DOM n'écrase RIEN : c'est ce qui permet aux propriétés masquées de
// garder leur valeur pendant qu'elles ne sont pas affichées.
export function readPropsMaterialFromDom(p, table){
  tableOr(table).forEach(function(d){
    if(!d.key || d.type === 'texture') return;   // les textures passent par donnees-tex-slot
    if(d.type === 'pair'){
      const a = document.getElementById(d.id[0]), b = document.getElementById(d.id[1]);
      if(a && b) p[d.key] = [ipNum(d.id[0], p[d.key][0]), ipNum(d.id[1], p[d.key][1])];
      return;
    }
    if(!document.getElementById(d.id)) return;
    if(d.type === 'color') p[d.key] = ipText(d.id) || p[d.key];
    else if(d.type === 'checkbox') p[d.key] = ipChecked(d.id, p[d.key]);
    else if(d.type === 'choice') p[d.key] = document.getElementById(d.id).value || d.options[0][0];
    else p[d.key] = clampProp(d, ipNum(d.id, p[d.key]));
  });
}

export function clampProp(d, v){
  let x = v;
  if(d.min !== undefined) x = Math.max(d.min, x);
  if(d.max !== undefined) x = Math.min(d.max, x);
  return x;
}

// ---------- Validation : ce que le copilote a le droit d'écrire ----------
// Renvoie {ok, valeur, message}. Refuser en expliquant vaut mieux qu'accepter en silence :
// un modèle qui écrit `lissage: 12` doit apprendre la plage, pas produire un matériau faux.
export function validatePropMaterial(key, value, p, table){
  const d = propMaterialByKey(key, table);
  if(!d) return {ok:false, message:'propriété inconnue : ' + key};
  const e = statePropMaterial(d, p || {});
  if(d.type === 'number'){
    const n = parseFloat(value);
    if(!isFinite(n)) return {ok:false, message:d.label + ' attend un nombre'};
    if((d.min !== undefined && n < d.min) || (d.max !== undefined && n > d.max))
      return {ok:false, message:d.label + ' va de ' + d.min + ' à ' + d.max + ' (reçu ' + n + ')'};
    return {ok:true, value:n,
            message:e.active ? null : d.label + ' est écrit mais sans effet : il ' + e.reason};
  }
  if(d.type === 'choice'){
    const vals = d.options.map(function(o){ return o[0]; });
    if(vals.indexOf(value) === -1)
      return {ok:false, message:d.label + ' attend ' + vals.join(' ou ') + ' (reçu ' + value + ')'};
    return {ok:true, value:value};
  }
  if(d.type === 'checkbox') return {ok:true, value:(value === true || value === 'true')};
  if(d.type === 'color'){
    if(!/^#[0-9a-fA-F]{6}$/.test(String(value)))
      return {ok:false, message:d.label + ' attend une couleur #rrggbb (reçu ' + value + ')'};
    return {ok:true, value:String(value)};
  }
  return {ok:true, value:value};
}

// La table, en JSON, pour le copilote. Les fonctions et le HTML des notes n'y sont pas :
// un modèle a besoin des RÈGLES, pas de la mise en page.
export function describeMaterialForAI(table){
  return tableOr(table).filter(function(d){ return d.key; }).map(function(d){
    const o = {property:d.key, type:d.type, caption:d.label};
    if(d.min !== undefined) o.min = d.min;
    if(d.max !== undefined) o.max = d.max;
    if(d.options) o.values = d.options.map(function(x){ return x[0]; });
    if(d.requires){
      o.requires = d.requires;
      o.ifMissing = (d.ifMissing === 'hidden') ? 'sans objet' : 'sans effet';
    }
    if(d.help) o.note = d.help;
    return o;
  });
}

// ---------- Le format, gardé par du code plutôt que par de la relecture ----------
// Ce fichier est le PATRON qu'un plugin doit suivre (Editor.enregistrerMateriau). Un patron
// qu'on se contente de documenter est un patron qu'on suit à peu près : chaque contrôle
// ci-dessous correspond à une manière de le rater qui ne lève AUCUNE error et produit un
// inspecteur plausible mais faux. On refuse à l'enregistrement, en nommant la cause, plutôt
// que de laisser le plugin s'installer et le champ mentir.
export const TYPES_PROP_MATERIAL = ['number', 'color', 'checkbox', 'choice', 'pair', 'texture'];

// Identifiant DOM déterministe. Le préfixe 'ip-' n'est pas cosmétique : le gestionnaire
// 'change' de l'inspecteur (import-settings.js) ignore tout champ dont l'id ne commence pas
// par là — un id inventé autrement donnerait un champ qu'on peut modifier et qui n'est
// jamais relu.
export function idPropAuto(prefixe, key){ return 'ip-' + prefixe + '-' + key; }

// {erreurs:[...], table:<copie normalisée, ids remplis>}. La table d'origine n'est jamais
// modifiée : un plugin peut réutiliser son tableau littéral d'un enregistrement à l'autre.
export function checkTableMaterial(table, prefixe){
  const errors = [];
  if(!Array.isArray(table) || table.length === 0){
    return {errors:['`proprietes` doit être un tableau non vide au format de js/material-props.js'],
            table:[]};
  }
  const vues = {};
  const keysTable = table.filter(function(d){ return d && d.key; }).map(function(d){ return d.key; });
  const keysNatives = (typeof MATERIAL_DEFAULT !== 'undefined') ? MATERIAL_DEFAULT : {};

  const output = table.map(function(d, i){
    const ou = 'properties[' + i + ']';
    if(!d || typeof d !== 'object'){ errors.push(ou + ' n\'est pas un objet'); return null; }
    if(d.section !== undefined || d.note !== undefined) return d;   // séparateurs : rien à vérifier
    if(!d.key){ errors.push(ou + ' n\'a ni `key`, ni `section`, ni `note`'); return null; }
    if(vues[d.key]){
      // Deux descripteurs pour la même clé : les DEUX champs s'affichent, un seul est relu.
      errors.push(ou + ' : la clé « ' + d.key + ' » est déclarée deux fois');
      return null;
    }
    vues[d.key] = true;

    // Un type inconnu ne lève rien : renderPropsMaterial tombe au bout de sa chaîne de `if`
    // et rend un champ NUMÉRIQUE. Une couleur mal typée devient un curseur, en silence.
    if(TYPES_PROP_MATERIAL.indexOf(d.type) === -1){
      errors.push(ou + ' (« ' + d.key + ' ») : type « ' + d.type + ' » inconnu — attendus : '
        + TYPES_PROP_MATERIAL.join(', '));
      return null;
    }
    // Même clé que le matériau natif mais autre type : le même champ du même projet serait
    // rendu et borné de deux façons selon le matériau sélectionné.
    const native = propMaterialByKey(d.key);
    if(native && native.type !== d.type){
      errors.push(ou + ' : « ' + d.key + ' » existe déjà en natif avec le type « '
        + native.type +' », pas « ' + d.type + ' »');
      return null;
    }
    if(d.type === 'choice'){
      const ok = Array.isArray(d.options) && d.options.length
        && d.options.every(function(o){ return Array.isArray(o) && o.length === 2; });
      // Sans options, ipSelect rend une liste vide et la relecture déréférence options[0][0].
      if(!ok){ errors.push(ou + ' (« ' + d.key + ' ») : `options` doit être une liste de paires [valeur, libellé]'); return null; }
    }
    // min > max : clampProp renvoie alors toujours `max`, quelle que soit la saisie.
    if(d.min !== undefined && d.max !== undefined && d.min > d.max){
      errors.push(ou + ' (« ' + d.key + ' ») : min ' + d.min + ' est supérieur à max ' + d.max);
      return null;
    }
    if(d.requires !== undefined){
      if(!Array.isArray(d.requires) || !d.requires.length){
        errors.push(ou + ' (« ' + d.key + ' ») : `requiert` doit être une liste de clés');
        return null;
      }
      // Une dépendance vers une clé qui n'existe nulle part n'est jamais satisfaite : le
      // field reste grisé POUR TOUJOURS, et l'infobulle nomme une map introuvable.
      const fantomes = d.requires.filter(function(k){
        return keysTable.indexOf(k) === -1 && keysNatives[k] === undefined;
      });
      if(fantomes.length){
        errors.push(ou + ' (« ' + d.key + ' ») : `requiert` cite ' + fantomes.join(', ')
          + ' — aucune propriété de ce nom, le champ resterait inert sans raison visible');
        return null;
      }
      if(d.ifMissing !== undefined && d.ifMissing !== 'greyed' && d.ifMissing !== 'hidden'){
        errors.push(ou + ' (« ' + d.key + ' ») : `siAbsent` vaut « grise » ou « masque »');
        return null;
      }
    }

    // Copie + id posé si le plugin n'en a pas donné : un auteur de shader décrit sa physique,
    // il n'a pas à inventer des identifiants DOM uniques à la main.
    const copie = Object.assign({}, d);
    if(d.type === 'pair'){
      if(!Array.isArray(copie.id) || copie.id.length !== 2){
        copie.id = [idPropAuto(prefixe, d.key) + '-x', idPropAuto(prefixe, d.key) + '-y'];
      }
    } else if(d.type !== 'texture' && !copie.id){
      copie.id = idPropAuto(prefixe, d.key);
    }
    return copie;
  });

  return {errors:errors, table:output.filter(function(d){ return d !== null; })};
}

// Valeurs de départ d'un matériau décrit par cette table. Un descripteur peut porter
// `defaut` ; sinon on déduit du type la valeur la plus neutre — la seule règle qui compte
// est qu'AUCUNE clé de la table ne reste `undefined`, faute de quoi le champ correspondant
// s'shown vide et la première relecture du DOM écrit NaN sans que rien ne le dise.
export function defaultsFromTable(table){
  const out = {};
  tableOr(table).forEach(function(d){
    if(!d.key) return;
    if(d.defaultValue !== undefined){ out[d.key] = JSON.parse(JSON.stringify(d.defaultValue)); return; }
    if(d.type === 'number')       out[d.key] = (d.min !== undefined) ? d.min : 0;
    else if(d.type === 'color') out[d.key] = '#ffffff';
    else if(d.type === 'checkbox')    out[d.key] = false;
    else if(d.type === 'choice')   out[d.key] = d.options[0][0];
    else if(d.type === 'pair')   out[d.key] = [1, 1];
    else                          out[d.key] = null;   // texture : aucun asset branché
  });
  return out;
}
