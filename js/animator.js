// ---------- Machine à états d'animation : le format et son évaluateur ----------
//
// Ce que ce fichier permet : décrire « quand la vitesse dépass 0,1, passer de Idle à Marche
// en 0,2 s » sous forme de DONNÉES, pas de code. C'est toute la raison d'être du chantier —
// un infographiste doit pouvoir câbler l'animation de son personnage sans écrire de JS.
//
// Ce fichier ne joue AUCUNE animation et ne connaît ni three ni le DOM. Il décide, l'appelant
// agit (`playAnimationModel` d'un côté, `rtPlayAnimation` de l'autre). Cette séparation
// n'est pas cosmétique : c'est ce qui rend la machine éprouvable hors navigateur, alors que
// tout ce qui touche au mixeur ne l'est pas.
//
// LE FORMAT (`.animator.json`) :
//
//   {
//     "format": "animator", "version": 1,
//     "parametres": [ {"name":"vitesse", "type":"float", "defaut":0},
//                     {"name":"saute",   "type":"trigger"} ],
//     "etats":      [ {"name":"Idle",   "clip":"idle",   "loop":true},
//                     {"name":"Marche", "clip":"marche", "loop":true},
//                     {"name":"Saut",   "clip":"jump",   "loop":false} ],
//     "start": "Idle",
//     "transitions": [
//       {"de":"Idle", "vers":"Marche", "duration":0.2,
//        "conditions":[{"param":"vitesse","operateur":">","valeur":0.1}]},
//       {"de":"*", "vers":"Saut", "duration":0.1,
//        "conditions":[{"param":"saute","operateur":"declenche"}]},
//       {"de":"Saut", "vers":"Idle", "duration":0.2, "attendreFin":true, "conditions":[]}
//     ]
//   }
//
// `de: "*"` = depuis N'IMPORTE QUEL état — l'équivalent de l'Any State d'Unity. Sans lui, un
// saut déclenchable de partout demanderait une transition par état, recopiée à la main, et
// oubliée dès qu'on ajoute un état.

export const ANIMATOR_OPERATORS = ['>', '<', '>=', '<=', '==', '!=', 'declenche'];
export const ANIMATOR_TYPES_PARAM = ['float', 'int', 'bool', 'trigger'];

/** Les paramètres à leur valeur de départ. Un déclencheur part toujours à faux. */
export function paramsByDefault(machine){
  const p = {};
  ((machine && machine.params) || []).forEach(function(d){
    if(!d || !d.name) return;
    p[d.name] = (d.type === 'trigger') ? false
      : (d.defaultValue !== undefined ? d.defaultValue : (d.type === 'bool' ? false : 0));
  });
  return p;
}

/**
 * Une condition est-elle satisfaite ?
 *
 * Un paramètre INCONNU rend faux — jamais vrai, et jamais une erreur. Une machine à états qui
 * plante à cause d'une faute de frappe dans un nom bloquerait le personnage sur place ; une
 * condition qui ne se déclenche pas se voit et se cherche. `validateAnimator` la signale par
 * ailleurs, au moment où l'on peut encore la corriger.
 */
export function conditionMet(cond, params){
  if(!cond || !cond.param) return false;
  if(!(cond.param in params)) return false;
  const v = params[cond.param];
  const attendu = cond.value;
  switch(cond.operateur){
    case '>':  return v > attendu;
    case '<':  return v < attendu;
    case '>=': return v >= attendu;
    case '<=': return v <= attendu;
    case '==': return v === attendu;
    case '!=': return v !== attendu;
    // Un déclencheur ne se compare pas : il est armé ou non. Le comparer à `true` marcherait
    // par accident aujourd'hui et casserait le jour où on stockera autre chose qu'un booléen.
    case 'declenche': return v === true;
    default: return false;
  }
}

/**
 * La transition à emprunter depuis `stateCurrent`, ou null.
 *
 * `progress` = part du clip déjà jouée, de 0 à 1. Elle ne sert qu'aux transitions marquées
 * `attendreFin`, celles qui ne doivent partir qu'une fois l'animation finie — un saut, un coup.
 * Sans elles, un enchaînement « Saut puis Idle » repartirait à la première image.
 *
 * L'ORDRE COMPTE : la première transition déclarée qui convient l'emporte. C'est ce qui rend
 * le résultat prévisible quand deux transitions sont satisfaites en même temps, et ce qui
 * permet à l'éditeur de dire « celle-ci pass avant celle-là » en les déplaçant.
 */
export function transitionApplicable(machine, stateCurrent, params, progress){
  const list = (machine && machine.transitions) || [];
  for(let i = 0; i < list.length; i++){
    const t = list[i];
    if(!t || !t.vers) continue;
    const fromEverywhere = (t.de === '*');
    if(!fromEverywhere && t.de !== stateCurrent) continue;
    // Une transition « depuis partout » vers l'état où l'on est déjà se rejouerait sans fin,
    // en repartant du début à chaque image. On ne loop jamais sur soi-même implicitement ;
    // qui veut relancer un état le déclare explicitement (`de` nommé, pas `*`).
    if(fromEverywhere && t.vers === stateCurrent) continue;
    // Exit Time : la transition n'est candidate qu'une fois cette fraction du clip jouée. Une
    // transition qui l'exige ET qui porte des conditions veut les DEUX, comme dans Unity.
    const output = timeOfOutput(t);
    if(output !== null && !(progress >= output)) continue;
    const conds = t.conditions || [];
    let toutes = true;
    for(let c = 0; c < conds.length; c++){
      if(!conditionMet(conds[c], params)){ toutes = false; break; }
    }
    if(toutes) return t;
  }
  return null;
}

/**
 * Échange la transition à `i` avec sa voisine (`direction` = -1 monte, +1 descend).
 *
 * La priorité EST l'ordre du tableau (transitionApplicable : « la première transition
 * déclarée qui convient l'emporte », voir plus haut) — ce n'est donc pas un champ à part, mais
 * une simple permutation de position. Ne fait rien en butée : un bouton « monter » sur la
 * première transition, ou « descendre » sur la dernière, n'a rien à faire.
 */
export function moveTransition(machine, i, direction){
  const list = (machine && machine.transitions) || [];
  const j = i + direction;
  if(j < 0 || j >= list.length) return false;
  const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
  return true;
}

// ---------- Les réglages d'une transition, à la Unity ----------
//
// Une transition d'Unity porte six réglages en plus de ses conditions, et chacun répond à une
// question qu'on se pose vraiment :
//
//   Has Exit Time / Exit Time  — « ne pars qu'une fois 75 % du clip joué »
//   Fixed Duration             — le fondu se count-t-il en SECONDES ou en fraction du clip ?
//   Transition Duration        — la durée du fondu
//   Transition Offset          — « démarre le clip d'arrivée à 30 % de sa durée »
//   Interruption Source        — qui a le droit de couper cette transition en cours
//   Ordered Interruption       — s'arrêter à la première candidate, ou prendre la meilleure
//
// Nous n'avions que la durée et un `attendreFin` booléen — c'est-à-dire un Exit Time bloqué à
// 100 %. Un coup d'épée qui doit enchaîner aux trois quarts n'était pas exprimable.

export const ANIMATOR_INTERRUPTIONS = ['aucune', 'etatCourant', 'etatSuivant',
                                'courantPuisSuivant', 'suivantPuisCourant'];

/**
 * Les opérateurs qu'un type de paramètre autorise, avec leur libellé — repris d'Unity.
 *
 * Un booléen ne se compare pas avec « > » et un déclencheur ne se compare pas du tout : il est
 * armé ou il ne l'est pas. Proposer les six opérateurs pour les quatre types laissait écrire
 * des conditions qui ne peuvent jamais être vraies, sans que rien ne le dise.
 */
// Les clés sont celles d'`ANIMATOR_TYPES_PARAM`, et ce n'est pas cosmétique : elles étaient
// restées en français (`flottant`, `entier`, `booleen`) alors que les paramètres portent
// `float`/`int`/`bool` depuis la migration. La table ne répondait donc JAMAIS, et l'ancienne
// vue retombait sur les opérateurs des flottants : une condition booléenne proposait
// « plus grand que » au lieu de « est ».
export const OPERATORS_BY_TYPE = {
  float:   [['>', 'plus grand que'], ['<', 'plus petit que']],
  int:     [['>', 'plus grand que'], ['<', 'plus petit que'],
            ['==', 'égal à'], ['!=', 'différent de']],
  bool:    [['==', 'est'], ['!=', 'n\'est pas']],
  trigger: [['declenche', 'est déclenché']]
};

/**
 * L'instant de sortie exigé, en fraction du clip (0 à 1 et au-delà pour plusieurs tours), ou
 * `null` si la transition ne l'exige pas.
 *
 * `attendreFin: true` sans `exitTime` vaut 1 : c'est ce que la case voulait dire avant qu'elle
 * ait une valeur, et les machines écrites ainsi doivent continuer de se comporter pareil.
 */
export function timeOfOutput(t){
  if(!t || !t.awaitEnd) return null;
  const v = Number(t.exitTime);
  return (isFinite(v) && v > 0) ? v : 1;
}

/**
 * La durée du fondu, EN SECONDES.
 *
 * `dureeFixe` (le Fixed Duration d'Unity) décide de l'unité de `duration` : en secondes quand elle
 * est vraie — notre comportement d'origine, et le défaut —, en fraction de la durée du clip de
 * DÉPART sinon. Le second est ce qu'on veut quand la même machine sert à des clips de longueurs
 * différentes : un fondu de 0,25 s sur un clip de 0,3 s mange presque tout le mouvement.
 */
export function durationTransition(t, durationClipStart){
  const d = Math.max(0, Number((t || {}).duration) || 0);
  if(!t || t.durationFixe === false){
    const base = Number(durationClipStart) || 0;
    return d * base;
  }
  return d;
}

/** Le décalage de départ du clip d'arrivée, en fraction de sa durée (0 à 1). */
export function offsetTransition(t){
  const v = Number((t || {}).offset);
  return (isFinite(v) && v > 0) ? Math.min(1, v) : 0;
}

/** Les déclencheurs consommés par une transition (à désarmer une fois qu'elle est prise). */
export function triggersOf(transition){
  return ((transition && transition.conditions) || [])
    .filter(function(c){ return c && c.operateur === 'declenche'; })
    .map(function(c){ return c.param; });
}

// ---------- Le lecteur : le petit état qui avance ----------

/**
 * Crée l'état d'exécution d'une machine. Volontairement un objet nu et sérialisable : il ne
 * contient aucune référence à une action, un mixeur ou un objet de scène. Les deux côtés
 * (éditeur et jeu) le gardent à côté de leur propre mixeur.
 */
export function createPlayerAnimator(machine){
  const states = (machine && machine.states) || [];
  const start = (machine && machine.start)
    || (states[0] ? states[0].name : null);
  return {state: start, params: paramsByDefault(machine), time: 0};
}

/**
 * Fait advance le lecteur d'une image. Renvoie la transition prise, ou null.
 *
 * UNE SEULE transition par image, et c'est délibéré : enchaîner tant qu'une transition
 * s'applique ferait tourner une boucle A→B→A à l'infini DANS une seule image, et le programme
 * se figerait sans erreur. Une image, un changement d'état — au pire l'enchaînement prend
 * quelques images de plus, ce qui ne se voit pas.
 */
export function updatePlayerAnimator(machine, player, dt, progress){
  if(!player || !player.state) return null;
  player.time += (dt || 0);
  const t = transitionApplicable(machine, player.state, player.params,
    progress === undefined ? 0 : progress);
  if(!t) return null;
  // Le déclencheur est CONSOMMÉ par la transition qui s'en sert. Sans cela il resterait armé,
  // et la transition repartirait à chaque image : un saut deviendrait un saut perpétuel.
  triggersOf(t).forEach(function(name){ player.params[name] = false; });
  player.state = t.vers;
  player.time = 0;
  return t;
}

/**
 * Pose la valeur d'un paramètre. Renvoie false si le paramètre n'existe pas — l'appelant peut
 * alors le dire, plutôt que de créer en silence un paramètre fantôme qu'aucune condition ne
 * lira jamais.
 */
export function setParamAnimator(player, name, value){
  if(!player || !(name in player.params)) return false;
  player.params[name] = value;
  return true;
}

/** Arme un déclencheur. Même contrat que ci-dessus. */
export function armTriggerAnimator(player, name){
  return setParamAnimator(player, name, true);
}

/**
 * L'objet que les scripts manipulent : `api.animator(cible)`.
 *
 * Un OBJET plutôt que des fonctions plates (`api.poserFlottant(cible, 'v', 3)`), parce que
 * c'est ainsi qu'on tient un Animator dans Unity : on le récupère une fois, on le garde, on le
 * pousse. Répéter la cible à chaque appel n'apporte rien et se trompe d'objet sans prévenir.
 *
 * Ici, et pas dans js/scripts.js, pour la raison habituelle : le runtime du jeu publié a besoin
 * du MÊME objet et ne charge pas ce fichier-là. Deux implémentations divergentes donneraient un
 * jeu qui ne réagit pas comme l'éditeur, et ça ne se verrait qu'après export. Seule la façon de
 * retrouver le lecteur diffère entre les deux côtés — elle reste chez l'appelant.
 *
 * `warn(name)` est appelé quand le paramètre n'existe pas : une faute de frappe ne lève rien
 * et ne fait rien, c'est la panne muette que tout ce fichier cherche à rendre visible.
 */
export function setParamOrWarn(player, name, value, warn){
  if(setParamAnimator(player, name, value)) return true;
  if(warn) warn(name);
  return false;
}

export function createObjectAnimator(player, machine, warn){
  // Nommée `setParam` et non `set` : `set` est déjà un global du runtime, et le contrôle de
  // symboles de test/materiau-plugin.test.mjs ne distingue pas une locale d'un appel global.
  const setParam = function(name, value){
    return setParamOrWarn(player, name, value, warn);
  };
  const api = {
    setFloat: function(name, v){ return setParam(name, Number(v) || 0); },
    setInt:   function(name, v){ return setParam(name, Math.round(Number(v) || 0)); },
    setBool:  function(name, v){ return setParam(name, !!v); },
    setTrigger:    function(name){ return setParam(name, true); },
    get:          function(name){ return (name in player.params) ? player.params[name] : undefined; },
    // Repart de l'état de départ ET des valeurs par défaut : un « rejouer » qui garderait les
    // paramètres ressortirait aussitôt de l'état de départ, par la transition qui les teste.
    restart: function(){
      const neuf = createPlayerAnimator(machine);
      player.state = neuf.state;
      player.params = neuf.params;
      player.time = 0;
      return player.state;
    }
  };
  // `state` et `params` en lecture seule, et `params` rend une COPIE : sans elle, un script
  // pourrait y écrire un paramètre que rien ne déclare et croire l'avoir posé.
  Object.defineProperty(api, 'state',   {get: function(){ return player.state || ''; }});
  Object.defineProperty(api, 'params', {get: function(){ return Object.assign({}, player.params); }});
  return api;
}

/**
 * Lit « vitesse = 1 », « assis = vrai », ou juste « saute » — un déclencheur, qu'on arme.
 *
 * C'est ce que saisit l'utilisateur dans l'action « Régler le paramètre d'animation… » du
 * système visuel « Quand… Alors… ». UNE ligne de texte, et pas trois contrôles séparés : tout
 * le reste de ce système fonctionne ainsi, et quelqu'un qui vient d'écrire
 * « Émettre l'événement… → pas » ne doit pas tomber sur un formulaire d'un autre genre.
 *
 * Ici et pas dans js/events.js, parce que le runtime en a besoin AUSSI et qu'il ne charge
 * pas ce fichier-là. Deux lectures divergentes de « vitesse = 1 » donneraient un jeu publié
 * qui ne réagit pas comme l'éditeur — et ça ne se verrait qu'après export.
 */
export function readSettingParam(text){
  const s = String(text || '').trim();
  if(!s) return null;
  const eg = s.indexOf('=');
  if(eg === -1) return {name: s, value: true, trigger: true};
  const name = s.slice(0, eg).trim();
  const raw = s.slice(eg + 1).trim();
  if(!name) return null;
  // « vrai/faux » AVANT les nombres : `Number('vrai')` vaut NaN, et un NaN glissé dans un
  // paramètre rendrait toutes ses comparaisons fausses sans que rien ne le signale.
  const bottom = raw.toLowerCase();
  if(bottom === 'vrai' || bottom === 'true')  return {name: name, value: true};
  if(bottom === 'faux' || bottom === 'false') return {name: name, value: false};
  const n = Number(raw);
  // Un texte qui n'est pas un nombre reste du texte : comparer une chaîne avec `==` est un
  // usage légitime, et le convertir en NaN casserait la condition en silence.
  return {name: name, value: (raw === '' || Number.isNaN(n)) ? raw : n};
}

/**
 * Lit une condition écrite à la main : « vitesse > 0.1 », « assis == vrai », ou « saute ».
 *
 * Même parti pris que `readSettingParam` — UNE ligne de texte plutôt qu'un formulaire à
 * trois contrôles. Un éditeur de graphe qui demanderait de remplir trois champs par condition
 * ferait plus de clics que d'animation.
 *
 * Les opérateurs sont essayés du PLUS LONG au plus court : sur « vitesse >= 1 », chercher « > »
 * d'abord donnerait le paramètre « vitesse » et la valeur « = 1 », c'est-à-dire une condition
 * qui a l'air juste et ne se déclenche jamais.
 */
export function weightBlend(points, value){
  const list = (points || []).filter(function(p){ return p && p.clip; });
  const n = list.length;
  const weight = new Array((points || []).length).fill(0);
  if(!n) return weight;
  const indexOf = function(p){ return (points || []).indexOf(p); };
  const tries = list.slice().sort(function(a, b){ return (a.value || 0) - (b.value || 0); });
  const v = (typeof value === 'number' && !Number.isNaN(value)) ? value : 0;
  // Hors des bounds, on ne prolonge PAS la droite : un paramètre qui dépass la valeur du
  // dernier point donnerait un poids supérieur à 1 sur celui-ci et négatif sur le précédent,
  // c'est-à-dire une pose extrapolée que personne n'a animée.
  if(v <= (tries[0].value || 0)){ weight[indexOf(tries[0])] = 1; return weight; }
  const last = tries[n - 1];
  if(v >= (last.value || 0)){ weight[indexOf(last)] = 1; return weight; }
  for(let i = 0; i < n - 1; i++){
    const a = tries[i], b = tries[i + 1];
    const va = a.value || 0, vb = b.value || 0;
    if(v < va || v > vb) continue;
    // Pas de garde « écart nul » ici, et c'est mesuré, pas supposé : deux points à la même
    // valeur sont toujours attrapés AVANT, soit par un bornage, soit par le segment précédent
    // — la liste étant triée, un segment empty se situe forcément à une valeur déjà couverte.
    // Le balayage du test le vérifie sur des doublons au début, au milieu, à la fin et partout.
    const k = (v - va) / (vb - va);
    weight[indexOf(a)] = 1 - k;
    weight[indexOf(b)] = k;
    return weight;
  }
  return weight;
}

/**
 * La durée du cycle mélangé — moyenne des durées, pondérée par les poids.
 *
 * C'est ce qui fait que la cadence change en douceur quand on passe de la marche à la course :
 * sans elle, il faudrait choisir la durée d'un seul clip, et le pas s'accélérerait d'un coup au
 * moment où le poids bascule.
 */
export function durationBlended(points, weight, durationOf){
  let somme = 0, total = 0;
  (points || []).forEach(function(p, i){
    const w = weight[i] || 0;
    if(w <= 0 || !p) return;
    const d = durationOf(p.clip);
    if(!(d > 0)) return;
    somme += w * d;
    total += w;
  });
  return total > 0 ? somme / total : 0;
}

/**
 * La vitesse de lecture de chaque clip pour que TOUS bouclent en même temps.
 *
 * LE point de tout le mécanisme. Marche et Course n'ont ni la même durée ni la même cadence :
 * jouées chacune à son propre temps, les jambes bégaient — un pied qui touche pendant que
 * l'autre décolle. Lu à `durée ÷ cycle`, chaque clip parcourt exactement un tour dans le même
 * temps que les autres : `temps ÷ durée` reste identique partout, à jamais.
 *
 * On rend une VITESSE, pas une phase à accumuler nous-mêmes, et c'est délibéré. Ce dépôt s'est
 * déjà donné la règle en toutes lettres pour les marqueurs : « le seul temps juste est celui
 * que le mixeur vient d'écrire ». Une phase tenue en parallèle finirait par diverger de ce que
 * les actions ont réellement joué — fondu, pause, changement de vitesse — et le décalage
 * porterait justement sur ce que ce lot prétend garantir.
 */
export function speedsBlend(points, weight, durationOf){
  const cycle = durationBlended(points, weight, durationOf);
  return (points || []).map(function(p){
    const d = p ? durationOf(p.clip) : 0;
    // Durée inconnue : rien à synchroniser sur ce clip-là. Vitesse normale plutôt que 0, qui
    // le figerait sur sa première image — un personnage à moitié en statue, sans erreur.
    if(!(d > 0) || !(cycle > 0)) return 1;
    return d / cycle;
  });
}

/** L'état porte-t-il un mélange plutôt qu'un clip simple ? */
export function isStateBlend(state){
  return !!(state && state.blend && (state.blend.points || []).length);
}

// Un point s'écrit « marche = 2 », comme une condition s'écrit « vitesse > 0.1 ». Une seule
// zone de texte, une ligne par point : c'est la forme que le reste de l'éditeur emploie déjà,
// et elle n'oblige personne à empiler des lignes de formulaire pour trois clips.

export function writePointBlend(p){
  if(!p || !p.clip) return '';
  return p.clip + ' = ' + (p.value || 0);
}

// ---------- Inertialisation : résorber l'ÉCART au lieu de mélanger deux poses ----------
//
// Un fondu classique fait play les deux clips à la fois et affiche leur moyenne. Ça marche,
// mais ça produit des poses que personne n'a animées : pendant 0,2 s le personnage est à
// mi-chemin entre marcher et frapper, les pieds glissent, et deux clips coûtent deux fois.
//
// L'inertialisation prend le problème par l'autre bout : le nouveau clip joue SEUL, à plein
// régime, dès la première image. On mesure l'écart entre la pose affichée juste avant et celle
// que le nouveau clip demande, et on le fait décroître à zéro — en repartant de la VITESSE
// qu'avait le membre. Le raccord n'a donc ni saut de position ni cassure de vitesse, et rien
// n'est jamais affiché qui ne soit le nouveau clip plus un écart qui s'efface.
//
// Formulation de référence : Bollo, « Inertialization », GDC 2018.

/**
 * La durée réellement utilisée pour résorber un écart.
 *
 * Bornée quand l'écart se referme DÉJÀ vite tout seul : laisser courir toute la durée demandée
 * ferait dépasser la courbe, c'est-à-dire un membre qui va au-delà de la pose visée avant d'y
 * revenir. On le voit comme un petit rebond, et ça ressemble à un défaut de rig.
 */
export function durationInertia(x0, v0, t1){
  // `x0 > 0` est une condition d'EXISTENCE, pas une optimisation : l'écart s'applique le long
  // d'une direction obtenue en normalisant la différence des deux poses. Une différence nulle
  // n'a pas de direction, donc il n'y a rien à apply — même si les poses s'éloignent l'une
  // de l'autre à cet instant.
  if(!(t1 > 0) || !(x0 > 0)) return 0;
  // Uniquement quand l'écart se REFERME : s'il grandit encore, il n'y a rien à dépasser, et
  // raccourcir la durée ne ferait que rendre le raccord plus sec sans raison.
  if(v0 < 0) return Math.min(t1, -5 * x0 / v0);
  return t1;
}

/**
 * Le polynôme qui ramène l'écart `x0` à zéro en partant de la vitesse `v0`.
 *
 * Degré cinq, et pas moins : il faut poser SIX conditions. Au départ, l'écart et sa vitesse —
 * c'est là qu'est toute la continuité. À l'arrivée, l'écart, sa vitesse ET son accélération
 * nuls : sans la troisième, le mouvement s'arrêterait avec une secousse au moment précis où
 * l'on croit avoir fini.
 *
 * L'accélération de départ n'est pas libre non plus : la laisser à zéro rendrait la résorption
 * molle, l'écart traînerait à la moitié de sa valeur à mi-parcours. La valeur ci-dessous est
 * celle de la formulation de référence, et elle fait tomber l'écart à 19 % à mi-parcours.
 */
export function coefficientsInertia(x0, v0, t1){
  const d = durationInertia(x0, v0, t1);
  if(!(d > 0)) return null;
  const a0 = (-8 * v0 * d - 20 * x0) / (d * d);
  const d2 = d * d, d3 = d2 * d, d4 = d3 * d, d5 = d4 * d;
  return {
    duration: d,
    c5: -(a0 * d2 + 6 * v0 * d + 12 * x0) / (2 * d5),
    c4: (3 * a0 * d2 + 16 * v0 * d + 30 * x0) / (2 * d4),
    c3: -(3 * a0 * d2 + 12 * v0 * d + 20 * x0) / (2 * d3),
    c2: a0 / 2,
    c1: v0,
    c0: x0
  };
}

/** L'écart restant à l'instant `t`. Exactement zéro passé la durée, pas « presque ». */
export function evaluateInertia(c, t){
  if(!c || t >= c.duration) return 0;
  const u = t > 0 ? t : 0;
  return ((((c.c5 * u + c.c4) * u + c.c3) * u + c.c2) * u + c.c1) * u + c.c0;
}

export const _interpolantsByClip = new WeakMap();

/**
 * La pose qu'un clip donne à un nœud à l'instant `t`, lue DANS SES PISTES.
 *
 * Surtout pas en passant par le mixeur : `PropertyMixer.apply` de three n'écrit dans la scène
 * que si la valeur accumulée a CHANGÉ. Redemander la même pose au même instant ne réécrit donc
 * rien, et une différence calculée là-dessus vaut l'identité. Défaut déjà mesuré une fois dans
 * ce dépôt : une clé enregistrée à [0,0,0,1] au lieu des 30° demandés. On lit la source.
 *
 * Partagée : la timeline s'en sert pour traduire une clé, l'inertialisation pour connaître la
 * VITESSE du clip d'arrivée — sans elle, la vitesse de sortie du raccord vaudrait celle de la
 * cible PLUS celle de la source au lieu de la seule source.
 */
export function poseOfClipFor(clip, name, t){
  let byName = _interpolantsByClip.get(clip);
  if(!byName){ byName = {}; _interpolantsByClip.set(clip, byName); }
  if(!byName[name]){
    const ent = {};
    ['position', 'quaternion', 'scale'].forEach(function(prop){
      const track = (clip.tracks || []).find(function(x){ return x.name === name + '.' + prop; });
      ent[prop] = track ? track.createInterpolant() : null;
    });
    byName[name] = ent;
  }
  const e = byName[name];
  const u = Math.max(0, Math.min(clip.duration, t));
  const read = function(interp, n){
    return interp ? Array.prototype.slice.call(interp.evaluate(u), 0, n) : null;
  };
  return {pos: read(e.position, 3), quat: read(e.quaternion, 4), ech: read(e.scale, 3)};
}

export function readPointBlend(text){
  const s = String(text || '').trim();
  if(!s) return null;
  // Le DERNIER « = » sépare : un nom de clip exporté peut contenir à peu près n'importe quoi,
  // la valeur non.
  const k = s.lastIndexOf('=');
  if(k === -1) return null;
  const clip = s.slice(0, k).trim();
  // La virgule décimale est acceptée : « 1,5 » est ce qu'un francophone tape, et le refuser
  // silencieusement placerait le point à 0 — donc un mélange qui ne mélange pas.
  const v = Number(s.slice(k + 1).trim().replace(',', '.'));
  if(!clip || !Number.isFinite(v)) return null;
  return {clip: clip, value: v};
}

// ---------- Root motion : faire advance le personnage pour de bon ----------
//
// Sans elle, un personnage marche SUR PLACE. C'est le manque le plus criant pour un jeu.
//
// Le déplacement vit dans la piste de position de l'os racine. Mesuré sur un export Mixamo :
// 53 pistes, dont UNE SEULE de position — `mixamorigHips.position`. Tout est là.

/**
 * L'os dont la piste de position porte le déplacement.
 *
 * On prend la PREMIÈRE piste de position déclarée : dans un clip de locomotion il n'y en a
 * qu'une, et s'il y en avait plusieurs, la première est celle du bassin — les exportateurs
 * écrivent la hiérarchie de haut en bas.
 */
export function boneRootOfClip(clip){
  const p = ((clip && clip.tracks) || []).find(function(t){ return /\.position$/.test(t.name); });
  return p ? p.name.slice(0, p.name.lastIndexOf('.')) : null;
}

/**
 * Le déplacement de la racine entre deux instants du clip.
 *
 * `lire(t)` rend la position de l'os racine à l'instant `t`, sous forme `[x, y, z]`.
 *
 * LE PIÈGE, et il ne se voit qu'après quelques secondes de jeu : à la boucle, le bassin
 * REVIENT au début du clip. Une simple différence donnerait un écart énormément négatif sur
 * une seule image, et le personnage serait catapulté en arrière. On traite donc le bouclage
 * comme deux morceaux — la fin du cycle, puis le début du suivant —, exactement comme pour
 * les marqueurs d'animation.
 */
export function moveRoot(read, avant, apres, duration, loop){
  const zero = {x:0, y:0, z:0};
  if(typeof read !== 'function') return zero;
  const diff = function(b, a){
    if(!a || !b) return zero;
    return {x: b[0] - a[0], y: b[1] - a[1], z: b[2] - a[2]};
  };
  if(apres >= avant) return diff(read(apres), read(avant));
  // Le temps a reculé sans boucler : on a ramené la tête de lecture en arrière, ou l'action
  // s'est arrêtée. Rien n'a été PARCOURU — téléporter l'objet là-dessus serait absurde.
  if(!loop) return zero;
  const endOfCycle = diff(read(duration), read(avant));
  const startOfNext = diff(read(apres), read(0));
  return {x: endOfCycle.x + startOfNext.x,
          y: endOfCycle.y + startOfNext.y,
          z: endOfCycle.z + startOfNext.z};
}

/**
 * Le clip nommé par un état — le champ de REPLI, celui d'avant les assets d'animation.
 *
 * Ce que joue réellement un état passe par `settingsAnimFor` (js/anim-models.js), qui essaie
 * d'abord `etat.animation`. Cette fonction reste le seul accès au repli, et c'est par elle que
 * `test/animator.test.mjs` vérifie qu'une machine écrite à la main, sans aucun asset, joue.
 */
export function clipOfLState(machine, nameState){
  const e = ((machine && machine.states) || []).find(function(x){ return x.name === nameState; });
  return e ? (e.clip || null) : null;
}

export function stateOfMachine(machine, nameState){
  return ((machine && machine.states) || []).find(function(x){ return x.name === nameState; }) || null;
}

// ---------- Validation ----------

/**
 * Liste les problèmes d'une machine, en clair.
 *
 * C'est la pièce qui décide si un non-codeur s'en sort. Une machine fausse ne lève aucune
 * erreur : le personnage reste simplement figé dans un état, et rien à l'écran ne dit pourquoi.
 * Chaque problème est donc nommé avec ce qu'il faut corriger, et `clipsConnus` permet de
 * vérifier aussi que les clips cités existent VRAIMENT sur le modèle.
 */
export function validateAnimator(machine, clipsConnus, animsConnues){
  const p = [];
  if(!machine || typeof machine !== 'object') return ['Le fichier animator est vide ou illisible.'];
  const states = machine.states || [];
  if(!states.length) p.push('Aucun état : la machine n\'a rien à jouer.');

  const namesStates = new Set();
  states.forEach(function(e, i){
    if(!e || !e.name){ p.push('L\'état n°' + (i + 1) + ' n\'a pas de nom.'); return; }
    if(namesStates.has(e.name)) p.push('Deux états s\'appellent « ' + e.name + ' » : une transition '
      + 'vers ce nom serait ambiguë.');
    namesStates.add(e.name);
    if(isStateBlend(e)){
      const pts = e.blend.points || [];
      if(pts.length < 2) p.push('Le mélange de l\'état « ' + e.name + ' » n\'a qu\'un point : '
        + 'il ne mélange rien, autant mettre le clip directement.');
      const vues = new Set();
      pts.forEach(function(pt, j){
        if(!pt || (!pt.clip && !pt.animation)){ p.push('Le point n°' + (j + 1)
          + ' du mélange de l\'état « ' + e.name + ' » n\'a pas d\'animation.'); return; }
        if(pt.animation && animsConnues && animsConnues.indexOf(pt.animation) === -1){
          p.push('Le mélange de l\'état « ' + e.name + ' » utilise une animation qui n\'existe '
            + 'plus dans le projet.');
        }
        if(!pt.animation && clipsConnus && clipsConnus.indexOf(pt.clip) === -1){
          p.push('Le mélange de l\'état « ' + e.name + ' » utilise « ' + pt.clip
            + ' », qui n\'existe pas sur ce modèle.');
        }
        // Deux points à la même valeur : à cette valeur, un seul des deux reçoit du poids, et
        // LEQUEL dépend de sa place dans la liste — mesuré, le dernier gagne s'il est en bout,
        // le premier gagne au milieu. Rien à l'écran ne le dirait.
        const v = pt.value || 0;
        if(vues.has(v)) p.push('Deux points du mélange de l\'état « ' + e.name
          + ' » sont à la valeur ' + v + ' : à cette valeur, un seul des deux est joué, et '
          + 'lequel dépend de l\'ordre de saisie.');
        vues.add(v);
      });
    }
    else if(!e.animation && !e.clip){
      p.push('L\'état « ' + e.name + ' » ne joue aucune animation.');
    }
    else if(e.animation){
      if(animsConnues && animsConnues.indexOf(e.animation) === -1){
        p.push('L\'état « ' + e.name + ' » joue une animation qui n\'existe plus dans le projet.');
      }
    }
    else if(clipsConnus && clipsConnus.indexOf(e.clip) === -1){
      p.push('L\'état « ' + e.name + ' » joue « ' + e.clip + ' », qui n\'existe pas sur ce modèle.');
    }
    // Un état resté sur l'ancien nom de clip alors que le projet connaît des assets
    // d'animation : c'est le cas d'une machine partagée par DEUX modèles, que la migration
    // refuse de trancher. Ça joue encore, mais l'état ne profite ni de la vitesse, ni de la
    // loop, ni de la découpe — et rien d'autre ne le dirait.
    else if(animsConnues){
      p.push('L\'état « ' + e.name + ' » désigne encore son clip par son nom (« ' + e.clip
        + ' ») au lieu d\'un asset d\'animation. Cette machine sert à plusieurs modèles : '
        + 'affectez-lui une animation à la main.');
    }
  });

  if(machine.start && !namesStates.has(machine.start)){
    p.push('L\'état de départ « ' + machine.start + ' » n\'existe pas.');
  }
  if(!machine.start && states.length){
    p.push('Aucun état de départ : le premier état sera pris par défaut.');
  }

  const namesParams = new Set();
  (machine.params || []).forEach(function(d, i){
    if(!d || !d.name){ p.push('Le paramètre n°' + (i + 1) + ' n\'a pas de nom.'); return; }
    if(namesParams.has(d.name)) p.push('Deux paramètres s\'appellent « ' + d.name + ' ».');
    namesParams.add(d.name);
    if(d.type && ANIMATOR_TYPES_PARAM.indexOf(d.type) === -1){
      p.push('Le paramètre « ' + d.name + ' » a un type inconnu (« ' + d.type + ' »).');
    }
  });

  // Un mélange piloté par un paramètre qui n'existe pas se lit toujours 0 : le personnage reste
  // sur le premier clip, à jamais, sans erreur. Même faute de frappe que dans une condition,
  // même silence — donc même contrôle.
  states.forEach(function(e){
    if(!isStateBlend(e)) return;
    const par = e.blend.param;
    if(!par) p.push('Le mélange de l\'état « ' + e.name + ' » n\'est piloté par aucun paramètre.');
    else if(!namesParams.has(par)) p.push('Le mélange de l\'état « ' + e.name + ' » est piloté par '
      + '« ' + par + ' », qui n\'est pas un paramètre déclaré.');
  });

  (machine.transitions || []).forEach(function(t, i){
    const ou = 'La transition n°' + (i + 1);
    if(!t || !t.vers){ p.push(ou + ' ne mène nulle part.'); return; }
    if(t.de !== '*' && !namesStates.has(t.de)) p.push(ou + ' part de « ' + t.de + ' », qui n\'existe pas.');
    if(!namesStates.has(t.vers)) p.push(ou + ' mène à « ' + t.vers + ' », qui n\'existe pas.');
    (t.conditions || []).forEach(function(c){
      if(!c || !c.param){ p.push(ou + ' a une condition sans paramètre.'); return; }
      if(!namesParams.has(c.param)){
        p.push(ou + ' teste « ' + c.param + ' », qui n\'est pas un paramètre déclaré.');
      }
      if(ANIMATOR_OPERATORS.indexOf(c.operateur) === -1){
        p.push(ou + ' utilise un opérateur inconnu (« ' + c.operateur + ' »).');
      }
    });
  });

  // Un état sans aucune sortie n'est pas une erreur — un état final existe — mais c'est la
  // cause la plus fréquente d'un « mon personnage reste bloqué ». On le DIT, sans le refuser.
  const aOutput = new Set();
  (machine.transitions || []).forEach(function(t){
    if(!t) return;
    if(t.de === '*') namesStates.forEach(function(n){ if(n !== t.vers) aOutput.add(n); });
    else aOutput.add(t.de);
  });
  namesStates.forEach(function(n){
    if(!aOutput.has(n)) p.push('L\'état « ' + n + ' » n\'a aucune transition sortante : '
      + 'une fois dedans, le personnage y reste.');
  });
  return p;
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.ANIMATOR_INTERRUPTIONS = ANIMATOR_INTERRUPTIONS;
globalThis.ANIMATOR_TYPES_PARAM = ANIMATOR_TYPES_PARAM;
globalThis.OPERATORS_BY_TYPE = OPERATORS_BY_TYPE;
globalThis.boneRootOfClip = boneRootOfClip;
globalThis.coefficientsInertia = coefficientsInertia;
globalThis.createObjectAnimator = createObjectAnimator;
globalThis.createPlayerAnimator = createPlayerAnimator;
globalThis.durationTransition = durationTransition;
globalThis.evaluateInertia = evaluateInertia;
globalThis.isStateBlend = isStateBlend;
globalThis.moveRoot = moveRoot;
globalThis.moveTransition = moveTransition;
globalThis.offsetTransition = offsetTransition;
globalThis.poseOfClipFor = poseOfClipFor;
globalThis.readSettingParam = readSettingParam;
globalThis.setParamAnimator = setParamAnimator;
globalThis.speedsBlend = speedsBlend;
globalThis.stateOfMachine = stateOfMachine;
globalThis.updatePlayerAnimator = updatePlayerAnimator;
globalThis.validateAnimator = validateAnimator;
globalThis.weightBlend = weightBlend;