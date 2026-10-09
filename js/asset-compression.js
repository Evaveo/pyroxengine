// ---------- Décodeurs de compression d'assets (Draco, meshopt, KTX2/Basis) ----------
//
// Ce fichier est chargé par l'ÉDITEUR **et** recopié dans le jeu publié par js/build.js,
// exactement comme jeu-ui.js ou jeu-character.js. C'est délibéré : « le jeu publié lit ce que
// l'éditeur importe » devient vrai par construction, au lieu de dépendre de deux
// branchements écrits séparément qui divergent au premier oubli.
//
// Les décodeurs eux-mêmes vivent dans trois bundles vendorisés séparés
// (vendor/three-draco.min.js, three-meshopt.min.js, three-ktx2.min.js) parce qu'ils sont
// LOURDS et rarement tous nécessaires : build.js n'embarque que ceux que le projet
// utilise réellement. Chacun est donc OPTIONNEL ici — l'absence d'une balise <script> ne
// doit jamais casser un import ordinaire, seulement refuser le format concerné, en le
// nommant.

// Extensions glTF couvertes, et le bundle qui les débloque. La clé est le nom exact tel
// qu'il apparaît dans `extensionsUsed` d'un glTF : c'est ce qu'on lit dans les octets du
// fichier pour décider quoi embarquer et quoi reprocher.
export const DECODERS_COMPRESSION = {
  KHR_draco_mesh_compression: {
    bundle: 'vendor/three-draco.min.js', caption: 'Draco (géométrie)',
    present: function(){ return typeof THREE.createDRACOLoader === 'function'; }
  },
  EXT_meshopt_compression: {
    bundle: 'vendor/three-meshopt.min.js', caption: 'meshopt (géométrie)',
    present: function(){ return !!THREE.MeshoptDecoder; }
  },
  KHR_texture_basisu: {
    bundle: 'vendor/three-ktx2.min.js', caption: 'KTX2/Basis (textures)',
    present: function(){ return typeof THREE.createKTX2Loader === 'function'; }
  }
};

// Blobs des fichiers d'un import, partagés avec les décodeurs.
//
// POURQUOI un registre global plutôt que le LoadingManager de l'import : le KTX2Loader
// est UNIQUE et réutilisé (three avertit explicitement contre plusieurs instances
// active, et chacune reconstruit un worker + 527 Ko de wasm). Il ne peut donc pas
// porter le manager d'un import particulier. Sans ça, un .gltf accompagné de textures
// .ktx2 séparées marche en .glb et échoue en .gltf — la panne qui n'apparaît que chez
// l'utilisateur qui n'exporte pas comme nous.
export const blobsShared = {};

// COLLISION DE NOMS, et pourquoi on ne peut que la signaler. Le registre est indexé par
// nom de fichier NU : deux modèles qui embarquent chacun leur `texture.ktx2` écrasent la
// même entrée, et le second sert sa texture au premier. On ne peut pas préfixer par
// l'identifiant de l'asset — le modificateur d'URL ne reçoit QUE le nom du fichier
// demandé par le .gltf, il ne sait pas pour quel asset il travaille. C'est la contrepartie
// du KTX2Loader unique, imposée par three lui-même.
//
// Ce qui reste possible, et suffit : refuser de traverser l'ambiguïté sans un mot. Une
// texture qui en remplace une autre est invisible à l'œil — on croit avoir mal exporté.
export function shareBlobs(blobs){
  Object.keys(blobs || {}).forEach(function(n){
    if(blobsShared[n] && blobsShared[n] !== blobs[n]){
      const msg = 'Deux fichiers importés s\'appellent « ' + n + '  » : le plus récent '
        + 'remplacera l\'autre pour les décodeurs. Renommez-en un.';
      if(typeof setStatus === 'function') setStatus(msg, 7000);
      console.warn('[compression] ' + msg);
    }
    blobsShared[n] = blobs[n];
  });
}

export let _ktx2Shared = null;
export let _ktx2Reports = false;

export function ktx2Shared(render){
  if(_ktx2Shared) return _ktx2Shared;
  if(!DECODERS_COMPRESSION.KHR_texture_basisu.present() || !render) return null;
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(function(url){
    const name = decodeURIComponent(String(url).replace(/^.*[\\/]/, '').split('?')[0]);
    return blobsShared[name] || url;
  });
  // detectSupport() interroge le GPU pour choisir la cible de transcodage (DXT, ASTC,
  // ETC2… ou RGBA non compressé si le GPU ne sait rien lire).
  //
  // ET IL PEUT LEVER. WebGPURenderer.hasFeature() refuse d'être appelé avant que
  // renderer.init() (asynchrone) ait résolu — message vérifié : « .hasFeature() called
  // before the backend is initialized ». Or loadAssets() du runtime démarre sans
  // attendre init(). Sans ce try, une exception ici remonterait dans bindDecoders()
  // et ferait échouer le chargement de TOUS les modèles, compressés ou non, dans un jeu
  // dont aucun asset n'utilise KTX2 : la panne totale pour une fonctionnalité inutilisée.
  //
  // On ne mémorise PAS l'échec : le prochain asset réessaiera, et le renderer aura eu le
  // temps de s'initialiser.
  try {
    _ktx2Shared = THREE.createKTX2Loader(render, manager);
  } catch(e){
    if(!_ktx2Reports){
      _ktx2Reports = true;
      console.warn('[compression] KTX2 non branché pour l\'instant (' + e.message + ')');
    }
    return null;
  }
  return _ktx2Shared;
}

// Branche sur un GLTFLoader tous les décodeurs disponibles. `render` est le renderer
// (nécessaire au seul KTX2). Renvoie la liste des extensions désormais couvertes —
// les tests s'en servent pour vérifier le branchement sans passer par un fichier.
export function bindDecoders(gltfLoader, render, blobs){
  if(blobs) shareBlobs(blobs);
  const branches = [];
  if(DECODERS_COMPRESSION.KHR_draco_mesh_compression.present()){
    gltfLoader.setDRACOLoader(THREE.createDRACOLoader());
    branches.push('KHR_draco_mesh_compression');
  }
  if(DECODERS_COMPRESSION.EXT_meshopt_compression.present()){
    gltfLoader.setMeshoptDecoder(THREE.MeshoptDecoder);
    branches.push('EXT_meshopt_compression');
  }
  const k = ktx2Shared(render);
  if(k){
    gltfLoader.setKTX2Loader(k);
    branches.push('KHR_texture_basisu');
  }
  return branches;
}

// ---------- Lecture des extensions exigées par un fichier ----------
// Sert deux fois : à nommer précisément ce qui manque quand un import échoue, et à
// décider ce que le ZIP exporté doit embarquer. Lire les octets est la seule source
// fiable — le nom du fichier ne dit rien de sa compression.

export function extensionsOfGlb(bytes){
  const view = new DataView(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength);
  if(view.byteLength < 20 || view.getUint32(0, true) !== 0x46546C67) return [];   // 'glTF'
  const lengthJson = view.getUint32(12, true);
  if(view.getUint32(16, true) !== 0x4E4F534A) return [];                          // 'JSON'
  const start = (bytes.byteOffset || 0) + 20;
  const raw = new Uint8Array(bytes.buffer || bytes, start, Math.min(lengthJson, view.byteLength - 20));
  return extensionsOfTextGltf(new TextDecoder().decode(raw));
}

export function extensionsOfTextGltf(text){
  try {
    const j = JSON.parse(text);
    // `extensionsUsed` suffit : une extension de compression réellement employée y est
    // toujours déclarée (la spec l'impose), et `extensionsRequired` en est un sous-ensemble.
    return (j.extensionsUsed || []).filter(function(e){ return !!DECODERS_COMPRESSION[e]; });
  } catch(e){ return []; }
}

// Extensions de compression exigées par un fichier de modèle (ArrayBuffer ou texte).
export function compressionsOfModel(name, content){
  if(/\.glb$/i.test(name)){
    const u8 = (content instanceof Uint8Array) ? content : new Uint8Array(content);
    return extensionsOfGlb(u8);
  }
  if(/\.gltf$/i.test(name)) return extensionsOfTextGltf(String(content));
  return [];
}

// Parmi ces extensions, celles dont le décodeur n'est PAS chargé. Le message qui en
// découle nomme le fichier missing : « non pris en charge » sans dire quoi faire est
// ce que l'ancien code disait déjà, et ça n'a jamais aidé personne.
export function decodersMissing(extensions){
  return (extensions || []).filter(function(e){
    const d = DECODERS_COMPRESSION[e];
    return d && !d.present();
  }).map(function(e){ return DECODERS_COMPRESSION[e]; });
}

export function messageDecodersMissing(missing){
  if(!missing.length) return '';
  return 'ce glTF utilise ' + missing.map(function(d){ return d.caption; }).join(' et ')
    + ' — décodeur absent : la page doit charger '
    + missing.map(function(d){ return d.bundle; }).join(' et ');
}
