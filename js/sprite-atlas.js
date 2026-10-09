// ---------- Assembler PLUSIEURS planches en une seule ----------
//
// Le manque que ce fichier comble : un `SpriteAnimator` lit toutes ses suites dans UN SEUL asset de
// sprite. Un personnage livré en neuf planches — repos, marche, course, saut, chute, atterrissage,
// coup, dégât, mort — ne peut donc pas être animé du tout, quoi qu'on fasse dans l'inspecteur. Ce
// n'est pas une limite du format, c'est une étape qui manquait : celle qui range les neuf planches
// dans une seule texture et garde la trace de qui est où.
//
// Mesuré sur un vrai game : dix-huit planches pour un personnage, et il a fallu un script hors de
// l'éditeur pour les composer. L'éditeur savait tout faire du jeu sauf ça.
//
// PUR : ni three, ni DOM, ni canvas. Le rangement est un calcul de rectangles ; le dessin est
// ailleurs. C'est ce qui permet de vérifier qu'aucune image ne se chevauche — sur des centaines de
// cas — sans jamais ouvrir de navigateur.

import { inputs } from './editor-input.js';

/** La plus petite puissance de deux ≥ n. Les textures y gagnent en compatibilité et en mipmaps. */
export function powerOfTwo(n){
  let p = 1;
  while(p < n) p *= 2;
  return p;
}

/**
 * Range des rectangles dans un atlas, en étagères.
 *
 * `inputs` : `[{key, l, h}]` en pixels. `marge` : pixels de garde AUTOUR de chaque image.
 *
 * La marge n'est pas de la prudence. Deux images collées se touchent au texel près, et dès qu'un
 * filtrage lisse ou qu'un mipmap entre en game, l'échantillonneur va chercher le texel voisin — donc
 * un liseré de l'image d'à côté sur le bord du sprite. Une marge d'un pixel suffit, et elle ne se
 * remarque pas dans la taille finale.
 *
 * Le tri est par HAUTEUR DÉCROISSANTE puis largeur : c'est ce qui rend un rangement en étagères
 * proche de l'optimal, et surtout DÉTERMINISTE. Un rangement qui change d'un import à l'autre
 * rendrait toute comparaison de deux atlas impossible, et les régions enregistrées d'une scène
 * pointeraient à côté au réimport.
 *
 * Rend `{l, h, cases: [{key, x, y, l, h}]}`. Rend `null` si rien à ranger.
 */
export function planeAtlas(inputs, marge){
  const m = Math.max(0, Math.round(Number(marge) === undefined ? 1 : Number(marge) || 0));
  const boites = (inputs || [])
    .filter(function(e){ return e && Number(e.l) > 0 && Number(e.h) > 0; })
    .map(function(e){ return {key: e.key, l: Math.round(e.l), h: Math.round(e.h)}; });
  if(!boites.length) return null;

  // Le tri travaille sur une COPIE : trier la liste de l'appelant changerait l'ordre de ses régions,
  // et l'ordre des régions est ce qui donne son numéro à chaque image d'une suite.
  const order = boites.slice().sort(function(a, b){
    if(b.h !== a.h) return b.h - a.h;
    if(b.l !== a.l) return b.l - a.l;
    return String(a.key) < String(b.key) ? -1 : 1;   // départage stable : deux tailles égales
  });

  /** Le rangement en étagères pour une largeur donnée, ou `null` si une image n'y rentre pas. */
  const layoutIn = function(L){
    const cases = [];
    let x = 0, y = 0, heightEtagere = 0;
    for(let i = 0; i < order.length; i++){
      const b = order[i];
      const bl = b.l + 2 * m, bh = b.h + 2 * m;
      // Précondition, pas une branche : la boucle d'appel part de la largeur de la plus large image,
      // donc ce cas ne peut pas se produire par ce chemin. On le garde parce que `rangerEn` est une
      // fonction, et qu'une fonction dont la précondition n'est pas vérifiée range une image hors de
      // l'atlas — elle serait coupée, ce qui se lit comme un sprite tronqué.
      if(bl > L) return null;
      if(x + bl > L){ x = 0; y += heightEtagere; heightEtagere = 0; }
      cases.push({key: b.key, x: x + m, y: y + m, l: b.l, h: b.h});
      x += bl;
      if(bh > heightEtagere) heightEtagere = bh;
    }
    return {l: L, h: powerOfTwo(y + heightEtagere), cases: cases};
  };

  // TOUTES LES LARGEURS SONT ESSAYÉES, et on garde la plus petite AIRE.
  //
  // Une seule largeur choisie « au jugé » — la racine de l'aire totale, pour viser un carré — gâche
  // beaucoup dès que les images ne sont pas à peu près carrées. Mesuré : douze colonnes de 16 × 512
  // donnaient un atlas de 512 × 1024, soit 5,3 fois l'aire utile, parce que la largeur visait un
  // carré que douze colonnes fines ne remplissent jamais. Essayer les puissances de deux coûte une
  // dizaine de rangements — quelques microsecondes — et divise le gâchis par deux.
  // 16 384 px de côté : au-delà, aucune map graphique courante n'accepte la texture. La clamped de
  // la boucle suffit à le garantir — une image plus large que ça fait démarrer la boucle au-dessus de
  // la clamped, donc aucun rangement n'est produit et `null` est rendu. Un contrôle explicite avant la
  // loop aurait été du code mort : la mutation qui le retirait ne changeait RIEN, et c'est ainsi
  // qu'on l'a su.
  const plusLarge = order.reduce(function(x, b){ return Math.max(x, b.l + 2 * m); }, 1);
  let meilleur = null;
  for(let L = powerOfTwo(plusLarge); L <= 16384; L *= 2){
    const p = layoutIn(L);
    if(!p) continue;
    // À area ÉGALE, on garde la plus CARRÉE. L'arrondi aux puissances de deux fait qu'il y a
    // souvent plusieurs largeurs de même area : douze images de 32 × 32 donnent 32 768 px en
    // 64 × 512 comme en 256 × 128. Les deux marchent, mais un atlas très étiré se relit mal quand
    // l'auteur l'ouvre pour vérifier son travail — et c'est exactement pour ça qu'il l'ouvre.
    const mieux = !meilleur
      || (p.l * p.h) < (meilleur.l * meilleur.h)
      || ((p.l * p.h) === (meilleur.l * meilleur.h)
          && Math.abs(p.l - p.h) < Math.abs(meilleur.l - meilleur.h));
    if(mieux) meilleur = p;
    // Une largeur plus grande que la somme de toutes les images ne rangera jamais mieux : tout tient
    // déjà sur une seule étagère.
    if(L >= order.reduce(function(s, b){ return s + b.l + 2 * m; }, 0)) break;
  }
  return meilleur;
}

/**
 * Des noms UNIQUES pour les régions d'un atlas.
 *
 * Deux planches contiennent presque toujours une région du même nom — « image », ou « 1 ». Sans
 * préfixe, la seconde écraserait la première et une suite d'animation jouerait les images d'un autre
 * état sans qu'aucune erreur ne soit levée : le personnage marcherait en jouant sa mort.
 *
 * `inputs` : `[{planche, region}]`. Rend la liste des noms, dans le même ordre.
 */
export function namesRegionsAtlas(inputs){
  const vus = Object.create(null);
  return (inputs || []).map(function(e){
    const base = String((e && e.sheet) || 'sheet') + '/' + String((e && e.region) || 'image');
    if(vus[base] === undefined){ vus[base] = 1; return base; }
    // Même préfixe ET même nom de région : on numérote, plutôt que d'écraser en silence.
    vus[base] += 1;
    return base + '#' + vus[base];
  });
}

/**
 * Les problèmes d'un assemblage, en clair, AVANT de dessiner quoi que ce soit.
 *
 * `sources` : `[{name, ppu, regions, textureId}]`, les assets de sprite à assembler.
 */
export function validateAtlas(sources){
  const p = [];
  const l = sources || [];
  if(l.length < 2){
    p.push('Il faut au moins deux planches à assembler.');
    return p;
  }
  const withoutRegion = l.filter(function(a){ return !a || !a.regions || !a.regions.length; });
  if(withoutRegion.length){
    p.push(withoutRegion.length + ' planche(s) sans aucune image découpée : découpez-les d\'abord '
      + '(inspecteur de la planche), sinon elles n\'apporteraient rien à l\'atlas.');
  }
  const withoutTexture = l.filter(function(a){ return a && !a.textureId; });
  if(withoutTexture.length) p.push(withoutTexture.length + ' planche(s) sans image source.');

  // LES PPU DOIVENT ÊTRE ÉGAUX. C'est le contrôle qui compte : le ppu dit combien de pixels d'art
  // valent une unité du monde, et l'atlas n'en porte qu'un. Mélanger du 16 et du 48 donnerait un
  // personnage trois fois trop grand selon l'état joué — une animation qui « saute d'échelle », ce
  // qu'on attribuerait au sprite plutôt qu'à l'import.
  const ppus = [];
  l.forEach(function(a){
    const v = Number(a && a.ppu) || 0;
    if(v > 0 && ppus.indexOf(v) === -1) ppus.push(v);
  });
  if(ppus.length > 1){
    p.push('Les planches n\'ont pas le même nombre de pixels par unité (' + ppus.sort(function(x, y){ return x - y; }).join(', ')
      + '). Un atlas n\'en porte qu\'un : les images ne seraient pas à la même échelle. '
      + 'Alignez-les avant d\'assembler.');
  }
  return p;
}

/**
 * Le plan complet d'un atlas à partir d'assets de sprite : où va chaque région, et sous quel nom.
 *
 * Rend `{l, h, ppu, regions: [{name, x, y, l, h, source, sourceRegion}]}` — `regions` est
 * directement la forme d'un asset de sprite, et `source`/`sourceRegion` disent quoi dessiner où.
 *
 * L'ORDRE DES RÉGIONS SUIT LES SOURCES, pas le rangement. Le rangement trie par hauteur pour
 * gâcher moins de place ; les régions, elles, gardent l'ordre des planches et l'ordre de découpe à
 * l'intérieur de chacune — parce que c'est cet ordre qui donne son numéro à chaque image d'une
 * suite. Les mélanger jouerait les animations dans le désordre.
 */
export function planeAtlasFromSprites(sources, marge){
  const l = sources || [];
  if(l.length < 1) return null;
  const inputs = [];
  l.forEach(function(a){
    (a.regions || []).forEach(function(r){
      inputs.push({sheet: a.name, region: r.name, source: a, sourceRegion: r, l: r.l, h: r.h});
    });
  });
  if(!inputs.length) return null;
  const names = namesRegionsAtlas(inputs);
  const plan = planeAtlas(inputs.map(function(e, i){ return {key: names[i], l: e.l, h: e.h}; }), marge);
  if(!plan) return null;
  const byKey = Object.create(null);
  plan.cases.forEach(function(c){ byKey[c.key] = c; });
  const regions = inputs.map(function(e, i){
    const c = byKey[names[i]];
    return {name: names[i], x: c.x, y: c.y, l: c.l, h: c.h,
            source: e.source, sourceRegion: e.sourceRegion};
  });
  const ppu = Number(l[0] && l[0].ppu) || 16;
  return {l: plan.l, h: plan.h, ppu: ppu, regions: regions};
}
