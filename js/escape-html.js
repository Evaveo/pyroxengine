// ---------- Échapper du texte destiné à un innerHTML ----------
// IL EN EXISTAIT DEUX EXEMPLAIRES : js/objects.js et js/hub/hub-ui.js, écrits différemment
// (chaîne de `.replace` d'un côté, table de correspondance de l'autre) pour le même contrat.
// Deux exemplaires d'une même règle, c'est la garantie qu'un jour l'un recevra une correction
// et pas l'autre. Les deux les réexportent désormais d'ici, sans changer leur nom : aucun
// appelant n'a bougé.
//
// MODULE FEUILLE, SANS AUCUN IMPORT — c'est ce qui permet à js/conflict-screen.js de s'en
// servir sans tirer objects.js, donc THREE, donc l'éditeur entier, dans ses tests.

export function escapeHtml(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
