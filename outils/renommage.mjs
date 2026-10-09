// moteur/outils/renommage.mjs
// Renommage d'identifiants conscient de la syntaxe JS, sans dépendance.
//
// Pourquoi pas un sed : `nom` est à la fois un identifiant du code, un mot des
// commentaires français, et un morceau de chaînes affichées à l'utilisateur. Les
// trois n'ont pas le même sort dans ce chantier (voir docs/superpowers/plans/
// 2026-08-13-naming-anglais-moteur.md).

// Un `/` ouvre une regex plutôt qu'une division si le dernier jeton significatif
// autorise un opérande à cette position.
const AVANT_REGEX = /[({[,;:!&|?+\-*%~^=<>]$|\b(return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)$/;

export function segmenter(code) {
  const segments = [];
  let debut = 0;
  let i = 0;
  const pousser = (type, fin) => {
    if (fin > debut) segments.push({ type, texte: code.slice(debut, fin) });
    debut = fin;
  };
  const finDeCode = () => { pousser('code', i); };

  while (i < code.length) {
    const c = code[i];
    const suivant = code[i + 1];

    if (c === '/' && suivant === '/') {
      finDeCode();
      while (i < code.length && code[i] !== '\n') i++;
      pousser('ligne', i);
      continue;
    }
    if (c === '/' && suivant === '*') {
      finDeCode();
      i += 2;
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i++;
      i = Math.min(i + 2, code.length);
      pousser('bloc', i);
      continue;
    }
    if (c === "'" || c === '"') {
      finDeCode();
      i++;
      while (i < code.length && code[i] !== c) { if (code[i] === '\\') i++; i++; }
      i++;
      pousser('chaine', i);
      continue;
    }
    if (c === '`') {
      finDeCode();
      i++;
      while (i < code.length && code[i] !== '`') { if (code[i] === '\\') i++; i++; }
      i++;
      pousser('gabarit', i);
      continue;
    }
    if (c === '/') {
      const avant = code.slice(debut, i).replace(/\s+$/, '');
      if (AVANT_REGEX.test(avant) || avant === '') {
        finDeCode();
        i++;
        let dansClasse = false;
        while (i < code.length) {
          if (code[i] === '\\') { i += 2; continue; }
          if (code[i] === '[') dansClasse = true;
          else if (code[i] === ']') dansClasse = false;
          else if (code[i] === '/' && !dansClasse) break;
          else if (code[i] === '\n') break;
          i++;
        }
        i++;
        while (i < code.length && /[a-z]/.test(code[i])) i++;   // drapeaux
        pousser('regex', i);
        continue;
      }
    }
    i++;
  }
  finDeCode();
  return segments;
}

// Les identifiants JS peuvent contenir $ et _ ; on borne donc sur [A-Za-z0-9_$]
// plutôt que sur \b, qui laisserait passer `a$nom`. Les clés à tiret (ids DOM)
// passent par la même fonction : le tiret n'est pas un caractère d'identifiant,
// la bordure fonctionne aussi pour elles.
//
// Remplacement en une seule passe (regex alternée, plus long d'abord) plutôt
// qu'une boucle de .replace() successifs : une boucle séquentielle re-scanne le
// texte déjà substitué à chaque symbole, donc une valeur cible qui coïnciderait
// avec une clé source pas encore traitée serait re-renommée dans la même passe
// (cascade). Une seule regex qui matche toutes les clés à la fois élimine ce
// risque : chaque occurrence n'est capturée qu'une fois.
function motifTable(noms) {
  const alternatives = noms.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp('(^|[^A-Za-z0-9_$])(' + alternatives + ')(?![A-Za-z0-9_$])', 'g');
}

const SEGMENTS_COMMENTAIRE = new Set(['ligne', 'bloc']);
const SEGMENTS_CHAINE = new Set(['chaine', 'gabarit']);

export function renommer(code, table, options) {
  const opts = options || {};
  const comptes = {};
  const noms = Object.keys(table).sort((a, b) => b.length - a.length);   // plus long d'abord
  if (noms.length === 0) return opts.compter ? { resultat: code, comptes: comptes } : code;
  const motif = motifTable(noms);

  const sortie = segmenter(code).map((segment) => {
    if (segment.type === 'regex') return segment.texte;
    if (SEGMENTS_COMMENTAIRE.has(segment.type) && !opts.commentaires) return segment.texte;
    if (SEGMENTS_CHAINE.has(segment.type) && !opts.chaines) return segment.texte;
    return segment.texte.replace(motif, (tout, avant, trouve) => {
      comptes[trouve] = (comptes[trouve] || 0) + 1;
      return avant + table[trouve];
    });
  }).join('');

  return opts.compter ? { resultat: sortie, comptes: comptes } : sortie;
}
