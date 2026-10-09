// ---------- Ce qu'un jeu publié n'a pas besoin de télécharger ----------
//
// Le build embarquait TOUJOURS tout le moteur. Un platformer en sprites téléchargeait donc le moteur
// de physique 3D, le reciblage de squelettes Mixamo et le niveau de détail — et un jeu 3D
// téléchargeait le solveur 2D, les tuiles et la caméra 2D.
//
// LA LISTE EST COURTE, ET C'EST DÉLIBÉRÉ. Retirer un fichier d'un jeu publié est la famille de
// défaut la plus coûteuse de ce dépôt : le symptôme est une erreur au premier clic, chez le joueur,
// sur un fichier qu'on croyait inutile. Ne sont donc facultatifs que les modules dont TOUS les sites
// d'appel du runtime ont été relevés un par un et se trouvent :
//   · soit derrière une garde `typeof`,
//   · soit dans une fonction que seule la donnée correspondante fait exécuter.
//
// UN SECOND RELEVÉ a rendu facultatifs les huit modules qui restaient, et il n'a coûté que DEUX
// gardes. Le premier relevé s'était arrêté trop tôt : il concluait « leurs symboles vivent dans un
// chemin qui tourne à chaque image ». C'était vrai du chemin, faux de son ENTRÉE — la plupart de ces
// entrées se gardaient déjà elles-mêmes :
//
//   · `rtUpdateAnimators` commence par `if(typeof updatePlayerAnimator !== 'function') return;` — et
//     `updatePlayerAnimator` vient d'`animator.js`. La garde existait, elle protégeait déjà son module.
//   · `rtUpdateAnimations` commence par `if(!rtAnims.size) return;` — sans animation, rien ne s'exécute.
//   · `rtMarkersDuringPlayback` teste `triggerMarkers`, qui vient de `anim-markers.js`.
//   · `game-character.js`, `shader-graph.js` et `lightmap-rgbm.js` ne sont cités que dans des corps de
//     méthode ou derrière `if(shaderDef)` / `if(aRgbm && aRgbm.rgbm)`.
//
// Seul `network-game.js` demandait un ajout, et pour une raison qui n'a rien à voir avec la fréquence :
// `apiFor` construisait `reseau: networkHandle()` et `estAutorite: networkIsAuthority` comme VALEURS
// de propriété, pour chaque script. Citer un identifiant absent lève déjà.
//
// Ce que ce second relevé enseigne : la question n'est jamais « ce chemin tourne-t-il souvent ? »,
// c'est « quelle est son entrée, et se garde-t-elle ? ». La première formulation avait laissé 101 Ko
// sur la table.

import { objects } from './objects.js';

/**
 * Les modules facultatifs, et ce qui les rend nécessaires.
 *
 * `besoin(data)` reçoit les données du projet telles que `buildDataProject` les produit et
 * rend vrai s'il faut embarquer le fichier. En cas de doute, il doit rendre VRAI : un module de trop
 * coûte des kilo-octets, un module missing coûte un jeu cassé.
 */
export const MODULES_OPTIONAL = [
  // --- Ce qu'un jeu 2D n'utilise pas ---
  {file: 'vendor/cannon.js', dans: 'vendor/cannon.js', pourquoi: 'physique 3D',
   besoin: function(d){ return objectsOfProject(d).some(function(o){
     // `phys` est le corps rigide 3D, `collider` sa forme. Un collider seul sert aux déclencheurs.
     return o.phys || o.collider;
   }); }},
  {file: 'js/retargeting.js', dans: 'retargeting.js', pourquoi: 'reciblage de squelettes',
   besoin: function(d){ return objectsOfProject(d).some(function(o){
     return (o.components || []).some(function(c){
       return c.type === 'SkinnedMeshRenderer' && c.data && (c.data.externalClips || []).length;
     });
   }); }},
  // LA CONDITION NE REGARDAIT QUE LE NIVEAU DE DÉTAIL, et ce module fait DEUX choses. Un jeu
  // dont aucun objet ne porte de distance de disparition partait donc sans lui — c'est-à-dire
  // sans le REGROUPEMENT EN INSTANCES, qui est ce qui tient une scène dense. Mesuré : 5 000
  // objets en 49 appels de dessin avec le module, 5 000 appels sans. La panne ne se voyait ni
  // dans l'éditeur ni dans l'aperçu — tous deux chargent tout —, uniquement dans le jeu
  // EXPORTÉ, et seulement à la cadence : aucune erreur, aucune trace.
  //
  // Le seuil est celui du regroupement lui-même (THRESHOLD_INSTANCES, js/render-perf.js) : en
  // dessous, aucun lot ne peut se former et le module ne servirait effectivement à rien.
  // Au-dessus, on embarque vingt kilo-octets pour ne pas risquer cent fois plus d'appels de
  // dessin — exactement la règle énoncée en tête de ce fichier : en cas de doute, VRAI.
  {file: 'js/render-perf.js', dans: 'render-perf.js', pourquoi: 'niveau de détail et regroupement',
   besoin: function(d){
     const list = objectsOfProject(d);
     return list.some(function(o){ return o.detail; }) || list.length >= 8;
   }},

  // --- Ce qu'un jeu 3D n'utilise pas ---
  {file: 'js/physics-2d.js', dans: 'physics-2d.js', pourquoi: 'solveur 2D',
   besoin: function(d){ return aOfPhysics2d(d); }},
  {file: 'js/world-2d.js', dans: 'world-2d.js', pourquoi: 'monde 2D',
   besoin: function(d){ return aOfPhysics2d(d); }},
  {file: 'js/tilemap.js', dans: 'tilemap.js', pourquoi: 'cartes de tuiles',
   besoin: function(d){ return objectsOfProject(d).some(function(o){
     return (o.components || []).some(function(c){ return c.type === 'Tilemap'; });
   }); }},
  {file: 'js/anim-sprite.js', dans: 'anim-sprite.js', pourquoi: 'animation de sprites',
   besoin: function(d){ return objectsOfProject(d).some(function(o){ return o.animSprite; }); }},
  {file: 'js/camera-framing.js', dans: 'camera-framing.js', pourquoi: 'caméra 2D',
   besoin: function(d){ return objectsOfProject(d).some(function(o){
     return (o.components || []).some(function(c){
       return c.type === 'CameraFollow'
         || (c.type === 'Camera' && c.data && c.data.projection === 'orthographic');
     });
   }); }},
  // sprite-2d.js sert AUSSI aux tuiles (`orderOfSort`, `materialSprite`) et à l'animation de sprite :
  // le lier au seul `sprite2d` publierait une map de tuiles sans son matériau.
  {file: 'js/sprite-2d.js', dans: 'sprite-2d.js', pourquoi: 'sprites, tuiles et ordre de tri',
   besoin: function(d){ return objectsOfProject(d).some(function(o){
     return o.sprite2d || o.animSprite
       || (o.components || []).some(function(c){ return c.type === 'Tilemap'; });
   }); }},

  // --- Les huit du second relevé ---
  {file: 'js/animator.js', dans: 'animator.js', pourquoi: 'machines à états d\'animation',
   besoin: function(d){
     // Un animator sur un objet, une action d'évènement qui règle un paramètre, ou un script qui
     // appelle `api.animator`. Les trois passent par `animator.js`.
     return objectsOfProject(d).some(function(o){ return o.animator; })
         || eventsCite(d, ['animator', 'param'])
         || scriptsCite(d, ['animator']);
   }},
  {file: 'js/anim-blend.js', dans: 'anim-blend.js', pourquoi: 'mélange de clips par os',
   // Un mélange ne vit QUE dans une machine à états : pas d'animator, pas de mélange. On ne cherche
   // pas l'état de mélange lui-même — le trouver demanderait de parcourir la machine, et se tromper
   // coûterait un personnage figé pour 5 Ko gagnés.
   // FAUX depuis le début : le runtime appelle `splitBone` à CHAQUE `playAnimation`
   // (rtRebuildActions, js/game-runtime.js), mélange ou pas. Un modèle animé par script sans
   // animator cassait au premier clip joué : « splitBone is not defined » (Zeldo, 2026-10-02).
   besoin: function(d){ return objectsOfProject(d).some(function(o){ return o.animator; }) || aOfAnimations(d); }},
  {file: 'js/anim-asset.js', dans: 'anim-asset.js', pourquoi: 'assets d\'animation',
   besoin: function(d){ return aOfAnimations(d); }},
  {file: 'js/anim-markers.js', dans: 'anim-markers.js', pourquoi: 'marqueurs d\'évènements',
   besoin: function(d){ return aOfAnimations(d); }},
  {file: 'js/network-game.js', dans: 'network-game.js', pourquoi: 'multijoueur',
   // Le TEXTE des scripts est la seule source : rien d'autre dans la scène ne dit qu'un jeu est en
   // réseau. `api.isAuthority` retombe sur « vrai » quand le module manque — un jeu solo est sa
   // propre autorité — donc un script qui n'en cite ni l'un ni l'autre ne peut pas s'en apercevoir.
   // L'api est anglaise. Les noms francais restent cherches par acquit : un script ecrit
   // avant le renommage et jamais relu citerait encore `api.network`, et publier sans le
   // module casserait le jeu chez le joueur — la garde doit pencher du cote sur.
   besoin: function(d){ return scriptsCite(d, ['network', 'isAuthority',
                                                 'network', 'estAutorite']); }},
  {file: 'js/game-character.js', dans: 'game-character.js', pourquoi: 'contrôleur de personnage 3D',
   // Les deux orthographes, meme raison que pour le reseau ci-dessus.
   besoin: function(d){ return scriptsCite(d, ['moveCharacter', 'respawn', 'bounce',
                                                 'deplacerPersonnage', 'respawn', 'bounce']); }},
  {file: 'js/shader-graph.js', dans: 'shader-graph.js', pourquoi: 'shaders par graphe',
   besoin: function(d){ return (d && d.assets || []).some(function(a){ return a.kind === 'graphShader'; }); }},
  {file: 'js/lightmap-rgbm.js', dans: 'lightmap-rgbm.js', pourquoi: 'lightmaps encodées en RGBM',
   besoin: function(d){ return (d && d.assets || []).some(function(a){ return a.rgbm; })
       || objectsOfProject(d).some(function(o){ return o.lightmapAtlas; }); }}
];

/**
 * Le TEXTE des scripts de la scène cite-t-il l'un de ces noms ?
 *
 * Certains modules ne se devinent pas depuis les données : rien dans une scène ne dit qu'un jeu est en
 * réseau ou qu'un script déplace un personnage. Mais le code des scripts EST dans les données
 * exportées, et un script qui n'écrit jamais `api.network` ne peut pas en avoir besoin.
 *
 * La recherche est volontairement GROSSIÈRE — une sous-chaîne, pas une analyse. Un commentaire qui
 * contient le mot suffit à embarquer le module : c'est le sens de prudence qu'on veut. L'inverse — un
 * appel construit dynamiquement, `api['res' + 'eau']` — resterait invisible, mais personne n'écrit ça,
 * et le prix de l'erreur est un module de 9 Ko en trop.
 */
export function scriptsCite(data, names){
  // LE CODE EST DANS L'ASSET, PAS DANS LE NŒUD. Cette fonction lisait `scripts[j].code`, champ
  // retiré du format au passage à la référence d'asset (`{scriptId, active, values}`) : elle
  // rendait donc toujours `false`, et `network-game.js` comme `game-character.js` étaient
  // SYSTÉMATIQUEMENT retirés de tout build web publié (docs/REVUE_2026-09-14.md § 2, cause 8).
  // `code` à plat est gardé en repli : les projets enregistrés avant la refonte le portent encore.
  const codeById = {};
  ((data && data.assets) || []).forEach(function(a){
    if(a && a.kind === 'script' && a.id) codeById[a.id] = String(a.code || '');
  });
  const cite = function(code){
    for(let k = 0; k < names.length; k++) if(code.indexOf(names[k]) !== -1) return true;
    return false;
  };
  const objects = objectsOfProject(data);
  for(let i = 0; i < objects.length; i++){
    // Les DEUX portes d'entrée du même script : le sac à plat et l'entrée du composant ScriptJS.
    // Le format écrit encore les deux (double stockage, § 5) — en lire une seule laisserait
    // passer la moitié des projets selon le chemin par lequel ils ont été enregistrés.
    const entries = (objects[i].scripts || []).slice();
    (objects[i].components || []).forEach(function(c){
      if(c && c.type === 'ScriptJS' && c.data) entries.push(c.data);
    });
    for(let j = 0; j < entries.length; j++){
      const e = entries[j];
      const code = String((e && e.code) || (e && e.scriptId && codeById[e.scriptId]) || e || '');
      if(cite(code)) return true;
    }
  }
  return false;
}

/** Une action d'évènement de l'un de ces genres existe-t-elle ? */
export function eventsCite(data, genres){
  const objects = objectsOfProject(data);
  for(let i = 0; i < objects.length; i++){
    const evs = objects[i].events || [];
    for(let j = 0; j < evs.length; j++){
      const actions = (evs[j] && evs[j].actions) || [];
      for(let k = 0; k < actions.length; k++){
        const t = String((actions[k] && (actions[k].type || actions[k].kind)) || '');
        for(let n = 0; n < genres.length; n++) if(t.indexOf(genres[n]) !== -1) return true;
      }
    }
  }
  return false;
}

/**
 * Y a-t-il UNE animation quelconque dans le projet ?
 *
 * Volontairement large : un asset d'animation, un objet qui en joue une, un animator, un clip
 * emprunté, ou une piste de scène. Distinguer plus finement ferait gagner quelques kilo-octets et
 * risquerait un personnage qui ne bouge plus — le bad côté du compromis.
 */
export function aOfAnimations(data){
  // UN ASSET MODÈLE SUFFIT. Ses clips ne sont pas des assets `animation` sérialisés : ils vivent
  // dans ses paramètres d'import, et le runtime les expose au chargement par `clipAssetOfModel`
  // (anim-asset.js). Et le modèle peut n'être porté par AUCUN objet de la scène — un héros créé
  // par script depuis un prefab (Zeldo, 2026-10-02 : « clipAssetOfModel is not defined » au
  // chargement du jeu publié, le héros riggé ignoré).
  if((data && data.assets || []).some(function(a){ return a.kind === 'animation' || a.kind === 'model'; })) return true;
  if(((data && data.scenes) || []).some(function(s){
    return s && s.data && s.data.tracks && s.data.tracks.length;
  })) return true;
  return objectsOfProject(data).some(function(o){
    return o.animator || o.type === 'model' || (o.components || []).some(function(c){
      return c.type === 'SkinnedMeshRenderer' && c.data && (c.data.externalClips || []).length;
    });
  });
}

/** Tous les objets sérialisés du projet, toutes scènes confondues. */
export function objectsOfProject(data){
  const tous = [];
  ((data && data.scenes) || []).forEach(function(s){
    const objects = (s && s.data && s.data.objects) || (s && s.objects) || [];
    objects.forEach(function(o){ if(o) tous.push(o); });
  });
  return tous;
}

/**
 * La physique 2D est-elle utilisée ?
 *
 * Une TILEMAP compte, et c'est le piège de cette liste : une map de tuiles produit des obstacles
 * pour le solveur 2D même si aucun objet ne porte de body. Un niveau fait d'un décor de tuiles et
 * d'un personnage sans `corps2d` — un jeu de puzzle, un point-and-click — n'aurait alors pas de
 * solveur, et rien ne collisionnerait. On préfère embarquer 19 Ko de trop.
 */
export function aOfPhysics2d(data){
  return objectsOfProject(data).some(function(o){
    return o.body2d || o.collider2d || o.controller2d
      || (o.components || []).some(function(c){ return c.type === 'Tilemap'; });
  });
}

/**
 * Les fichiers à EMBARQUER parmi les facultatifs, et ceux qu'on laisse de côté.
 *
 * Rend `{embarques: [...], retires: [{fichier, pourquoi}], octetsConnus: n}` — `retires` sert à le
 * DIRE à l'auteur. Un allègement silencieux serait la pire version de cette fonctionnalité : le jour
 * où elle se trompe, personne ne saurait qu'elle a retiré quelque chose.
 */
export function trimmingBuild(data){
  const embarques = [], retires = [];
  MODULES_OPTIONAL.forEach(function(m){
    if(m.besoin(data)) embarques.push(m.file);
    else retires.push({file: m.file, dans: m.dans, pourquoi: m.pourquoi});
  });
  return {embarques: embarques, retires: retires};
}

/** Un module facultatif est-il embarqué ? Utilisé par `pageIndexBuild` pour ses balises. */
export function moduleEmbedded(trimming, dans){
  if(!trimming) return true;                 // pas d'allègement calculé : on embarque tout
  return trimming.embarques.some(function(f){
    const m = MODULES_OPTIONAL.find(function(x){ return x.file === f; });
    return m && m.dans === dans;
  });
}
