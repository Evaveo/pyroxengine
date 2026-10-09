// ---------- L'atténuation d'une source audio, en un seul endroit ----------
//
// Ces quelques appels étaient écrits DEUX FOIS — dans js/audio.js pour l'éditeur, dans
// js/game-runtime.js pour le jeu — et le lot qui suit en ajoute trois de plus (distance maximale,
// pente, modèle). Trois paramètres × deux exemplaires, c'est six occasions qu'un jeu publié sonne
// autrement que ce que l'auteur a réglé. Et une divergence d'atténuation ne se voit pas : elle
// s'entend, plus tard, chez le joueur, sur un mélange qu'on croyait validé.
//
// PARTAGÉ, donc : ce fichier est chargé par l'éditeur, par l'aperçu de jeu, par le harnais de build et
// embarqué dans les jeux publiés. Rien n'y dépend du DOM ; `three` n'y est même pas nommé — on ne
// touche l'objet son que par ses méthodes, ce qui rend la fonction vérifiable avec un objet quelconque.
//
// ---------------------------------------------------------------------------------------
// CE QUE « PORTÉE » VEUT DIRE, ET CE QU'ELLE NE VEUT PAS DIRE
//
// Le champ s'appelle « portée » et règle `refDistance` : la distance à laquelle le son garde son volume
// plein. Ce n'est PAS une limite. Avec le modèle `inverse` — celui du Web Audio par défaut, et celui de
// tous les projets existants — le gain vaut :
//
//     ref / (ref + pente × (d − ref))
//
// qui décroît sans jamais atteindre zéro. Dix sources lointaines restent donc audibles en fond, et le
// mélange se brouille sans qu'aucune ne paraisse fautive.
//
// Le modèle `lineaire` change ça : le gain atteint réellement zéro à `distanceMax`. C'est ce qu'on veut
// presque toujours pour un décor sonore — mais il n'est PAS le défaut, et c'est délibéré : le changer
// modifierait le son de tous les projets déjà réglés à l'oreille. On l'offre, on explique lequel
// choisir, et on laisse l'auteur décider.
// ---------------------------------------------------------------------------------------

export const AUDIO_MODELS = ['inverse', 'lineaire', 'exponentiel'];

// Web Audio les nomme en anglais ; l'interface et les projets les nomment en français. La table est ici
// pour que la traduction ne soit pas recopiée à côté de chaque appel.
export const AUDIO_MODEL_WEB = {inverse: 'inverse', lineaire: 'linear', exponentiel: 'exponential'};

/**
 * Pose l'atténuation d'une source positionnelle.
 *
 * `sound` : un objet qui expose les setters du Web Audio (`THREE.PositionalAudio`). Une source NON
 * spatiale n'en a aucun — on ne fait donc rien, plutôt que de tester le type de l'objet : c'est la
 * présence de la méthode qui décide, et elle ne mentira pas.
 *
 * `ua` : le sac de réglages (`userData.audio`).
 *
 * Rend ce qui a été appliqué, pour que l'appelant puisse le DIRE — un réglage silencieusement ignoré
 * parce que le navigateur ne connaît pas la méthode est la pire des issues.
 */
export function setFalloffAudio(son, ua){
  const r = {range: null, distanceMax: null, rolloff: null, model: null, ignored: []};
  if(!son || !ua) return r;

  const range = Math.max(0.01, Number(ua.range) || 10);
  if(typeof son.setRefDistance === 'function'){ son.setRefDistance(range); r.range = range; }
  else r.ignored.push('range');

  // La distance maximale doit rester AU-DESSUS de la portée : `max <= ref` donne une division par zéro
  // dans le modèle linéaire, et un son qui disparaît d'un coup ou reste à plein volume selon le
  // navigateur. On la repousse plutôt que de refuser, parce qu'un réglage tapé à l'envers doit
  // continuer de produire un son.
  const dmax = Math.max(range + 0.01, Number(ua.distanceMax) || (range * 10));
  if(typeof son.setMaxDistance === 'function'){ son.setMaxDistance(dmax); r.distanceMax = dmax; }
  else r.ignored.push('distanceMax');

  const rolloff = Math.max(0, Number(ua.rolloff) === undefined ? 1 : Number(ua.rolloff));
  if(typeof son.setRolloffFactor === 'function'){ son.setRolloffFactor(rolloff); r.rolloff = rolloff; }
  else r.ignored.push('rolloff');

  const name = (AUDIO_MODELS.indexOf(ua.model) !== -1) ? ua.model : 'inverse';
  if(typeof son.setDistanceModel === 'function'){
    son.setDistanceModel(AUDIO_MODEL_WEB[name]);
    r.model = name;
  } else r.ignored.push('model');
  return r;
}

/** Le gain théorique d'une source à la distance `d`, d'après ses réglages. */
export function gainAudioA(ua, d){
  const ref = Math.max(0.01, Number(ua && ua.range) || 10);
  const max = Math.max(ref + 0.01, Number(ua && ua.distanceMax) || (ref * 10));
  const rolloff = Math.max(0, (ua && Number(ua.rolloff) !== undefined && ua.rolloff !== null) ? Number(ua.rolloff) : 1);
  const name = (ua && AUDIO_MODELS.indexOf(ua.model) !== -1) ? ua.model : 'inverse';
  const dist = Math.max(0, Number(d) || 0);
  if(name === 'lineaire'){
    // La formule du Web Audio, distance bornée à [ref, max]. C'est le SEUL modèle qui atteint zéro.
    const c = Math.min(Math.max(dist, ref), max);
    return Math.max(0, 1 - rolloff * (c - ref) / (max - ref));
  }
  if(name === 'exponentiel'){
    if(dist <= ref) return 1;
    return Math.pow(Math.max(dist, ref) / ref, -rolloff);
  }
  if(dist <= ref) return 1;
  return ref / (ref + rolloff * (Math.min(dist, max) - ref));
}

/**
 * Ce qu'un réglage d'atténuation a de gênant, en clair — et ce n'est jamais une erreur bloquante.
 *
 * Le plus utile de ces messages est le premier : il dit à quel point le modèle par défaut ne coupe
 * jamais. C'est la seule façon d'apprendre la différence sans passer une soirée à chercher pourquoi
 * un niveau est bruyant.
 */
export function validateFalloffAudio(ua){
  const p = [];
  if(!ua) return p;
  if(ua.spatial === false) return p;    // une source non spatiale ignore toute l'atténuation
  const name = (AUDIO_MODELS.indexOf(ua.model) !== -1) ? ua.model : 'inverse';
  if(name !== 'lineaire'){
    const g = gainAudioA(ua, Math.max(0.01, Number(ua.range) || 10) * 10);
    p.push('Modèle « ' + name + ' » : à dix fois la portée, ce son s\'entend encore à '
      + Math.round(g * 100) + ' % — il ne se tait jamais tout à fait. Passez en « lineaire » pour '
      + 'qu\'il s\'éteigne vraiment à la distance maximale.');
  }
  if(Number(ua.distanceMax) && Number(ua.distanceMax) <= (Number(ua.range) || 10)){
    p.push('La distance maximale (' + ua.distanceMax + ') est sous la portée (' + (ua.range || 10)
      + ') : elle a été repoussée au-dessus, sinon l\'atténuation n\'a pas de sens.');
  }
  if(Number(ua.rolloff) === 0){
    p.push('Pente à 0 : le son garde son volume plein à toute distance, comme s\'il n\'était pas '
      + 'spatial. C\'est peut-être ce que vous voulez — décocher « 3D » serait plus clair.');
  }
  return p;
}
