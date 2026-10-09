// Plugin d'exemple : un MATÉRIAU écrit en nœuds TSL.
//
// À installer depuis Fichier → Plugins → « ＋ Installer un .js… ». Il ajoute une entrée
// « 🎨 Matériau « Hologramme » » au menu Extensions, qui crée un asset matériau piloté par
// ce shader.
//
// CE QUE CE FICHIER DÉMONTRE, et qui est le vrai sujet : l'auteur du shader n'écrit AUCUNE
// interface. Il décrit ses uniformes dans `proprietes`, au format de js/material-props.js,
// et il obtient gratuitement l'inspecteur (avec plages, infobulles et dépendances entre
// champs), le bornage des saisies, et la description envoyée au copilot IA. La même table
// sert l'humain qui clique et le modèle qui écrit.
//
// Le moteur rend en WebGPURenderer : un matériau s'écrit en NŒUDS, pas en GLSL. Aucune
// chaîne de shader n'apparaît ici.

Editor.registerMaterial({
  name: 'Hologramme',
  category: 'Sci-fi',

  // ---------- la table déclarative : format EXACT de js/material-props.js ----------
  properties: [
    {section: 'Hologramme'},
    {key: 'tint', type:'color', label: 'Teinte', default: '#3fd8ff',
     help: 'Couleur de l\'émission. Un hologramme ne réfléchit pas la lumière : il l\'émet, '
        + 'donc c\'est cette tint qu\'on voit, pas l\'albédo.'},
    {key: 'intensity', type:'number', label: 'Intensité', min: 0, max: 8, step: 0.1, default: 2,
     help: 'Multiplie l\'émission. Au-delà de 1, la glow déborde sur le bloom du '
        + 'post-traitement si celui-ci est active.'},

    {section: 'Balayage'},
    {key: 'density', type:'number', label: 'Densité de lignes', min: 1, max: 400, step: 1, default: 80,
     help: 'Nombre de bands par mètre, mesuré en space LOCAL : mettre l\'objet à l\'échelle '
        + 'ne change pas leur finesse à l\'écran, seule cette valeur le fait.'},
    {key: 'speed', type:'number', label: 'Vitesse', min: -20, max: 20, step: 0.5, default: 6,
     help: 'Défilement des bands, en unités par seconde. Une valeur négative les fait '
        + 'descendre. À 0 elles sont figées.'},
    {key: 'floor', type:'number', label: 'Plancher', min: 0, max: 1, step: 0.05, default: 0.25,
     help: 'Luminosité des bands SOMBRES. À 0 elles sont noires et l\'objet clignote ; à 1 '
        + 'le balayage disparaît complètement.'},

    {section: 'Bord'},
    {key: 'fresnel', type:'number', label: 'Netteté du bord', min: 0.1, max: 8, step: 0.1, default: 2.5,
     help: 'Exposant de Fresnel : plus il est grand, plus la surbrillance se concentre sur la '
        + 'silhouette. C\'est ce qui fait lire le volume malgré la transparence.'},
    {key: 'baseOpacity', type:'number', label: 'Opacité', min: 0, max: 1, step: 0.05, default: 0.6,
     help: 'Opacité AVANT le balayage et le edge, qui la modulent tous les deux — un '
        + 'hologramme est plus dense là où il brille.'},

    {section: 'Masque'},
    {key: 'maskAsset', type: 'texture', label: 'Masque (canal V)'},
    {key: 'maskInverted', type:'checkbox', label: 'Inverser le mask',
     requires: ['maskAsset'], ifMissing: 'greyed',
     help: 'Sans effet tant qu\'aucun mask n\'est branché — le field reste visible pour '
        + 'qu\'on sache qu\'il existe.'}
  ],

  // ---------- le shader ----------
  // p   : les propriétés ci-dessus, déjà bornées par l'inspecteur.
  // ctx : {THREE, TSL, texture(key), props}. `ctx.texture` résout un emplacement déclaré
  //       `type:'texture'` en THREE.Texture avec le tuilage et les paramètres d'import du
  //       moteur — inutile de les réimplémenter.
  make: function(p, ctx){
    const T = ctx.TSL;
    // Le pont ESM peut ne pas avoir fini de charger (page d'aperçu, error de module).
    // Renoncer ici est propre : le moteur retombe sur le matériau natif et le dit dans la
    // Console. Déréférencer T sans ce test donnerait un objet invisible sans un mot.
    if(!T) throw new Error('TSL indisponible — le rendu par nœuds n\'est pas prêt');

    const m = new ctx.THREE.MeshStandardNodeMaterial();
    m.transparent = true;
    // Les faces arrière doivent rester visibles : c'est la superposition des deux couches
    // qui donne l'épaisseur, et sans depthWrite elles ne se masquent pas l'une l'autre.
    m.side = ctx.THREE.DoubleSide;
    m.depthWrite = false;

    // Bandes de balayage. `positionLocal` et non `positionWorld` : les lignes doivent être
    // solidaires de l'objet, sinon elles glissent dessus dès qu'il bouge.
    const scan = T.positionLocal.y.mul(p.density).sub(T.time.mul(p.speed))
      .sin().mul(0.5).add(0.5);                       // → 0..1
    const glow = scan.mul(1 - p.floor).add(p.floor);   // → floor..1

    // Fresnel. `positionViewDirection` est déjà la direction normalisée surface → caméra ;
    // `transformedNormalView` est la normale APRÈS map de normales, dans le même space.
    const nDotV = T.dot(T.normalize(T.transformedNormalView), T.positionViewDirection).clamp(0, 1);
    const edge = nDotV.oneMinus().pow(p.fresnel);

    let factor = glow.add(edge);

    // L'emplacement de texture, s'il est rempli. Le canal vert par convention : c'est celui
    // que porte la rugosité dans nos masques, donc celui qu'un artiste peint déjà en
    // niveaux de gris utiles.
    const mask = ctx.texture('maskAsset');
    if(mask){
      const g = T.texture(mask).g;
      factor = factor.mul(p.maskInverted ? g.oneMinus() : g);
    }

    const tint = T.color(p.tint);
    m.emissiveNode = tint.mul(p.intensity).mul(factor);
    // L'albédo reste sombre : ce qu'on voit vient de l'émission, pas d'un éclairage.
    m.colorNode = tint.mul(0.08);
    m.opacityNode = factor.mul(p.baseOpacity).clamp(0, 1);
    return m;
  }
});
