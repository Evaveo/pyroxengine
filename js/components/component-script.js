// moteur/js/components/component-script.js
// Parse le bloc JSDoc "@expose name {type} = defaut" précédant la première
// fonction du script. Types supportés : number, string, boolean, color, node,
// component:X. Une ligne mal formée est ignorée silencieusement.
import { assetById } from '../component-data.js';
import { Registry } from '../component-registry.js';
import { Component, detachData } from '../component.js';

export function parseExposures(source) {
  const resultats = [];
  const regexLine = /@expose\s+(\w+)\s*\{([^}]+)\}(?:\s*=\s*(.+))?/;
  const lines = (source || '').split('\n');
  for (const line of lines) {
    const m = line.match(regexLine);
    if (!m) continue;
    const name = m[1];
    const type = m[2].trim();
    let raw = m[3] !== undefined ? m[3].trim() : null;
    let defaultValue = null;
    if (raw !== null) {
      if (type === 'number') defaultValue = Number(raw);
      else if (type === 'boolean') defaultValue = (raw === 'true');
      else defaultValue = raw;
    }
    resultats.push({ name: name, type: type, defaultValue: defaultValue });
  }
  return resultats;
}

export let _scriptJsUidNext = 1;

// this.entree référence DIRECTEMENT l'entrée {scriptId, active, values} poussée dans
// userData.scripts (le moteur d'exécution existant, runScripts()/
// compiledOf() dans scripts.js, continue de piloter la compilation et l'appel
// start/update) : ce composant ajoute l'analyse des variables exposées
// et l'accès Unity-like (api.node, api.trouverNoeud...).
//
// LE CODE N'EST PLUS SUR L'INSTANCE, IL EST SUR L'ASSET. L'entrée portait `code`, une COPIE
// prise au glisser-déposer : éditer l'asset ensuite ne changeait aucune instance déjà posée, et
// éditer le script d'un objet ne remontait pas à l'asset. Deux sources de vérité pour une même
// logique, donc deux comportements divergents sous un même nom. Le composant ne garde plus que
// `scriptId` — l'identité, comme un MonoBehaviour tient son GUID — et `values`, les variables
// @expose, qui sont bien un réglage d'instance. Il n'y a PAS d'override local : éditer l'asset
// se voit sur toutes ses instances, c'est exactement le point.
export class ScriptJS extends Component {
  constructor(node, opts) {
    super(node);
    opts = opts || {};
    this.uid = _scriptJsUidNext++;
    // `valeurs` vit SUR l'entrée (et non sur le composant) : c'est l'entrée qui est poussée
    // dans userData.scripts, donc la seule chose que serializeObject écrit dans la scène.
    // Sur le composant, les valeurs @expose réglées dans l'inspecteur étaient perdues à
    // chaque sauvegarde — et n'atteignaient jamais le jeu publié, qui recopie userData.scripts.
    this.entry = {
      scriptId: opts.scriptId || null,
      active: (opts.active !== undefined) ? opts.active : true,
      values: opts.values || {}
    };
  }

  // `hydrate` : le SEUL point de relecture (contrat de component.js, règle 2). Il rejoue la
  // lecture du constructeur SANS toucher `uid`, qui identifie l'instance et ne vient pas du
  // fichier. `values` n'est écrasé que s'il est fourni : les variables @expose déjà réglées ne
  // doivent pas repartir à zéro parce qu'une relecture ne les mentionne pas.
  hydrate(d){
    if(!d) return;
    if(d.scriptId !== undefined) this.entry.scriptId = d.scriptId || null;
    if(d.active !== undefined) this.entry.active = d.active;
    if(d.values !== undefined) this.entry.values = d.values || {};
  }

  // L'asset script référencé, ou null s'il a été supprimé — ou si l'entrée vient d'un projet
  // d'avant la référence, qui portait le code en dur. Ce null est MONTRÉ par l'inspecteur
  // (« script manquant ») : un composant qui ne résout rien sans le dire est un objet muet
  // dont personne ne retrouve la cause.
  get asset() {
    if (!this.entry.scriptId) return null;
    // `assetById` (js/component-data.js, PARTAGÉ) et pas `assets.find` : un index validé au lieu
    // d'un parcours, et le même chemin dans les deux moteurs — l'éditeur tient un tableau
    // `assets`, le jeu publié une table `assetsById`.
    // Le repli fait le parcours plutôt que de rendre `null` : une garde `typeof` qui rend
    // « rien » ferait passer un module absent pour un asset supprimé, et l'inspecteur
    // afficherait « script manquant » sur un script qui existe.
    const a = (typeof assetById === 'function')
      ? assetById(this.entry.scriptId)
      : ((typeof assets !== 'undefined' && Array.isArray(assets))
          ? assets.find((x) => x.id === this.entry.scriptId)
          : null);
    return (a && a.kind === 'script') ? a : null;
  }
  get missing() { return !this.asset; }
  get code() { const a = this.asset; return a ? (a.code || '') : ''; }
  get values() { return this.entry.values; }
  set values(v) { this.entry.values = v || {}; }
  // Mémorisé par code : ce getter est lu à chaque image par api.expose, et relisait l'en-tête du
  // script par expression régulière à chaque fois (revue du 2026-09-29, § 5.4).
  get exposures() {
    const code = this.code;
    if (this._exposuresCode !== code) { this._exposures = parseExposures(code); this._exposuresCode = code; }
    return this._exposures;
  }

  onAdd() {
    if (!this.node.userData.scripts) this.node.userData.scripts = [];
    this.node.userData.scripts.push(this.entry);
    this.exposures.forEach((e) => {
      if (!(e.name in this.values)) this.values[e.name] = e.defaultValue;
    });
    // la case du header générique remplace l'ancienne case « active » propre à ce
    // composant : this.entree.active (userData.scripts[i].active, lu par le moteur
    // d'exécution existant) reste la source de vérité
    this.active = this.entry.active !== false;
  }

  onActiveChange(active) {
    this.entry.active = active;
  }

  onRemove() {
    const list = this.node.userData.scripts || [];
    const i = list.indexOf(this.entry);
    if (i !== -1) list.splice(i, 1);
  }

  // `values` DETACHE : c'est l'objet de `userData.scripts[i].values`, donc l'etat de jeu
  // lui-meme. Le rendre vivant laissait un appelant le muter en croyant travailler sur une
  // copie (contrat de component.js, regle 4).
  serialize() {
    return { scriptId: this.entry.scriptId, active: this.entry.active,
             values: detachData(this.entry.values) };
  }

  static get typeName() { return 'ScriptJS'; }
  static get icon(){ return Icons.html('code') + ' '; }
  static get description(){ return 'Logique personnalisée'; }
  static get category() { return 'Gameplay'; }
}

Registry.registerClass(ScriptJS);

export const SystemScripts = {
  // Le moteur existant (runScripts dans scripts.js) itère déjà sur
  // userData.scripts pour chaque objet, à la même fréquence que la boucle de
  // game ; ce Système existe pour l'architecture pseudo-ECS mais délègue à lui.
  update(dt) {
    if (typeof runScripts === 'function') runScripts(dt);
  }
};
