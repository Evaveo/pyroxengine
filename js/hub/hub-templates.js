// moteur/js/hub/hub-templates.js
// Le CATALOGUE de templates du Project Hub, et son seul point d'extension.
//
// Chargé par LES DEUX pages : hub.html (pour lister nom/description/vignette, avant même
// qu'un projet existe) et editor.html (pour appliquer le contenu réel une fois le projet
// ouvert). C'est pour ça que ce fichier ne dépend de RIEN — ni THREE, ni le DOM, ni les
// fonctions de scène (createSceneNode, createFromCreatable...) qui n'existent que côté éditeur.
//
// AJOUTER UN TEMPLATE NE TOUCHE JAMAIS CE FICHIER : un nouveau template s'enregistre lui-même
// avec `HubTemplates.register(...)`, et s'il a un contenu réel à poser dans la scène, un second
// fichier (chargé seulement par editor.html) lui attache son comportement avec
// `HubTemplates.attachApply(id, fn)`. Voir js/hub/template-fps.js pour le patron.
export const HubTemplates = (function(){
  const registre = new Map();

  // `applyInEditor` est volontairement absent ici : un template déclaré côté hub.html n'a pas
  // encore de comportement, seulement une carte à afficher. C'est attachApply qui le pose,
  // depuis un fichier que seul editor.html charge — la carte reste affichable (et son absence
  // de comportement affichée comme "Bientôt disponible") même si l'attachement n'a jamais lieu.
  function register(descriptor){
    if(!descriptor || !descriptor.id) throw new Error('Un template doit avoir un id.');
    if(registre.has(descriptor.id)) throw new Error('Template déjà enregistré : ' + descriptor.id);
    registre.set(descriptor.id, Object.assign({applyInEditor: null}, descriptor));
  }

  function attachApply(id, fn){
    const t = registre.get(id);
    if(!t) throw new Error('Template inconnu : ' + id);
    t.applyInEditor = fn;
  }

  function get(id){ return registre.get(id) || null; }

  function list(){ return Array.from(registre.values()); }

  return { register, attachApply, get, list };
})();

// ---------- Le catalogue de départ ----------
HubTemplates.register({
  id: 'empty',
  label: 'Vide',
  description: 'Un projet sans rien : à vous de tout poser.',
  thumbnail: null
});

HubTemplates.register({
  id: 'fps-basic',
  label: 'FPS — déplacement',
  description: 'Vue à la première personne : déplacement, saut, regard souris. Sans arme — un point de départ neutre pour n\'importe quel jeu à la première personne.',
  thumbnail: null
});

HubTemplates.register({
  id: 'platformer-2d',
  label: 'Plateforme 2D',
  description: 'Caméra 2D orthographique, tilemap de départ, cadrage automatique sur la largeur du niveau.',
  thumbnail: null
});

// Les comportements sont attachés depuis js/hub/template-*.js (chargés par editor.html
// seulement). Un template dont applyInEditor reste null s'affiche grisé « Bientôt disponible »
// — voir hub-ui.js.
HubTemplates.register({
  id: 'third-person',
  label: 'Troisième personne',
  description: 'Caméra d’épaule orbitale à la souris, déplacement, saut. Sans arme — voir js/hub/template-third-person.js.',
  thumbnail: null
});

HubTemplates.register({
  id: 'webxr-vr',
  label: 'WebXR / VR',
  description: 'Casque VR : XR Origin, manettes, téléportation, rotation par cran, cubes à saisir et lancer. Voir docs/WEBXR.md.',
  thumbnail: null
});
