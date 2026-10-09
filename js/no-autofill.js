// Empêche le gestionnaire de mots de passe du navigateur de remplir les champs du moteur.
// Une fois le compte cloud enregistré, Chrome prend tout champ texte voisin d'un champ
// mot de passe (clé API du copilote, jeton Blender…) pour un identifiant et y colle le
// pseudo. autocomplete="off" seul est ignoré pour les heuristiques de connexion :
// "new-password" sur les champs secrets coupe la détection du formulaire de login.
function disableAutofill(root) {
  const fields = root.querySelectorAll ? root.querySelectorAll('input, textarea') : [];
  for (const el of fields) {
    if (el.dataset.autofillGuard) continue;
    el.dataset.autofillGuard = '1';
    if (el.type === 'password') el.setAttribute('autocomplete', 'new-password');
    else if (!el.hasAttribute('autocomplete')) el.setAttribute('autocomplete', 'off');
  }
}

function start() {
  disableAutofill(document);
  new MutationObserver(records => {
    for (const r of records) for (const n of r.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.matches('input, textarea')) disableAutofill(n.parentNode || n);
      else disableAutofill(n);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
