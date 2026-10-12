// ---------- La vue Jeu : ce qui se décide sans renderer ni DOM ----------
//
// PUR, sans aucun import. js/game-view.js (le branchement sur le renderer et le panneau) lui
// demande quelle caméra filmer, à quelle taille, et s'il faut rendre du tout cette image-ci.
// Testé par test/vue-jeu.test.mjs.

/**
 * Les rapports d'image proposés, comme le menu « Free Aspect / 16:9… » du Game view d'Unity.
 * `ratio` : largeur / hauteur ; `null` = Libre (l'image prend toute la place du panneau, ce que
 * fait le jeu publié dans une fenêtre qu'on redimensionne).
 */
export const GAME_VIEW_ASPECTS = [
  {id: 'free',  label: 'Libre',            ratio: null},
  {id: '16:9',  label: '16:9',             ratio: 16 / 9},
  {id: '16:10', label: '16:10',            ratio: 16 / 10},
  {id: '4:3',   label: '4:3',              ratio: 4 / 3},
  {id: '21:9',  label: '21:9',             ratio: 21 / 9},
  {id: '1:1',   label: '1:1',              ratio: 1},
  {id: '9:16',  label: '9:16 (téléphone)', ratio: 9 / 16}
];

/** Le rapport d'un id, ou `null` (Libre, ou id inconnu : une préférence d'une autre version). */
export function aspectRatioOf(id){
  const a = GAME_VIEW_ASPECTS.find(function(x){ return x.id === id; });
  return a ? a.ratio : null;
}

/**
 * Le plus grand rectangle de ce rapport qui tienne dans `width × height`, centré : les bandes
 * noires d'Unity. En pixels CSS ENTIERS, jamais nuls — une cible de rendu 0×0 fait partir
 * WebGPU en erreurs de validation à chaque image (voir `resize`, js/viewport.js).
 * Rend `null` quand la place elle-même est nulle (panneau caché, onglet inactif).
 */
export function fitGameViewRect(width, height, ratio){
  const W = Math.floor(Number(width) || 0), H = Math.floor(Number(height) || 0);
  if(W <= 0 || H <= 0) return null;
  if(!ratio || !isFinite(ratio) || ratio <= 0) return {x: 0, y: 0, width: W, height: H};
  let w = W, h = Math.round(W / ratio);
  if(h > H){ h = H; w = Math.round(H * ratio); }
  w = Math.max(1, Math.min(W, w));
  h = Math.max(1, Math.min(H, h));
  return {x: Math.floor((W - w) / 2), y: Math.floor((H - h) / 2), width: w, height: h};
}

/**
 * LA caméra que filmerait le jeu : la caméra marquée principale, sinon la première — la règle
 * exacte de `rtCameraMain` (js/game-runtime.js). `nodes` : les porteurs d'un composant Camera
 * actif ; `isMain` : le seul juge, `isCameraMain` (js/camera-framing.js).
 */
export function pickMainCameraNode(nodes, isMain){
  const list = (nodes || []).filter(Boolean);
  const judge = (typeof isMain === 'function') ? isMain : function(){ return false; };
  return list.find(function(n){ return judge(n); }) || list[0] || null;
}

/**
 * Faut-il rendre la vue Jeu à cette image ? Seulement quand on la REGARDE : panneau dans la page,
 * de taille non nulle, une caméra à filmer, un renderer qui sait viser un second canevas, et pas
 * de cuisson de lightmap en cours (elle remplace les matériaux : l'image serait fausse, et elle
 * prendrait sa cible de rendu à la cuisson). Rend la RAISON du refus, pour l'afficher.
 */
export function gameViewRenderState(s){
  const o = s || {};
  if(!o.connected || !(o.width > 0) || !(o.height > 0)) return {render: false, reason: 'hidden'};
  if(!o.ready) return {render: false, reason: 'starting'};
  if(!o.canvasTarget) return {render: false, reason: 'no-webgpu'};
  if(o.baking) return {render: false, reason: 'baking'};
  if(!o.hasCamera) return {render: false, reason: 'no-camera'};
  return {render: true, reason: null};
}

/** Ce que le panneau dit quand il ne rend pas (le texte est de l'interface, donc en français). */
export const GAME_VIEW_MESSAGES = {
  'starting': 'Initialisation du rendu…',
  'no-webgpu': 'La vue Jeu demande WebGPU : ce navigateur fait tourner l\'éditeur en WebGL2, qui ne '
    + 'sait pas dessiner dans un second canevas. Utilisez « Voir à travers cette caméra » (inspecteur de la '
    + 'caméra principale), ou ▶ Jouer.',
  'baking': 'Cuisson des lightmaps en cours : la vue Jeu reprendra à la fin.',
  'no-camera': 'Aucune caméra active dans la scène : le jeu n\'aurait rien à filmer. Ajoutez une '
    + 'caméra (menu Objet) et cochez « Caméra principale ».'
};
