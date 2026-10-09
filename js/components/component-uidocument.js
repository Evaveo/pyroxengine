// moteur/js/components/component-uidocument.js
// this.donnees référence DIRECTEMENT userData.uiDoc (même objet, pas une copie) —
// même patron que Collider (component-collider.js). Un seul UIDocument par Noeud.
// Le HTML/CSS ne sont PAS stockés ici : ce composant référence des assets
// documentUI/feuilleStyle (comme un matériau référencé par materiauId), partagés
// entre Noeuds — voir 2026-08-06-assets-documentui-feuillestyle-design.md.
import { ensureUIDoc } from '../component-data.js';
import { Registry } from '../component-registry.js';
import { Component, detachData, mergeIntoBag } from '../component.js';

export class UIDocument extends Component {
  constructor(node, opts) {
    super(node);
    this.data = opts || {};
  }

  get documentUI() {
    return assets.find((a) => a.id === this.data.documentUIId && a.kind === 'documentUI') || null;
  }
  get feuillesStyle() {
    return this.data.sheetStyleIds
      .map((id) => assets.find((a) => a.id === id && a.kind === 'sheetStyle'))
      .filter(Boolean);
  }
  // Lecture seule pour un script (api.uiDocument(node).html/.css) : le contenu vit sur les
  // assets référencés, potentiellement partagés par plusieurs Noeuds — un script ne les
  // réécrit pas à la volée (même décision que côté runtime, voir game-runtime.js). L'édition
  // passe par l'inspecteur (clicDom ci-dessous), qui modifie l'ASSET, pas ce composant.
  get html() { const d = this.documentUI; return d ? d.html : ''; }
  get css() { return this.feuillesStyle.map((f) => f.css).join('\n'); }
  get values() { return this.data.values || (this.data.values = {}); }

  onAdd() {
    this.data = mergeIntoBag(ensureUIDoc(this.node), this.data);
  }

  onRemove() {
    delete this.node.userData.uiDoc;
  }

  // DÉTACHÉES (contrat de component.js, règle 4).
  serialize() { return detachData(this.data); }

  // `hydrate` est le SEUL point de relecture (contrat de component.js, règle 2) : sans lui, un
  // composant déjà posé puis relu depuis le fichier par `applyComponents` ne voyait rien.
  hydrate(d){ if(d) this.data = d; }


  static get typeName() { return 'UIDocument'; }
  static get description(){ return 'Interface HTML/CSS'; }
  static get category() { return 'Interface'; }
}

// ---------- Ouverture depuis le menu Fenêtres / le sélecteur de fichier ----------
// L'association documentUI ↔ feuilleStyle vit sur le composant UIDocument d'un Noeud
// (clicDom ci-dessus), pas sur l'asset documentUI lui-même — deux Noeuds peuvent réutiliser
// le même document avec des feuilles différentes. Ouvert hors contexte d'un composant précis
// (menu, sélecteur), il n'y a donc pas de feuille à faire correspondre : on édite le HTML
// seul (donnees.sansFeuille, voir external-editor.html).
export function openEditorDocumentUIStandalone(doc){
  const listFiles = assets.filter(function(x){ return x.kind === 'documentUI'; })
    .map(function(x){ return {id: x.id, name: x.name}; });
  openEditorExternal('html-css', {
    id: doc.id, name: doc.name, html: doc.html || '', withoutSheet: true, listFiles: listFiles
  }, function(data){
    doc.html = data.html;
    updateProject();
  }, function(id){
    const n = assets.find(function(x){ return x.id === id && x.kind === 'documentUI'; });
    if(n) openEditorDocumentUIStandalone(n);
  });
}

// Ouvre l'éditeur HTML/CSS à empty, ou sur le dernier documentUI édité en standalone cette
// session — appelée par le menu Fenêtres.
export function openLastWindowDocumentUI(){
  const lastId = typeof lastAssetEditedBy === 'function' ? lastAssetEditedBy('html-css') : null;
  const docs = assets.filter(function(x){ return x.kind === 'documentUI'; });
  const a = (lastId && docs.find(function(x){ return x.id === lastId; })) || docs[0] || null;
  if(a){ openEditorDocumentUIStandalone(a); return; }
  openEditorExternal('html-css', {id: null, name: '', html: '', withoutSheet: true, listFiles: []});
}

Registry.registerClass(UIDocument);
