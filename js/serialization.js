// ---------- Sérialisation / sauvegarde / chargement de scène ----------
import { migrateMachinesOfScene, skinnedMeshRendererOf } from './anim-models.js';
import { anim, btnPlayback, closeClipAsset, keySel, setKeySel, tracksOfScene, updateTimeline } from './animation.js';
import { adoptAssetId, analyzeModel, applyTextureRaw, assetId, assets, createAssetAnimation, createAssetModel, createAssetTexture, folderCurrent, newClipId, nextAssetId, previewObject3D, reserveAssetId, setFolderCurrent, syncClipAssetsOfModel, updateProject } from './assets.js';
import { createAssetAudio, createAssetLoop, createAssetSfx } from './audio.js';
import { ed, ensureGame } from './component-data.js';
import { applyComponents, bagsOverriddenBy, nodeOfComponents, syncComponents } from './component-migration.js';
import { faceCameraToPlane } from './components/component-camera.js';
import { rebuildTilemap } from './components/component-tilemap.js';
import { logConsole } from './console.js';
import { inputs } from './editor-input.js';
import { ENV_DEFAULT, applyEnvironment, env } from './environment.js';
import { setStatus, updateHierarchy } from './hierarchy.js';
import { histo, restoreState, stateCurrent } from './history.js';
import { applyImportModel } from './import-settings.js';
import { removeHelper } from './inspector.js';
import { collectAtlasLightmap, reapplyAtlasLightmap } from './lightmap-atlas.js';
import { MATERIAL_DEFAULT, applyMaterialOn, invert01, previewMaterial, smoothingFromRoughness } from './materials.js';
import { applyNodeMixin } from './node.js';
import { counter, createFromCreatable, createHelperFor, isSceneObject, listMats, objects } from './objects.js';
import { phys, stopSimulation } from './physics.js';
import { typePlugin } from './plugins.js';
import { ensurePostProfileDefaults } from './post-profile.js';
import { VERSION_MANIFEST, registerInFolder, removeFilesAssetOnDisk, writeFileInFolder } from './project-folder.js';
import { endSave, markProjectSaved, startSave } from './project-dirty.js';
import { changedSinceWrite, noteWritten, resetWriteCache } from './write-cache.js';
import { LAYERS_DEFAULT, PROJECT_SETTINGS_KEYS_MIGRATED, projectSettingsOf } from './project-settings.js';
import { cloudPathsToRemove, saveCloudProject, scenesToWrite } from './cloud-project.js';
import { openConflictScreen } from './conflict-screen.js';
import { applyProjectSettings, folderWatch, folderWatchEnabled, openCloudProjectFromUrl, project, updateScenes } from './project.js';
import { gizmoAttach, grid, hemi, proxyView, scene, sun, tcVisual } from './scene.js';
import { codeOfScriptEntry } from './scripts.js';
import { select } from './selection.js';
import { emptyPalette, parsePalette, serializePalette } from './tile-palette.js';
import { ppu2dOfProject } from './view-gizmo.js';
import { loop } from './viewport.js';
import { checkerPixels, unloadedAssetsMessage, withRetry } from './load-retry.js';

export function findRefs(o){
  const r = {light: ed(o).light || null, cam: ed(o).cam || null};
  o.children.forEach(function(e){
    if(e.isLight && !r.light) r.light = e;
    if(e.isCamera && !r.cam) r.cam = e;
  });
  return r;
}

export function serializeObject(o){
  const t = o.userData.type;
  const d = {
    id: o.id,
    name: o.name,
    pos: o.position.toArray(), quat: o.quaternion.toArray(), ech: o.scale.toArray(),
    // L'INTENTION, pas l'etat de rendu : un objet regroupe dans un lot d'instances porte
    // `visible = false` pour que le lot le dessine a sa place. Ecrire ce faux-la, c'etait
    // enregistrer un projet dont tout le decor est masque — un fichier corrompu par une
    // optimisation, et qui ne se decouvre qu'a la reouverture. Voir js/render-perf.js.
    visible: visibleIntent(o),
    ombreProjetee: (o.castShadow !== undefined) ? o.castShadow : true,
    ombreRecue: (o.receiveShadow !== undefined) ? o.receiveShadow : true,
    // Un parent COMPTE dès qu'il est un NŒUD, et un nœud se reconnaît à son tableau de
    // composants (applyNodeMixin). La condition interrogeait `userData.type`, que la racine du
    // monde 2D n'avait pas : le lien de parenté de chaque objet 2D était écrit `null`, et ils
    // redevenaient des racines détachées à la relecture.
    //
    // Et PAS `isSceneObject(o.parent)` : un template de prefab est sérialisé détaché de la
    // scène (serializeTree sur sa racine), donc hors index — la parenté y partirait à null.
    //
    // Parenté sous un nœud de MODÈLE (une arme dans la main) : le parent écrit est la racine de
    // l'instance, et `parentNode` dit sous quel nœud — lui n'est pas sérialisé, il est regénéré.
    parent: (o.parent && o.parent.userData && Array.isArray(o.parent.userData.components))
      ? ((o.parent.userData.modelNode !== undefined && typeof modelRootOf === 'function')
        ? modelRootOf(o.parent).id : o.parent.id) : null,
    parentNode: (o.parent && o.parent.userData && o.parent.userData.modelNode !== undefined)
      ? o.parent.userData.modelNode : undefined,
    game: o.userData.game ? JSON.parse(JSON.stringify(o.userData.game)) : null,
    // distance de disparition (LOD) — absente quand elle vaut 0, pour ne pas alourdir
    // chaque objet d'un réglage neutre
    detail: o.userData.detail ? JSON.parse(JSON.stringify(o.userData.detail)) : null,
    prefabId: o.userData.prefabId || null,
    materialId: o.userData.materialId || null,
    // `terr`, `subScene` et `probe` NE SONT PLUS ÉCRITS.
    //
    // C'est la première marche de la sortie du double stockage (docs/REVUE_2026-09-10.md § 3.1).
    // Le format écrivait ces trois données DEUX FOIS — une fois à plat ici, une fois dans
    // l'entrée `components` du composant qui les possède — et `rebuildTree` ne relisait déjà
    // plus que la seconde : c'est `Terrain`/`SubScene`/`Reflection` qui reconstruisent leur sac
    // depuis leurs données de composant. La copie à plat était donc du poids mort dans chaque
    // fichier de scène, et surtout une SECONDE vérité que rien ne réconciliait le jour où les
    // deux diffèrent (fichier édité à la main, fusion de scènes, migration).
    //
    // Les fichiers déjà enregistrés ne perdent rien : rien ne lisait ce champ.
    // Les dix-sept sacs qui restent (`phys`, `collider`, `scripts`…) sont encore RELUS par
    // `rebuildTree`, et leur retrait demande d'abord que leur composant sache se reconstruire
    // seul — ce que `mergeIntoBag`/`hydrate` viennent de rendre vrai (§ 3.3).

    // `uiDoc`, `animator`, `sprite2d`, `animSprite`, `body2d`, `collider2d`, `controller2d` NE
    // SONT PLUS ÉCRITS À PLAT : leurs composants (`UIDocument`, `AnimatorController`,
    // `SpriteRenderer`, `SpriteAnimator`, `Rigidbody2D`, `Collider2D`, `CharacterController2D`)
    // les écrivent déjà dans `components[]` — même sortie du double stockage que `phys`,
    // `collider`, `scripts`, `audio`, `part`, `events` ci-dessus.
    // Note sur `animSprite` : c'est ce nom-là qu'écrit le composant, jamais `_animSprite`, qui
    // est l'état de LECTURE (où on en est dans la suite) — l'écrire figerait chaque personnage
    // sur l'image qu'il avait au moment de la sauvegarde.
    // `events` N'EST PLUS ÉCRIT À PLAT : le composant `Events` l'écrit déjà dans `components[]`
    // (js/components/component-events.js) — même sortie du double stockage que les treize
    // autres sacs listés plus haut.
    // Le rangement des UV dans l'atlas de lightmap, une affine par maillage. On persiste
    // ces quatre nombres et pas le jeu d'UV lui-même : le tableau serait lourd, redondant
    // avec le modèle, et surtout on veut pouvoir rejouer le rangement sur le dépliage
    // D'ORIGINE. Sans ça, rouvrir un projet cuit remet l'uv1 du fichier .glb — l'attribut
    // existe, donc aucun contrôle ne bronche, et la lightmap se plaque n'importe où.
    // CE QUE LE NŒUD EST. C'est la seule source : le champ `type` a disparu du format, et les
    // données qui le doublaient avec (la forme et le matériau d'un maillage, la couleur d'une
    // lumière, le champ de vision d'une caméra, l'asset d'un modèle) vivent maintenant dans le
    // composant qui les possède, écrites une seule fois.
    components: componentEntriesOf(o),
    lightmapAtlas: (typeof collectAtlasLightmap === 'function')
      ? collectAtlasLightmap(o) : null
  };
  // Une INSTANCE DE MODÈLE porte les écarts de ses nœuds au fichier (js/model-nodes.js) : ses
  // nœuds ne sont pas sérialisés pour eux-mêmes.
  if(o.getComponent && o.getComponent('Model') && typeof captureModelOverrides === 'function'
     && o.userData.modelNode === undefined){
    const a = (typeof assets !== 'undefined')
      ? assets.find(function(x){ return x.id === o.userData.assetId && x.kind === 'model'; }) : null;
    d.modelNodes = captureModelOverrides(o, a ? a.template : null, serializeComponentsOf);
  }
  // Animations empruntées à un AUTRE asset : `externalClips` (SkinnedMeshRenderer.serialize(),
  // js/components/component-skinned-mesh.js) l'écrit déjà via `d.components` ci-dessus — rien
  // de plus à faire ici pour ce champ (voir js/anim-models.js, `attachAnimationExternal`).
  // LES TYPES DE PLUGIN, et eux seuls, écrivent encore un `type`.
  //
  // Ce que le nœud EST se lit dans `components` : la forme, la lumière, la caméra, le terrain,
  // le modèle ont tous leur composant, qui porte ses propres données (`d.geo`, `d.lum`, `d.fov`,
  // `d.asset` ont disparu du format — c'étaient les mêmes valeurs, écrites deux fois).
  //
  // Un type de plugin, lui, n'a pas de composant à nommer : `registerTypeObject` (js/plugins.js)
  // est une API publique clé sur `userData.type`, et son état passe par `tp.serialize(o)`.
  const tp = (typeof typePlugin === 'function') ? typePlugin(t) : null;
  if(tp){
    d.type = t;
    d.plug = tp.serialize ? JSON.parse(JSON.stringify(tp.serialize(o) || null)) : null;
  } else if(o.userData.plugAbsent){
    // le plugin manquait au chargement : on rend ses données telles quelles
    d.type = o.userData.plugAbsent.type;
    d.plug = o.userData.plugAbsent.plug;
  }
  return d;
}

// LES DÉBRIS DE CLONE SONT DES COMPOSANTS AUSSI. `Object3D.clone()` recopie userData par JSON :
// chaque composant en ressort en objet nu, tel que l'écrit `Component.toJSON` —
// `{typeName, active, ...serialize()}`. Une copie POSÉE dans la scène les reconstruit
// (reenableSubTree, objects.js), mais le GABARIT d'un prefab (createPrefabFromSelection,
// applyAtPrefab) reste un clone détaché : il ne porte QUE des débris. Les écarter faisait
// enregistrer chaque prefab sans son maillage, sa lumière ni son script — des groupes vides,
// invisibles et intouchables une fois le projet rouvert ou le jeu lancé.
function componentEntriesOf(o){
  return (o.userData.components || []).map(function(c){
    if(!c) return null;
    if(c.constructor && c.constructor.typeName){
      return { type: c.constructor.typeName, data: c.serialize(), active: c.active !== false };
    }
    if(typeof c.typeName === 'string' && c.typeName){
      const data = Object.assign({}, c);
      delete data.typeName; delete data.active;
      return { type: c.typeName, data: JSON.parse(JSON.stringify(data)), active: c.active !== false };
    }
    return null;
  }).filter(Boolean);
}

/** Les composants d'un nœud, tels que le format les écrit. */
export function serializeComponentsOf(o){
  return componentEntriesOf(o)
    // Un composant posé par le fichier lui-même et resté vierge (le SkinnedMeshRenderer d'un
    // maillage skinné) n'est pas un écart : ne l'écrire que s'il porte quelque chose.
    .filter(function(e){
      return e.active === false || !(e.type === 'SkinnedMeshRenderer'
        && !((e.data && e.data.externalClips) || []).length);
    });
}

// UN PREFAB DONT LE MODÈLE EST PERDU se signale au chargement. Jusqu'à la v0.189.0, chaque
// réouverture écrasait l'id du modèle dans la racine d'un prefab par l'id du prefab lui-même
// (adoptAssetId, js/assets.js) : le composant Model pointait sur le prefab, et le jeu affichait
// « asset absent » sans dire QUOI refaire. Le vrai modèle n'est pas dans le fichier — on ne
// devine pas, on nomme le prefab et la marche à suivre. Rend la liste des messages (tests).
export function warnPrefabModelLost(da, assetsById){
  const out = [];
  (da && da.tree || []).forEach(function(entry){
    (entry.components || []).forEach(function(c){
      if(!c || c.type !== 'Model' || !c.data || !c.data.assetId) return;
      const id = c.data.assetId, target = assetsById ? assetsById[id] : null;
      if(target && target.kind === 'model') return;
      const why = id === da.id ? 'pointe vers lui-même' : (target ? 'pointe vers un ' + target.kind : 'pointe vers un asset absent');
      const msg = 'Le prefab « ' + da.name + ' » a perdu son modèle (son nœud « ' + (entry.name || '?') + ' » ' + why
        + ') : recréez-le depuis le modèle (posez le modèle dans la scène, puis faites-en un prefab).';
      out.push(msg);
      console.warn('[chargement] ' + msg);
    });
  });
  return out;
}

export function serializeTree(rootT){
  const list = [];
  // Un NŒUD de projet, et pas ses internes (la THREE.Light d'une lumière, l'objectif d'une
  // caméra, les maillages d'un modèle importé) : le tableau de composants est ce qui les
  // distingue depuis que le type n'est plus la source de vérité.
  rootT.traverse(function(o){
    if(Array.isArray(o.userData.components) && o.userData.modelNode === undefined)
      list.push(serializeObject(o));
  });
  return list;
}

// Reconstruit une liste d'objets sérialisés ; renvoie {parId, racines}.
/**
 * L'asset désigné par une référence, que celle-ci ait DÉJÀ été remappée ou non.
 *
 * `assetsById` est indexé par les ANCIENS ids, et l'ouverture d'un projet remappe les références
 * des scènes avant de construire les objets (`loadScene`). Selon le chemin d'appel, la référence
 * reçue porte donc l'ancien id ou le nouveau. On regarde d'abord dans la liste réelle des assets
 * (déjà remappée), puis dans la table (encore ancienne) : les deux chemins restent valides.
 *
 * HONNÊTETÉ SUR CE QUE CETTE FONCTION NE FAIT PAS. Elle a été écrite en croyant expliquer une perte
 * de textures à la réouverture — sol, murs et cubes rendus gris alors que `texAsset` était bien
 * écrit dans le fichier. Elle ne l'expliquait pas : une sonde posée à la construction a montré que
 * la résolution réussissait déjà, pour chaque objet. La cause était l'ORDRE d'habillage, corrigé
 * plus bas au point où le matériau d'asset est appliqué. Ce qui reste ici est une résolution qui
 * accepte les deux formes ; ce n'est pas le correctif de ce défaut-là.
 */
export function assetOfReference(assetsById, id){
  if(!id) return null;
  const direct = (typeof assets !== 'undefined')
    ? assets.find(function(a){ return a.id === id; }) : null;
  return direct || assetsById[id] || null;
}

// avecHelpers=false pour les templates de prefabs (helpers créés à l'instanciation).

export function rebuildTree(listData, assetsById, withHelpers){
  const byId = {};
  const racines = [];
  listData.forEach(function(d){
    // LE NŒUD VIENT DE SES COMPOSANTS, et de rien d'autre. Le fichier les nomme ; le premier
    // d'entre eux qui réclame un porteur particulier le construit (NodeShells), les autres se
    // contentent d'un Group. La cascade « if(d.type === 'mesh') … else if … » qui vivait ici
    // obligeait le format à stocker le type de chaque nœud, existait en double avec celle du
    // jeu publié, et sautait en silence tout nœud sans type.
    // L'ENTRÉE FANTÔME d'avant la v0.159 : le maillage skinné d'un modèle était indexé comme un
    // objet de scène, donc écrit à part, avec son seul SkinnedMeshRenderer. Reconstruit, il
    // donnait un Group vide accroché sous la racine. Ses données (`externalClips`) sont
    // reprises par la passe de second temps plus bas ; le nœud, lui, n'est plus fabriqué.
    if(typeof isLegacySkinnedEntry === 'function' && isLegacySkinnedEntry(d)) return;
    const fait = nodeOfComponents(d, {assetsById: assetsById, entry: d});
    let o = fait.object3d;
    if(fait.missing){
      logConsole('warn', '« ' + d.name + ' » : le composant « ' + fait.missing
        + ' » n\'a pas pu construire son objet (asset absent du projet ?) — '
        + 'nœud conservé en substitut', null);
    }
    // LES TYPES DE PLUGIN restent clés sur `userData.type` : c'est l'API publique
    // `registerTypeObject` (js/plugins.js), et un type de plugin n'a pas de composant à nommer.
    // Le champ `type` du fichier n'existe donc plus QUE pour eux.
    if(d.type && typeof typePlugin === 'function' && typePlugin(d.type)){
      const tp = typePlugin(d.type);
      try{
        o = tp.make();
        o.userData.type = d.type;
        if(typeof applyNodeMixin === 'function') applyNodeMixin(o);
        if(tp.restore) tp.restore(o, d.plug);
      } catch(e){
        logConsole('error', 'plugin « ' + tp.plugin + ' » : reconstruction de « '
          + d.name + ' » impossible — ' + e.message, null);
      }
    }
    else if(d.plug !== undefined && d.plug !== null){
      // objet d'un plugin absent : proxy visible qui CONSERVE les données brutes, pour qu'une
      // sauvegarde ne les efface pas
      o.userData.plugAbsent = {type: d.type, plug: d.plug};
      logConsole('warn', '« ' + d.name + ' » : plugin fournissant le type « '
        + d.type + ' » absent — objet conservé en substitut', null);
    }
    if(!o) return;
    o.name = d.name;
    o.position.fromArray(d.pos);
    o.quaternion.fromArray(d.quat);
    o.scale.fromArray(d.ech);
    o.castShadow = (d.ombreProjetee !== undefined) ? d.ombreProjetee : true;
    o.receiveShadow = (d.ombreRecue !== undefined) ? d.ombreRecue : true;
    if(d.visible === false) o.visible = false;
    // Un sac que le fichier NOMME déjà par un composant (`d.components`) porte la valeur à
    // jour ; le sac à plat vient forcément d'un fichier plus ancien que lui, et le recopier ici
    // serait la seconde vérité que rien ne réconcilie (voir bagsOverriddenBy,
    // js/component-migration.js).
    const ignoreSacs = bagsOverriddenBy(d.components);
    if(d.phys && !ignoreSacs.phys) o.userData.phys = JSON.parse(JSON.stringify(d.phys));
    if(d.game) o.userData.game = JSON.parse(JSON.stringify(d.game));
    if(d.detail) o.userData.detail = JSON.parse(JSON.stringify(d.detail));
    if(d.collider && !ignoreSacs.collider) o.userData.collider = JSON.parse(JSON.stringify(d.collider));
    if(!ignoreSacs.scripts){
      if(d.scripts) o.userData.scripts = JSON.parse(JSON.stringify(d.scripts));
      else if(d.script) o.userData.scripts = [JSON.parse(JSON.stringify(d.script))];   // migration v5 en place
    }
    if(d.prefabId) o.userData.prefabId = d.prefabId;
    if(d.audio && !ignoreSacs.audio) o.userData.audio = JSON.parse(JSON.stringify(d.audio));
    if(d.part && !ignoreSacs.part) o.userData.part = JSON.parse(JSON.stringify(d.part));
    if(d.animator && !ignoreSacs.animator) o.userData.animator = JSON.parse(JSON.stringify(d.animator));
    if(d.events && !ignoreSacs.events) o.userData.events = JSON.parse(JSON.stringify(d.events));
    if(d.uiDoc && !ignoreSacs.uiDoc) o.userData.uiDoc = JSON.parse(JSON.stringify(d.uiDoc));
    if(d.sprite2d && !ignoreSacs.sprite2d) o.userData.sprite2d = JSON.parse(JSON.stringify(d.sprite2d));
    if(d.animSprite && !ignoreSacs.animSprite) o.userData.animSprite = JSON.parse(JSON.stringify(d.animSprite));
    if(d.body2d && !ignoreSacs.body2d) o.userData.body2d = JSON.parse(JSON.stringify(d.body2d));
    if(d.collider2d && !ignoreSacs.collider2d) o.userData.collider2d = JSON.parse(JSON.stringify(d.collider2d));
    if(d.controller2d && !ignoreSacs.controller2d) o.userData.controller2d = JSON.parse(JSON.stringify(d.controller2d));
    // Avant d'apply le matériau : c'est lui qui branchera la lightmap sur `uv1`, et
    // `uv1` doit déjà être celui de l'atlas, pas celui du fichier de modèle.
    if(d.lightmapAtlas){
      o.userData.lightmapAtlas = JSON.parse(JSON.stringify(d.lightmapAtlas));
      reapplyAtlasLightmap(o);
    }
    const matA = assetOfReference(assetsById, d.materialId);
    if(matA && matA.kind === 'material'){
      applyMaterialOn(matA, o);
      // applyMaterialOn() vient de RECONSTRUIRE o.material, et d'effacer `texAsset` au
      // passage. Or c'est ce même effacement qui rend l'ordre inverse impossible : un
      // `texAsset` présent dans le fichier ne peut signifier qu'une chose — la texture a été
      // posée APRÈS le matériau. Il faut donc la reposer APRÈS lui ici aussi. Sans cette
      // reprise, une texture directe disparaît à chaque rechargement, et pour TOUS les objets :
      // ils reçoivent le matériau par défaut du projet dès leur création (js/objects.js).
      const texAfterMat = assetOfReference(assetsById, d.texAsset);
      if(texAfterMat && applyTextureRaw(texAfterMat, o, true)){
        o.userData.texAsset = texAfterMat.id;
      }
    }
    // makeParticles()/makeProbe() (ci-dessus) ont déjà attaché leur
    // composant sur des données par défaut ; userData.part/userData.sonde viennent
    // d'être remplacés par les données chargées — le composant doit pointer sur
    // CES données, pas sur les défauts orphelins (sinon l'inspecteur affiche les
    // défauts et les édite sans effet sur la simulation réelle).
    if(o.getComponent){
      const cPart = o.getComponent('Particles');
      if(cPart && o.userData.part) cPart.data = o.userData.part;
      const cProbe = o.getComponent('Reflection');
      if(cProbe && o.userData.probe) cProbe.data = o.userData.probe;
    }
    byId[d.id] = o;
    // Les nœuds d'une instance de modèle, exposés par son shell (js/objects.js) : rangés dans la
    // table sous l'id qu'ils portaient à l'enregistrement — ce qui les cite (piste d'animation,
    // script, caméra qui suit) les retrouve — et indexés avec elle par l'appelant.
    if(typeof exposedNodesOf === 'function' && o.getComponent && o.getComponent('Model')){
      const ids = (d.modelNodes && d.modelNodes.ids) || {};
      exposedNodesOf(o).forEach(function(n){
        const key = n.userData.modelNode;
        byId[ids[key] !== undefined ? ids[key] : ('m' + d.id + '/' + key)] = n;
      });
    }
  });
  listData.forEach(function(d){
    const o = byId[d.id];
    if(!o) return;
    let p = (d.parent !== null && d.parent !== undefined) ? byId[d.parent] : null;
    // Parenté sous un nœud de modèle : retrouvé par sa clé ; disparu (réimport), l'objet reste
    // sous la racine de l'instance plutôt que de partir à la racine de la scène.
    if(p && d.parentNode && typeof modelNodeByKey === 'function'){
      p = modelNodeByKey(p, d.parentNode) || p;
    }
    if(p) p.add(o); else racines.push(o);
  });
  // LES COMPOSANTS APRÈS LE PARENTAGE. L'ordre comptait parce qu'`addComponent` refusait un
  // composant 2D sur un nœud 3D, et que l'espace se lisait en REMONTANT les parents : appelé
  // avant le parentage il ne trouvait rien, retombait sur « 3d », et levait une erreur qui
  // interrompait toute la reconstruction — le nœud était perdu, et tous les suivants avec.
  //
  // Ce refus n'existe plus (un seul monde), mais l'ordre reste : le `onAdd` d'un composant
  // peut interroger la scène autour de lui, et un nœud non encore parenté n'y est pas.
  listData.forEach(function(d){
    const o = byId[d.id];
    if(!o) return;
    // Les composants que le fichier NOMME, D'ABORD. `syncComponents` tourne ENSUITE, toujours :
    // un nœud fabriqué avec un composant par défaut (makePrimitive…) que le fichier ne liste pas
    // restait sinon sur son sac `userData` orphelin, jamais rattaché — l'inspecteur éditait un
    // objet, la simulation en lisait un autre (§ 5 point 4). `syncComponents` est idempotente :
    // chacune de ses branches est gardée par `!getComponent`, donc rejouer un composant déjà posé
    // par `applyComponents` ne fait rien.
    if(Array.isArray(d.components) && d.components.length) applyComponents(o, d.components);
    syncComponents(o);
    // Les écarts des nœuds de l'instance, APRÈS les composants de sa racine.
    if(d.modelNodes && typeof applyModelOverrides === 'function'){
      applyModelOverrides(o, d.modelNodes, function(n, list){
        applyComponents(n, list);
        syncComponents(n);
        const c = list.find(function(x){ return x.type === 'SkinnedMeshRenderer'; });
        if(c && c.data && (c.data.externalClips || []).length
           && typeof reattachAnimationsExternal === 'function'){
          reattachAnimationsExternal(o, c.data.externalClips.map(function(r){
            return {asset:r.assetId, clip:r.sourceClip, name:r.localName};
          }), function(id){ return assetOfReference(assetsById, id); });
        }
      }, function(n){ if(typeof applyMaterialSlots === 'function') applyMaterialSlots(n); });
    }
  });
  if(withHelpers){
    Object.keys(byId).forEach(function(k){ createHelperFor(byId[k]); });
  }
  // externalClips (SkinnedMeshRenderer) : ce composant vit sur le DESCENDANT skinné, un entry
  // séparé de celui de la racine Model qui l'a cloné (constat 3 du plan animator — même règle
  // que skeletonOf, js/skeleton.js). `NodeShells.register('Model', ...)` (js/objects.js) ne peut
  // donc pas le reposer : à ce moment-là ce descendant n'a pas encore été reconstruit. On le fait
  // ici, une fois l'arbre ENTIER construit et parenté.
  const entriesById = {};
  listData.forEach(function(d){ entriesById[d.id] = d; });
  listData.forEach(function(d){
    const c = (d.components || []).find(function(x){ return x.type === 'SkinnedMeshRenderer'; });
    if(!c || !c.data || !(c.data.externalClips || []).length) return;
    // Les clips sont reciblés sur la RACINE du clone (`cloneModel` y range `animations`), pas
    // sur le descendant skinné qui porte seulement la provenance — on remonte donc jusqu'à elle.
    let racineEntry = d;
    while(racineEntry.parent !== null && racineEntry.parent !== undefined
          && entriesById[racineEntry.parent]){
      racineEntry = entriesById[racineEntry.parent];
    }
    const racine = byId[racineEntry.id];
    if(!racine) return;
    // On vise le composant via `skinnedMeshRendererOf`, PAS `byId[d.id].getComponent(...)` :
    // `SkinnedMeshRenderer` n'a pas de shell propre dans `NodeShells` (il ne réclame aucun
    // porteur particulier), donc `byId[d.id]` peut être un simple Group posé par
    // `nodeOfComponents` pour cet entry, distinct du VRAI THREE.SkinnedMesh que `cloneModel`
    // vient de reconstruire à l'intérieur de `racine`. `skinnedMeshRendererOf` est le même
    // helper que tout le reste du moteur utilise pour désigner LE composant qui compte.
    const compReel = skinnedMeshRendererOf(racine);
    if(!compReel) return;
    compReel.externalClips = c.data.externalClips;
    if(typeof reattachAnimationsExternal === 'function'){
      reattachAnimationsExternal(racine, c.data.externalClips.map(function(r){
        return {asset:r.assetId, clip:r.sourceClip, name:r.localName};
      }), function(id){ return assetOfReference(assetsById, id); });
    }
  });
  return {byId: byId, racines: racines};
}

export function fileInB64(blob, name){
  return new Promise(function(res, rej){
    const r = new FileReader();
    r.onload = function(){ res({name: name, b64: r.result}); };
    r.onerror = function(){ rej(new Error('lecture impossible : ' + name)); };
    r.readAsDataURL(blob);
  });
}

export function b64InFile(entry){
  return fetch(entry.b64).then(function(rep){ return rep.blob(); })
    .then(function(blob){ return new File([blob], entry.name, {type: blob.type}); });
}

/**
 * Ce qu'on écrit d'un asset d'animation — et rien d'autre.
 *
 * Une seule fonction pour les deux chemins d'écriture (inline dans projet.json et fichier
 * `.animation.json` sur disque) : les deux formats ont divergé par le passé, et la divergence
 * ne se voit qu'en rouvrant un projet enregistré dans l'autre mode.
 */
export function descriptorAnimation(a){
  const type = (typeof typeSourceAnim === 'function') ? typeSourceAnim(a) : 'model';
  const d = {format:'animation', version:2,
    source:{type:type,
            asset:(a.source && a.source.asset) || null, clip:(a.source && a.source.clip) || ''},
    speed:a.speed === undefined ? 1 : a.speed,
    loop:a.loop === undefined ? true : !!a.loop,
    start:a.start || 0,
    end:(a.end === undefined || a.end === null) ? null : a.end};
  // Les pistes ne sont écrites que pour un clip à clés : les recopier sur une référence
  // laisserait traîner des clés mortes qu'aucune interface ne montrerait plus.
  if(type === 'keys'){
    d.duration = a.duration || 1;
    d.imagesBySeconde = a.imagesBySeconde || 60;
    d.tracks = JSON.parse(JSON.stringify(a.tracks || []));
  }
  return d;
}

export async function assetsSerialized(){
  const dAssets = [];
  for(const a of assets){
    if(a.kind === 'texture' && a.file){
      dAssets.push({id:a.id, kind:'texture', name:a.name, folder:a.folder || '',
        paramsImport:a.paramsImport || null,
        // `cuite` doit survivre à la sauvegarde : c'est la seule chose qui autorise une
        // cuisson à écraser cette texture. Perdue, la cuisson suivante créerait un asset de
        // plus à chaque fois — ou pire, écraserait une lightmap importée.
        cuite:!!a.cuite,
        rgbm:!!a.rgbm,
        files:[await fileInB64(a.file, a.file.name)]});
    } else if(a.kind === 'model'){
      const fs = [];
      for(const f of (a.paquet || [])) fs.push(await fileInB64(f, f.name));
      // `marqueurs` : les événements posés sur les clips de CE fichier. Ils appartiennent au
      // clip, donc à l'asset — pas aux objets qui le jouent, qui peuvent être plusieurs.
      if(fs.length) dAssets.push({id:a.id, kind:'model', name:a.name, folder:a.folder || '',
        paramsImport:a.paramsImport || null, markers:a.markers || null,
        avatar:a.avatar || null, files:fs});
      else setStatus('L\'asset « ' + a.name + ' » n\'a pas de fichier source, il ne sera pas sauvegardé', 4000);
    } else if(a.kind === 'prefab'){
      dAssets.push({id:a.id, kind:'prefab', name:a.name, folder:a.folder || '', base:a.base || null,
        tree:serializeTree(a.template)});
    } else if(a.kind === 'script'){
      dAssets.push({id:a.id, kind:'script', name:a.name, folder:a.folder || '', code:a.code});
    } else if(a.kind === 'data'){
      // Table de contenu (statistiques d'ennemis, objets, dialogues, vagues…).
      // Stockée en TEXTE et non en objet : c'est ce que l'utilisateur édite, et
      // ça préserve son ordre et sa mise en forme d'une sauvegarde à l'autre.
      dAssets.push({id:a.id, kind:'data', name:a.name, folder:a.folder || '', text:a.text});
    } else if(a.kind === 'material'){
      dAssets.push({id:a.id, kind:'material', name:a.name, folder:a.folder || '',
        byDefault:a.byDefault || undefined, props:JSON.parse(JSON.stringify(a.props)),
        shaderId:a.shaderId || undefined,
        valuesParams:a.shaderId ? JSON.parse(JSON.stringify(a.valuesParams || {})) : undefined});
    } else if(a.kind === 'preset'){
      dAssets.push({id:a.id, kind:'preset', name:a.name, folder:a.folder || '',
        preset:JSON.parse(JSON.stringify(a.preset || {}))});
    } else if(a.kind === 'postProfile'){
      dAssets.push({id:a.id, kind:'postProfile', name:a.name, folder:a.folder || '',
        effects:JSON.parse(JSON.stringify(a.effects))});
    } else if(a.kind === 'audio' && a.file){
      dAssets.push({id:a.id, kind:'audio', name:a.name, folder:a.folder || '',
        paramsImport:a.paramsImport || null,
        files:[await fileInB64(a.file, a.file.name)]});
    } else if(a.kind === 'sfx'){
      // Un bruitage, c'est sa RECETTE : le son se recalcule au chargement (js/chip-synth.js). On
      // n'écrit aucun octet audio — quelques centaines d'octets de JSON au lieu d'un WAV.
      dAssets.push({id:a.id, kind:'sfx', name:a.name, folder:a.folder || '',
        recipe:JSON.parse(JSON.stringify(a.recipe || {}))});
    } else if(a.kind === 'musicLoop'){
      // Même principe : la recette de la boucle, recalculée au chargement (js/music-loop.js).
      dAssets.push({id:a.id, kind:'musicLoop', name:a.name, folder:a.folder || '',
        recipe:JSON.parse(JSON.stringify(a.recipe || {}))});
    } else if(a.kind === 'documentUI'){
      dAssets.push({id:a.id, kind:'documentUI', name:a.name, folder:a.folder || '', html:a.html});
    } else if(a.kind === 'sheetStyle'){
      dAssets.push({id:a.id, kind:'sheetStyle', name:a.name, folder:a.folder || '', css:a.css});
    } else if(a.kind === 'animator'){
      dAssets.push({id:a.id, kind:'animator', name:a.name, folder:a.folder || '',
        machine:JSON.parse(JSON.stringify(a.machine || {}))});
    } else if(a.kind === 'animation'){
      // Un clip de modèle (onglet Animation) vit dans le `paramsImport.clips` de son modèle :
      // l'écrire ici en ferait deux propriétaires.
      if(a.embedded) continue;
      dAssets.push({id:a.id, kind:'animation', name:a.name, folder:a.folder || '',
        anim:descriptorAnimation(a)});
    } else if(a.kind === 'tilePalette'){
      // INLINE ici, et fichier séparé seulement dans diskAssetManifest(). Cette branche
      // écrivait un fichier avec les variables locales de diskAssetManifest() : elle levait un
      // ReferenceError, donc TOUTE sauvegarde d'un projet portant une palette échouait
      // (docs/REVUE_2026-09-14.md § 2).
      dAssets.push({id:a.id, kind:'tilePalette', name:a.name, folder:a.folder || '',
        palette:serializePalette(a.palette || emptyPalette(0.5))});
    } else if(a.kind === 'graphShader'){
      dAssets.push({id:a.id, kind:'graphShader', name:a.name, folder:a.folder || '',
        target:a.target, properties:JSON.parse(JSON.stringify(a.properties || [])),
        nodes:JSON.parse(JSON.stringify(a.nodes)),
        links:JSON.parse(JSON.stringify(a.links)), outputs:Object.assign({}, a.outputs),
        layout:a.layout ? Object.assign({}, a.layout) : {}});
    } else if(a.kind === 'sprite'){
      dAssets.push({id:a.id, kind:'sprite', name:a.name, folder:a.folder || '',
        sprite:descriptorSprite(a)});
    }
  }
  return dAssets;
}

/**
 * Le contenu d'un sprite, sans son identité d'asset.
 *
 * La même forme part dans le `.p3d` et dans le `.sprite.json` : deux écritures différentes
 * donneraient deux chemins de relecture, et l'un des deux finirait par mentir.
 */
export function descriptorSprite(a){
  return {
    format:'sprite', version:1,
    textureId: a.textureId || null,
    ppu: Number(a.ppu) || 100,
    pivot: {x: (a.pivot && a.pivot.x !== undefined) ? a.pivot.x : 0.5,
            y: (a.pivot && a.pivot.y !== undefined) ? a.pivot.y : 0.5},
    regions: JSON.parse(JSON.stringify(a.regions || [])),
    // Les SUITES suivent la planche, comme les regions : ce sont des images de CETTE
    // planche. Les oublier ici publierait un jeu ou chaque personnage est fige sur une
    // image, sans erreur — la famille de defaut la plus couteuse de ce repo.
    sequences: JSON.parse(JSON.stringify(a.sequences || []))
  };
}

// Même rôle qu'assetsSerialized(), pour le format « folder project » sur disque :
// TOUS les assets (texture/audio/modèle/script/matériau) vivent sous
// assets/<a.folder>/ — le MÊME arbre de dossiers que l'utilisateur organise
// librement dans le panneau Projet (a.folder), sans partition par type de
// fichier. Les binaires (texture/audio/modèle) sont déjà écrits séparément par
// writeAssetInFolder() au moment de l'import — ici on ne stocke que leur NOM
// (pas de base64, ça alourdirait project.json pour rien). Les scripts et
// matériaux sont AUSSI écrits en fichiers réels (assets/<folder>/<name>.js,
// assets/<folder>/<name>.material.json) pour rester visibles/éditables
// directement sur le disque, au même endroit que les autres assets du même
// folder. Depuis la v0.198.0, PLUS AUCUN genre ne reste en ligne dans project.json :
// les tables de données (`.data.json`) puis les prefabs (`.prefab.json`, l'arbre du
// gabarit sérialisé) ont chacun leur fichier.
// Retourne {assets, fichiersAEcrire} : fichiersAEcrire est la liste des
// {chemin, contenu} à écrire via writeFileInFolder (voir registerInProjectOpen).
// LE SUFFIXE ET LE CONTENU D'UNE CARTE D'IDENTITÉ, déclarés ICI — du côté qui ÉCRIT.
// project-folder.js porte les mêmes valeurs du côté qui LIT (META_SUFFIX, readMetas) : les
// deux modules ont un travail distinct et ne se partagent pas de symbole, ce qui évite à ce
// fichier une dépendance que la moitié des tests ne monte pas. `test/identite-assets.test.mjs`
// mesure que les deux suffixes sont bien le même — c'est lui qui les empêche de diverger.
export const SUFFIX_META = '.meta';
export const VERSION_META_WRITTEN = 1;
export function contentMeta(da){
  return JSON.stringify({version: VERSION_META_WRITTEN, id: da.id, kind: da.kind,
                         name: da.name || ''}, null, 2);
}

// Le contenu d'un `.prefab.json`. Versionné pour lui-même : le fichier peut être copié dans un
// autre projet, il doit dire quel format il porte. Relu par resolveAssetDescriptors
// (project-folder.js), qui rend le même {base, tree} que l'ancien prefab en ligne.
export const VERSION_PREFAB_FILE = 1;
export function prefabFileContent(a){
  return {version:VERSION_PREFAB_FILE, base:a.base || null, tree:serializeTree(a.template)};
}

export function diskAssetManifest(){
  const dAssets = [];
  const filesAWrite = [];
  const namesTaken = new Set();
  // Unicité par DOSSIER (et pas globale) : deux assets de même nom dans deux
  // dossiers différents ne doivent pas se faire renommer l'un l'autre.
  function nameFileUnique(folder, base, ext){
    let c = base, i = 2;
    while(namesTaken.has(folder + ' ' + c + ext)) c = base + '-' + (i++);
    namesTaken.add(folder + ' ' + c + ext);
    return c + ext;
  }
  for(const a of assets){
    if((a.kind === 'texture' || a.kind === 'audio') && a.file){
      dAssets.push({id:a.id, kind:a.kind, name:a.name, folder:a.folder || '',
        paramsImport:a.paramsImport || null, files:[a.file.name]});
    } else if(a.kind === 'model'){
      const names = (a.paquet || []).map(function(f){ return f.name; });
      if(names.length) dAssets.push({id:a.id, kind:'model', name:a.name, folder:a.folder || '',
        paramsImport:a.paramsImport || null, markers:a.markers || null,
        avatar:a.avatar || null, files:names});
      else setStatus('L\'asset « ' + a.name + ' » n\'a pas de fichier source, il ne sera pas sauvegardé', 4000);
    } else if(a.kind === 'prefab'){
      // UN VRAI FICHIER (`.prefab.json`), comme tous les genres (v0.198.0). Le prefab vivait
      // en ligne dans project.json : invisible dans l'explorateur, impossible à versionner, à
      // copier d'un projet à l'autre ou à retrouver par sa carte d'identité. Un project.json
      // d'avant, qui porte `tree` en ligne, reste lu (branche sans `file` de
      // resolveAssetDescriptors) et passe au fichier à l'enregistrement suivant.
      const folder = a.folder || '';
      const fileName = nameFileUnique(folder, slugFile(a.name), '.prefab.json');
      filesAWrite.push({filePath: 'assets/' + (folder ? folder + '/' : '') + fileName,
        content: JSON.stringify(prefabFileContent(a), null, 2)});
      dAssets.push({id:a.id, kind:'prefab', name:a.name, folder:folder, file:fileName});
    } else if(a.kind === 'script'){
      const folder = a.folder || '';
      const fileName = nameFileUnique(folder, slugFile(a.name), '.js');
      filesAWrite.push({filePath: 'assets/' + (folder ? folder + '/' : '') + fileName, content:a.code || ''});
      dAssets.push({id:a.id, kind:'script', name:a.name, folder:folder, file:fileName});
    } else if(a.kind === 'data'){
      // UN VRAI FICHIER sur disque (`.data.json`), comme tout genre qui a une forme fichier évidente :
      // une table de contenu est faite pour être éditée hors de l'éditeur. Le TEXTE est écrit tel
      // quel — ordre et mise en forme de l'utilisateur conservés. Un projet d'avant, qui portait
      // `text` en ligne dans project.json, reste lu (branche sans `file` de resolveAssetDescriptors).
      const folder = a.folder || '';
      const fileName = nameFileUnique(folder, slugFile(a.name), '.data.json');
      filesAWrite.push({filePath: 'assets/' + (folder ? folder + '/' : '') + fileName, content:a.text || ''});
      dAssets.push({id:a.id, kind:'data', name:a.name, folder:folder, file:fileName});
    } else if(a.kind === 'material'){
      const folder = a.folder || '';
      const fileName = nameFileUnique(folder, slugFile(a.name), '.material.json');
      filesAWrite.push({filePath: 'assets/' + (folder ? folder + '/' : '') + fileName,
        content:JSON.stringify(a.props, null, 2)});
      dAssets.push({id:a.id, kind:'material', name:a.name, folder:folder, file:fileName,
        byDefault:a.byDefault || undefined, shaderId:a.shaderId || undefined,
        valuesParams:a.shaderId ? JSON.parse(JSON.stringify(a.valuesParams || {})) : undefined});
    } else if(a.kind === 'preset'){
      const folder = a.folder || '';
      const fileName = nameFileUnique(folder, slugFile(a.name), '.preset.json');
      filesAWrite.push({filePath: 'assets/' + (folder ? folder + '/' : '') + fileName,
        content:JSON.stringify(a.preset || {}, null, 2)});
      dAssets.push({id:a.id, kind:'preset', name:a.name, folder:folder, file:fileName});
    } else if(a.kind === 'postProfile'){
      const folder = a.folder || '';
      const fileName = nameFileUnique(folder, slugFile(a.name), '.postprofile.json');
      filesAWrite.push({filePath: 'assets/' + (folder ? folder + '/' : '') + fileName,
        content:JSON.stringify(a.effects, null, 2)});
      dAssets.push({id:a.id, kind:'postProfile', name:a.name, folder:folder, file:fileName});
    } else if(a.kind === 'sfx'){
      // Un vrai fichier `.sfx.json` : la recette, lisible, diffable dans git et éditable à la main.
      const folder = a.folder || '';
      const fileName = nameFileUnique(folder, slugFile(a.name), '.sfx.json');
      filesAWrite.push({filePath: 'assets/' + (folder ? folder + '/' : '') + fileName,
        content: JSON.stringify(a.recipe || {}, null, 2)});
      dAssets.push({id:a.id, kind:'sfx', name:a.name, folder:folder, file:fileName});
    } else if(a.kind === 'musicLoop'){
      const folder = a.folder || '';
      const fileName = nameFileUnique(folder, slugFile(a.name), '.loop.json');
      filesAWrite.push({filePath: 'assets/' + (folder ? folder + '/' : '') + fileName,
        content: JSON.stringify(a.recipe || {}, null, 2)});
      dAssets.push({id:a.id, kind:'musicLoop', name:a.name, folder:folder, file:fileName});
    } else if(a.kind === 'documentUI'){
      const folder = a.folder || '';
      const fileName = nameFileUnique(folder, slugFile(a.name), '.html');
      filesAWrite.push({filePath: 'assets/' + (folder ? folder + '/' : '') + fileName, content:a.html || ''});
      dAssets.push({id:a.id, kind:'documentUI', name:a.name, folder:folder, file:fileName});
    } else if(a.kind === 'sheetStyle'){
      const folder = a.folder || '';
      const fileName = nameFileUnique(folder, slugFile(a.name), '.css');
      filesAWrite.push({filePath: 'assets/' + (folder ? folder + '/' : '') + fileName, content:a.css || ''});
      dAssets.push({id:a.id, kind:'sheetStyle', name:a.name, folder:folder, file:fileName});
    } else if(a.kind === 'animator'){
      // Un vrai fichier sur disque, comme l exige ARCHITECTURE.md : un genre qui a une forme
      // fichier evidente doit s ecrire, sinon un projet ouvert en folder local ne le montre
      // jamais. Regression deja vecue avec documentUI/feuilleStyle (v0.20.0).
      const folder = a.folder || '';
      const fileName = nameFileUnique(folder, slugFile(a.name), '.animator.json');
      filesAWrite.push({filePath: 'assets/' + (folder ? folder + '/' : '') + fileName,
        content: JSON.stringify(a.machine || {}, null, 2)});
      dAssets.push({id:a.id, kind:'animator', name:a.name, folder:folder, file:fileName});
    } else if(a.kind === 'animation'){
      // Un clip de modèle n'a PAS de fichier : il est dans le `.meta`/manifeste de son modèle,
      // comme un clip d'FBX dans Unity n'a pas de `.anim`.
      if(a.embedded) continue;
      // Même exigence que ci-dessus : un genre qui a une forme fichier évidente s'écrit sur
      // disque, sinon il reste invisible en mode folder local.
      const folder = a.folder || '';
      const fileName = nameFileUnique(folder, slugFile(a.name), '.animation.json');
      filesAWrite.push({filePath: 'assets/' + (folder ? folder + '/' : '') + fileName,
        content: JSON.stringify(descriptorAnimation(a), null, 2)});
      dAssets.push({id:a.id, kind:'animation', name:a.name, folder:folder, file:fileName});
    } else if(a.kind === 'graphShader'){
      const folder = a.folder || '';
      const fileName = nameFileUnique(folder, slugFile(a.name), '.graph-shader.json');
      filesAWrite.push({filePath: 'assets/' + (folder ? folder + '/' : '') + fileName,
        content: JSON.stringify({target:a.target, properties:a.properties || [],
          nodes:a.nodes, links:a.links, outputs:a.outputs, layout:a.layout || {}}, null, 2)});
      dAssets.push({id:a.id, kind:'graphShader', name:a.name, folder:folder, file:fileName});
    } else if(a.kind === 'tilePalette'){
      // Même exigence que l'animator et le sprite : un genre qui a une forme fichier évidente
      // s'écrit sur disque, sinon il reste invisible en mode dossier local.
      const folder = a.folder || '';
      const fileName = nameFileUnique(folder, slugFile(a.name), '.tilepalette.json');
      filesAWrite.push({filePath: 'assets/' + (folder ? folder + '/' : '') + fileName,
        content: JSON.stringify(serializePalette(a.palette || emptyPalette(0.5)), null, 2)});
      dAssets.push({id:a.id, kind:'tilePalette', name:a.name, folder:folder, file:fileName});
    } else if(a.kind === 'sprite'){
      // Un vrai fichier sur disque, comme l'exige ARCHITECTURE.md : un genre qui a une forme
      // fichier évidente doit s'écrire, sinon un projet ouvert en folder local ne le montre
      // jamais. Régression déjà vécue avec documentUI/feuilleStyle (v0.20.0).
      const folder = a.folder || '';
      const fileName = nameFileUnique(folder, slugFile(a.name), '.sprite.json');
      filesAWrite.push({filePath: 'assets/' + (folder ? folder + '/' : '') + fileName,
        content: JSON.stringify(descriptorSprite(a), null, 2)});
      dAssets.push({id:a.id, kind:'sprite', name:a.name, folder:folder, file:fileName});
    }
  }
  // LA CARTE D'IDENTITÉ DE CHAQUE ASSET-FICHIER, écrite à côté de lui (`<fichier>.meta`).
  // Une seule boucle, à partir des descripteurs déjà construits : aucun genre ne peut être
  // oublié — ajouter un genre au-dessus lui donne son `.meta` sans rien écrire de plus.
  // C'est ce fichier qui permet à un asset renommé/déplacé hors de l'éditeur de retrouver son
  // identité (voir relocateAssetsByMeta et discoverFolderAssets, js/project-folder.js) : sans
  // lui, toutes ses références mouraient en silence.
  for(const da of dAssets){
    // Un modèle multi-fichiers ne porte sa carte que sur son fichier PRINCIPAL : le `.bin` et
    // les textures frères ne sont pas des assets, ils sont chargés par le LoadingManager.
    const principal = da.file
      || (da.files || []).find(function(n){ return /\.(glb|gltf|fbx)$/i.test(n); })
      || (da.files || [])[0];
    if(!principal) continue;
    filesAWrite.push({
      filePath: 'assets/' + (da.folder ? da.folder + '/' : '') + principal + SUFFIX_META,
      content: contentMeta(da)});
  }
  return {assets:dAssets, filesAWrite:filesAWrite};
}

// Chaque entrée migre `data` de sa version vers la suivante, en le mutant sur place.
// Ajoutez une entrée ici à chaque nouveau champ de projet qui a besoin d'une valeur
// par défaut sur les anciens projets.
export const MIGRATIONS = {
  2: function(data){
    // v2 → v3 : aucun changement de schéma dans ce lot ; ce palier existe pour que les
    // migrations futures aient un point d'entrée versionné dès leur premier besoin réel.
    data.version = 3;
  },
  3: function(data){
    // v3 → v4 : ajoute la table de calques, absente des projets plus anciens.
    // userData.game.calque reste une chaîne libre sur les objets existants — c'est
    // resolveLayer/sameLayer (scripts.js) qui la lit sans la convertir de force ici.
    data.layers = JSON.parse(JSON.stringify(LAYERS_DEFAULT));
    data.version = 4;
  },
  4: function(data){
    // v4 → v5 : ombreProjetee/ombreRecue par objet, absents des projets plus anciens.
    // Rien à migrer explicitement : leur absence dans un objet sérialisé signifie déjà
    // "true" (comportement historique) au chargement, via le fallback de rebuildTree.
    // Ce palier n'existe que pour garder version en phase avec le schéma.
    data.version = 5;
  },
  5: function(data){
    // v5 -> v6 : script (objet unique) -> scripts (tableau). Convertit chaque objet de
    // chaque scène ET chaque template de prefab, pas seulement le format d'enveloppe.
    function convertList(list){
      (list || []).forEach(function(d){
        if(d.script && !d.scripts){ d.scripts = [d.script]; delete d.script; }
      });
    }
    (data.scenes || []).forEach(function(s){ if(s.data) convertList(s.data.objects); });
    (data.assets || []).filter(function(a){ return a.kind === 'prefab'; }).forEach(function(a){
      convertList(a.tree);
    });
    data.version = 6;
  },
  6: function(data){
    // v6 -> v7 : interface de jeu (HUD) au niveau du projet. Un projet antérieur
    // n'en a pas : on pose une UI VIDE plutôt que null, pour que tout le reste du
    // code lise data.ui.elements sans garde à chaque appel.
    if(!data.ui || !Array.isArray(data.ui.elements)) data.ui = {elements: []};
    data.version = 7;
  },
  7: function(data){
    // v7 -> v8 : DEUX lots sont arrivés sur ce même palier, fusionnés ici.
    //
    // 1. Système Noeud+Component : aucun changement de schéma sérialisé — les
    //    composants (Collider/Physics/Terrain/Particles/Reflection/ScriptJS)
    //    miroitent les bags userData existants, déjà lus par rebuildTree ;
    //    c'est syncComponents() (component-migration.js), appelée à la
    //    reconstruction de chaque objet, qui comble userData.components après coup.
    //    Ce lot n'avait donc pas de conversion à faire, seulement un palier à
    //    poser pour rester en phase.
    //
    // 2. `rugosite` devient `smoothing` (smoothness = 1 − rugosité), sur les
    // matériaux assets ET sur le matériau local des primitives. La valeur est convertie,
    // pas seulement renommée : un projet rouvert doit avoir EXACTEMENT le même aspect.
    // Voir materials.js pour la raison du changement de convention.
    function convertMat(m){
      if(!m || m.roughness === undefined) return;
      if(m.smoothness === undefined) m.smoothness = invert01(m.roughness);
      delete m.roughness;
    }
    function convertList(list){
      (list || []).forEach(function(d){ convertMat(d.mat); });
    }
    (data.scenes || []).forEach(function(s){ if(s.data) convertList(s.data.objects); });
    (data.assets || []).forEach(function(a){
      if(a.kind === 'prefab') convertList(a.tree);
      else if(a.kind === 'material') convertMat(a.props);
    });
    data.version = 8;
  },
  8: function(data){
    // v8 -> v9 : le masque combiné devient explicitement empaqueté, et notre contrat
    // natif pass à l'ORM de glTF (R occlusion · G rugosité · B métal) — une norme
    // ouverte de Khronos plutôt que la convention d'un moteur, et celle que three lit
    // sans conversion.
    //
    // Tout masque déjà en place a forcément été peint dans l'unique convention qu'on
    // acceptait avant ce palier, celle de HDRP : on l'inscrit noir sur blanc. Sans
    // cette ligne, le nouveau défaut s'appliquerait à eux et un projet rouvert
    // changerait d'aspect — occlusion et métal permutés, rugosité inversée — sans la
    // moindre erreur pour le signaler.
    function mark(m){
      if(m && m.combineAsset && m.combinePacking === undefined) m.combinePacking = 'unity';
    }
    function markList(list){
      (list || []).forEach(function(d){ mark(d.mat); });
    }
    (data.scenes || []).forEach(function(s){ if(s.data) markList(s.data.objects); });
    (data.assets || []).forEach(function(a){
      if(a.kind === 'prefab') markList(a.tree);
      else if(a.kind === 'material') mark(a.props);
    });
    data.version = 9;
  },
  9: function(data){
    // v9 -> v10 : l'interface de jeu plate (data.ui.elements, anchors hg/hc/hd...) devient un
    // Noeud portant un composant UIDocument (HTML/CSS réel). Générée une seule fois, dans la
    // PREMIÈRE scène du projet — les projets suivants écrivent directement du HTML/CSS.
    const elements = (data.ui && Array.isArray(data.ui.elements)) ? data.ui.elements : [];
    if (elements.length && data.scenes && data.scenes[0]) {
      const ANCHORS_CSS = {
        hg: {top:'0', left:'0'}, hc: {top:'0', left:'50%', tx:'-50%'},
        hd: {top:'0', right:'0'},
        cg: {top:'50%', left:'0', ty:'-50%'}, cc: {top:'50%', left:'50%', tx:'-50%', ty:'-50%'},
        cd: {top:'50%', right:'0', ty:'-50%'},
        bg: {bottom:'0', left:'0'}, bc: {bottom:'0', left:'50%', tx:'-50%'},
        bd: {bottom:'0', right:'0'}
      };
      function stylePosition(el) {
        const a = ANCHORS_CSS[el.anchor] || ANCHORS_CSS.hg;
        let s = 'position:absolute;width:' + el.l + 'px;height:' + el.h + 'px;';
        if (a.top !== undefined) {
          s += 'top:' + (a.top === '0' ? el.y + 'px' : (el.y ? 'calc(' + a.top + ' + ' + el.y + 'px)' : a.top)) + ';';
        }
        if (a.bottom !== undefined) s += 'bottom:' + el.y + 'px;';
        if (a.left !== undefined) s += 'left:' + (a.left === '0' ? el.x + 'px' : a.left) + ';';
        if (a.right !== undefined) s += 'right:' + el.x + 'px;';
        const tx = a.tx || '', ty = a.ty || '';
        if (tx || ty) s += 'transform:translate(' + (tx || '0') + ',' + (ty || '0') + ');';
        return s;
      }
      function styleApparence(el) {
        let s = 'box-sizing:border-box;overflow:hidden;';
        if (el.fond) s += 'background:' + el.fond + ';';
        if (el.bordure) s += 'border:1px solid ' + el.bordure + ';';
        if (el.radius) s += 'border-radius:' + el.radius + 'px;';
        if (el.opacity !== undefined) s += 'opacity:' + el.opacity + ';';
        if (el.color) s += 'color:' + el.color + ';';
        if (el.size) s += 'font-size:' + el.size + 'px;';
        if (el.gras) s += 'font-weight:700;';
        if (el.visible === false) s += 'display:none;';
        return s;
      }
      function attrEvent(el) {
        return el.event ? ' data-event="' + el.event.replace(/"/g, '&quot;') + '"' : '';
      }
      const bind = 'ui_' + Math.random().toString(36).slice(2, 8);
      let html = '';
      elements.forEach(function (el, i) {
        const style = stylePosition(el) + styleApparence(el);
        const key = bind + '_' + i;
        if (el.type === 'field') {
          html += '<input style="' + style + '" placeholder="' + (el.placeholder || '') + '"'
            + ' value="' + (el.value || '') + '" data-bind="' + key + '"' + attrEvent(el) + '>';
        } else if (el.type === 'list') {
          const opts = (el.options || '').split('\n').map(function (o) { return o.trim(); }).filter(Boolean);
          html += '<select style="' + style + '" data-bind="' + key + '"' + attrEvent(el) + '>'
            + opts.map(function (o) { return '<option>' + o + '</option>'; }).join('') + '</select>';
        } else if (el.type === 'checkbox') {
          html += '<label style="' + style + '"><input type="checkbox" data-bind="' + key + '"'
            + (el.value ? ' checked' : '') + attrEvent(el) + '> ' + (el.text || '') + '</label>';
        } else if (el.type === 'button') {
          html += '<button style="' + style + '"' + attrEvent(el) + '>' + (el.text || '') + '</button>';
        } else {
          html += '<div style="' + style + '">' + (el.text || '') + '</div>';
        }
      });
      data.scenes[0].data = data.scenes[0].data || {objects: [], tracks: [], duration: 5, loop: true};
      data.scenes[0].data.objects = data.scenes[0].data.objects || [];
      const idFree = 1 + data.scenes[0].data.objects.reduce(function (m, o) { return Math.max(m, o.id || 0); }, 0);
      data.scenes[0].data.objects.push({
        id: idFree, type: 'group', name: 'UI (migré)',
        pos: [0, 0, 0], quat: [0, 0, 0, 1], ech: [1, 1, 1], visible: true,
        parent: null, uiDoc: {html: html, css: '', values: {}}
      });
    }
    delete data.ui;
    data.version = 10;
  },
  10: function(data){
    // v10 -> v11 : UIDocument.userData.uiDoc passe de {html, css, valeurs} (inline) à
    // {documentUIId, feuilleStyleIds, valeurs} (assets documentUI/feuilleStyle référencés) —
    // voir 2026-08-06-assets-documentui-feuillestyle-design.md. Date.now() est interdit dans le
    // harnais de test node:vm : on génère les nouveaux ids d'asset avec un compteer local.
    data.assets = data.assets || [];
    let counter = 0;
    function migrateUiDoc(uiDoc, nameNode){
      if(!uiDoc || uiDoc.documentUIId !== undefined) return;   // déjà au nouveau format
      counter++;
      const idDoc = 'a-migre10-' + counter + '-d';
      const idCss = 'a-migre10-' + counter + '-c';
      data.assets.push({id: idDoc, kind: 'documentUI', name: (nameNode || 'UI') + ' — document', folder: '', html: uiDoc.html || ''});
      data.assets.push({id: idCss, kind: 'sheetStyle', name: (nameNode || 'UI') + ' — style', folder: '', css: uiDoc.css || ''});
      const values = uiDoc.values || {};
      delete uiDoc.html;
      delete uiDoc.css;
      uiDoc.documentUIId = idDoc;
      uiDoc.sheetStyleIds = [idCss];
      uiDoc.values = values;
    }
    function migrateList(list){
      (list || []).forEach(function(o){ if(o.uiDoc) migrateUiDoc(o.uiDoc, o.name); });
    }
    (data.scenes || []).forEach(function(s){ if(s.data) migrateList(s.data.objects); });
    (data.assets || []).filter(function(a){ return a.kind === 'prefab'; }).forEach(function(a){ migrateList(a.tree); });
    data.version = 11;
  },
  11: function(data){
    // v11 -> v12 : nouveau genre d'asset grapheShader (fondation de l'éditeur nodal TSL) —
    // aucun project antérieur n'en possède, rien à convertir. Ce palier existe pour garder
    // `version` en phase avec le schéma, comme les paliers 2->3 et 4->5 avant lui.
    data.version = 12;
  },
  12: function(data){
    // v12 -> v13 : Shader (grapheShader, logique pure) vs Matériau (instance + données),
    // comme Unity — un grapheShader n'est plus assignable directement à un objet, seulement
    // via un materiau qui le référence (materiau.shaderId/valeursParams). Rattrape le very
    // court intervalle (v12) où le contraire était vrai : tout objet dont le materiauId
    // pointait vers un grapheShader reçoit un materiau instance nouvellement créé qui le
    // référence, réutilisé si plusieurs objets partageaient le même shader.
    data.assets = data.assets || [];
    const shadersById = {};
    data.assets.filter(function(a){ return a.kind === 'graphShader'; })
      .forEach(function(a){ shadersById[a.id] = a; });
    const materialForShader = {};
    let counter = 0;
    function materialOfSubstitution(shaderId){
      if(materialForShader[shaderId]) return materialForShader[shaderId];
      counter++;
      const shader = shadersById[shaderId];
      const id = 'a-migre12-' + counter;
      data.assets.push({id:id, kind:'material', name:(shader ? shader.name : 'Matériau') + ' (migré)',
        folder:'', props:{}, shaderId:shaderId, valuesParams:{}});
      materialForShader[shaderId] = id;
      return id;
    }
    function migrateList(list){
      (list || []).forEach(function(o){
        if(o.materialId && shadersById[o.materialId]) o.materialId = materialOfSubstitution(o.materialId);
      });
    }
    (data.scenes || []).forEach(function(s){ if(s.data) migrateList(s.data.objects); });
    (data.assets || []).filter(function(a){ return a.kind === 'prefab'; }).forEach(function(a){ migrateList(a.tree); });
    data.version = 13;
  },
  13: function(data){
    // v13 -> v14 : fondation 2D. Nouveau genre d'asset `sprite` et liste des calques de tri —
    // aucun project antérieur n'en possède, rien à convertir. Le palier pose les calques par
    // défaut, sans quoi un ancien project open en 2D n'aurait aucun calque où ranger un
    // sprite, et `orderOfSort` les enverrait tous au fond.
    if(!Array.isArray(data.layers2d) || !data.layers2d.length){
      data.layers2d = ['Fond', 'Décor', 'Jeu', 'Premier plan', 'Interface'];
    }
    if(!(Number(data.ppu2d) > 0)) data.ppu2d = 100;
    data.version = 14;
  },
  14: function(data){
    // v14 -> v15 : les réglages de niveau projet rejoignent `data.settings`.
    //
    // DÉPLACEMENT, PAS RECONSTRUCTION — c'est toute la difficulté de ce palier. « settings
    // absent → le construire depuis les valeurs par défaut du code » aurait RÉINITIALISÉ les
    // calques, les entrées et les réglages de cuisson de tout projet existant. Le déplacement
    // est dans `projectSettingsOf` (project-settings.js), qui ne pose un défaut que si le champ
    // manque — le patron de MIGRATIONS[13], juste au-dessus.
    data.settings = projectSettingsOf(data);
    PROJECT_SETTINGS_KEYS_MIGRATED.forEach(function(k){ delete data[k]; });
    delete data.projectName;
    data.version = 15;
  }
};

export function migrateProjectData(data){
  if(!data || data.version === undefined) return data;   // scène v1 legacy, pas de version
  // Chaque palier DOIT faire monter la version. Un palier qui l'oublie bouclait jusqu'à une
  // garde de 20 tours, puis rendait en silence un projet à moitié migré (revue du 2026-09-29,
  // § 6.18) : on l'arrête au premier tour, avec un message qui dit lequel.
  while(MIGRATIONS[data.version]){
    const from = data.version;
    MIGRATIONS[from](data);
    if(!(data.version > from)) throw new Error('la migration du format de projet depuis la version ' + from + ' n\'a pas fait monter la version');
  }
  return data;
}


// construit l'objet project complet (v3) — partagé par la sauvegarde et l'autosave
export async function buildDataProject(){
  project.scenes[project.current].data = stateCurrent();
  const data = {
    version: 15,
    current: project.current,
    folders: project.folders || [],
    // Les réglages de projet, en UN champ. Avant, huit champs à plat ici, huit lectures
    // symétriques au chargement, et le manifeste du format dossier qui n'en écrivait aucun.
    settings: JSON.parse(JSON.stringify(project.settings)),
    scenes: project.scenes.map(function(s){
      const d = s.data;
      return {name:s.name, data: d
        ? {objects:d.objects, tracks:d.tracks, duration:d.duration, loop:d.loop, env:d.env}
        : null};
    }),
    assets: await assetsSerialized()
  };
  // Le GENRE est écrit APRÈS les scènes parce qu'il en est déduit. C'est un indice de confort — quel
  // tab ouvrir, quel préréglage proposer — jamais une contrainte : un projet 2D qui reçoit un
  // objet 3D devient « mixte » et continue de s'ouvrir. C'est précisément ce qu'un format `.p2d`
  // séparé n'aurait pas su faire sans refuser l'objet ou mentir sur le genre.
  if(typeof kindProject === 'function') data.kind = kindProject(data.scenes);
  return data;
}

// registerScene() vit plus bas, avec le format décomposé qu'il produit.

// Enregistre directement dans le dossier project open (File System Access API),
// sans passer par l'export .p3d. Complète registerScene() (qui reste le
// chemin d'export .p3d) — voir project-folder.js pour writeFileInFolder
// et registerInFolder.
// Le contenu de project.json. PARTAGE entre l'enregistrement sur disque et l'enregistrement
// vers un projet heberge : deux assemblages divergents produiraient deux projets differents
// selon l'endroit ou l'on enregistre, et la divergence ne se verrait qu'a la relecture.
export function projectManifestOf(data, assetsManifest){
  return { name: project.name, version: VERSION_MANIFEST, folders: project.folders,
    settings: data.settings,
    scenes: project.scenes.map(s => ({name: s.name})), assets: assetsManifest };
}

/**
 * TOUS les fichiers du projet, sous la forme { chemin -> contenu (string | Uint8Array) }.
 *
 * L'enregistrement habituel est un DELTA (project.json + scène courante) : il suppose que le
 * reste est déjà à destination. Un ENVOI initial vers le cloud, ou une copie vers un dossier
 * neuf, n'a pas cette base — il lui faut tout : chaque scène chargée, les fichiers textuels
 * des assets (scripts, matériaux, tables… et leurs `.meta`), et les fichiers BINAIRES
 * (textures, sons, modèles), qu'aucun enregistrement n'écrit parce qu'ils partent à l'import.
 * Les chemins sont ceux de writeAssetInFolder : la copie se rouvre comme un dossier ordinaire.
 */
export async function collectProjectFiles(){
  assertSavable();
  const data = await buildDataProject();
  const { assets: assetsManifest, filesAWrite } = diskAssetManifest();
  const files = { 'project.json': JSON.stringify(projectManifestOf(data, assetsManifest), null, 2) };
  Object.assign(files, scenesToWrite(data.scenes, {}, files));
  for(const f of filesAWrite) files[f.filePath] = f.content;
  Object.assign(files, await binaryAssetFiles());
  return files;
}

/**
 * Les fichiers BINAIRES des assets (textures, sons, modèles) : { chemin -> Uint8Array }, aux
 * chemins de writeAssetInFolder.
 *
 * ⚠ UN PROJET HÉBERGÉ NE LES RECEVAIT JAMAIS. En mode dossier ils sont écrits à l'import
 * (writeAssetInFolder) ; en mode cloud, rien ne les envoyait — ni l'import, ni
 * registerInCloudProject, qui ne portait que project.json, les scènes et les fichiers textuels.
 * project.json listait donc des PNG absents du serveur : au rechargement et dans le jeu publié,
 * chaque texture importée depuis l'ouverture du projet était « introuvable », sans erreur à
 * l'enregistrement. Envoyer TOUS les binaires à chaque enregistrement ne coûte qu'un hachage :
 * saveCloudProject ne transfère que les empreintes que le serveur n'a pas.
 */
export async function binaryAssetFiles(){
  const files = {};
  for(const a of assets){
    const binaries = a.file ? [a.file] : (a.kind === 'model' ? (a.paquet || []) : []);
    const prefix = a.folder ? 'assets/' + a.folder + '/' : 'assets/';
    for(const f of binaries){
      if(f && typeof f.arrayBuffer === 'function') files[prefix + f.name] = new Uint8Array(await f.arrayBuffer());
    }
  }
  return files;
}

// Enregistre vers le projet HEBERGE ouvert (project.cloud), en DELTA : seuls project.json, la
// scene courante et les assets reellement modifies partent. Voir js/cloud-project.js et
// docs/superpowers/specs/2026-09-23-projet-cloud-editable-design.md.
export async function registerInCloudProject(){
  assertSavable();
  const report = startSave();
  try {
    const data = await buildDataProject();
    const { assets: assetsManifest, filesAWrite } = diskAssetManifest();
    report('manifest', 0);
    const manifest = projectManifestOf(data, assetsManifest);
    const sceneCurrent = data.scenes[project.current].data;
    if(!sceneCurrent){
      setStatus('Scene vide, rien a enregistrer pour "' + project.scenes[project.current].name + '".', 4000);
      return;
    }
    // Memes deux fichiers que sur disque, et ecrits sans cache : rien ne surveille un projet
    // heberge, donc rien ne pourrait affirmer qu'ils y sont encore a jour.
    const changed = {
      'project.json': JSON.stringify(manifest, null, 2),
      ['scenes/' + project.scenes[project.current].name + '.scene.json']:
        JSON.stringify(sceneCurrent, null, 2)
    };
    // TOUTE SCENE QUI N'A PAS ENCORE DE FICHIER PART AUSSI, meme si elle n'est pas affichee :
    // c'est ce qui rend la CONVERSION d'une archive complete, et ce qui empeche une scene
    // ajoutee d'etre listee sans exister. La regle est dans cloud-project.js, ou elle se teste.
    Object.assign(changed, scenesToWrite(data.scenes, project.cloud.manifest, changed));
    for(const f of filesAWrite) changed[f.filePath] = f.content;
    // les binaires des assets : sans eux, une texture importée n'existe que dans cet onglet
    Object.assign(changed, await binaryAssetFiles());
    report('files', 0);

    // Ce qui n'existe plus à son ancien chemin (asset déplacé, renommé, supprimé, scène
    // retirée) doit sortir du manifeste hébergé, sinon il revient en fantôme au rechargement.
    const live = ['project.json'];
    for(const s of project.scenes) live.push('scenes/' + s.name + '.scene.json');
    for(const da of assetsManifest){
      const dir = 'assets/' + (da.folder ? da.folder + '/' : '');
      for(const n of (da.file ? [da.file] : (da.files || []))) live.push(dir + n);
    }
    const removed = cloudPathsToRemove(project.cloud.manifest,
      live.concat(filesAWrite.map(function(f){ return f.filePath; })), changed);

    const r = await saveCloudProject(project.cloud.id,
      { baseManifest: project.cloud.manifest, changed, removed }, project.cloud.versionId,
      project.cloud.api, null);
    // La reponse porte le manifeste RETENU par le serveur, qui peut differer du notre s'il a
    // fusionne l'enregistrement d'un collegue. Le garder est ce qui permet au prochain
    // enregistrement de repartir de la bonne base.
    project.cloud.versionId = r.version_id;
    if(r.files) project.cloud.manifest = r.files;
    report('files', 1);
    markProjectSaved();
    setStatus('Projet enregistre dans le cloud'
      + (r.fusionnee ? ' (fusionne avec l enregistrement d un collegue)' : ''), 2500);
  } catch(e){
    // Un conflit n'est pas une panne : l'utilisateur tranche, fichier par fichier.
    if(e && e.statut === 409 && e.details && e.details.conflits){
      await solveConflictCloud(e);
    } else setStatus(e.message, 6000);
  } finally {
    endSave();
  }
}

/**
 * Le deuxieme temps d'un enregistrement refuse en conflit : on montre l'ecran, on applique
 * l'arbitrage, on reenvoie sur la tete. RIEN N'EST ECRIT SANS UN CLIC — annuler laisse le
 * travail en memoire, exactement comme avant l'enregistrement.
 */
async function solveConflictCloud(refus){
  const details = refus.details || {};
  const conflicts = details.conflits || [];
  // Le manifeste de TETE : sans lui, garder la version du collegue serait impossible, et
  // garder la mienne effacerait ce qu'il a ecrit sans conflit. Il faut donc le chercher.
  let head;
  try {
    head = await project.cloud.api.readTree(project.cloud.id);
  } catch(err){
    setStatus('Conflit sur ' + conflicts.join(', ') + ', et la version du serveur est '
      + 'illisible (' + err.message + ") : rien n'a ete enregistre.", 9000);
    return;
  }

  const decision = await openConflictScreen({
    conflicts, base: project.cloud.manifest, head: head.files,
    mine: refus.manifest || {}, who: details.auteur
  }, {
    openModal: globalThis.openModal, closeModal: globalThis.closeModal,
    getBody: () => document.getElementById('modal-body')
  });
  if(!decision){ setStatus('Enregistrement abandonne — votre travail reste en memoire.', 4000); return; }

  try {
    // `base` = la TETE : le serveur voit une base a jour et ecrit tel quel. C'est bien nous
    // qui avons arbitre, il n'a plus rien a decider.
    const r = await project.cloud.api.writeTree(project.cloud.id,
      { base: head.version_id, files: decision.manifest, note: 'resolution de conflit' });
    project.cloud.versionId = r.version_id;
    if(r.files) project.cloud.manifest = r.files;
    markProjectSaved();

    const reprises = conflicts.filter((p) => decision.choices[p] !== 'mine');
    if(reprises.length){
      // Ce qu'on voit a l'ecran n'est PLUS ce qui est enregistre pour ces fichiers. Le dire
      // sans recharger laisserait l'editeur mentir jusqu'au prochain enregistrement, qui
      // reecraserait le choix qu'on vient de faire.
      setStatus('Conflit resolu. ' + reprises.length + ' fichier(s) repris du serveur : '
        + 'rechargement du projet…', 4000);
      await openCloudProjectFromUrl();
    } else {
      setStatus('Conflit resolu — votre version a ete gardee pour ' + conflicts.length
        + ' fichier(s).', 4000);
    }
  } catch(err){
    setStatus('La resolution a echoue : ' + err.message, 8000);
  }
}

export async function registerInProjectOpen(){
  // Un projet heberge n'a pas de dossier : il s'enregistre vers le cloud. L'aiguillage est ICI
  // plutot que chez les trois appelants (bouton de la barre, menu, autosave), pour qu'aucun
  // d'eux n'ait a savoir d'ou vient le projet ouvert.
  if(project.cloud) return registerInCloudProject();
  assertSavable();
  if(!project.handleFolder){
    setStatus('Aucun dossier de projet ouvert — utilisez "Ouvrir un dossier de projet…".', 4000);
    return;
  }
  // L'ENREGISTREMENT EST LONG SUR UN GROS PROJET, et il l'est en silence : entre le clic et le
  // message final, rien ne bougeait. `report` fait avancer le bouton de la barre du haut à
  // chaque jalon — et `endSave()` le referme dans le `finally`, y compris quand l'écriture
  // échoue, sinon il resterait bloqué sur « Enregistrement… » sans moyen de réessayer.
  const report = startSave();
  // UNE IMAGE AVANT DE PARTIR. `buildDataProject()` occupe le fil principal sans jamais rendre
  // la main assez longtemps pour un repaint : sans ce temps d'arrêt, le bouton n'affiche
  // « Enregistrement… » qu'une fois la partie la plus lente DÉJÀ passée — c'est-à-dire pile
  // pendant la seconde où l'utilisateur se demandait si son clic avait pris.
  if(typeof requestAnimationFrame === 'function'){
    await new Promise(function(res){ requestAnimationFrame(function(){ res(); }); });
  }
  try {
    // buildDataProject() met à jour project.scenes[project.courante].donnees
    // via stateCurrent() avant de construire data — donc donnees.scenes[project.courante].donnees
    // est déjà à jour pour la scène affichée. Les AUTRES scènes (jamais rendues courantes)
    // gardent leur `data` telle quelle en mémoire, potentiellement null si jamais
    // visitées ni chargées du disque.
    const data = await buildDataProject();
    const { assets: assetsManifest, filesAWrite } = diskAssetManifest();
    report('manifest', 0);
    // Le manifeste porte TOUT le niveau projet, pas seulement son nom : `inputs`, `layers`,
    // `layers2d`, `ppu2d`, `lightmap`, `design` et `versionVisible` sont dans
    // buildDataProject() depuis toujours, et le manifeste les oubliait — un projet ouvert en
    // dossier perdait donc ses calques et ses entrées à CHAQUE enregistrement.
    // Le manifeste porte TOUT le niveau projet, `settings` compris. Il ne l'écrivait pas : un
    // projet ouvert en dossier perdait ses calques et ses entrées à CHAQUE enregistrement.
    // `name` reste aussi à plat — c'est ce qu'un humain lit en premier dans project.json.
    const manifest = projectManifestOf(data, assetsManifest);
    const sceneCurrent = data.scenes[project.current].data;
    if(!sceneCurrent){
      setStatus('Scène vide, rien à enregistrer pour "' + project.scenes[project.current].name + '".', 4000);
      return;
    }
    // L'ÉCRITURE INCRÉMENTALE, ET LES DEUX CONDITIONS QUI LA RENDENT SÛRE.
    //
    // Sauter un fichier suppose de savoir que le disque porte encore ce que l'éditeur y a mis.
    // C'est la surveillance du dossier qui le garantit, en invalidant (js/project.js,
    // invalidateWritesOfDisk) chaque chemin qui bouge hors de l'éditeur. Éteinte par préférence
    // ou ARRÊTÉE par une perte d'accès, plus personne ne le signale : on vide le cache et on
    // réécrit tout, comme avant. Lent, jamais faux.
    //
    // Et la portée est celle de la surveillance, donc `assets/` : `project.json` et le fichier
    // de scène s'écrivent TOUJOURS, sans passer par le cache. Rien ne les surveille — un `git
    // pull` ou une édition à la main les changerait sans que l'éditeur l'apprenne, et il
    // sauterait alors l'écriture d'un manifeste qu'il croit à jour. Ce sont deux fichiers : le
    // gain était nul, le risque non.
    if(!folderWatchEnabled() || folderWatch.stopped) resetWriteCache();
    let sautes = 0;
    async function put(filePath, content){
      if(!changedSinceWrite(filePath, content)){ sautes++; return; }
      await writeFileInFolder(project.handleFolder, filePath, content);
      // APRÈS l'écriture seulement : un échec doit laisser le fichier « à écrire », sinon
      // l'enregistrement suivant le sauterait et la perte deviendrait définitive.
      noteWritten(filePath, content);
    }

    await registerInFolder(project.handleFolder, manifest, sceneCurrent,
                           project.scenes[project.current].name);
    // Les fichiers sont comptés UN PAR UN : c'est la partie longue, et la seule dont on connaisse
    // le nombre exact à l'avance. Un projet sans fichier à écrire n'a pas de dénominateur — il
    // passe directement à 100 % plutôt que de diviser par zéro.
    report('files', filesAWrite.length ? 0 : 1);
    let traites = 0;
    for(const f of filesAWrite){
      await put(f.filePath, f.content);
      report('files', ++traites / filesAWrite.length);
    }
    // Les fichiers qu'une migration a rendus inutiles (les `.animation.json` des clips passés
    // dans leur modèle). APRÈS l'écriture du manifeste qui ne les cite plus : effacés avant,
    // un enregistrement interrompu laisserait un manifeste qui les réclame.
    await removeObsoleteDiskFiles();
    markProjectSaved();
    setStatus('Projet enregistré dans ' + project.handleFolder.name
      + (sautes ? ' — ' + sautes + ' fichier(s) déjà à jour' : ''), 2000);
  } catch(e){
    setStatus(e.message, 6000);
  } finally {
    endSave();
  }
}

// ---------- Export « folder Git » : arborescence lisible et versionnable ----------
// project.json + scenes/*.scene.json (JSON indenté) + prefabs/*.prefab.json +
// scripts/*.js + assets/ (fichiers bruts, pas de base64). Livré en .zip.
// L'archive .p3d reste le format d'OUVERTURE de l'éditeur.
/**
 * Fait passer les assets `animation` AUTONOMES de source `model` dans la liste des clips de leur
 * modèle (`paramsImport.clips`), sous leur propre id — les états de l'Animator qui les citent
 * n'ont donc rien à changer. Un modèle qui n'avait encore aucune liste gagne un clip par prise
 * pour ce qu'aucun asset ne couvrait, comme Unity avant qu'on touche à la liste.
 *
 * Leurs fichiers `.animation.json` sont notés pour être effacés au prochain enregistrement
 * (`removeObsoleteDiskFiles`) : les garder les ferait redécouvrir comme des assets orphelins.
 */
export function migrateAnimAssetsIntoModels(models){
  const disk = project.handleFolder ? diskAssetManifest().assets : [];
  (models || []).forEach(function(m){
    if(!m || m.kind !== 'model') return;
    if(!m.paramsImport) m.paramsImport = {};
    const standalone = assets.filter(function(x){
      return x.kind === 'animation' && !x.embedded && x.source && x.source.asset === m.id
        && (x.source.type || 'model') === 'model';
    });
    const fresh = !Array.isArray(m.paramsImport.clips);
    if(fresh) m.paramsImport.clips = [];
    const clips = m.paramsImport.clips;
    standalone.forEach(function(x){
      if(clips.some(function(c){ return c.id === x.id; })) return;
      clips.push({id: x.id, name: x.name, take: x.source.clip,
        start: x.start || 0, end: (x.end === undefined) ? null : x.end,
        speed: x.speed === undefined ? 1 : x.speed, loop: x.loop === undefined ? true : !!x.loop});
      const d = disk.find(function(y){ return y.id === x.id; });
      const names = d ? (d.files || (d.file ? [d.file] : [])) : [];
      if(names.length){
        if(!project.obsoleteDiskFiles) project.obsoleteDiskFiles = [];
        project.obsoleteDiskFiles.push({folder: d.folder || '', names: names});
      }
    });
    if(fresh && typeof defaultClipsOfTakes === 'function'){
      const takes = (m.animationsBrutes || (m.template && m.template.animations) || [])
        .filter(function(t){ return !clips.some(function(c){ return c.take === t.name; }); });
      defaultClipsOfTakes(takes, newClipId).forEach(function(c){ clips.push(c); });
    }
    // Les réglages d'avant restent complétés de leurs défauts à la lecture
    // (`normalizeClipSettings`) : on n'invente ici que l'identité et la prise.
    syncClipAssetsOfModel(m);
  });
}

/** Efface les fichiers notés par une migration. Best-effort : un échec est signalé, pas fatal. */
export async function removeObsoleteDiskFiles(){
  const list = project.obsoleteDiskFiles || [];
  if(!list.length || !project.handleFolder) return;
  project.obsoleteDiskFiles = [];
  for(const f of list){
    try { await removeFilesAssetOnDisk(project.handleFolder, f.folder, f.names); }
    catch(e){ setStatus('Fichier obsolète non effacé : ' + e.message, 5000); }
  }
}

export function slugFile(name){
  return String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sans-name';
}

export async function exportProjectGit(){
  setStatus('Préparation de l\'export Git…');
  project.scenes[project.current].data = stateCurrent();
  const files = {};
  const taken = new Set();
  function filePath(prefixe, name, ext){
    let base = prefixe + slugFile(name), c = base, i = 2;
    while(taken.has(c + ext)) c = base + '-' + (i++);
    taken.add(c + ext);
    return c + ext;
  }
  const json2 = function(o){ return fflate.strToU8(JSON.stringify(o, null, 2) + '\n'); };

  const scenesRefs = [];
  project.scenes.forEach(function(s){
    const f = filePath('scenes/', s.name, '.scene.json');
    scenesRefs.push({name:s.name, file:f});
    const d = s.data || {objects:[], tracks:[], duration:5, loop:true, env:null};
    files[f] = json2({name:s.name, duration:d.duration, loop:d.loop, env:d.env || null,
      objects:d.objects, tracks:d.tracks});
  });

  const namesAssets = {};
  assets.forEach(function(a){ namesAssets[a.id] = a.name; });
  assets.filter(function(a){ return a.kind === 'prefab'; }).forEach(function(a){
    files[filePath('prefabs/', a.name, '.prefab.json')] = json2({
      name:a.name, base:a.base ? (namesAssets[a.base] || null) : null,
      tree:serializeTree(a.template)});
  });
  assets.filter(function(a){ return a.kind === 'script'; }).forEach(function(a){
    files[filePath('scripts/', a.name, '.js')] = fflate.strToU8(a.code);
  });
  assets.filter(function(a){ return a.kind === 'material'; }).forEach(function(a){
    const propsGit = Object.assign({}, a.props);
    ['texAsset', 'normalAsset', 'roughnessAsset', 'metalAsset', 'aoAsset', 'emissiveAsset', 'combineAsset']
      .forEach(function(k){
        if(propsGit[k]) propsGit[k] = namesAssets[propsGit[k]] || null;
      });
    files[filePath('materials/', a.name, '.material.json')] = json2({name:a.name, props:propsGit});
  });
  for(const a of assets){
    if((a.kind === 'texture' || a.kind === 'audio') && a.file){
      files['assets/' + (a.folder ? a.folder + '/' : '') + a.file.name] = new Uint8Array(await a.file.arrayBuffer());
    } else if(a.kind === 'model'){
      for(const f of (a.paquet || [])) files['assets/' + (a.folder ? a.folder + '/' : '') + f.name] = new Uint8Array(await f.arrayBuffer());
    }
  }

  files['project.json'] = json2({
    name: project.name,
    version: 2,
    current: project.current,
    inputs: project.inputs || null,
    scenes: scenesRefs,
    note: 'Export lisible pour Git. L\'archive .p3d reste le format d\'ouverture de l\'éditeur.'
  });

  const zip = fflate.zipSync(files, {level:6});
  const blob = new Blob([zip], {type:'application/zip'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = slugFile(project.name) + '-git.zip';
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 5000);
  setStatus('Export Git : ' + Object.keys(files).length + ' fichier(s), '
    + Math.round(blob.size/1024) + ' Ko', 3500);
}

// ---------- Export des données de jeu (format runtime, découplé de la sauvegarde) ----------
export function filePathOf(o){
  const morceaux = [o.name];
  let p = o.parent;
  while(p && p !== scene){ morceaux.unshift(p.name); p = p.parent; }
  return morceaux.join('/');
}

export function exportDataGame(){
  function node(o){
    const t = o.userData.type;
    const game = o.userData.game || {};
    const n = {
      name: o.name,
      type: t,
      // Meme raison que serializeObject : c'est l'intention qui part dans le jeu publie.
      visible: visibleIntent(o),
      tag: game.tag || '',
      layer: game.layer || 'Défaut',
      props: game.props || {},
      transform: {
        position: o.position.toArray(),
        quaternion: o.quaternion.toArray(),
        scale: o.scale.toArray()
      },
      collider: o.userData.collider && o.userData.collider.shape !== 'auto'
        ? o.userData.collider : null,
      physics: (o.userData.phys && o.userData.phys.active) ? o.userData.phys : null,
      // Le code est RÉSOLU depuis l'asset référencé : l'entrée ne porte plus que `scriptId`.
      // Cet export-là (menu « Exporter les données de jeu ») est une photo lisible du niveau,
      // pas le format du build — il aplatit donc la référence en texte, exprès.
      scripts: (o.userData.scripts || [])
        .map(function(s){ return s.active ? codeOfScriptEntry(s) : ''; })
        .filter(function(code){ return code && code.trim(); }),
      events: (o.userData.events && o.userData.events.length)
        ? o.userData.events : null
    };
    if(o.userData.audio && o.userData.audio.asset){
      const aa = assets.find(function(x){ return x.id === o.userData.audio.asset; });
      n.audio = Object.assign({}, o.userData.audio, {asset: aa ? aa.name : null});
    }
    if(t === 'particles') n.particles = o.userData.part || null;
    if(t === 'terrain') n.terrain = o.userData.terr || null;
    if(t === 'mesh'){
      n.geometry = o.userData.geo;
      n.material = {
        color: '#' + o.material.color.getHexString(),
        smoothness: smoothingFromRoughness(o.material.roughness),
        metal: o.material.metalness,
        emissive: '#' + new THREE.Color(o.userData.emissiveBase || 0).getHexString(),
        opacity: (o.material.opacity !== undefined) ? o.material.opacity : 1
      };
    }
    // matériau asset : prioritaire sur le matériau local (primitives ET modèles)
    const ma = o.userData.materialId
      ? assets.find(function(x){ return x.id === o.userData.materialId && x.kind === 'material'; })
      : null;
    if(ma){
      function nameTex(id){
        const ta = id ? assets.find(function(x){ return x.id === id; }) : null;
        return ta ? ta.name : null;
      }
      n.material = {
        asset: ma.name,
        color: ma.props.color,
        smoothness: ma.props.smoothness,
        metal: ma.props.metal,
        emissive: ma.props.emissive,
        opacity: ma.props.opacity,
        doubleSided: !!ma.props.doubleSided,
        tiling: ma.props.tiling,
        offset: ma.props.offset,
        maps: {
          albedo: nameTex(ma.props.texAsset),
          normal: nameTex(ma.props.normalAsset),
          normalIntensity: ma.props.normalIntensity,
          roughness: nameTex(ma.props.roughnessAsset),
          metal: nameTex(ma.props.metalAsset),
          combinee: nameTex(ma.props.combineAsset),
          ao: nameTex(ma.props.aoAsset),
          aoIntensity: ma.props.aoIntensity,
          emissive: nameTex(ma.props.emissiveAsset)
        }
      };
    }
    if(t === 'point' || t === 'spot' || t === 'directional'){
      const l = findRefs(o).light;
      if(l) n.light = {
        color: '#' + l.color.getHexString(),
        intensity: l.intensity,
        range: l.distance,
        angle: l.angle,
        penumbra: l.penumbra
      };
    }
    if(t === 'camera'){
      const c = findRefs(o).cam;
      // `fov` AU PREMIER NIVEAU, en plus de `camera.fov` : c'est `d.fov` que lit le runtime, et
      // seulement lui. Sous `camera:{}` le champ était écrit, lisible dans le fichier, et
      // silencieusement ignoré — toute caméra exportée par ce menu ouvrait à 50°. `camera` est
      // conservé pour ne pas casser un consommateur externe de ce JSON.
      if(c){ n.camera = {fov: c.fov}; n.fov = c.fov; }
      if(o.userData.camActive === false) n.camActive = false;
    }
    // LES SIX CHAMPS DE LA 2D. Le runtime les lit tous (`d.sprite2d`, `d.animSprite`, `d.tilemap2d`,
    // `d.corps2d`, `d.collider2d`, `d.controleur2d`) et ce chemin d'export n'en écrivait AUCUN :
    // « Exporter les données de jeu (.json) » produisait, pour un jeu 2D, un fichier où il ne
    // restait ni décor, ni personnage, ni collision — des nœuds nus, sans une erreur. L'export en
    // ZIP passe par `stateCurrent()`, un autre sérialiseur, et lui les portait : le défaut ne se
    // voyait donc que par ce menu-là.
    ['sprite2d', 'animSprite', 'body2d', 'collider2d', 'controller2d'].forEach(function(k){
      if(o.userData[k]) n[k] = JSON.parse(JSON.stringify(o.userData[k]));
    });
    if(t === 'model'){
      const a = assets.find(function(x){ return x.id === o.userData.assetId; });
      n.model = a ? a.name : null;
    }
    // `isSceneObject` et pas `objects.indexOf` : cette fonction est récursive sur tout l'arbre,
    // donc un test linéaire par enfant faisait un O(n²) à chaque export. L'index de scène répond
    // en O(1) (objects.js).
    n.enfants = o.children.filter(isSceneObject).map(node);
    return n;
  }

  const data = {
    format: 'moteur3d-export',
    // v3 : `materiau.rugosite` devient `materiau.lissage` (= 1 − rugosité). Un consommateur
    // externe doit lire le numéro pour savoir laquelle des deux il a en main.
    version: 3,
    exporte: new Date().toISOString(),
    environment: JSON.parse(JSON.stringify(env)),
    animation: {
      duration: anim.duration,
      loop: anim.loop,
      tracks: (typeof tracksOfScene === 'function' ? tracksOfScene() : anim.tracks).map(function(p){
        return {object: filePathOf(p.obj), additif: !!p.additif, keys: p.keys};
      })
    },
    objects: objects.filter(function(o){ return o.parent === scene; }).map(node)
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'export-game.json';
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 5000);
  setStatus('Données de jeu exportées (export-game.json)', 3000);
}

export function newScene(effacerAssets){
  if(phys.active) stopSimulation();
  anim.playback = false;
  btnPlayback.textContent = '▶';
  gizmoAttach(null);
  const racines = objects.filter(function(o){ return o.parent === scene; });
  objects.forEach(removeHelper);
  racines.forEach(function(r){
    scene.remove(r);
    r.traverse(function(o){
      if(o.geometry) o.geometry.dispose();
      listMats(o).forEach(function(m){ if(m.dispose) m.dispose(); });
    });
  });
  objects.length = 0;
  // Filet de sécurité : si un objet a un jour fini dans `scene` sans être suivi dans
  // `objects` (fuite ailleurs — un chemin qui fait scene.add() sans objets.push()), le
  // nettoyage ci-dessus ne le voit jamais, puisqu'il part de `objects` et pas du graphe
  // réel. L'orphelin survit alors à CHAQUE changement de projet, indéfiniment, jusqu'à
  // entrer en collision d'id three.js avec un futur objet légitime (constaté : un objet
  // de test resté en mémoire empêchait la sélection de tout ce qui suivait son id dans un
  // project chargé ensuite — scene.getObjectById() retombait sur l'orphelin au lieu du bon
  // objet). Un balayage direct de `scene.children` referme la fuite quelle qu'en soit la
  // cause, plutôt que de la rechasser une par une.
  const fixturesPermanentes = new Set([hemi, sun, grid, tcVisual, proxyView].filter(Boolean));
  scene.children.slice().forEach(function(o){
    if(fixturesPermanentes.has(o)) return;
    scene.remove(o);
    o.traverse(function(d){
      if(d.geometry) d.geometry.dispose();
      listMats(d).forEach(function(m){ if(m.dispose) m.dispose(); });
    });
  });
  // Un clip ouvert n'a plus de racine dans une scène qu'on vide : on referme avant, sinon la
  // timeline continuerait d'écrire dans un asset en visant des objets détruits.
  if(typeof closeClipAsset === 'function') closeClipAsset();
  anim.tracks = [];
  setKeySel(null);
  anim.t = 0;
  if(effacerAssets){
    assets.forEach(function(a){
      if(a.kind === 'texture' && a.preview && a.preview.indexOf('blob:') === 0) URL.revokeObjectURL(a.preview);
    });
    assets.length = 0;
    updateProject();
  }
  applyEnvironment(ENV_DEFAULT);
  select(null);
  updateHierarchy();
  updateTimeline();
}

/**
 * Un projet 2D neuf : la scène de départ d'un jeu 2D au lieu de celle d'une scène 3D.
 *
 * La scène de départ de l'éditeur est un sol, un cube, un soleil et une caméra en perspective
 * (js/startup.js) — c'est-à-dire tout ce qu'un jeu 2D ne veut pas. Commencer un jeu 2D demandait
 * donc de supprimer quatre objets, de trouver l'onglet 2D, puis de créer trois objets. Rien de
 * difficile, mais quatre gestes de trop avant le premier, et c'est là que l'on décide si un outil
 * est fait pour ce qu'on veut faire.
 *
 * Le sol est posé PLEIN sur la rangée du bas : un platformer dont le personnage tombe dans le vide à
 * la première image ne montre pas ce que l'éditeur sait faire.
 */
export function newProject2d(){
  newScene(false);
  project.name = 'Jeu 2D';
  const tiles = createFromCreatable('Tilemap');
  tiles.name = 'Décor';
  const c = tiles.getComponent('Tilemap');
  setRectTilemap(c, 0, c.height - 2, c.width - 1, c.height - 1, 1);
  rebuildTilemap(tiles);

  const cam = createFromCreatable('Camera');
  cam.getComponent('Camera').projection = 'orthographic';
  cam.getComponent('Camera').pixelPerfect = true;
  cam.getComponent('Camera').applyProjection();
  faceCameraToPlane(cam);
  cam.addComponent('CameraFollow', {});
  cam.getComponent('Camera').main = true;
  cam.name = 'Caméra 2D';
  const r = cam.getComponent('Camera');
  const f = cam.getComponent('CameraFollow');
  // Cadrage sur la largeur du niveau : le réglage qu'un auteur ne pense pas à faire, et dont
  // l'absence donne « c'est flou ».
  r.mode = 'width';
  r.widthLevel = Math.round(c.width * c.cellSize * 100) / 100;

  // SEULES LES BORNES HORIZONTALES, et c'est mesuré. « Déduire du décor » rendrait ici l'étendue du
  // SOL — deux rangées, soit une bande d'une unité de haut (yMin −9, yMax −8) — et le suivi
  // centrerait la caméra sur cette bande, puisqu'un niveau plus étroit que la vue est centré par
  // construction. La caméra serait clouée sur la ligne du sol, à montrer surtout du sous-sol.
  //
  // La verticale reste donc LIBRE, ce que le module recommande quand on ne connaît pas la hauteur du
  // niveau. Et on ne la connaît pas : il n'est pas encore dessiné.
  f.xMin = 0;
  f.xMax = r.widthLevel;

  // Le ppu de la caméra suit celui du PROJET. Sans ça, la vue 2D de l'éditeur count ses pixels avec
  // `ppu2d` (100 par défaut) et la caméra de jeu avec le sien (16) : le zoom ×2 réglé à l'écran ne
  // donne pas le même rapport en game, et l'auteur cadre sur une échelle qui n'est pas la sienne.
  r.ppu = ppu2dOfProject();

  project.kind = '2d';
  updateHierarchy();
  select(tiles);
  setStatus('Projet 2D neuf : un décor de ' + c.width + ' × ' + c.height + ' cases avec son sol, et une '
    + 'caméra 2D cadrée sur la largeur. Le pinceau de la barre 2D remplit le reste.', 8000);
}

// ---------- Format DÉCOMPOSÉ : un fichier par scène, un par asset ----------
// Le project était un unique blob JSON. Deux conséquences : deux personnes ne
// pouvaient pas éditer deux scènes différentes sans se marcher dessus, et le
// navigateur devait analyser d'un bloc une chaîne base64 de plusieurs centaines
// de méga-octets dès qu'il y avait de vrais modèles.
//
// Ce n'est PAS l'export Git (exportProjectGit). Celui-ci aims la lecture par
// un humain : il référence les assets par nom et laisse tomber les paramètres
// d'import — l'inverser fidèlement serait fragile. Ici on découpe MÉCANIQUEMENT
// la structure que buildDataProject produit déjà, sans rien réinterpréter.
// La recomposition est donc exacte par construction, et le test le vérifie.
// Le manifeste d'un projet, et le SEUL name écrit désormais.
//
// L'archive `.p3d` écrivait `project.json`, les deux chemins de dossier écrivaient `project.json`.
// Un caractère d'écart, et aucun repli : dézipper un `.p3d` ne donnait donc PAS un dossier project
// ouvrable, et zipper un dossier project ne donnait pas un `.p3d` lisible — alors que les deux
// écrivent la même structure (`scenes/`, `assets/`). Le message d'erreur disait « ce n'est pas un
// project valide », donc on soupçonnait le contenu et pas le nom du fichier.
//
// `project.json` gagne parce que c'est celui des deux formes de dossier, donc celui déjà écrit sur
// les disques et dans les dépôts Git. `project.json` reste LU, sans quoi tous les `.p3d` déjà
// enregistrés deviendraient illisibles — et un changement de format qui casse les fichiers
// existants n'est pas une amélioration.
export const PROJECT_MANIFEST = 'project.json';
export const PROJECT_MANIFEST_OLD = 'projet.json';

export function splitProject(data){
  const files = {};
  const text = function(o){ return fflate.strToU8(JSON.stringify(o, null, 2) + '\n'); };

  // enveloppe : tout sauf les scènes et les assets, plus la liste de leurs fichiers
  const envelope = {};
  Object.keys(data).forEach(function(k){
    if(k !== 'scenes' && k !== 'assets') envelope[k] = data[k];
  });
  envelope.scenes = (data.scenes || []).map(function(s, i){
    return {name: s.name, file: 'scenes/' + i + '.json'};
  });
  envelope.assets = (data.assets || []).map(function(a, i){
    return {id: a.id, kind: a.kind, name: a.name, file: 'assets/' + i + '.json'};
  });
  files[PROJECT_MANIFEST] = text(envelope);

  (data.scenes || []).forEach(function(s, i){ files['scenes/' + i + '.json'] = text(s); });
  (data.assets || []).forEach(function(a, i){ files['assets/' + i + '.json'] = text(a); });
  return files;
}

export function recomposeProject(files){
  const read = function(filePath){
    const u = files[filePath];
    if(!u) throw new Error('fichier manquant dans l\'archive : ' + filePath);
    return JSON.parse(fflate.strFromU8(u));
  };
  // Le nom current d'abord, l'ancien ensuite : c'est ce repli qui garde lisibles les `.p3d` écrits
  // avant l'unification, et il permet en passant d'ouvrir un dossier project simplement zippé.
  const envelope = read(files[PROJECT_MANIFEST] ? PROJECT_MANIFEST : PROJECT_MANIFEST_OLD);
  const data = {};
  Object.keys(envelope).forEach(function(k){
    if(k !== 'scenes' && k !== 'assets') data[k] = envelope[k];
  });
  data.scenes = (envelope.scenes || []).map(function(ref){ return read(ref.file); });
  data.assets = (envelope.assets || []).map(function(ref){ return read(ref.file); });
  return data;
}

/**
 * Écrit un fichier, en demandant OÙ quand le navigateur sait le faire.
 *
 * `<a download>` laisse le navigateur décider seul du nom et de l'emplacement, et tous ne se
 * comportent pas pareil : le navigateur intégré de certains outils dépose le fichier dans le
 * dossier de téléchargement sous un nom d'identifiant, suffixé `.tmp`. Mesuré : un `.p3d` de
 * 1,7 Mo, parfaitement valide, arrivé sous le nom `f12129ba-…-4dd1419ae316.tmp` — il a fallu
 * l'identifier à sa taille et à sa signature ZIP pour le retrouver. Un projet qu'on ne reconnaît
 * plus est un projet perdu.
 *
 * `showSaveFilePicker` demande donc où enregistrer, avec le bon nom et la bonne extension. Le
 * repli sur `<a download>` reste, parce que l'API n'existe pas partout — et un refus de
 * l'utilisateur ne doit surtout pas déclencher ce repli : il a dit non, pas « fais autrement ».
 */
export async function writeFileChosen(blob, fileName, description){
  if(typeof showSaveFilePicker === 'function'){
    try {
      const ext = '.' + fileName.split('.').pop();
      const h = await showSaveFilePicker({
        suggestedName: fileName,
        types: [{description: description || 'Projet', accept: {'application/zip': [ext]}}]
      });
      const w = await h.createWritable();
      await w.write(blob);
      await w.close();
      return 'disk';
    } catch(e){
      if(e && e.name === 'AbortError') return 'annule';
      // Toute autre panne — API absente du contexte, permission refusée par la page — retombe sur
      // le téléchargement : mieux vaut un fichier mal nommé que pas de fichier du tout.
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 5000);
  return 'telechargement';
}

export async function registerScene(){
  assertSavable();
  setStatus('Préparation de la sauvegarde…');
  const data = await buildDataProject();
  const zip = fflate.zipSync(splitProject(data), {level:6});
  const blob = new Blob([zip], {type:'application/zip'});
  const fileName = slugFile(project.name || 'project-3d') + '.p3d';
  const ou = await writeFileChosen(blob, fileName, 'Projet 3D');
  if(ou === 'annule'){ setStatus('Enregistrement annulé', 2500); return; }
  setStatus('Projet enregistré (' + project.scenes.length + ' scène(s), '
    + Math.round(blob.size / 1024) + ' Ko — un fichier par scène et par asset dans l\'archive)'
    + (ou === 'telechargement'
        ? ' — déposé dans vos téléchargements, le navigateur a pu le renommer'
        : ''), 4000);
}

export async function loadScene(file){
  let data;
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    if(buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b){
      // « PK » : archive décomposée (format current)
      data = recomposeProject(fflate.unzipSync(buf));
    } else if(buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b){
      // 1f 8b : JSON gzippé — ancien format, toujours lisible. Les projets déjà
      // enregistrés doivent continuer de s'ouvrir : un changement de format qui
      // rend les fichiers existants illisibles n'est pas une amélioration.
      data = JSON.parse(fflate.strFromU8(fflate.gunzipSync(buf)));
    } else {
      data = JSON.parse(fflate.strFromU8(buf));   // .json en clair
    }
  }
  catch(e){ setStatus('Fichier de projet illisible — ' + e.message, 5000); return; }
  await loadDataProject(data);
}

// Reconstruit les assets d'un projet à partir de leurs descripteurs (`das`, la
// forme {id, kind, name, folder, ...} produite par assetsSerialized()/l'écriture
// disque) et les ajoute à `assets[]`. `resoudreFichier(reference, descripteur)`
// convertit UNE référence de fichier (chaîne base64 pour le format .p3d, nom de
// fichier relatif pour un dossier project) en un vrai `File` — c'est le seul point
// qui diffère entre les deux formats de stockage ; toute la logique de
// reconstruction/remappage d'ids ci-dessous est partagée entre les deux.
// Retourne assetsById : {ancienId -> nouvel asset en mémoire}.
/**
 * L'asset d'une texture qui n'a pas pu être chargée : même identité, même nom, mêmes réglages,
 * PAS de fichier, une texture damier pour que ce qui l'utilise se voie, et le descripteur
 * d'origine gardé tel quel (`descriptor`). Voir la boucle des textures plus bas.
 */
export function unloadedTextureAsset(da, why){
  let texture = null;
  if(globalThis.THREE && THREE.DataTexture){
    texture = new THREE.DataTexture(checkerPixels(16, 4), 16, 16, THREE.RGBAFormat);
    texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
  }
  return {id: da.id, kind: 'texture', name: da.name, folder: da.folder || '',
          paramsImport: da.paramsImport || null, cuite: !!da.cuite, rgbm: !!da.rgbm,
          preview: null, file: null, texture: texture, imageSource: null,
          dimensionsSource: texture ? [16, 16] : null,
          unloaded: true, loadError: why || '', descriptor: da};
}

/**
 * Refuse un enregistrement tant qu'un asset n'est pas chargé (voir `unloadedAssetsMessage`,
 * js/load-retry.js). Lève : les appelants (bouton, menu, MCP `save_project`, autosave) affichent
 * déjà l'erreur d'un enregistrement raté.
 */
export function assertSavable(){
  const refusal = unloadedAssetsMessage(assets);
  if(!refusal) return;
  setStatus('⛔ ' + refusal, 8000);
  throw new Error(refusal);
}

// LE CONTENU d'une animation et d'une planche de sprites, tel que lu dans son fichier. Partagé
// par l'ouverture du projet (ci-dessous) et le rechargement à chaud (`hotReloadAsset`,
// project.js) : ces deux genres gardent leurs champs À PLAT sur l'asset, et le rechargement
// recopiait le fichier lu dans `a.anim` / `a.sprite`, que personne ne lit. Un .sprite.json ou un
// .animation.json modifié hors de l'éditeur n'avait donc aucun effet — puis était écrasé par
// l'ancienne version au Ctrl+S suivant (v0.197.0).
export function animationFieldsOf(d){
  d = d || {};
  return {duration:d.duration || 1,
          imagesBySeconde:d.imagesBySeconde || 60,
          tracks:JSON.parse(JSON.stringify(d.tracks || [])),
          source:{type:(d.source && d.source.type)
                    || ((d.source && d.source.asset) ? 'model' : 'keys'),
                  asset:(d.source && d.source.asset) || null,
                  clip:(d.source && d.source.clip) || ''},
          speed:d.speed === undefined ? 1 : d.speed,
          loop:d.loop === undefined ? true : !!d.loop,
          start:d.start || 0,
          end:(d.end === undefined || d.end === null) ? null : d.end};
}
export function spriteFieldsOf(d){
  d = d || {};
  return {textureId:d.textureId || null,
          ppu:Number(d.ppu) || 100,
          pivot:{x:(d.pivot && d.pivot.x !== undefined) ? d.pivot.x : 0.5,
                 y:(d.pivot && d.pivot.y !== undefined) ? d.pivot.y : 0.5},
          regions:JSON.parse(JSON.stringify(d.regions || [])),
          sequences:JSON.parse(JSON.stringify(d.sequences || []))};
}

export async function rebuildAssetsFromDescriptors(das, resolveFile){
  const assetsById = {};
  // L'IDENTITÉ D'ABORD, AVANT LA MOINDRE CRÉATION. Deux gestes, dans cet ordre, et l'ordre
  // compte : on réserve le compteur au-dessus de TOUS les ids relus, puis chaque asset
  // reconstruit reprend le sien (`adopt` ci-dessous). Sans la réservation préalable, le
  // premier asset créé prendrait `a1` — qu'un descripteur plus loin revendique peut-être —
  // et les deux se disputeraient les mêmes références. Voir la longue note de `reserveAssetId`
  // (js/assets.js) : c'est la racine de toute la famille de pannes muettes de ce chantier.
  const taken = new Set(assets.map(function(a){ return a.id; }));
  // Les assets DÉJÀ en mémoire avant cet appel. `adoptNewAssets` (project.js) appelle cette
  // fonction avec un lot PARTIEL — les seuls fichiers découverts sur le disque. Les passes de
  // remap plus bas ne doivent alors toucher QUE les assets de ce lot, et une référence vers un
  // asset déjà présent reste valide telle quelle. Avant : le remap parcourait tout `assets`,
  // et chaque planche dont la texture n'était pas dans le lot perdait son `textureId`, en
  // silence (projet Donjon, 2026-10-06 : 72 planches sur 101 vidées par 8 PNG découverts).
  const preexisting = new Set(assets);
  const preexistingIds = new Set(taken);
  function remapRef(id){
    if(assetsById[id]) return assetsById[id].id;
    return preexistingIds.has(id) ? id : null;
  }
  das.forEach(function(da){ reserveAssetId(da.id); });
  // Les clips d'un modèle portent des ids d'asset (les états de l'Animator les citent) : ils
  // doivent être réservés comme les autres, sinon un asset créé plus bas prendrait le leur.
  das.forEach(function(da){
    const clips = da.kind === 'model' && da.paramsImport && da.paramsImport.clips;
    if(Array.isArray(clips)) clips.forEach(function(c){ if(c && c.id) reserveAssetId(c.id); });
  });
  // Enregistre l'asset reconstruit sous l'id qu'il portait dans le fichier ET lui rend cet id.
  // `assetsById` reste indexé par l'ANCIEN id pour que `remapReferencesAssetsInScenes` — qui
  // devient l'identité pour un projet à ids stables — continue de fonctionner tel quel sur les
  // projets d'avant ce lot, et sur les assets découverts (qui, eux, n'ont pas d'id persistant).
  function adopt(a, da){
    if(!a) return a;
    adoptAssetId(a, da.id, taken);
    taken.add(a.id);
    assetsById[da.id] = a;
    return a;
  }
  // ordre : scripts et textures, puis modèles, puis prefabs (qui peuvent référencer des modèles)
  for(const da of das.filter(x => x.kind === 'script')){
    const a = {id:'a'+(nextAssetId()), kind:'script', name:da.name || 'Script', code:da.code || ''};
    assets.push(a);
    assetsById[da.id] = adopt(a, da);
  }
  for(const da of das.filter(x => x.kind === 'data')){
    const a = {id:'a'+(nextAssetId()), kind:'data', name:da.name || 'Données',
               folder:da.folder || '', text:da.text || '[]'};
    assets.push(a);
    assetsById[da.id] = adopt(a, da);
  }
  for(const da of das.filter(x => x.kind === 'documentUI')){
    const a = {id:'a'+(nextAssetId()), kind:'documentUI', name:da.name || 'Document UI',
               folder:da.folder || '', html:da.html || ''};
    assets.push(a);
    assetsById[da.id] = adopt(a, da);
  }
  for(const da of das.filter(x => x.kind === 'animator')){
    const a = {id:'a'+(nextAssetId()), kind:'animator', name:da.name || 'Animator',
               folder:da.folder || '', machine:da.machine || {}};
    assets.push(a);
    assetsById[da.id] = adopt(a, da);
  }
  // La palette de tuiles : oubliée du chemin de rechargement, elle disparaissait à la
  // réouverture même une fois la sauvegarde réparée (docs/REVUE_2026-09-14.md § 2).
  // `palette` est le contenu inline (canal .p3d/autosave) ; en mode dossier-projet c'est
  // project-folder.js qui a déjà relu le fichier et posé le même champ.
  for(const da of das.filter(x => x.kind === 'tilePalette')){
    const a = {id:'a'+(nextAssetId()), kind:'tilePalette', name:da.name || 'Palette',
               folder:da.folder || '', palette:parsePalette(da.palette || emptyPalette(0.5))};
    assets.push(a);
    assetsById[da.id] = adopt(a, da);
  }
  // Les PRESETS D'IMPORT. `preset` porte {kind, params} : le genre d'asset visé et les
  // réglages. Un preset dont le genre est illisible ne s'appliquera à rien — il reste visible
  // dans le panneau plutôt que de disparaître en silence.
  for(const da of das.filter(x => x.kind === 'preset')){
    const d = da.preset || {};
    const a = {id:'a'+(nextAssetId()), kind:'preset', name:da.name || 'Preset',
               folder:da.folder || '',
               preset:{kind:d.kind || '', params:d.params || {}}};
    assets.push(a);
    assetsById[da.id] = adopt(a, da);
  }
  for(const da of das.filter(x => x.kind === 'postProfile')){
    const a = {id:'a'+(nextAssetId()), kind:'postProfile', name:da.name || 'Profil',
               folder:da.folder || '', effects:ensurePostProfileDefaults(da.effects)};
    assets.push(a);
    assetsById[da.id] = adopt(a, da);
  }
  for(const da of das.filter(x => x.kind === 'animation')){
    const a = Object.assign({id:'a'+(nextAssetId()), kind:'animation', name:da.name || 'Animation',
               folder:da.folder || '', format:'animation', version:2,
               // `rev` repart de 0 : c'est un compteer de session, il ne sert qu'à faire
               // recuire le clip après une modification, et rien n'est encore compilé ici.
               rev:0}, animationFieldsOf(da.anim));
    assets.push(a);
    assetsById[da.id] = adopt(a, da);
  }
  for(const da of das.filter(x => x.kind === 'sheetStyle')){
    const a = {id:'a'+(nextAssetId()), kind:'sheetStyle', name:da.name || 'Feuille de style',
               folder:da.folder || '', css:da.css || ''};
    assets.push(a);
    assetsById[da.id] = adopt(a, da);
  }
  for(const da of das.filter(x => x.kind === 'sprite')){
    // `textureId` est remappé plus bas comme toutes les références entre assets.
    const a = Object.assign({id:'a'+(nextAssetId()), kind:'sprite', name:da.name || 'Sprite',
               folder:da.folder || '', format:'sprite', version:1}, spriteFieldsOf(da.sprite));
    assets.push(a);
    assetsById[da.id] = adopt(a, da);
  }
  // Séquentiel, et c'est mesuré : paralléliser ces fetch() avec Promise.all ne
  // change RIEN (541 ms contre 552 sur 46 Mo de textures). b64InFile a l'air
  // d'une entrée-sortie, mais le coût réel est le décodage base64 puis PNG —
  // du calcul, sur un seul fil. Promise.all ne crée pas de threads.
  // Le vrai levier serait de ne pas charger ce dont la scène n'a pas besoin.
  // UN ÉCHEC PASSAGER N'EST PAS UNE PERTE. Le `catch` d'avant journalisait puis passait à la
  // suite : la texture disparaissait de `assets`, et la sauvegarde suivante l'effaçait pour de bon
  // du projet (BUGS_MOTEUR n° 18 — un 429 du serveur à l'ouverture suffisait). Désormais :
  // réessai avec délai croissant (la lecture cloud réessaie déjà elle-même, `readObject`), puis,
  // si l'échec persiste, l'asset est GARDÉ, marqué `unloaded`, avec une texture damier à la place
  // de l'image — et `unloadedAssetsMessage` refuse l'enregistrement tant qu'il en reste.
  for(const da of das.filter(x => x.kind === 'texture')){
    try{
      const f = await withRetry(function(){ return resolveFile(da.files[0], da); }, {attempts: 2});
      assetsById[da.id] = adopt(createAssetTexture(f, {name:da.name, paramsImport:da.paramsImport,
                                                 cuite:!!da.cuite, rgbm:!!da.rgbm, noRefresh:true}), da);
    } catch(e){
      const why = (e && e.message) || String(e);
      console.error('Texture « ' + da.name + ' » non chargée :', e);
      logConsole('error', 'Texture « ' + da.name + ' » non chargée (' + why + ') — gardée dans le projet, '
        + 'enregistrement bloqué jusqu\'au rechargement', null);
      setStatus('Texture « ' + da.name + ' » non chargée — gardée, voir la Console', 6000);
      const a = unloadedTextureAsset(da, why);
      assets.push(a);
      adopt(a, da);
    }
  }
  // Les bruitages : la recette, recalculée en son. Aucune entrée-sortie, donc rien à rattraper —
  // une recette abîmée retombe sur des défauts jouables (normalizeSfx), elle ne perd pas l'asset.
  for(const da of das.filter(x => x.kind === 'sfx')){
    assetsById[da.id] = adopt(createAssetSfx(da.recipe, {name:da.name || 'Bruitage',
                                                       folder:da.folder || '', silent:true}), da);
  }
  for(const da of das.filter(x => x.kind === 'musicLoop')){
    assetsById[da.id] = adopt(createAssetLoop(da.recipe, {name:da.name || 'Boucle',
                                                        folder:da.folder || '', silent:true}), da);
  }
  for(const da of das.filter(x => x.kind === 'audio')){
    try{
      const f = await resolveFile(da.files[0], da);
      assetsById[da.id] = adopt(createAssetAudio(f, {name:da.name, paramsImport:da.paramsImport, noRefresh:true}), da);
    } catch(e){ console.error('Audio « ' + da.name + ' » perdu au chargement :', e); setStatus('Audio « ' + da.name + ' » perdu — voir la Console', 5000); }
  }
  for(const da of das.filter(x => x.kind === 'model')){
    try{
      const files = [];
      for(const fe of da.files) files.push(await resolveFile(fe, da));
      const principal = files.find(f => /\.(glb|gltf|fbx)$/i.test(f.name));
      const blobs = {};
      files.forEach(function(f){ blobs[f.name] = URL.createObjectURL(f); });
      const manager = new THREE.LoadingManager();
      manager.setURLModifier(function(url){
        const nameF = decodeURIComponent(url.replace(/^.*[\\/]/, '').split('?')[0]);
        return blobs[nameF] || url;
      });
      const res = await analyzeModel(principal, manager);
      const clipIdsInFile = ((da.paramsImport && da.paramsImport.clips) || [])
        .map(function(c){ return c && c.id; });
      assetsById[da.id] = adopt(createAssetModel(res.root, da.name, res.format,
        {paquet: files, silencieux: true, unite: res.unite, noRefresh: true,
         paramsImport: da.paramsImport}), da);
      // Les marqueurs d'evenement du fichier : ils appartiennent au clip, donc a l'asset.
      if(da.markers) assetsById[da.id].markers = JSON.parse(JSON.stringify(da.markers));
      // L'Avatar humanoïde (moteur/js/humanoid-avatar.js) : la table emplacement→os, détectée
      // ou corrigée à la main dans l'inspecteur (js/skeleton.js). Relue telle quelle, comme les
      // marqueurs juste au-dessus — elle ne référence aucun id d'asset à remapper.
      if(da.avatar) assetsById[da.id].avatar = JSON.parse(JSON.stringify(da.avatar));
      // L'id qu'un clip portait dans le fichier désigne désormais son sous-asset — c'est par
      // cette table que les états de l'Animator sont remappés plus bas.
      const clipsNow = (assetsById[da.id].paramsImport && assetsById[da.id].paramsImport.clips) || [];
      clipIdsInFile.forEach(function(old, i){
        const c = clipsNow[i];
        const x = c && assets.find(function(y){ return y.id === c.id && y.kind === 'animation'; });
        if(old && x) assetsById[old] = x;
      });
    } catch(e){ console.error(e); setStatus('Modèle « ' + da.name + ' » impossible à recharger', 4000); }
  }
  // matériaux : après les textures (leurs props référencent des ids de textures)
  const KEYS_MAPS = ['texAsset', 'normalAsset', 'roughnessAsset', 'metalAsset', 'aoAsset', 'emissiveAsset', 'combineAsset'];
  // grapheShader avant material : un materiau à shader référence un id de grapheShader
  // dans son shaderId (comme les CLES_MAPS ci-dessous référencent des ids de texture) — le
  // remappage a besoin que le shader soit déjà dans assetsById.
  for(const da of das.filter(x => x.kind === 'graphShader')){
    const a = {id:'a'+(nextAssetId()), kind:'graphShader', name:da.name || 'Graphe de shader',
      folder:da.folder || '', target:da.target || 'lit', properties:da.properties || [],
      nodes:da.nodes || [], links:da.links || [], outputs:da.outputs || {}, layout:da.layout || {}};
    assets.push(a);
    assetsById[da.id] = adopt(a, da);
  }
  for(const da of das.filter(x => x.kind === 'material')){
    const props = Object.assign(JSON.parse(JSON.stringify(MATERIAL_DEFAULT)), da.props || {});
    KEYS_MAPS.forEach(function(k){
      if(props[k]) props[k] = assetsById[props[k]] ? assetsById[props[k]].id : null;
    });
    const a = {id:'a'+(nextAssetId()), kind:'material', name:da.name || 'Matériau', props:props,
      byDefault: da.byDefault || undefined,
      shaderId: da.shaderId && assetsById[da.shaderId] ? assetsById[da.shaderId].id : undefined,
      valuesParams: da.shaderId ? JSON.parse(JSON.stringify(da.valuesParams || {})) : undefined};
    a.preview = previewMaterial(a);
    assets.push(a);
    assetsById[da.id] = adopt(a, da);
  }
  // Emplacements de matériaux des modèles : ils référencent des assets matériaux, créés
  // après les modèles → les ids sont remappés puis les matériaux réappliqués ici, avant
  // les prefabs et les scènes qui clonent les templates de modèles.
  for(const da of das.filter(x => x.kind === 'model')){
    const a = assetsById[da.id];
    const map = da.paramsImport && da.paramsImport.materials;
    if(!a || !map) continue;
    const propre = {};
    Object.keys(map).forEach(function(k){
      const target = map[k] ? assetsById[map[k]] : null;
      if(target && target.kind === 'material') propre[k] = target.id;
    });
    a.paramsImport.materials = propre;
    applyImportModel(a, false);
  }
  for(const da of das.filter(x => x.kind === 'prefab')){
    warnPrefabModelLost(da, assetsById);
    const rec = rebuildTree(da.tree || [], assetsById, false);
    // Plus de disparition MUETTE : un prefab dont l'arbre ne se reconstruit pas était sauté sans
    // un mot, puis absent de la sauvegarde suivante (BUGS_MOTEUR n° 2).
    if(!rec.racines.length){
      const msg = 'Prefab « ' + da.name + ' » illisible au chargement (arbre vide) — ignoré';
      console.error(msg, da);
      logConsole('error', msg, null);
      continue;
    }
    const template = rec.racines[0];
    const a = {id:'a'+(nextAssetId()), kind:'prefab', name:da.name, base:da.base || null,
               preview:previewObject3D(template), template:template};
    assets.push(a);
    assetsById[da.id] = adopt(a, da);
  }
  // restaure le dossier de chaque asset chargé
  das.forEach(function(da){
    if(assetsById[da.id]) assetsById[da.id].folder = da.folder || '';
  });
  // Seuls les assets reconstruits ICI sont remappés (voir `preexisting`).
  const rebuilt = assets.filter(function(a){ return !preexisting.has(a); });
  // remappe les bases de variantes vers les nouveaux ids
  rebuilt.forEach(function(a){
    if(a.kind === 'prefab' && a.base) a.base = remapRef(a.base);
  });
  // Les DEUX références d'asset à asset du chantier animation. Elles sont faciles à oublier
  // parce que `remapReferencesAssetsInScenes` ne parcourt que les objets de scène : une
  // animation qui aims son modèle, et un état de machine qui aims son animation, ne passent
  // par aucune scène. Oubliées, elles survivraient intactes dans le fichier et ne
  // désigneraient plus rien — c'est exactement la panne muette décrite pour `animExt`.
  rebuilt.forEach(function(a){
    if(a.kind === 'animation' && !a.embedded && a.source && a.source.asset){
      a.source.asset = remapRef(a.source.asset);
    }
    if(a.kind === 'animator' && a.machine){
      const remap = function(p){
        if(p && p.animation) p.animation = remapRef(p.animation);
      };
      (a.machine.states || []).forEach(function(e){
        if(!e) return;
        remap(e);
        if(e.blend && e.blend.points) e.blend.points.forEach(remap);
      });
    }
    // La troisième, de la fondation 2D : un sprite aims sa texture. Même piège, même remède —
    // aucune scène ne la traverse, donc rien d'autre ne la remapperait.
    if(a.kind === 'sprite' && a.textureId){
      a.textureId = remapRef(a.textureId);
    }
    // Et la quatrième : une tuile aims son sprite. Même piège, même remède — la palette est
    // un asset, aucune scène ne la traverse.
    if(a.kind === 'tilePalette' && a.palette){
      (a.palette.tiles || []).forEach(function(t){
        if(t && t.spriteId) t.spriteId = remapRef(t.spriteId);
      });
    }
  });
  // EXTRACTION AUTOMATIQUE DES CLIPS EMBARQUÉS, À CHAQUE OUVERTURE — pas seulement à l'import
  // (js/assets.js, même geste). Un modèle qui embarque un clip sans asset Animation
  // correspondant en gagne un ICI aussi : un FBX ajouté à la main sous assets/ (copié depuis
  // l'explorateur, sorti d'un autre outil, récupéré d'un dépôt git — voir discoverFolderAssets)
  // ne passe jamais par le geste d'import, et ses clips restaient sinon accessibles seulement
  // depuis le modèle. Doit tourner APRÈS le remap ci-dessus : c'est lui qui aligne les
  // Animation DÉJÀ déclarées sur les nouveaux ids de modèle, pour que la recherche
  // « en existe-t-il déjà un » ci-dessous ne les recrée pas en double à chaque ouverture.
  //
  // Depuis la v0.159, ces clips sont des SOUS-ASSETS du modèle (onglet Animation) et plus des
  // assets autonomes : `migrateAnimAssetsIntoModels` fait passer les anciens dans leur modèle,
  // sous leur propre id, et pose un clip par prise pour ce qui n'en avait pas.
  migrateAnimAssetsIntoModels(das.filter(x => x.kind === 'model')
    .map(function(da){ return assetsById[da.id]; }).filter(Boolean));
  updateProject();
  return assetsById;
}

// Remappe, dans un tableau de scènes {name, donnees}, toutes les références
// d'assets (texAsset, asset, prefabId, materiauId, audio.asset, env.cielAsset)
// vers leurs NOUVEAUX ids après un rechargement (rebuildAssetsFromDescriptors
// crée des assets avec des ids fraîchement générés, différents de ceux d'origine).
// Le champ de `data` qui porte une référence d'asset, par type de composant. Déclaré à part
// pour être LISIBLE d'un coup d'œil : c'est la liste qu'on oublie de compléter, et un oubli
// ici est muet (la référence pointe vers l'asset qui a hérité du numéro).
// Tilemap / Model / PostVolume / SkinnedMeshRenderer restent traités à la main plus bas :
// chacun a un avertissement ou une forme (tableau) qui lui est propre.
const REFS_ASSET_COMPONENT = {
  AnimatorController: 'assetId',   // la machine d'états (asset animator)
  SpriteRenderer:     'spriteId',
  SpriteAnimator:     'spriteId',
  AudioSource:        'asset',
  ScriptJS:           'scriptId'
};

// ---------- LE RAPPORT DES RÉFÉRENCES MORTES ----------
//
// Le remappage ne parcourt QUE les champs que sa table connaît : un champ oublié y est
// invisible, et c'est là toute l'histoire de ce chantier. Cette fonction-ci fait l'inverse —
// elle ne connaît AUCUN champ, elle parcourt la scène entière et retient toute valeur qui a la
// FORME d'une référence d'asset (`"a17"`, ou un tableau de) sous une clé qui en a le NOM
// (`…Id`, `…Ids`, `asset`, `…Asset`) et qui ne désigne aucun asset du projet.
//
// Elle ne répare rien : elle DIT. Un champ que personne n'a pensé à remapper ne peut plus
// disparaître sans un mot — c'est exactement ce qui manquait quand le menu de Chromélo a perdu
// son HTML, et quand `documentUIId: "a1"` a survécu seul à la renumérotation de ses voisins.
export const KEY_REF_ASSET = /(Ids?|Assets?)$|^asset$/;
export function isRefAsset(v){ return typeof v === 'string' && /^a\d+$/.test(v); }

// LE GENRE ATTENDU PAR CHAMP — et c'est la moitie la plus utile du rapport.
//
// Une reference MORTE se voit (l'asset n'existe plus). Une reference GLISSEE, non : elle se
// resout parfaitement, vers l'asset qui a herite du numero. Mesure sur jeux/Chromelo, dans un
// fichier ecrit avant que les ids deviennent stables : `sheetStyleIds: ["a2"]` designait le
// SCRIPT `chromelo`, pas sa feuille de style. Rien ne le disait — l'interface s'affichait
// simplement sans style, et on cherchait le defaut dans le CSS.
//
// La table est indexee par NOM DE CHAMP et pas par type de composant : elle couvre donc d'un
// coup le composant, le sac a plat qui le double, et les references d'asset a asset — les
// trois endroits ou le meme champ reapparait, et ou on n'en corrigeait jamais que deux.
export const KIND_EXPECTED_BY_FIELD = {
  documentUIId: 'documentUI',
  sheetStyleIds: 'sheetStyle',
  scriptId:      'script',
  materialId:    'material',
  spriteId:      'sprite',
  textureId:     'texture',
  paletteId:     'tilePalette',
  profileId:     'postProfile',
  prefabId:      'prefab',
  shaderId:      'graphShader'
};

export function deadReferencesOf(scenes, assetsById){
  const dead = [];
  const seen = new Set();
  function visit(node, path, nameObject){
    if(!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if(Array.isArray(node)){
      node.forEach(function(v, i){ visit(v, path + '[' + i + ']', nameObject); });
      return;
    }
    // Le nom de l'objet porteur le plus proche : c'est ce qu'on donnera à lire à l'utilisateur,
    // « a1 introuvable » tout seul ne lui dit pas où aller le re-choisir.
    const name = (typeof node.name === 'string' && node.name) ? node.name : nameObject;
    Object.keys(node).forEach(function(k){
      const v = node[k];
      if(KEY_REF_ASSET.test(k)){
        const values = Array.isArray(v) ? v : [v];
        const kindWanted = KIND_EXPECTED_BY_FIELD[k];
        values.forEach(function(x){
          if(!isRefAsset(x)) return;
          const target = assetsById[x];
          if(!target){
            dead.push({object: name, field: k, id: x, path: path, reason: 'absent'});
          } else if(kindWanted && target.kind && target.kind !== kindWanted){
            // La reference se resout — vers le mauvais genre d'asset. C'est le cas le plus
            // dangereux : silencieux a la lecture, visible seulement a l'usage, et jamais la
            // ou on le cherche.
            dead.push({object: name, field: k, id: x, path: path, reason: 'kind',
                       kindWanted: kindWanted, kindFound: target.kind});
          }
        });
      }
      visit(v, path + '.' + k, name);
    });
  }
  (scenes || []).forEach(function(sc){ visit(sc.data, sc.name || '?', '?'); });
  return dead;
}

/**
 * Le rapport, en UN message groupé plutôt qu'un `console.warn` par occurrence — un projet qui
 * en accumule cent rendait la console illisible, donc ignorée, donc inutile. Rend le nombre de
 * références mortes trouvées, pour que l'appelant décide quoi afficher dans la barre d'état.
 */
export function reportDeadReferences(scenes, assetsById){
  const dead = deadReferencesOf(scenes, assetsById);
  if(!dead.length) return 0;
  const lignes = dead.map(function(d){
    const quoi = d.reason === 'kind'
      ? 'pointe vers un asset de genre « ' + d.kindFound + ' » au lieu de « ' + d.kindWanted + ' »'
      : 'introuvable dans le projet';
    return '  • ' + d.object + ' → ' + d.field + ' = ' + d.id + ' : ' + quoi + '   (' + d.path + ')';
  });
  console.warn('[projet] ' + dead.length + ' reference(s) d asset a reprendre.'
    + ' Les re-choisir dans l inspecteur :\n' + lignes.join('\n'));
  return dead.length;
}

export function remapReferencesAssetsInScenes(scenes, assetsById){
  scenes.forEach(function(s){
    const d = s.data;
    if(!d) return;
    (d.objects || []).forEach(function(o){
      if(o.texAsset) o.texAsset = assetsById[o.texAsset] ? assetsById[o.texAsset].id : null;
      if(o.asset)    o.asset    = assetsById[o.asset]    ? assetsById[o.asset].id    : null;
      if(o.prefabId) o.prefabId = assetsById[o.prefabId] ? assetsById[o.prefabId].id : null;
      if(o.materialId) o.materialId = assetsById[o.materialId] ? assetsById[o.materialId].id : null;
      if(o.audio && o.audio.asset){
        o.audio.asset = assetsById[o.audio.asset] ? assetsById[o.audio.asset].id : null;
      }
      // Animations empruntées : ce sont des références d'asset comme les autres, et les ids
      // sont RÉATTRIBUÉS au chargement. Oubliée ici, la provenance survivait intacte dans le
      // fichier et ne désignait plus rien — le personnage revenait sans son animation, sans
      // le moindre message. Une référence ajoutée ailleurs doit toujours passer par ici.
      if(o.animator && o.animator.assetId){
        o.animator.assetId = assetsById[o.animator.assetId]
          ? assetsById[o.animator.assetId].id : null;
      }
      // LES DEUX RÉFÉRENCES DU MONDE 2D, oubliées ici quand elles ont été ajoutées — alors que
      // l'avertissement était écrit juste au-dessus. Mesuré sur un jeu réel enregistré puis
      // rouvert : le héros affichait la planche des murs, les gemmes pointaient vers une TEXTURE
      // au lieu d'une planche, et la salle se peignait avec le sprite des gemmes. Toutes les
      // références avaient glissé du même nombre de rangs — les ids sont réattribués au
      // chargement, et rien ne les rattrapait. Le fichier était intact : c'est sa relecture qui
      // mentait, et le jeu se rouvrait méconnaissable sans le moindre message.
      if(o.sprite2d && o.sprite2d.spriteId){
        o.sprite2d.spriteId = assetsById[o.sprite2d.spriteId]
          ? assetsById[o.sprite2d.spriteId].id : null;
      }
      // La PALETTE d'une tilemap est une référence d'asset imbriquée dans un composant :
      // aucune lecture des défauts ne peut la voir, puisqu'elle y vaut `null`. Sans ce
      // remappage, un décor rouvert peint avec la palette d'un autre projet — le même défaut,
      // mesuré, que les matériaux d'avant la refonte.
      // LE SAC `scripts` À PLAT : `scriptId` n'était remappé NULLE PART, ni ici ni dans la
      // boucle des composants (docs/REVUE_2026-09-14.md § 2). Un script attaché retombait donc
      // sur l'asset qui avait hérité de son numéro, ou sur rien.
      if(Array.isArray(o.scripts)){
        o.scripts.forEach(function(e){
          if(e && e.scriptId) e.scriptId = assetsById[e.scriptId] ? assetsById[e.scriptId].id : null;
        });
      }
      (o.components || []).forEach(function(c){
        // LES RÉFÉRENCES OUBLIÉES DE LA REFONTE ECS. Le sac à plat correspondant est bien
        // remappé plus haut — mais c'est le COMPOSANT qui gagne à la relecture
        // (`applyComponents` écrase le sac). Le remappage du sac ne servait donc à rien pour
        // celles-ci : la référence glissait d'un rang à chaque réouverture, exactement comme
        // mesuré pour sprite2d avant sa correction (docs/REVUE_2026-09-14.md § 2).
        // Une référence ajoutée dans un composant doit TOUJOURS passer par ici.
        const champ = c && c.type ? REFS_ASSET_COMPONENT[c.type] : null;
        if(champ && c.data && c.data[champ]){
          const target = assetsById[c.data[champ]];
          if(!target){
            console.warn('[projet] ' + (o.name || '?') + ' : ' + c.type + ' → asset '
              + c.data[champ] + ' introuvable dans les assets du projet. La référence est vidée.');
          }
          c.data[champ] = target ? target.id : null;
        }
        // LE DOCUMENT ET SES FEUILLES DE STYLE (UIDocument) : exactement l'oubli décrit
        // au-dessus, et le dernier de la liste. `o.uiDoc` (le sac à plat) est bien remappé
        // plus bas — mais `applyComponents` écrase le sac avec `c.data` via `hydrate`, donc
        // c'est le composant qui gagne, et lui gardait les ids d'AVANT le rechargement.
        // Symptôme mesuré (jeux/Chromelo) : à la réouverture du projet, le menu ne trouvait
        // plus `menu.html` ni `menu.css` — interface vide, « le CSS est absent », sans un
        // message. Deux champs, dont un TABLEAU : c'est pour ça qu'il ne rentre pas dans
        // REFS_ASSET_COMPONENT, qui ne connaît qu'un champ scalaire par type.
        if(c && c.type === 'UIDocument' && c.data){
          if(c.data.documentUIId){
            const target = assetsById[c.data.documentUIId];
            if(!target){
              console.warn('[projet] ' + (o.name || '?') + ' : document d interface '
                + c.data.documentUIId + ' introuvable dans les assets du projet.'
                + ' L interface reste vide : la re-choisir dans l inspecteur.');
            }
            c.data.documentUIId = target ? target.id : null;
          }
          if(Array.isArray(c.data.sheetStyleIds)){
            c.data.sheetStyleIds = c.data.sheetStyleIds
              .map(function(id){
                const a = assetsById[id];
                if(!a){
                  console.warn('[projet] ' + (o.name || '?') + ' : feuille de style ' + id
                    + ' introuvable dans les assets du projet. Elle est retirée.');
                }
                return a ? a.id : null;
              })
              .filter(Boolean);
          }
        }
        if(c && c.type === 'Tilemap' && c.data && c.data.paletteId){
          c.data.paletteId = assetsById[c.data.paletteId] ? assetsById[c.data.paletteId].id : null;
        }
        // L'ASSET D'UN MODÈLE IMPORTÉ (glTF/FBX) : même nature, même oubli, même symptôme muet
        // que la palette et le profil ci-dessous. Le composant Model ne détient rien
        // (component-model.js) — toute sa provenance vit dans `data.assetId`, réattribué à
        // chaque rechargement comme n'importe quel autre id d'asset. Oublié ici,
        // `NodeShells.register('Model', ...)` (game-runtime.js) et son miroir éditeur
        // (objects.js) ne trouvaient plus jamais l'asset : le nœud retombait en substitut vide,
        // avec l'avertissement « asset absent du projet ? » — un modèle qui se charge très bien
        // au premier import disparaissait systématiquement dès la première réouverture.
        if(c && c.type === 'Model' && c.data && c.data.assetId){
          const target = assetsById[c.data.assetId];
          if(!target){
            console.warn('[projet] ' + (o.name || '?') + ' : modèle ' + c.data.assetId
              + ' introuvable dans les assets du projet. Le nœud reste un substitut vide.');
          }
          c.data.assetId = target ? target.id : null;
        }
        // Le PROFIL d'un PostVolume : même nature, même oubli, même symptôme muet que la
        // palette ci-dessus. Mesuré : à la réouverture du projet, `profileId` désignait un id
        // mort, `PostVolume.profile` rendait null, et le post-traitement disparaissait
        // entièrement — de l'éditeur comme du jeu publié — sans le moindre message.
        if(c && c.type === 'PostVolume' && c.data && c.data.profileId){
          const target = assetsById[c.data.profileId];
          // ET ON LE DIT. Une référence qui ne se résout pas est mise à null — c'est la bonne
          // décision (un id mort ne désigne rien), mais faite en silence elle donne un
          // post-traitement qui « ne marche plus » sans que rien n'ait l'air d'avoir changé.
          // C'est exactement ce qui est arrivé aux projets enregistrés avant que ce remappage
          // existe : leur profil est irrécupérable, et il faut le re-choisir dans l'inspecteur.
          if(!target){
            console.warn('[projet] ' + (o.name || '?')
              + ' : profil de post-traitement ' + c.data.profileId
              + ' introuvable dans les assets du projet. Le PostVolume repart sans profil :'
              + ' le re-choisir dans l inspecteur.');
          }
          c.data.profileId = target ? target.id : null;
        }
        // externalClips (SkinnedMeshRenderer) : même nature que Model.assetId ci-dessus, mais
        // porté par le nœud descendant skinné, pas par la racine — voir skinnedMeshRendererOf
        // (js/anim-models.js). Un id d'asset non remappé pointerait vers un fichier disparu au
        // rechargement suivant.
        if(c && c.type === 'SkinnedMeshRenderer' && c.data && Array.isArray(c.data.externalClips)){
          c.data.externalClips = c.data.externalClips
            .map(function(ref){
              const a = assetsById[ref.assetId];
              if(!a){
                console.warn('[projet] ' + (o.name || '?') + ' : clip externe ' + ref.assetId
                  + ' introuvable dans les assets du projet. Ce clip est retiré.');
                return null;
              }
              return {assetId:a.id, sourceClip:ref.sourceClip, localName:ref.localName};
            })
            .filter(Boolean);
        }
      });
      if(o.uiDoc){
        if(o.uiDoc.documentUIId){
          o.uiDoc.documentUIId = assetsById[o.uiDoc.documentUIId] ? assetsById[o.uiDoc.documentUIId].id : null;
        }
        if(Array.isArray(o.uiDoc.sheetStyleIds)){
          o.uiDoc.sheetStyleIds = o.uiDoc.sheetStyleIds
            .map(function(id){ return assetsById[id] ? assetsById[id].id : null; })
            .filter(Boolean);
        }
      }
    });
    if(d.env && d.env.skyAsset){
      d.env.skyAsset = assetsById[d.env.skyAsset] ? assetsById[d.env.skyAsset].id : null;
    }
  });
}

export async function loadDataProject(data){
  data = migrateProjectData(data);
  // Surtout PAS d'égalité sur le numéro de version ici : migrateProjectData
  // vient de remonter le fichier à la version courante, donc « === 6 » devenait
  // faux dès qu'on ajoutait un palier — et le projet était rejeté comme « ni un
  // project ni une scène », sans erreur, juste un message trompeur. C'est ce qui
  // s'est produit en passant à la v7. On teste la FORME, pas le numéro.
  const isProject = data && data.version !== undefined && Array.isArray(data.scenes);
  const isScene = data && Array.isArray(data.objects);
  if(!isProject && !isScene){ setStatus('Ce fichier n\'est ni un projet ni une scène de cet éditeur', 4000); return; }

  setStatus('Chargement…');
  // ON CHANGE DE PROJET, DONC ON RECHANGE DE QUESTION (js/script-trust.js). Sans cette ligne, un
  // « Ne pas exécuter » répondu pour un projet resterait en mémoire pour le suivant : ses
  // scripts ne tourneraient jamais, sans un mot et sans rien pour le rattacher à la réponse
  // donnée dix minutes plus tôt sur un autre fichier. Une acceptation, elle, n'a pas besoin
  // d'être oubliée — elle est persistée par EMPREINTE DE CODE, donc elle ne déborde pas d'un
  // projet à l'autre.
  if(typeof resetTrustSession === 'function') resetTrustSession();
  histo.undo.length = 0;
  histo.redo.length = 0;
  newScene(true);

  const assetsById = await rebuildAssetsFromDescriptors(data.assets || [],
    function(ref){ return b64InFile(ref); });

  // project v2 : liste de scènes ; scène v1 : encapsulée dans un projet à une scène.
  //
  // Les huit lectures de réglages qui étaient ici sont devenues UNE : `projectSettingsOf` pose
  // les défauts pour les champs absents, et une scène nue (`isProject` faux) n'apporte aucun
  // réglage — donc elle repart des défauts, comme avant.
  applyProjectSettings(isProject ? data : null);
  project.folders = (isProject && data.folders) || [];
  setFolderCurrent('');
  project.scenes = isProject
    ? data.scenes.map(function(s){ return {name:s.name || 'Scène', data:s.data || null}; })
    : [{name:'Scène 1', data:{objects:data.objects, tracks:data.tracks || [],
        duration:data.duration || 5, loop:data.loop !== false}}];
  if(!project.scenes.length) project.scenes = [{name:'Scène 1', data:null}];

  // Les ids d'asset sont désormais STABLES (voir reserveAssetId/adoptAssetId, js/assets.js) :
  // ce remappage est l'identité pour tout projet enregistré à partir de la v0.139.0, et reste
  // le chemin de rattrapage des projets d'avant, dont les ids avaient été renumérotés. Le
  // rapport passe AVANT : c'est le remappage qui met les références mortes à null.
  const nbDead = reportDeadReferences(project.scenes, assetsById);
  remapReferencesAssetsInScenes(project.scenes, assetsById);
  if(nbDead){
    setStatus(nbDead + " référence(s) d'asset perdue(s) dans ce projet — voir la console.", 8000);
  }
  project.current = Math.min(isProject ? (data.current || 0) : 0, project.scenes.length - 1);
  updateScenes();

  // `data` nomme deja le manifeste du projet dans cette fonction : la scene courante prend
  // son propre name (collision introduite par le renommage donnees -> data).
  const dataScene = project.scenes[project.current].data;
  if(dataScene) restoreState(dataScene);
  else { select(null); updateHierarchy(); updateTimeline(); }
  // Après restoreState, et pas avant : la migration a besoin des objets porteurs pour savoir
  // de quel modèle vient le clip que chaque état nomme.
  migrateMachinesOfScene();

  // LE GENRE DÉCIDE DE L'ONGLET. Il est RECALCULÉ depuis les scènes chargées plutôt que lu dans le
  // manifeste : un projet enregistré avant ce champ n'en a pas, et un fichier trafiqué à la main
  // pourrait le contredire. Le contenu est la source, le champ du manifeste n'est qu'un hidden.
  //
  // Sans ça, ouvrir un jeu 2D montrait une vue 3D empty — le monde 2D est hors du champ d'une caméra
  // en perspective placée pour une scène 3D — et il fallait savoir qu'il existait un onglet « 2D »
  // pour retrouver son travail. Le pire accueil possible pour un projet qu'on vient d'ouvrir.
  const kind = (typeof kindProject === 'function') ? kindProject(project.scenes) : '3d';
  project.kind = kind;

  // Un projet qu'on vient d'ouvrir est, par définition, identique à son disque : l'indicateur
  // repart de « à jour », même si la session précédente l'avait laissé sur « non enregistré ».
  markProjectSaved();

  setStatus('Projet chargé : ' + project.scenes.length + ' scène(s), '
    + assets.length + ' asset(s)'
    + (kind === '3d' ? '' : ' — projet ' + (kind === '2d' ? '2D' : 'mixte 2D/3D')), 3500);
}

export const inputScene = document.getElementById('file-scene');
inputScene.addEventListener('change', function(){
  if(inputScene.files.length) loadScene(inputScene.files[0]);
  inputScene.value = '';
});


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.assetOfReference = assetOfReference;