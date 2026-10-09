import { deEsm } from './engine-env.mjs';
// Les préréglages de caméra reposent sur UNE hypothèse, et elle est contre-intuitive : la
// direction de vue d'un objet caméra de ce moteur est **+Z**, pas −Z.
//
// La `PerspectiveCamera` que l'object porte est tournée d'un demi-tour autour de Y, si bien que
// son −Z tombe sur le +Z de l'object. Prendre −Z — le réflexe — place le centre d'orbite
// derrière la caméra : elle tourne autour d'un point qu'elle ne regarde pas. Mesuré avant
// correction : radius variant de 10 à 30 m au lieu de rester à 10.
//
// Ce fichier tient les deux bouts : que les préréglages emploient la bonne convention, et que
// le MOTEUR la respecte toujours. Le jour où quelqu'un retire ce demi-tour, les préréglages
// deviendraient faux en silence — et c'est le second test qui le dira, pas le premier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(racineMoteur, f), 'utf8');
const codeSeul = (src) => src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

test('les prereglages emploient +Z comme direction de vue', () => {
  const src = codeSeul(read('js/animation.js'));
  assert.match(src, /function beforeCamera\(cam\)\{\s*return new THREE\.Vector3\(0, 0, 1\)/,
    'la direction de vue doit être +Z : avec −Z, l’orbite tourne autour d’un point situé '
    + 'derrière la caméra');
  // Une seule source pour cette direction. La re-dériver ailleurs, c'est se donner une
  // deuxième chance de se tromper de signe — et la première fois avait déjà suffi.
  const derivations = (src.match(/new THREE\.Vector3\(0, 0, -?1\)\.applyQuaternion/g) || []).length;
  assert.equal(derivations, 1,
    'la direction de vue est dérivée ' + derivations + ' fois : elle ne doit l’être qu’une, '
    + 'dans beforeCamera()');
  assert.match(src, /targetWatched\(cam, o\.distance\)/, 'l’orbite doit viser le point regardé');
  assert.match(src, /addScaledVector\(beforeCamera\(cam\), o\.distance\)/,
    'le travelling doit advance dans la direction de vue, pas dans son opposé');
});

test('le moteur tourne toujours sa camera d un demi-tour — sinon la convention s inverse', () => {
  // C'est CE fait qui rend +Z correct. Il est posé aux deux endroits qui fabriquent une
  // caméra ; en unregister un suffirait à rendre les préréglages faux pour les caméras créées
  // par ce chemin-là, et seulement celles-là.
  ['js/objects.js', 'js/components/component-camera.js'].forEach((f) => {
    assert.match(codeSeul(read(f)), /cam\.rotation\.y = Math\.PI/,
      f + ' ne tourne plus la caméra d’un demi-tour : la direction de vue d’un objet caméra '
      + 'redevient −Z, et tous les préréglages d’animation visent à l’envers');
  });
});

test('un prerelage REMPLACE la piste de la camera, il ne s empile pas', () => {
  // Deux préréglages accumulés donneraient des clés entrelacées et un mouvement que personne
  // n'a demandé — sans erreur, juste une caméra qui part n'importe où.
  const src = codeSeul(read('js/animation.js'));
  const start = src.indexOf('function setKeysCamera(');
  assert.ok(start > 0, 'setKeysCamera a disparu');
  const body = src.slice(start, src.indexOf('\n}', start));
  assert.match(body, /anim\.tracks\.splice\(anim\.tracks\.indexOf\(ancienne\), 1\)/,
    'la piste existante doit être retirée avant d’en écrire une neuve');
  // Et les clés produites doivent être des clés ORDINAIRES, retouchables comme les autres.
  assert.match(body, /p\.keys\.push\(\{t:e\.t, pos:.*quat:.*ech:/,
    'un préréglage doit écrire des clés normales, pas une trajectoire à part');
});

test('l orbite echantillonne assez finement pour que l arc ne devienne pas un polygone', () => {
  const src = codeSeul(read('js/animation.js'));
  const m = src.match(/const STEP_ANGLE_PRESET = (\d+)/);
  assert.ok(m, 'le pas d’échantillonnage a disparu');
  const step = parseInt(m[1], 10);
  // Au-delà de ~20°, la corde entre deux clés s'émap visiblement du cercle : l'orbite se met
  // à « couper les virages ». En deçà de 5°, on paie des clés pour rien.
  assert.ok(step >= 5 && step <= 20,
    'un pas de ' + step + '° donne soit un arc qui se voit en polygone, soit des clés inutiles');
});

// ---------- exécution réelle de la timeline ----------
//
// `animation.js` va chercher ses éléments d'interface dès son chargement : sans DOM, il ne
// s'évalue pas. Un DOM d'à peine vingt lines suffit pourtant à exercer ce qui compte —
// la pose de clés et l'interpolation — et c'est indispensable ici, parce que deux régressions
// (clé posée sur le modèle au lieu de l'os, interpolation écrite dans le bad object)
// passaient au travers de toutes les vérifications faites sur le source.
function contexteTimeline(){
  const elements = new Map();
  const faireEl = () => ({
    innerHTML:'', textContent:'', value:'', disabled:false, dataset:{}, style:{},
    classList:{add(){}, remove(){}, toggle(){}, contains(){ return false; }},
    addEventListener(){}, getBoundingClientRect(){ return {left:0, width:100}; },
    querySelector(){ return null; }, closest(){ return null; }
  });
  const bac = {console, Math, JSON, Set, Map, Array, Object, parseFloat, parseInt, isFinite};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  bac.document = {getElementById(id){
    if(!elements.has(id)) elements.set(id, faireEl());
    return elements.get(id);
  }};
  bac.setStatus = () => {};
  bac.pushHistory = () => {};
  bac.escapeHtml = (s) => String(s);
  bac.iconOf = () => '';
  bac.syncInspector = () => {};
  bac.animationInProgress = () => null;
  bac.selection = null;
  bac.boneSelected = null;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('vendor/three.min.js')), ctx, {filename:'vendor/three.min.js'});
  vm.runInContext(deEsm(read('js/track-sampling.js')), ctx, {filename:'js/track-sampling.js'});
  vm.runInContext(deEsm(read('js/animation.js')), ctx, {filename:'js/animation.js'});
  // `anim` est un `const` : une liaison LEXICALE, pas une propriete du bac a sable — seules
  // les declarations `function` y apparaissent. On le lit en evaluant son nom dans le
  // contexte, ce qui traverse bien la portee lexicale partagee par les deux scripts.
  ctx.anim = vm.runInContext('anim', ctx);
  return ctx;
}

test('une cle posee sur un OS anime l os, pas le modele', () => {
  const ctx = contexteTimeline();
  const T = ctx.THREE;
  const model = new T.Group(); model.name = 'Perso';
  const os = new T.Bone(); os.name = 'Spine'; model.add(os);

  ctx.selection = model;
  ctx.boneSelected = os;
  ctx.anim.duration = 2;

  ctx.anim.t = 0; os.rotation.z = 0; ctx.setKey();
  ctx.anim.t = 2; os.rotation.z = 1; ctx.setKey();

  assert.equal(ctx.anim.tracks.length, 1, 'une seule track attendue');
  assert.equal(ctx.anim.tracks[0].os, os,
    'la piste aims le modèle au lieu de l’os : les clés animeront le personnage entier');
  assert.equal(ctx.anim.tracks[0].obj, model, 'la piste doit garder le modèle comme porteur');

  // L'INTERPOLATION doit écrire dans l'os. C'est le point qu'aucune lecture du source
  // n'attrapait : la piste peut viser l'os et l'écriture partir dans l'object.
  const rotModeleAvant = model.rotation.z;
  ctx.applyAnimation(1);
  assert.equal(+os.rotation.z.toFixed(3), 0.5,
    'l’os n’a pas été interpolé : l’écriture part ailleurs que dans la cible de la piste');
  assert.equal(model.rotation.z, rotModeleAvant,
    'le modèle a bougé alors que seule une piste d’os existe');
});

test('une piste d objet et une piste d os coexistent sans se marcher dessus', () => {
  const ctx = contexteTimeline();
  const T = ctx.THREE;
  const model = new T.Group(); model.name = 'Perso';
  const os = new T.Bone(); os.name = 'Spine'; model.add(os);
  ctx.selection = model;
  ctx.anim.duration = 2;

  ctx.boneSelected = os;   ctx.anim.t = 0; ctx.setKey();
  ctx.boneSelected = null; ctx.anim.t = 0; ctx.setKey();
  assert.equal(ctx.anim.tracks.length, 2,
    'les deux clés ont atterri dans la même piste : `trackOf` ne discrimine pas sur l’os');
  assert.equal(ctx.anim.tracks.filter((p) => p.os).length, 1);
  assert.equal(ctx.anim.tracks.filter((p) => !p.os).length, 1);
});

test('poser une cle d os pendant qu un clip joue est REFUSE', () => {
  // Le mixeur et la timeline écrivent dans les mêmes transformées : les deux à la fois donnent
  // une pose qui tremble, sans erreur — celui qui écrit en dernier gagne, et ça change d'une
  // image à l'autre.
  const ctx = contexteTimeline();
  const T = ctx.THREE;
  const model = new T.Group(); model.name = 'Perso';
  const os = new T.Bone(); os.name = 'Spine'; model.add(os);
  ctx.selection = model;
  ctx.boneSelected = os;
  ctx.animationInProgress = () => 'Marche';      // un clip tourne
  ctx.setKey();
  assert.equal(ctx.anim.tracks.length, 0,
    'une clé a été posée malgré le clip en playback : les deux se disputeront la pose');
});

// ---------- clip importé affiché dans la timeline ----------

test('les cles d un clip importe sont groupees PAR OS', () => {
  // Un clip three porte une piste par (os, propriété) : `Hips.position` et `Hips.quaternion`
  // sont deux pistes pour un seul os. Les afficher telles quelles doublerait les lignes et
  // ferait croire à deux fois plus d'os animés qu'il n'y en a. Mesuré sur un export réel :
  // 53 tracks three pour 52 os.
  const ctx = contexteTimeline();
  const T = ctx.THREE;
  const clip = new T.AnimationClip('marche', 1, [
    new T.VectorKeyframeTrack('Hips.position', [0, 0.5, 1], [0,0,0, 0,1,0, 0,0,0]),
    new T.QuaternionKeyframeTrack('Hips.quaternion', [0, 1], [0,0,0,1, 0,0,0,1]),
    new T.QuaternionKeyframeTrack('Spine.quaternion', [0, 0.25, 0.75], [0,0,0,1, 0,0,0,1, 0,0,0,1])
  ]);
  const ranks = ctx.boneAnimatedOfClip(clip);
  assert.equal(ranks.length, 2, 'deux os animés attendus, ' + ranks.length + ' obtenus : les '
    + 'tracks position et quaternion d’un même os ont produit deux lignes');
  const hips = ranks.find((r) => r.name === 'Hips');
  // Les instants des deux pistes de Hips sont FUSIONNÉS et dédoublonnés : 0, 0.5 et 1.
  assert.deepEqual(Array.from(hips.instants), [0, 0.5, 1],
    'les instants des pistes d’un même os doivent être fusionnés sans doublon');
});

test('le clip affiche est en LECTURE SEULE et suit la tete de lecture', () => {
  // Deux décisions liées. Ces clés appartiennent à l'ASSET, donc à tous les personnages qui
  // s'en servent : les rendre modifiables sur place ferait éditer le fichier source depuis la
  // track d'une instance. Mais les afficher sans pouvoir s'y déplacer en ferait une
  // décoration — or c'est le déplacement qui permet de choisir où poser sa propre clé.
  const src = codeSeul(read('js/animation.js'));
  // L'APPEL, pas la définition. Un `/updateClipShown\(t\)/` sur tout le fichier matche aussi
  // `function updateClipShown(t){` : unregister l'appel laissait la garde verte. On regarde donc
  // le body d'applyAnimation, seul endroit où cet appel a un sens.
  const iApp = src.indexOf('function applyAnimation(');
  const corpsApp = src.slice(iApp, src.indexOf('\n}', iApp));
  assert.match(corpsApp, /updateClipShown\(t\)/,
    'la tête de lecture ne pilote plus le clip : ses clés deviennent décoratives');
  const start = src.indexOf('function updateClipShown(');
  const body = src.slice(start, src.indexOf('\n}', start));
  assert.match(body, /clipShown\.mixer\.update\(0\)/,
    'update(0) applique la pose sans advance le temps — c’est ce qu’on veut d’une tête de '
    + 'playback qu’on déplace à la main');
  // Les clés du clip ne doivent pas être attrapables : le glisser-déposer de clés aims `.key`.
  assert.match(codeSeul(read('css/panels.css')), /\.key\.clip\{[^}]*pointer-events:none/,
    'les clés du clip doivent être insensibles au pointeur, sinon on croit pouvoir les '
    + 'déplacer et le glisser modifie une piste voisine');
});

test('un seul clip affiche a la fois', () => {
  // Deux clips affichés donneraient deux mixeurs écrivant dans les mêmes os, et une pose qui
  // dépend de l'ordre de mise à jour.
  const src = codeSeul(read('js/animation.js'));
  const start = src.indexOf('function showClipInTimeline(');
  const body = src.slice(start, src.indexOf('\n}', start));
  assert.match(body, /stopClipShown\(\)/,
    'afficher un clip doit d’abord arrêter le précédent');
  assert.match(body, /anim\.duration = Math\.max\(0\.1/,
    'la timeline doit se caler sur la durée du clip : sur une règle de 5 s, un clip d’une '
    + 'seconde se tasse dans le premier cinquième et ses clés deviennent illisibles');
});

// ---------- affichage automatique à la sélection ----------

test('selectionner un personnage montre son animation, sans le demander', () => {
  const src = codeSeul(read('js/selection.js'));
  const start = src.indexOf('function select(');
  const body = src.slice(start, src.indexOf('\n}', start));
  assert.match(body, /clipAutoForSelection\(selection\)/,
    'la sélection ne déclenche plus l’affichage du clip : il faudrait le demander à la main '
    + 'à chaque fois');
  // Et la timeline ne doit pas être reconstruite DEUX fois par click : clipAutoForSelection
  // s'en charge déjà.
  assert.match(body, /else if\(animBody\.style\.display !== 'none'\) updateTimeline\(\)/,
    'sans le `else`, chaque clic dans la hiérarchie reconstruit la timeline deux fois');
});

test('un clip de duree nulle n est PAS affiche', () => {
  // Une T-pose exportée depuis Mixamo porte un clip de 0,03 s : l'afficher donnerait
  // cinquante lines d'os sans une seule clé visible, et masquerait le vrai clip du modèle.
  const ctx = contexteTimeline();
  const T = ctx.THREE;
  const obj = new T.Group(); obj.name = 'Perso';
  ctx.ed = () => ({});
  ctx.clipsOf = () => [new T.AnimationClip('T-pose', 0.03, [
    new T.QuaternionKeyframeTrack('Hips.quaternion', [0], [0,0,0,1])])];
  ctx.clipAutoForSelection(obj);
  const shown = vm.runInContext('clipShown', ctx);
  assert.equal(shown.clip, null,
    'un clip de durée quasi nulle a été affiché : cinquante lines d’os sans clé visible');
});

test('la duree de la timeline n est recalee que si rien n y est pose', () => {
  // Cette durée appartient au PROJET. La changer à chaque clic sur un personnage remanierait
  // sous les pieds de l'utilisateur l'animation qu'il est en train de composer.
  const ctx = contexteTimeline();
  const T = ctx.THREE;
  const obj = new T.Group(); obj.name = 'Perso';
  const os = new T.Bone(); os.name = 'Hips'; obj.add(os);
  ctx.ed = () => ({});
  ctx.clipsOf = () => [new T.AnimationClip('marche', 2, [
    new T.QuaternionKeyframeTrack('Hips.quaternion', [0, 1, 2], [0,0,0,1, 0,0,0,1, 0,0,0,1])])];

  // Timeline vierge : caler est sans risque et rend les clés lisibles.
  ctx.anim.duration = 5;
  ctx.clipAutoForSelection(obj);
  assert.equal(ctx.anim.duration, 2, 'sur une timeline empty, la durée doit se caler sur le clip');

  // Timeline habitée : on n'y touche pas.
  const ctx2 = contexteTimeline();
  ctx2.ed = () => ({});
  ctx2.clipsOf = () => [new T.AnimationClip('marche', 2, [
    new T.QuaternionKeyframeTrack('Hips.quaternion', [0, 2], [0,0,0,1, 0,0,0,1])])];
  ctx2.anim.duration = 5;
  ctx2.anim.tracks.push({obj:obj, os:null, keys:[{t:0, pos:[0,0,0], quat:[0,0,0,1], ech:[1,1,1]}]});
  ctx2.clipAutoForSelection(obj);
  assert.equal(ctx2.anim.duration, 5,
    'la durée a été changée alors que l’utilisateur avait déjà posé des clés : son animation '
    + 'vient d’être remaniée sous ses pieds');
});

test('reselectionner le meme personnage ne relance pas son mixeur', () => {
  // Relancer le mixeur remet le clip à zéro : la pose saute au premier instant et la position
  // de la tête de lecture est perdue. Or on reclique sur un objet tout le temps — pour le
  // déplacer, changer son matériau, lire sa fiche.
  const ctx = contexteTimeline();
  const T = ctx.THREE;
  const obj = new T.Group(); obj.name = 'Perso';
  const os = new T.Bone(); os.name = 'Hips'; obj.add(os);
  const fiches = new Map();
  ctx.ed = (o) => { if(!fiches.has(o)) fiches.set(o, {}); return fiches.get(o); };
  ctx.clipsOf = () => [new T.AnimationClip('marche', 2, [
    new T.QuaternionKeyframeTrack('Hips.quaternion', [0, 2], [0,0,0,1, 0,0,0,1])])];

  ctx.clipAutoForSelection(obj);
  const premier = vm.runInContext('clipShown.mixer', ctx);
  assert.ok(premier, 'le clip aurait dû s’afficher');
  ctx.clipAutoForSelection(obj);
  assert.equal(vm.runInContext('clipShown.mixer', ctx), premier,
    'le mixeur a été recréé : le clip repart de zéro à chaque clic sur le personnage');
});

test('un clip explicitement masque le reste au changement de selection', () => {
  const ctx = contexteTimeline();
  const T = ctx.THREE;
  const obj = new T.Group(); obj.name = 'Perso';
  const fiches = new Map([[obj, {clipMask:true}]]);
  ctx.ed = (o) => { if(!fiches.has(o)) fiches.set(o, {}); return fiches.get(o); };
  ctx.clipsOf = () => [new T.AnimationClip('marche', 2, [
    new T.QuaternionKeyframeTrack('Hips.quaternion', [0, 2], [0,0,0,1, 0,0,0,1])])];
  ctx.clipAutoForSelection(obj);
  assert.equal(vm.runInContext('clipShown.clip', ctx), null,
    'un clip masqué à la main est revenu tout seul : le bouton n’aurait servi à rien');

  // Et l'inverse : sans marque, il s'shown.
  fiches.set(obj, {});
  ctx.clipAutoForSelection(obj);
  assert.ok(vm.runInContext('clipShown.clip', ctx), 'sans marque, le clip doit s’afficher');
});

test('masquer un clip depuis l inspecteur POSE la marque', () => {
  // Le test précédent vérifie qu'une marque posée est respectée ; celui-ci, qu'elle est bien
  // écrite. Les deux sont nécessaires : le lecteur et l'écrivain peuvent diverger.
  // La section Animation vit désormais dans le panneau SkinnedMeshRenderer (js/ui/panels-
  // components.js), pas dans js/skeleton.js — voir tâche 4.3 du plan.
  const src = codeSeul(read('js/ui/panels-components.js'));
  assert.match(src, /ed\(o\)\.clipMask = true;/,
    'masquer un clip ne laisse aucune trace : il reviendra à la sélection suivante');
  assert.match(src, /ed\(o\)\.clipMask = false;/,
    'réafficher un clip doit lever la marque, sinon elle le masquerait à nouveau ensuite');
});

// ---------- ce que l'inventaire a trouvé ----------

test('le jeu publie reconstruit et applique les pistes d OS comme l editeur', () => {
  // LA divergence la plus coûteuse de ce dépôt : elle ne se voit qu'après l'export. Le runtime
  // ignorait `dp.os` — une piste d'avant-bras publiée faisait partir le personnage ENTIER à
  // l'autre bout de la scène, là où l'éditeur ne bougeait qu'un os. Aucun test ne couvrait ce
  // chemin ; c'est un inventaire du code qui l'a trouvé, pas une exécution.
  const rt = codeSeul(read('js/game-runtime.js'));

  // 1. La reconstruction doit résoudre l'os par son NOM et écarter les pistes orphelines.
  const iRec = rt.indexOf('game.tracks = (data.tracks');
  assert.ok(iRec > 0, 'la reconstruction des pistes a disparu du runtime');
  const rec = rt.slice(iRec, iRec + 900);
  assert.match(rec, /x\.isBone && x\.name === dp\.os/,
    'le runtime ne retrouve pas l’os par son nom : la piste s’appliquera au modèle entier');
  assert.match(rec, /!p\.boneAttendu \|\| p\.os/,
    'une piste d’os orpheline doit être écartée, jamais rabattue sur l’object');

  // 2. L'application doit viser l'os. Reconstruire juste puis écrire dans `p.obj` donnerait
  //    exactement le même défaut, une étape plus loin.
  const iApp = rt.indexOf('function applyAnimation(');
  const app = rt.slice(iApp, rt.indexOf('\n}', iApp));
  assert.match(app, /const target = p\.os \|\| p\.obj;/,
    'le runtime écrit dans l’objet sans regarder `p.os`');
  assert.doesNotMatch(app, /p\.obj\.position\.lerpVectors/,
    'il reste une écriture directe dans l’object : la cible doit passer par `p.os || p.obj`');
});

test('nos tracks passent APRES le clip shown, pas avant', () => {
  // L'ordre décide de qui gagne. Le clip était appliqué en dernier, donc il écrasait nos
  // tracks : on posait une clé sur un os et elle ne faisait rien. Depuis que le clip s'shown
  // automatiquement à la sélection, c'était devenu le cas PAR DÉFAUT.
  const src = codeSeul(read('js/animation.js'));
  const iApp = src.indexOf('function applyAnimation(');
  const body = src.slice(iApp, src.indexOf('\n}', iApp));
  const appels = body.match(/updateClipShown\(t\)/g) || [];
  const iClip = body.indexOf('updateClipShown(t)');
  const iPistes = body.indexOf('anim.tracks.forEach');
  assert.ok(iClip > 0 && iPistes > 0, 'l’un des deux a disparu d’applyAnimation');
  assert.ok(iClip < iPistes,
    'le clip est appliqué après nos tracks : une clé posée sur un os est écrasée aussitôt, '
    + 'sans un mot');
  // UN SEUL appel, et ce test-ci a dû l'apprendre à ses dépens : il regardait `indexOf`, donc
  // le PREMIER appel. Le correctif de la v0.32.2 avait remonté l'appel sans supprimer
  // l'original, et un second `updateClipShown(t)` vivait après les pistes — invisible à cette
  // garde, qui restait verte au-dessus de sa propre annulation. Compter, et pas seulement
  // ordonner.
  assert.equal(appels.length, 1,
    appels.length + ' appels à updateClipShown dans applyAnimation : un second appel après '
    + 'les pistes réapplique le clip par-dessus elles et annule ce que cette garde protège');
});

test('reduire la duree est annulable', () => {
  // Raccourcir la durée ramène le temps de toute clé qui dépass à la nouvelle end. Plusieurs
  // clés s'y empilent alors, et leur position d'origine est perdue. Sans instantané, un chiffre
  // tapé de travers détruisait le travail sans recours.
  const src = codeSeul(read('js/animation.js'));
  const i = src.indexOf("getElementById('an-duration').addEventListener");
  assert.ok(i > 0, 'le champ de durée n’a plus de gestionnaire');
  const body = src.slice(i, i + 900);
  const iHisto = body.indexOf('pushHistory()');
  const iEcrete = body.indexOf('c.t = Math.min(c.t, anim.duration)');
  assert.ok(iHisto > 0, 'aucun instantané avant d’écrêter : la réduction est irréversible');
  assert.ok(iHisto < iEcrete, 'l’instantané doit être pris AVANT l’écrêtage, pas après');
});
