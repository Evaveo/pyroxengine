// ---------- Animation de sprite : le calcul, sans three et sans DOM ----------
//
// Une SUITE est une liste de régions d'une même planche, jouée à une cadence donnée :
//   {name, images: ['course_0', 'course_1', …], ips: 12, loop: true, evenements: [{image, name}]}
//
// Les suites vivent sur l'ASSET SPRITE, pas sur le nœud : les images sont des régions de CETTE
// planche, et deux personnages qui partagent la planche doivent partager la découpe. Ce qui vit
// sur le nœud, c'est l'état de lecture — quelle suite, où on en est.
//
// PUR, et partagé éditeur/runtime pour la même raison que sprite-2d.js : une divergence entre ce
// que l'éditeur montre et ce que le jeu publié joue ne se verrait qu'après export.
//
// Voir docs/superpowers/specs/2026-08-16-game-maree-design.md, phase 3.

/** Le nombre d'images d'une suite. */
export function countImagesSequence(sequence){
  const l = sequence && sequence.images;
  return Array.isArray(l) ? l.length : 0;
}

/**
 * La durée d'une suite, en secondes.
 *
 * `n / ips`, et pas `(n - 1) / ips` : chaque image occupe une tranche de temps entière, la
 * dernière comprise. Avec `(n - 1)`, une suite de 8 images à 12 im/s durerait 0,583 s au lieu de
 * 0,667 — la dernière image ne serait jamais affichée que le temps d'un arrondi.
 */
export function durationSequence(sequence){
  const n = countImagesSequence(sequence);
  const ips = Number(sequence && sequence.ips) || 0;
  return (n > 0 && ips > 0) ? (n / ips) : 0;
}

/** La suite d'un nom, ou null. */
export function sequenceByName(sequences, name){
  const l = Array.isArray(sequences) ? sequences : [];
  if(!name) return null;
  return l.find(function(s){ return s && s.name === name; }) || null;
}

/**
 * Démarre une suite : on repart de zéro, et l'image 0 n'a PAS encore été jouée.
 *
 * `input` porte cette dernière nuance, et elle compte : sans elle, un événement posé sur
 * l'image 0 ne partirait jamais, puisque le premier avancement irait de l'image 0 à l'image 0 et
 * ne franchirait donc rien. Un « poser le pied » sur la première image d'une course est
 * exactement ce cas.
 */
export function startAnimSprite(state, name){
  const e = state || {};
  e.sequence = name || null;
  e.t = 0;
  e.entry = true;
  return e;
}

// Une image d'écart énorme — une pause du navigateur, un onglet en arrière-plan — ne doit pas
// faire partir un événement des centaines de fois. On n'en rejoue jamais plus d'un cycle.
export const ANIM_SPRITE_CYCLES_MAX = 1;

/**
 * Les événements franchis entre deux images ABSOLUES (non ramenées dans la suite).
 *
 * Raisonner en images absolues plutôt qu'en indices ramenés est ce qui rend le passage de boucle
 * juste : aller de l'image 6 à l'image 9 d'une suite de 8 doit franchir 7, 0 (l'image 8) et 1
 * (la 9) — dans cet ordre, une fois chacune. Comparer des indices ramenés donnerait « de 6 à 1 »,
 * soit un intervalle vide ou à l'envers.
 */
export function eventsCrossed(sequence, ofAbsolu, aAbsolu){
  const n = countImagesSequence(sequence);
  const evs = (sequence && Array.isArray(sequence.events)) ? sequence.events : [];
  if(!(n > 0) || !evs.length || aAbsolu < ofAbsolu) return [];
  const start = Math.max(ofAbsolu, aAbsolu - n * ANIM_SPRITE_CYCLES_MAX + 1);
  const output = [];
  for(let f = start; f <= aAbsolu; f++){
    const i = ((f % n) + n) % n;
    evs.forEach(function(ev){
      if(ev && (Number(ev.image) || 0) === i) output.push(ev.name);
    });
  }
  return output;
}

/**
 * Avance la lecture de `dt` secondes et rend ce qu'il faut afficher.
 *
 * Rend `{image, indice, finie, evenements}`. `image` est le NOM de région à poser sur le sprite ;
 * `null` veut dire « ne change rien » — une suite vide ou à 0 im/s n'efface pas ce qui est
 * affiché, sans quoi un réglage incomplet ferait disparaître le personnage au lieu de le figer.
 */
export function advanceAnimSprite(state, sequence, dt){
  const e = state || {};
  const n = countImagesSequence(sequence);
  const ips = Number(sequence && sequence.ips) || 0;
  if(!(n > 0) || !(ips > 0)) return {image: null, indice: 0, finished: true, events: []};

  const loop = !!sequence.loop;
  const duration = n / ips;
  const t0 = Math.max(0, Number(e.t) || 0);
  const avant = Math.floor(t0 * ips);
  let t = t0 + Math.max(0, Number(dt) || 0);

  let finished = false;
  if(!loop && t >= duration){ t = duration; finished = true; }
  // Sans loop on ne dépasse jamais la dernière image : `floor(duree · ips)` vaut `n`, qui
  // n'existe pas.
  const apres = loop ? Math.floor(t * ips) : Math.min(Math.floor(t * ips), n - 1);

  const start = e.entry ? avant : avant + 1;
  e.entry = false;
  const events = eventsCrossed(sequence, start, apres);

  // Le temps est ramené dans le cycle APRÈS le calcul des événements : le franchissement se
  // raisonne en images absolues, l'état stocké n'en a pas besoin.
  e.t = loop ? (t % duration) : t;
  const indice = ((apres % n) + n) % n;
  return {image: sequence.images[indice], indice: indice, finished: finished, events: events};
}

/**
 * Où en est la lecture, entre 0 et 1.
 *
 * C'est ce qui donne leur raison d'être aux deux bounds posées sur `e.t` — le figeage à la durée
 * sans loop, le retour dans le cycle avec. Sans lecteur, ces deux bounds ne changeaient RIEN
 * au résultat : les mutations qui les supprimaient survivaient à tous les tests, parce que
 * l'indice d'image est de toute façon ramené plus loin. Deux bounds mortes.
 *
 * Avec elles, `e.t` veut dire quelque chose : le temps écoulé DANS le cycle current. Un script
 * peut demander « où en est la réception ? », et surtout basculer une suite en boucle pendant
 * qu'elle joue — ce qu'on fait sans y penser dans l'inspecteur — reprend proprement au lieu de
 * repartir d'un reste arbitraire.
 */
export function progressAnimSprite(state, sequence){
  const d = durationSequence(sequence);
  if(!(d > 0)) return 0;
  // Aucune clamped ici, et c'est voulu : `advanceAnimSprite` tient déjà `e.t` dans [0, durée], et
  // c'est justement cet invariant que cette fonction rend lisible. Borner une seconde fois
  // masquerait la disparition de la première — mesuré, la mutation qui supprimait le figeage du
  // temps survivait tant que ce `Math.min(1, …)` était là.
  return (Number(state && state.t) || 0) / d;
}

/**
 * Deux régions donnent-elles la MÊME géométrie ?
 *
 * Une planche d'animation a des cellules de taille identique : seules les coordonnées de texture
 * changent d'une image à l'autre. Reconstruire la maille à chaque image allouerait une géométrie
 * et un matériau douze fois par seconde et par personnage, et rendrait au tampon graphique des
 * ressources aussitôt resumes. La question se décide ici pour que l'éditeur et le jeu publié y
 * répondent pareil.
 */
export function sameGeometrySprite(regionA, regionB){
  if(!regionA || !regionB) return false;
  return (Number(regionA.l) || 0) === (Number(regionB.l) || 0)
      && (Number(regionA.h) || 0) === (Number(regionB.h) || 0);
}

/**
 * Joue une suite sur un nœud. Rendue ici parce que c'est l'API des scripts ET du copilote.
 *
 * Rejouer la suite DÉJÀ en cours ne la redémarre pas : sans cette garde, un script qui appelle
 * `playAnimSprite(p, 'course')` à chaque image — ce qu'on écrit sans y penser — figerait le
 * personnage sur sa première image, et on chercherait du côté de la planche.
 */
export function playAnimSprite(node, name, forcer){
  if(!node) return false;
  const e = node.userData._animSprite || (node.userData._animSprite = {});
  if(!forcer && e.sequence === name) return false;
  startAnimSprite(e, name);
  return true;
}

/**
 * Un pas d'animation pour toute une liste de nœuds. Rend le nombre d'animateurs joués.
 *
 * L'ORCHESTRATION EST ICI, et elle y est parce qu'elle ne doit exister qu'une fois : démarrage
 * automatique, retour au défaut quand une suite sans loop s'achève, image nulle qui ne change
 * rien. Trois règles qu'on ne remarque que quand elles diffèrent entre l'éditeur et le jeu.
 *
 * Ce qui diffère vraiment est passé en argument : `resoudreAsset` (les deux côtés n'ont pas la
 * même table d'assets), `poserImage` (les deux ont leur construction de maille) et `emit`
 * (l'éditeur n'a pas de bus d'événements — un marker qui déclencherait un tir pendant qu'on
 * place les objets serait une nuisance).
 */
export function stepAnimSprites(list, dt, resolveAsset, setImage, emit){
  let n = 0;
  (list || []).forEach(function(o){
    const a = o && o.userData && o.userData.animSprite;
    if(!a) return;
    const asset = resolveAsset(o);
    if(!asset) return;
    const e = o.userData._animSprite || (o.userData._animSprite = {});
    if(!e.sequence && a.auto !== false && a.defaultValue) startAnimSprite(e, a.defaultValue);
    const s = sequenceByName(asset.sequences, e.sequence);
    if(!s) return;
    const r = advanceAnimSprite(e, s, (Number(dt) || 0) * (Number(a.speed) || 1));
    if(r.image !== null && setImage) setImage(o, r.image);
    if(emit) r.events.forEach(emit);
    // Une suite finie revient au défaut : c'est ce qu'on attend d'une réception ou d'un
    // atterrissage, et l'écrire dans chaque script serait la même ligne partout.
    if(r.finished && a.defaultValue && e.sequence !== a.defaultValue) startAnimSprite(e, a.defaultValue);
    n++;
  });
  return n;
}

/**
 * Les problèmes des suites d'un sprite, en clair. Jamais une exception : une suite mal réglée
 * n'est pas une erreur, elle joue simplement autre chose que ce qu'on croit.
 */
export function validateSequences(sequences, regions){
  const p = [];
  const l = Array.isArray(sequences) ? sequences : [];
  const names = new Set((Array.isArray(regions) ? regions : [])
    .map(function(r){ return r && r.name; }).filter(Boolean));
  const vus = new Set();
  l.forEach(function(s, i){
    const ou = 'La suite n°' + (i + 1);
    if(!s || !s.name){ p.push(ou + ' n\'a pas de nom.'); return; }
    if(vus.has(s.name)){
      p.push('Deux suites s\'appellent « ' + s.name + ' » : la seconde ne pourra jamais être jouée.');
    }
    vus.add(s.name);
    const n = countImagesSequence(s);
    if(!n){ p.push('La suite « ' + s.name + ' » n\'a aucune image.'); }
    if(!(Number(s.ips) > 0)){
      p.push('La suite « ' + s.name + ' » est à ' + (s.ips === undefined ? 'aucune' : s.ips)
        + ' image par seconde : elle ne peut pas advance.');
    }
    (s.images || []).forEach(function(name){
      // Une image qui ne désigne aucune région shown l'image par défaut de la planche — donc
      // une animation qui « saute » sur une image sans qu'aucune erreur ne soit levée.
      if(names.size && !names.has(name)){
        p.push('La suite « ' + s.name + ' » désigne l\'image « ' + name + ' », qui n\'existe pas '
          + 'dans cette planche.');
      }
    });
    (s.events || []).forEach(function(ev){
      const i2 = Number(ev && ev.image);
      if(!Number.isInteger(i2) || i2 < 0 || i2 >= n){
        p.push('Un événement de « ' + s.name + ' » est posé sur l\'image ' + (ev && ev.image)
          + ', hors des ' + n + ' images de la suite : il ne partira jamais.');
      }
      if(!ev || !ev.name) p.push('Un événement de « ' + s.name + ' » n\'a pas de nom.');
    });
  });
  return p;
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.playAnimSprite = playAnimSprite;
globalThis.sameGeometrySprite = sameGeometrySprite;
globalThis.sequenceByName = sequenceByName;
globalThis.stepAnimSprites = stepAnimSprites;
globalThis.validateSequences = validateSequences;