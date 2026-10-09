// ---------- Aide de l'éditeur : les briques de mise en forme ----------
// Partagées par toutes les parties (js/help/pages-*.js). Aucune ne touche au DOM : ce sont
// des fonctions qui rendent du texte HTML, chargeables dans le harnais node:vm des tests.

// Les PARTIES du manuel, dans l'ordre du sommaire — le plan du manuel Unity : on commence,
// on apprend l'interface, on suit un workflow, on consulte la fiche d'un composant, on
// écrit du code, on suit un tutoriel. Une page dont la `part` n'est pas ici est refusée
// par test/aide.test.mjs.
export const PARTS_HELP = [
  {id:'start',      title:'Prise en main',        icon:'🚀'},
  {id:'interface',  title:'Interface',            icon:'🧭'},
  {id:'workflows',  title:'Workflows',            icon:'🛠️'},
  {id:'components', title:'Composants',           icon:'🧩'},
  {id:'scripting',  title:'Scripts',              icon:'📜'},
  {id:'tutorials',  title:'Tutoriels',            icon:'🎓'},
  {id:'reference',  title:'Référence',            icon:'📚'}
];

// Niveau de lecture d'une page. « both » : l'essentiel pour débuter, puis des blocs
// « Avancé » repliés pour qui veut le détail.
export const LEVELS_HELP = {
  beginner: 'Débutant',
  advanced: 'Avancé',
  both: 'Tous niveaux'
};

// Un terme du glossaire, cité dans une page, devient un lien vers le glossaire.
export function termHelp(t){
  return '<a href="#glossary" class="help-term" data-term="' + t + '">' + t + '</a>';
}
export function linkHelp(id, caption){
  return '<a href="#' + id + '" class="help-link" data-help="' + id + '">' + caption + '</a>';
}
// Un tableau large doit défiler DANS son cadre, jamais faire défiler la page en travers.
export function arrayHelp(headers, lines){
  return '<div class="help-array"><table>'
    + (headers ? '<tr>' + headers.map(function(e){ return '<th>' + e + '</th>'; }).join('') + '</tr>' : '')
    + lines.map(function(l){
        return '<tr>' + l.map(function(c){ return '<td>' + c + '</td>'; }).join('') + '</tr>';
      }).join('')
    + '</table></div>';
}
export function defaultHelp(v){ return '<span class="help-default">' + v + '</span>'; }

// « L'essentiel » : le résumé en tête de page, ce qu'un débutant doit retenir s'il ne lit
// que ça.
export function essentialHelp(html){
  return '<div class="help-essential"><div class="help-essential-title">L\'essentiel</div>'
    + html + '</div>';
}

// Un bloc pour lecteur avancé : replié par défaut, il ne gêne pas la lecture débutante.
// C'est un vrai <details> : il s'ouvre sans script, et la recherche le trouve quand même.
export function advancedHelp(title, html){
  return '<details class="help-advanced"><summary><span class="help-badge help-badge-adv">Avancé</span> '
    + title + '</summary><div class="help-advanced-body">' + html + '</div></details>';
}

// Un piège : un défaut silencieux, qui ne lève aucune erreur et donne un résultat plausible.
export function trapHelp(html){ return '<div class="help-trap">' + html + '</div>'; }

// Une astuce, pour le débutant.
export function tipHelp(html){ return '<div class="help-tip">' + html + '</div>'; }

// Étapes numérotées d'un tutoriel ou d'un workflow.
export function stepsHelp(steps){
  return '<ol class="help-steps">' + steps.map(function(s){ return '<li>' + s + '</li>'; }).join('')
    + '</ol>';
}

// Fiche d'un composant : tableau de ses propriétés [nom affiché, clé, défaut, rôle].
export function propsHelp(lines){
  return arrayHelp(['Propriété', 'Clé', 'Défaut', 'Rôle'], lines.map(function(l){
    return ['<b>' + l[0] + '</b>', '<code>' + l[1] + '</code>', l[2] === '' ? '' : defaultHelp(l[2]), l[3]];
  }));
}

// Combien de balises <script> porte la page d'un jeu publié quand rien n'est retiré.
// Le chiffre est ici PARCE QU'IL N'A PAS D'ANCRE POSSIBLE : il ne se lit dans aucune ligne
// de code, il se compte sur le HTML engendré. test/aide-chiffres.test.mjs le recompte en
// appelant pageIndexBuild() pour de vrai.
export const TAGS_BUILD_FULL = 92;
