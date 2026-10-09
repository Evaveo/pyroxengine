// ---------- Les ICÔNES : un seul endroit qui sait comment on écrit un glyphe ----------
//
// L'interface écrivait ses icônes en clair, dans le markup : `＋ Importer`, `⏮`, `🔎 Filtrer`,
// `✥ Déplacer`. Trois problèmes, tous mesurés :
//
//  · un emoji n'a pas la même largeur ni la même ligne de base d'une plateforme à l'autre —
//    l'alignement d'une barre d'outils dépendait de la police système de l'utilisateur ;
//  · il ne prend pas `currentColor`, donc il ignore l'accent, l'état désactivé et le thème ;
//  · il n'est cherchable qu'au caractère : personne ne peut lister les icônes de l'éditeur.
//
// Ce module remplace ça par la fonte Phosphor vendorée (`vendor/phosphor/`). Il ne dessine
// rien lui-même : il construit la SEULE forme de markup autorisée, pour que le jour où la
// fonte change, un seul fichier soit à relire.
//
// ACCESSIBILITÉ. Une icône est décorative par défaut (`aria-hidden`) : à côté d'un libellé
// texte, la lire une seconde fois est du bruit. Dès qu'on passe un `title`, elle devient
// porteuse de sens et reçoit `role="img"` — c'est le cas des boutons sans libellé.
export const Icons = (function(){

  // Les deux graisses vendorées, et la classe que chacune porte dans phosphor.css.
  const WEIGHTS = {regular: 'ph', fill: 'ph-fill'};

  // Le nom d'une icône Phosphor : minuscules, chiffres et tirets. La garde n'est pas
  // cosmétique — le nom part dans une classe CSS et dans du HTML, et un nom fantaisiste
  // rendrait un carré vide sans que rien ne le signale.
  const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  function check(name, weight){
    if(typeof name !== 'string' || !NAME.test(name)){
      throw new Error('nom d\'icône invalide : ' + String(name));
    }
    if(!Object.prototype.hasOwnProperty.call(WEIGHTS, weight)){
      throw new Error('graisse d\'icône inconnue : ' + String(weight));
    }
  }

  // La liste de classes d'une icône. Exposée seule parce qu'un appelant a parfois déjà son
  // `<i>` (un bouton existant, un nœud d'arbre recyclé) et ne veut que reclasser.
  function className(name, opts){
    const o = opts || {};
    const weight = o.weight || 'regular';
    check(name, weight);
    // La famille vient de `ph` ou `ph-fill`, le glyphe de `ph-<nom>` : il faut les DEUX.
    const list = [WEIGHTS[weight], 'ph-' + name];
    if(o.className) list.push(o.className);
    return list.join(' ');
  }

  function escape(text){
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Le markup, en chaîne. La moitié de l'interface se construit par `innerHTML` : lui rendre
  // un élément DOM l'obligerait à un aller-retour inutile.
  function html(name, opts){
    const o = opts || {};
    const cls = className(name, o);
    const style = o.size ? ' style="font-size:' + escape(o.size) + '"' : '';
    const label = o.title
      ? ' role="img" aria-label="' + escape(o.title) + '" title="' + escape(o.title) + '"'
      : ' aria-hidden="true"';
    return '<i class="' + escape(cls) + '"' + label + style + '></i>';
  }

  // Le même, en élément. Pour les appelants qui construisent le DOM nœud par nœud (le dock,
  // l'arbre de hiérarchie) et qui n'ont pas de conteneur où poser du HTML.
  function el(name, opts){
    const o = opts || {};
    const node = document.createElement('i');
    node.className = className(name, o);
    if(o.title){
      node.setAttribute('role', 'img');
      node.setAttribute('aria-label', o.title);
      node.title = o.title;
    } else {
      node.setAttribute('aria-hidden', 'true');
    }
    if(o.size) node.style.fontSize = o.size;
    return node;
  }

  return {html: html, el: el, className: className, WEIGHTS: WEIGHTS};
})();

if (typeof globalThis !== 'undefined') globalThis.Icons = Icons;
