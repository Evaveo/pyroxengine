// ---------- Enregistrement incrémental : ne pas réécrire ce qui n'a pas bougé ----------
//
// `registerInProjectOpen` (js/serialization.js) reconstruit à chaque fois TOUS les fichiers
// texte du projet — un par script, matériau, profil, graphe, animator, clip, palette, document,
// feuille de style, table de contenu, plus un `.meta` par asset — et les réécrit tous, qu'ils
// aient changé ou non. Sur un projet de plusieurs centaines d'assets, l'essentiel du temps part
// donc dans des écritures rigoureusement identiques à ce qui est déjà sur le disque.
//
// Ce module tient l'empreinte du dernier contenu ÉCRIT par l'éditeur pour chaque chemin, et rend
// « à écrire / inchangé ». Ce n'est pas un cache de lecture : il ne prétend jamais savoir ce
// qu'il y a sur le disque, seulement ce que l'éditeur y a mis lui-même.
//
// LES TROIS FAÇONS DE MENTIR, et ce qui les empêche :
//
//   1. UN FICHIER MODIFIÉ HORS DE L'ÉDITEUR. Le disque ne correspond plus à l'empreinte, et
//      sauter l'écriture laisserait la version de l'utilisateur écraser... rien du tout, en
//      silence. La surveillance du dossier (js/folder-watch.js) appelle donc `invalidateWrite`
//      sur chaque chemin qu'elle voit changer ou disparaître.
//   2. UNE SURVEILLANCE ÉTEINTE. Sans elle, personne ne peut signaler (1). L'appelant vide alors
//      le cache avant d'enregistrer : pas de surveillance, pas d'incrémental. Le comportement
//      redevient exactement celui d'avant — lent, mais jamais faux.
//   3. UN AUTRE DOSSIER. Les empreintes appartiennent au dossier pour lequel elles ont été
//      prises : `resetWriteCache()` à chaque ouverture de projet.
//
// Aucun import : ce module est appelé par serialization.js ET par project.js, et il se charge
// dans un vm nu pour les tests.

/** chemin -> empreinte du dernier contenu écrit par l'éditeur. */
const written = new Map();

/**
 * Empreinte d'un contenu texte : longueur + FNV-1a 32 bits.
 *
 * Garder le contenu lui-même doublerait en mémoire tout le texte du projet pour ne rien
 * apporter : on ne relit jamais ces valeurs, on les compare. La longueur accompagne le hash
 * parce qu'elle est gratuite et qu'elle écarte l'immense majorité des collisions.
 */
export function fingerprintContent(content){
  const s = String(content);
  let h = 0x811c9dc5;
  for(let i = 0; i < s.length; i++){
    h ^= s.charCodeAt(i);
    // Le multiplicateur FNV en arithmétique 32 bits sûre : `h * 16777619` dépasse la précision
    // exacte des flottants et rendrait le hash dépendant de l'arrondi.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return s.length + ':' + h.toString(16);
}

/** `true` si ce contenu doit partir sur le disque (jamais écrit, ou différent du dernier). */
export function changedSinceWrite(filePath, content){
  return written.get(filePath) !== fingerprintContent(content);
}

/** À appeler APRÈS une écriture réussie — jamais avant : un échec doit rester « à écrire ». */
export function noteWritten(filePath, content){
  written.set(filePath, fingerprintContent(content));
}

/** Ce chemin a bougé hors de l'éditeur (ou a disparu) : la prochaine écriture repart. */
export function invalidateWrite(filePath){
  written.delete(filePath);
}

/** Tout repart de zéro : changement de dossier, surveillance éteinte, doute. */
export function resetWriteCache(){
  written.clear();
}

/** Le nombre d'empreintes tenues — pour les tests et le diagnostic, jamais pour décider. */
export function sizeWriteCache(){ return written.size; }
