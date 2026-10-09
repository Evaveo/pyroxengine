// ---------- Couche PURE du formulaire ----------
// Descripteur + cibles → plan de rendu et écritures. AUCUN DOM, aucune globale d'éditeur.
// C'est ce qui rend le socle mesurable sous node:vm sans navigateur (spec §11.1) : la
// couche DOM (js/ui/form.js) ne fait qu'appliquer ce que ce fichier a calculé.

import { logConsole } from '../console.js';
import { field } from '../shader-graph-editor.js';

/** Lit `path` sur `target`. Un chemin absent rend `undefined` sans lever. */
export function resolvePath(target, path){
  if(target === null || target === undefined || !path) return undefined;
  const parts = String(path).split('.');
  let cur = target;
  for(let i = 0; i < parts.length; i++){
    if(cur === null || cur === undefined) return undefined;
    cur = cur[parts[i]];
  }
  return cur;
}

/**
 * Écrit `value` à `path` sur `target`. Rend `false` si un maillon intermédiaire manque.
 *
 * On REFUSE de créer les objets intermédiaires : une faute de frappe dans un `key` doit
 * échouer visiblement, pas faire pousser une branche fantôme dans la donnée du projet —
 * qui serait ensuite sérialisée, migrée, et impossible à distinguer d'un vrai champ.
 */
export function writePath(target, path, value){
  if(target === null || target === undefined || !path) return false;
  const parts = String(path).split('.');
  let cur = target;
  for(let i = 0; i < parts.length - 1; i++){
    const k = parts[i];
    if(cur[k] === null || typeof cur[k] !== 'object') return false;
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = value;
  return true;
}

// Sentinelle de divergence : les cibles ne s'accordent pas sur la valeur. Ce n'est ni
// `null` ni `undefined`, qui sont des valeurs légitimes.
export const FIELD_MIXED = ' mixed';

/**
 * État d'un champ pour UNE cible : `{visible, enabled, reason}`.
 *
 * Deux vocabulaires cohabitent volontairement :
 *   · `requires` + `ifMissing` — celui de material-props.js, déjà en service ;
 *   · `visible(t)` / `enabled(t)` + `disabledReason` — les prédicats du socle.
 * Le premier est évalué d'abord : c'est lui qui porte la raison la plus précise.
 */
export function stateField(field, target){
  let visible = true, enabled = true, reason = null;
  if(field.requires && field.requires.length){
    const satisfied = field.requires.some(function(k){ return !!resolvePath(target, k); });
    if(!satisfied){
      reason = 'demande ' + field.requires.join(' ou ');
      enabled = false;
      visible = (field.ifMissing !== 'hidden');
    }
  }
  if(visible && typeof field.visible === 'function') visible = !!field.visible(target);
  if(enabled && typeof field.enabled === 'function'){
    enabled = !!field.enabled(target);
    if(!enabled && !reason) reason = field.disabledReason || null;
  }
  return {visible: visible, enabled: enabled, reason: reason};
}

/** Lit la valeur d'un champ sur une cible : accesseur `get` s'il existe, sinon le chemin. */
export function readField(field, target){
  if(typeof field.get === 'function') return field.get(target);
  return resolvePath(target, field.key);
}

export function sameFieldValue(a, b){
  if(a === b) return true;
  if(Array.isArray(a) && Array.isArray(b)){
    return a.length === b.length && a.every(function(v, i){ return sameFieldValue(v, b[i]); });
  }
  return false;
}

/** Valeur d'un champ sur N cibles : la valeur si toutes s'accordent, `FIELD_MIXED` sinon. */
export function valueAcrossTargets(field, targets){
  if(!targets.length) return undefined;
  const first = readField(field, targets[0]);
  for(let i = 1; i < targets.length; i++){
    if(!sameFieldValue(first, readField(field, targets[i]))) return FIELD_MIXED;
  }
  return first;
}

export function idOfField(field, sectionId, index){
  if(field.ids) return field.ids.slice();
  // `id` peut porter DEUX identifiants : material-props.js écrit `id:['ip-mtx','ip-mty']`
  // pour un champ composé (tuilage X/Y). Les envelopper une fois de plus perdrait le second.
  if(field.id) return Array.isArray(field.id) ? field.id.slice() : [field.id];
  const base = field.key ? String(field.key).replace(/\./g, '-') : (sectionId + '-' + index);
  return ['f-' + base];
}

/**
 * Descripteur + cibles → plan de rendu.
 *
 * Le plan porte une `shape` : une empreinte de ce qui est AFFICHÉ (entrées, ids, états),
 * pas des valeurs. La couche DOM ne reconstruit que quand la `shape` change — c'est ce qui
 * évite de détruire l'élément qu'on est en train d'éditer à chaque frappe.
 */
/**
 * Une entrée de champ, d'action ou d'info : le fragment que `planForm` compose, extrait ici
 * parce que les LIGNES D'UNE LISTE en ont besoin exactement de la même façon. Un second
 * chemin de composition pour les sous-champs divergerait au premier ajout de contrat.
 *
 * Rend `{entry, shape}` — ou `null` quand le champ est masqué.
 */
/**
 * Une entrée de LISTE : une ligne par élément, chacune avec ses propres sous-champs.
 *
 * Une liste est TOUJOURS mono-cible : deux objets n'ont pas « la même » troisième condition, et
 * écrire en éventail sur des lignes qui ne se correspondent pas détruirait la donnée sans rien
 * dire.
 *
 * Une ligne peut elle-même porter une liste — les ACTIONS d'un événement, par exemple. C'est
 * pour ça que la planification passe par `planFieldEntry`, qui sait retomber ici.
 */
export function planListEntry(field, ref, sectionId, fi, multi){
  const items = (typeof field.items === 'function' ? field.items(ref) : []) || [];
  const shape = [];
  const rows = items.map(function(item, i){
    const subs = (typeof field.fields === 'function' ? field.fields(item, i, ref) : []) || [];
    const rowEntries = [];
    subs.forEach(function(sub, si2){
      const made = planFieldEntry(sub, item, sectionId + '-' + fi + '-' + i, si2, [item], false);
      if(made) rowEntries.push(made.entry);
    });
    return {index: i, item: item, entries: rowEntries};
  });
  shape.push('list:' + sectionId + ':' + fi + ':' + rows.map(function(r){
    return r.entries.map(function(e){
      // Le TYPE de chaque sous-champ entre dans la signature ; une liste imbriquée y met en
      // plus son nombre de lignes, sinon ajouter une action ne construirait rien.
      return e.kind === 'list' ? ('list' + e.rows.length) : e.type;
    }).join('-');
  }).join('|'));
  return {shape: shape, entry: {kind: 'list', ids: idOfField(field, sectionId, fi),
          label: field.label || '', rows: rows, addLabel: field.addLabel || '＋',
          onAdd: field.onAdd, onRemove: field.onRemove,
          enabled: !multi, reason: multi ? 'un seul objet à la fois' : null}};
}

export function planFieldEntry(field, ref, sectionId, fi, targets, multi){
  // Une liste imbriquée dans une ligne : même planification, cible = l'élément de la ligne.
  if(field.type === 'list') return planListEntry(field, ref, sectionId, fi, multi);
  const st = stateField(field, ref);
  if(!st.visible) return null;
  let enabled = st.enabled, reason = st.reason;
  // Un champ sans sens en multi-sélection reste VISIBLE et dit pourquoi il est inerte :
  // le masquer ferait croire qu'il n'existe pas.
  if(multi && field.multi === false){
    enabled = false;
    reason = 'un seul objet à la fois';
  }
  const shape = [];
  if(field.type === 'action'){
    shape.push('act:' + sectionId + ':' + fi + ':' + (enabled ? '1' : '0'));
    // `icon` transporte un NOM d'icône, pas du markup : cette couche est pure et ne construit
    // aucun DOM. C'est form.js qui en fait un élément — un `<i>` écrit ici finirait affiché en
    // toutes lettres, le libellé étant posé par texte et non par HTML.
    return {shape: shape, entry: {kind: 'action', label: field.label || '', enabled: enabled,
            reason: reason, run: field.run, icon: field.icon,
            ids: idOfField(field, sectionId, fi)}};
  }
  // Un champ `info` porte une valeur CALCULÉE, jamais saisie. Il est inerte par nature, et
  // sans `reason` : un « pourquoi c'est grisé » ferait chercher un réglage qui n'existe pas.
  if(field.type === 'info') enabled = false;
  // Les options peuvent dépendre de la cible (les calques du projet, les clips d'un modèle).
  const options = (typeof field.options === 'function') ? field.options(ref)
                : (field.options || null);
  const value = valueAcrossTargets(field, targets);
  shape.push('f:' + sectionId + ':' + fi + ':' + (field.type || 'text') + ':' + (enabled ? '1' : '0'));
  // Les options, elles, SONT une forme : un <select> ne se remplit qu'à la construction.
  if(options) shape.push('opt:' + options.map(function(o){ return o[0]; }).join(','));
  return {shape: shape, entry: {kind: 'field', field: field, ids: idOfField(field, sectionId, fi),
          type: field.type || 'text', label: field.label || '', help: field.help || null,
          cssClass: field.cssClass || null, placeholder: field.placeholder || null,
          rows: field.rows,
          options: options, min: field.min, max: field.max, step: field.step,
          value: value, mixed: value === FIELD_MIXED,
          enabled: enabled, reason: reason}};
}

/**
 * Descripteur + cibles → plan de rendu.
 *
 * Le plan porte une `shape` : une empreinte de ce qui est AFFICHÉ (entrées, ids, états),
 * pas des valeurs. La couche DOM ne reconstruit que quand la `shape` change — c'est ce qui
 * évite de détruire l'élément qu'on est en train d'éditer à chaque frappe.
 */
export function planForm(descriptor, targets){
  const list = targets || [];
  const multi = list.length > 1;
  const ref = list[0] || null;
  const shape = [];
  // `sections` peut être une FONCTION de la cible : les champs d'un script sont ses variables
  // `@expose`, et on ne les connaît qu'en regardant l'instance. Une liste figée ne saurait pas
  // les exprimer, et c'est le dernier endroit du contrat où il fallait une échappatoire.
  const declared = (typeof descriptor.sections === 'function')
    ? (descriptor.sections(ref) || [])
    : (descriptor.sections || []);
  const sections = declared.map(function(section, si){
    const sectionId = section.id || ('s' + si);
    const entries = [];
    (section.fields || []).forEach(function(field, fi){
      if(field.section){
        entries.push({kind: 'subsection', title: field.section});
        shape.push('sub:' + field.section);
        return;
      }
      if(!ref) return;
      if(field.type === 'note'){
        if(typeof field.when === 'function' && !field.when(ref)) return;
        // Le texte d'une note est une VALEUR, pas une forme : un texte calculé est permis, mais
        // il n'entre PAS dans la signature ci-dessous. L'y mettre reconstruirait la section à
        // chaque changement de compteur — et couperait la saisie du champ d'à côté.
        const noteText = (typeof field.text === 'function') ? field.text(ref)
                       : (field.text || field.note || '');
        entries.push({kind: 'note', text: noteText});
        shape.push('note:' + sectionId + ':' + fi);
        return;
      }
      if(field.type === 'list'){
        const made = planListEntry(field, ref, sectionId, fi, multi);
        entries.push(made.entry);
        made.shape.forEach(function(x){ shape.push(x); });
        return;
      }
      const made = planFieldEntry(field, ref, sectionId, fi, list, multi);
      if(!made) return;
      entries.push(made.entry);
      made.shape.forEach(function(x){ shape.push(x); });
    });
    shape.push('/' + sectionId);
    return {id: sectionId, title: section.title || '', collapsed: !!section.collapsed,
            // `layout: 'inline'` met les champs de la section sur UNE ligne — c'est la forme
            // qu'avaient Nom/Tag/Calque avant la migration, et elle a une raison : ce sont les
            // trois identifiants d'un objet, pas trois réglages.
            layout: section.layout || null, entries: entries};
  });
  return {sections: sections, empty: !list.length, multi: multi,
          shape: shape.join('|')};
}

/**
 * Écrit `value` sur TOUTES les cibles. Rend `{written, failed, reason}`.
 *
 * L'écriture en éventail est ici, dans la couche pure, et nulle part ailleurs : c'est ce qui
 * fait qu'un champ n'a RIEN à coder pour la multi-sélection. L'instantané d'historique, lui,
 * est posé par l'appelant (js/ui/form.js) — une seule fois pour l'ensemble des cibles.
 */
export function writeField(field, targets, value){
  const list = targets || [];
  if(list.length > 1 && field.multi === false){
    return {written: 0, failed: 0, reason: 'un seul objet à la fois'};
  }
  let written = 0, failed = 0, reason = null;
  list.forEach(function(target){
    if(typeof field.set === 'function'){
      // Un accesseur qui LÈVE ne doit pas emporter le formulaire avec lui. Sans ce filet,
      // l'exception remontait dans l'écouteur du champ : le reste de la saisie (dont le
      // recalcul de forme qui fait apparaître les champs dépendants) ne s'exécutait jamais,
      // et le panneau semblait simplement ignorer le réglage — sans rien dire.
      try {
        field.set(target, value);
        written += 1;
      } catch(e){
        failed += 1;
        reason = (e && e.message) ? e.message : String(e);
        if(typeof logConsole === 'function'){
          logConsole('champ « ' + (field.label || (field.ids && field.ids[0]) || field.key)
            + ' » : ' + reason, 'error');
        } else if(typeof console !== 'undefined'){
          console.error('champ', field.label, e);
        }
      }
      return;
    }
    if(writePath(target, field.key, value)) written += 1;
    else failed += 1;
  });
  return {written: written, failed: failed, reason: reason};
}

/**
 * Une table « à plat » façon PROPS_MATERIAL → des sections du socle.
 *
 * La table de material-props.js mélange les entrées `{section:'…'}` et les champs dans une
 * seule liste : une section ouvre, et tout ce qui suit lui appartient jusqu'à la suivante.
 * Le socle, lui, imbrique. Cette fonction fait la conversion — et rien d'autre : les entrées
 * elles-mêmes sont réutilisées TELLES QUELLES, sans recopier champ par champ, pour qu'aucune
 * clé ne puisse être oubliée au passage (c'est exactement ce que le brouillon perdait).
 *
 * Elle sert aussi aux matériaux de plugin (Editor.registerMaterial), qui décrivent leurs
 * uniformes dans le même format.
 */
export function sectionsFromPropsTable(table){
  const sections = [];
  let current = null;
  (table || []).forEach(function(entry){
    if(entry.section){
      current = {id: 'sec-' + sections.length, title: entry.section, fields: []};
      sections.push(current);
      return;
    }
    if(!current){
      current = {id: 'sec-0', title: '', fields: []};
      sections.push(current);
    }
    current.fields.push(entry);
  });
  return sections;
}
