// ---------- Inspecteur ----------
//
// LES CINQ FABRIQUES DE CHAMPS ONT DISPARU. `fieldVec3`, `fieldNumber`, `fieldColor`,
// `fieldSelect` et `fieldText` rendaient des chaînes HTML, que `setVal` et `readF` allaient
// ensuite relire par `getElementById`. C'était la forme de tout l'inspecteur — 736 lignes de
// concaténation — et elles sont restées en façade pendant quatre lots, le temps que leurs
// derniers appelants migrent : `postfx.js` et `component-views.js` au lot 2, `subscenes.js` et
// `Editor.api.fields` au lot 3, `palette-ui.js` au lot 4.
//
// Ce qui reste ici est la COQUILLE : les blocs de composants, leur en-tête, leur pliage, et le
// câblage des hôtes que le socle remplit.
import { rebindSkeletons, skinnedMeshRendererOf } from './anim-models.js';
import { anim, assetClipOpen, keySel, setKeySel, setTracksOfScene, tracksLiveOfClip, tracksOfScene, updateTimeline } from './animation.js';
import { ed, ensureGame } from './component-data.js';
import { Registry } from './component-registry.js';
import { ComponentViews } from './component-views.js';
import { setStatus, updateHierarchy } from './hierarchy.js';
import { pushHistory } from './history.js';
import { buildInspectorAsset } from './import-settings.js';
import { cloneCleanly, escapeHtml, helpers, listMats, objects, reenableSubTree } from './objects.js';
import { detachBodyPhysics } from './physics.js';
import { PluginSections } from './plugins.js';
import { assetPrefabOf } from './prefabs.js';
import { activeCam, applyFilters, camEditor, gizmoAttach, scene, setActiveCam, tc } from './scene.js';
import { allSelection, assetSelected, select, selection, selectionMulti, setHighlight } from './selection.js';
import { component } from './shader-graph-editor.js';
import { closeModal, openModal, openPanelDock } from './ui.js';
import { createForm } from './ui/form.js';
import { Icons } from './ui/icon.js';
import { Panels } from './ui/panel.js';
import { mountInspectorAnimatorAsset } from './ui/panels-components.js';
import { PANEL_IDENTITY, PANEL_MODEL, PANEL_MODEL_MATERIALS, PANEL_PREFAB, PANEL_SUBSCENE } from './ui/panels-inspector.js';
import { resize } from './viewport.js';

// LES COMPOSANTS PORTENT UN NOM FRANÇAIS À L'ÉCRAN. L'inspecteur affichait le `typeName` brut
// (CameraFollow, ScriptJS, PostVolume…) au milieu d'une interface française (revue du 2026-09-29,
// § 4.2). Le `typeName` reste l'identifiant — celui de `getComponent` — et s'affiche en infobulle.
// Un composant de plugin sans entrée ici garde son nom de type.
export const COMPONENT_LABELS = {
  AnimatorController: 'Machine à états', AudioSource: 'Source audio', Camera: 'Caméra',
  CameraFollow: 'Suivi de caméra', TeamColor: 'Couleur d' + "'" + 'équipe', FogOfWar: 'Brouillard de guerre', Vision: 'Vision', CharacterController2D: 'Contrôleur de personnage 2D',
  Collider: 'Collider', Collider2D: 'Collider 2D', Events: 'Événements', Light: 'Lumière',
  Mesh: 'Maillage', Model: 'Modèle', Particles: 'Particules', Physics: 'Physique',
  PostVolume: 'Volume de post-traitement', Reflection: 'Sonde de réflexion', Rigidbody2D: 'Corps rigide 2D',
  ScriptJS: 'Script', SkinnedMeshRenderer: 'Maillage skinné', SpriteAnimator: 'Animation de sprite',
  SpriteRenderer: 'Sprite', SubScene: 'Sous-scène', Synthesizer: 'Synthétiseur', Tag: 'Tag',
  Terrain: 'Terrain', Tilemap: 'Tilemap', TouchControls: 'Contrôles tactiles', UIDocument: 'Interface (UI)',
  XRGrabbable: 'Saisissable (XR)', XROrigin: 'Origine XR', XRTeleportArea: 'Zone de téléportation (XR)'
};
export function componentLabel(typeName){ return COMPONENT_LABELS[typeName] || typeName; }

export const inspBody = document.getElementById('insp-body');

// ---------- La section Transform, premier client du socle déclaratif ----------
// Les ids des champs sont ceux d'avant, À LA LETTRE (`f-px`… `f-sz`) : tout ce qui les cible
// ailleurs continue de fonctionner. Ce qui change : la multi-sélection marche (déplacer trois
// objets ensemble), l'undo est posé par le socle et ne peut plus être oublié, et le gizmo peut
// synchroniser en continu sans effacer une saisie en cours.
//
// La section n'a pas de titre ici : l'en-tête « Transform (local) » reste écrit par
// buildInspector, qui seul sait si l'objet est enfant d'un autre.
/** Un nœud de modèle retouché dans l'inspecteur devient un override (js/model-nodes.js). */
function markEditedIfModelNode(o){
  if(typeof markModelNodeEdited === 'function') markModelNodeEdited(o);
}

if(typeof Panels !== 'undefined'){
  Panels.register({
    id: 'transform',
    title: 'Transform',
    targets: function(){
      if(typeof allSelection === 'function') return allSelection();
      return selection ? [selection] : [];
    },
    sections: [{ id: 'transform', title: '', fields: [
      { key: 'position', ids: ['f-px', 'f-py', 'f-pz'], label: 'Position', type: 'vec3', step: 0.1,
        get: function(o){ return [o.position.x, o.position.y, o.position.z]; },
        set: function(o, v){ o.position.set(v[0], v[1], v[2]); markEditedIfModelNode(o); } },
      { key: 'rotation', ids: ['f-rx', 'f-ry', 'f-rz'], label: 'Rotation °', type: 'vec3', step: 1,
        // Degrés à l'écran, radians dans la donnée — la conversion est une affaire
        // d'INTERFACE, donc elle vit dans l'accesseur et nulle part ailleurs.
        get: function(o){ return ['x', 'y', 'z'].map(function(a){
          return Math.round(o.rotation[a] * 180 / Math.PI * 100) / 100; }); },
        set: function(o, v){ o.rotation.set(v[0] * Math.PI / 180, v[1] * Math.PI / 180, v[2] * Math.PI / 180);
          markEditedIfModelNode(o); } },
      { key: 'scale', ids: ['f-sx', 'f-sy', 'f-sz'], label: 'Échelle', type: 'vec3', step: 0.1,
        get: function(o){ return [o.scale.x, o.scale.y, o.scale.z]; },
        set: function(o, v){ o.scale.set(v[0], v[1], v[2]); markEditedIfModelNode(o); } }
    ]}]
  });

  // Les trois sections restantes de l'objet. `targets` : la multi-sélection pour l'identité
  // (tag et calque se partagent), un seul objet pour les autres — un modèle importé, un jeu de
  // clips et un prefab lié ne se partagent pas entre plusieurs sélections.
  const singleTarget = function(){ return selection ? [selection] : []; };
  Panels.register(Object.assign({}, PANEL_IDENTITY, {
    targets: function(){ return allSelection(); } }));
  Panels.register(Object.assign({}, PANEL_MODEL, { targets: singleTarget }));
  Panels.register(Object.assign({}, PANEL_MODEL_MATERIALS, { targets: singleTarget }));
  Panels.register(Object.assign({}, PANEL_PREFAB, { targets: singleTarget }));
  Panels.register(Object.assign({}, PANEL_SUBSCENE, { targets: singleTarget }));
}

// ---------- Composants (Noeud + Component) ----------
// pliage des blocs de composant : confort de session, pas persisté au projet
export const componentsReplies = new Map();
export function keyFoldComponent(node, component, idx){
  return node.uuid + '|' + component.constructor.typeName + '|' + idx;
}

export function buildBlocksComponents(node){
  let h = '<div class="sec sec-components">Composants'
    + '<button class="btn-insp" id="btn-add-component">+ Composant</button></div>';
  node.getComponents().forEach(function(component, idx){
    // Composants d'index (Tag, Model, SubScene) : rien à régler, et leur sujet a déjà
    // sa section ailleurs dans l'inspecteur. On saute SANS filtrer le tableau, pour que
    // `idx` reste celui de getComponents() — c'est lui que lisent les gestionnaires de
    // la case d'activation et de la croix de retrait.
    if(component.constructor.hiddenInInspector) return;
    const key = keyFoldComponent(node, component, idx);
    const folded = componentsReplies.get(key) === true;
    // La vue vit dans js/component-views.js, plus dans le composant (voir l'en-tête
    // de ce fichier-là). Un composant sans vue rend une chaîne vide : le bloc
    // s'affiche alors avec son nom, sa case d'activation et sa croix, sans corps.
    const content = ComponentViews.html(component, idx);
    // Une CARTE du vocabulaire (css/components.css), pas un bloc maison. Les classes
    // `block-component`, `fold-component`, `active-component`, `remove-component` et
    // `body-component` restent posées à côté : ce sont elles que lisent les gestionnaires
    // délégués plus bas dans ce fichier, et les renommer aurait débranché l'activation,
    // le repli et le retrait d'un composant sans qu'aucune erreur ne soit levée.
    //
    // L'activation est un INTERRUPTEUR et non une case à cocher : une case répond à « faut-il
    // inclure ceci », un interrupteur à « est-ce allumé » — qui est la question posée ici.
    // C'est une vraie `<input type=checkbox>` sous l'apparence, donc le clavier, le focus et
    // les technologies d'assistance continuent de fonctionner sans une ligne de script.
    h += '<div class="ui-card block-component' + (folded ? ' folded' : '')
      + (component.active ? '' : ' off disabled')
      + '" data-typename="'+component.constructor.typeName+'" data-idx="'+idx+'" data-key="'+key+'">'
      + '<div class="ui-card-head header-component">'
      + '<span class="fold-component" title="Replier / déplier">'
      + Icons.html(folded ? 'caret-right' : 'caret-down') + '</span>'
      + '<span class="ui-chip ui-chip-sm">' + (component.constructor.icon || '') + '</span>'
      + '<span class="ui-card-title name-component" title="' + component.constructor.typeName + '">'
      + escapeHtml(componentLabel(component.constructor.typeName)) + '</span>'
      // Le « ? » ouvre la fiche du composant dans le manuel (js/help.js écoute ses clics).
      + '<button class="ui-icon-btn ui-icon-btn-sm help-component" type="button" data-help-component="'
      + component.constructor.typeName + '" title="Aide sur ce composant (F1)">?</button>'
      + '<label class="ui-switch" title="Activer / désactiver">'
      + '<input type="checkbox" class="active-component" data-idx="'+idx+'"'
      + (component.active ? ' checked' : '') + '>'
      + '<span class="ui-switch-track"></span><span class="ui-switch-thumb"></span></label>'
      + (component.constructor.removable
        ? '<button class="ui-icon-btn ui-icon-btn-sm ui-btn-danger remove-component" data-idx="'
          + idx + '" title="Retirer ce composant">' + Icons.html('trash') + '</button>'
        : '')
      + '</div>'
      + '<div class="ui-card-body body-component"' + (folded ? ' hidden' : '') + '>'
      + content + '</div></div>';
  });
  // Le bouton d'ajout PASSE SOUS la liste et prend toute la largeur : posé dans le titre de
  // section, il se lisait comme une décoration du titre. Sous la dernière carte, il est à
  // l'endroit où le regard arrive quand on a fini de lire ce que l'objet porte déjà.
  h += '<button class="ui-btn ui-btn-block" id="btn-add-component">'
    + Icons.html('plus') + 'Ajouter un composant</button>';
  return h;
}

export function buildPopupComponents(node){
  // La liste propose TOUT ce qui n'est pas interne. Elle filtrait aussi par espace — un
  // composant 2D ne se proposait pas sur un nœud 3D et réciproquement ; il n'y a plus qu'un
  // monde, et le tri par catégorie suffit à s'y retrouver.
  const byCategorie = {};
  Registry.registeredClasses.forEach(function(c){
    if(c.classe.internal) return;
    if(!byCategorie[c.category]) byCategorie[c.category] = [];
    byCategorie[c.category].push(c);
  });
  // Le RAIL de catégories, avec son compte. Il remplace des titres empilés dans une colonne
  // qui défilait : avec dix-huit composants, la catégorie cherchée était sous la ligne de
  // flottaison, et rien ne disait combien il y en avait dans chacune.
  const categories = Object.keys(byCategorie);
  const total = categories.reduce(function(n, k){ return n + byCategorie[k].length; }, 0);

  // Une carte par composant : puce d'icône, nom, et ce que le composant FAIT. Le nom seul
  // (`Reflection`, `PostVolume`) ne dit rien à qui ne l'a jamais posé — c'est la description
  // qui permet de choisir sans ouvrir l'aide. Elle est facultative : un composant de plugin
  // qui n'en déclare pas retombe sur sa catégorie, ce qui reste plus utile que rien.
  function card(c){
    const desc = c.classe.description || c.category || '';
    return '<button class="ui-card-pick item-component" data-type="' + c.typeName + '"'
      + ' data-category="' + escapeHtml(c.category || '') + '"'
      + ' title="Ajouter ' + escapeHtml(c.typeName) + '">'
      + '<span class="ui-chip">' + (c.classe.icon || '') + '</span>'
      + '<span><span class="ui-card-pick-name">' + escapeHtml(componentLabel(c.typeName)) + '</span><br>'
      + '<span class="ui-card-pick-desc">' + escapeHtml(desc) + '</span></span></button>';
  }

  let html = '<div class="ui-search" style="margin-bottom:var(--sp-5)">'
    + Icons.html('magnifying-glass')
    + '<input id="search-component" placeholder="Rechercher un composant…" spellcheck="false">'
    + '</div><div class="ui-split">'
    + '<div class="ui-rail" id="rail-component">'
    + '<button class="ui-row active" data-category="">' + Icons.html('squares-four')
    + '<span style="flex:1">Tous</span><span class="ui-count">' + total + '</span></button>';
  categories.forEach(function(category){
    html += '<button class="ui-row" data-category="' + escapeHtml(category) + '">'
      + '<span style="flex:1">' + escapeHtml(category) + '</span>'
      + '<span class="ui-count">' + byCategorie[category].length + '</span></button>';
  });
  html += '</div><div class="ui-grid" id="grid-component">';
  categories.forEach(function(category){
    byCategorie[category].forEach(function(c){ html += card(c); });
  });
  html += '</div></div>';
  return html;
}

// Réutilise la fenêtre modale déjà existante (#modal, openModal/closeModal — voir
// ui.js) plutôt qu'un élément flottant maison sans style ni positionnement.
export function openPopupComponents(node){
  openModal('Ajouter un composant', buildPopupComponents(node));
  const body = document.getElementById('modal-body');

  // UN SEUL filtre, croisant les deux critères. Les traiter séparément — la recherche cache,
  // puis la catégorie ré-affiche — fait que le dernier des deux gestes efface l'autre : on
  // tape « col », on clique « Physique », et les composants d'un autre nom réapparaissent.
  const recherche = body.querySelector('#search-component');
  const rail = body.querySelector('#rail-component');
  let category = '';

  function applyFilter(){
    const text = (recherche ? recherche.value : '').trim().toLowerCase();
    body.querySelectorAll('.item-component').forEach(function(el){
      const onName = !text || el.dataset.type.toLowerCase().indexOf(text) !== -1;
      const onCategory = !category || el.dataset.category === category;
      el.hidden = !(onName && onCategory);
    });
  }

  if(recherche){
    recherche.addEventListener('input', applyFilter);
    recherche.focus();
  }
  if(rail){
    rail.querySelectorAll('[data-category]').forEach(function(btn){
      btn.addEventListener('click', function(){
        category = btn.dataset.category;
        rail.querySelectorAll('[data-category]').forEach(function(b){
          b.classList.toggle('active', b === btn);
        });
        applyFilter();
      });
    });
  }

  body.querySelectorAll('.item-component').forEach(function(el){
    el.addEventListener('click', function(){
      // ScriptJS peut être ajouté plusieurs fois (plusieurs scripts sur un même
      // Noeud) ; les autres types partagent des ids de champs DOM fixes
      // (f-cshape…) et ne peuvent pas coexister en double sans se marcher dessus.
      if(el.dataset.type !== 'ScriptJS' && node.getComponent(el.dataset.type)){
        setStatus('« ' + el.dataset.type + ' » est déjà présent sur cet objet', 2500);
        closeModal();
        return;
      }
      pushHistory();
      node.addComponent(el.dataset.type, {});
      closeModal();
      buildInspector();
    });
  });
}


// ensureGame, ensureCollider, matColliderViz, removeColliderViz, updateColliderViz vivent
// dans composant-data.js / collider.js — c'est leur SEULE copie depuis le lot ECS
// (vague 1 du naming). Ces cinq-ci en étaient des doublons EXACTS réintroduits par le merge
// de main, invisibles tant qu'editor.html ne chargeait pas collider.js — une fois restauré,
// `const matColliderViz` déclaré deux fois sur la même page levait une SyntaxError et
// interrompait tout inspector.js. Voir docs/KNOWN_ISSUES.md.

export function buildInspector(){
  if(assetSelected){
    // tile du panneau Projet sélectionnée : paramètres d'import (import-settings.js)
    //
    // SOUS try/catch, sur le modèle de Panels.buildOne (ui/panel.js) : buildInspectorAsset()
    // monte 1600 lignes de HTML concaténé sans le moindre filet. Une exception dans n'importe
    // quelle branche (matériau, modèle, sprite…) laissait l'inspecteur STRICTEMENT inchangé —
    // sans message, sans trace visible si la console est fermée. C'est le mécanisme exact de
    // « l'inspecteur ne fonctionne plus avec les assets » (docs/REVUE_2026-09-14.md § 1).
    try {
      buildInspectorAsset(assetSelected);
    } catch(e){
      console.error('inspecteur d\'asset « ' + (assetSelected.name || assetSelected.id) + ' » :', e);
      // Même classe que le placard de Panels (ui/panel.js) : un seul aspect d'échec dans
      // l'éditeur, et le même bouton de sortie que pour un panneau tombé.
      inspBody.innerHTML = '<div class="panel-error">L\'inspecteur de l\'asset « '
        + escapeHtml(String(assetSelected.name || assetSelected.id)) + ' » n\'a pas pu '
        + 's\'afficher : ' + escapeHtml(String((e && e.message) || 'erreur inconnue'))
        + '<button class="panel-error-retry" type="button" id="btn-retry-inspector-asset">Réessayer</button></div>';
      const retry = inspBody.querySelector('#btn-retry-inspector-asset');
      if(retry) retry.addEventListener('click', function(){ buildInspector(); });
      return;
    }
    // La machine Animator ÉDITÉE COMME ASSET (fenêtre Animator ouverte sans composant sur un
    // objet de la scène) : le mini-inspecteur d'état/transition sélectionné dans le graphe se
    // monte à part, voir panels-components.js/mountInspectorAnimatorAsset.
    mountInspectorAnimatorAsset(assetSelected);
    return;
  }
  if(!selection){
    // L'INSPECTEUR NE MONTRE QUE L'OBJET SÉLECTIONNÉ. Ciel, brouillard, éclairage et
    // post-traitement décrivent la SCÈNE : ils ont leurs propres panneaux depuis v0.96.0.
    // Les deux boutons ci-dessous remplacent la découvrabilité que ce repli assurait par
    // accident — sans eux, personne ne saurait où sont passés ces réglages.
    inspBody.innerHTML = '<div class="none" style="margin-bottom:8px">aucun objet sélectionné</div>'
      + '<button class="btn-insp" id="btn-open-environment">🌤 Environnement de la scène</button>'
      + '<button class="btn-insp" id="btn-open-render">🎨 Rendu</button>';
    // `Panels.syncAll()` MÊME SANS SÉLECTION : un chargement de projet (aucun objet sélectionné
    // dans l'état restauré, voir history.js) réassigne `env` (js/environment.js,
    // `applyEnvironment(fresh)`) sans jamais passer par `syncInspector()`, qui ne tournait
    // qu'à l'intérieur du bloc « objet sélectionné ». Sans cet appel, le panneau Environnement
    // restait accroché à l'ancien objet `env` du tout premier boot jusqu'à ce qu'on sélectionne
    // un objet au moins une fois — et ses réglages n'avaient donc aucun effet visible d'ici là.
    if(typeof Panels !== 'undefined') Panels.syncAll();
    return;
  }
  const t = selection.userData.type;
  // Nom + Tag + Calque sur une seule ligne : ce sont les trois identifiants d'un
  // objet (affichage, script/gameplay, rendu/collision), pas des réglages —
  // l'ancienne section « Jeu » séparée n'apportait rien de plus.
  ensureGame(selection);
  // Nom, tag et calque sont construits par le SOCLE (js/ui/panels-inspector.js) : le tag et le
  // calque acceptent la multi-sélection, le nom non (trois homonymes rendraient la hiérarchie
  // illisible), et l'undo est posé par le socle.
  let html = '<div id="insp-identity"></div>';
  // Un nœud d'instance de modèle (os, maillage) : ce qu'on y change est un OVERRIDE du fichier,
  // comme sur l'enfant d'un prefab Unity — le dire avant qu'on s'étonne de ne pas pouvoir le
  // renommer ni le supprimer.
  if(selection.userData.modelNode !== undefined){
    const rootModel = (typeof modelRootOf === 'function') ? modelRootOf(selection) : null;
    html += '<div class="ip-note">Nœud du modèle <b>' + escapeHtml(rootModel ? rootModel.name : '?')
      + '</b>' + (selection.isBone ? ' — os' : '') + '. Transformée, visibilité et composants '
      + 'ajoutés sont enregistrés comme <b>overrides</b> et survivent au réimport du fichier. '
      + 'Son nom et sa place dans la hiérarchie viennent du fichier.</div>';
  }
  html += '<div class="sec">Transform' + (selection.parent !== scene ? ' (local)' : '') + '</div>';
  // Position / Rotation / Échelle sont construites par le SOCLE déclaratif (js/ui/*), qui
  // apporte la multi-sélection, l'undo par interaction et une synchronisation qui n'efface
  // plus une saisie en cours. Le reste de l'inspecteur est inchangé (migration au lot 1a-bis).
  html += '<div id="insp-transform"></div>';

  // 'model' (glTF/FBX importé) n'a pas de composant Mesh : pas de matériau/ombres
  // affichés pour ce type — logique, il n'y a pas de mesh/matériau THREE unique à
  // représenter (plusieurs sous-maillages possibles). Collider/Physics sont de
  // vrais composants (applyNodeMixin dans createAssetModel, assets.js) et
  // s'affichent via buildBlocksComponents ci-dessous, comme pour les autres types.
  if(t === 'model'){
    html += '<div id="insp-model"></div>';
  }
  if(selection.isMesh && selection.userData.modelNode !== undefined){
    html += '<div id="insp-model-materials"></div>';
  }
  // Squelette/Avatar humanoïde/Clips externes ne sont plus gatés sur `userData.type === 'model'`
  // mais sur la présence du composant SkinnedMeshRenderer QUELQUE PART dans le sous-arbre du
  // nœud sélectionné (skinnedMeshRendererOf, js/anim-models.js) : un FBX Mixamo « without skin »
  // a le type 'model' sans le moindre THREE.SkinnedMesh, et un modèle avec plusieurs SkinnedMesh
  // (body + vêtements) porte le composant sur un DESCENDANT, jamais sur la racine. Affichées par
  // le mécanisme générique de composant (buildBlocksComponents ci-dessous, via le panneau
  // SkinnedMeshRenderer de la tâche 1.6) : plus de section à part ici.
  // Sous-scène : synchronisée par le socle (panneau inspector-subscene).

  // La source audio est un COMPOSANT (js/components/component-audio.js) : sa section, ses champs et
  // son bouton Écouter vivent avec lui. La garder ici en plus l'afficherait DEUX FOIS, avec deux jeux
  // d'identifiants identiques — et le second écraserait le premier au premier réglage.

  // section Prefab lié (instance rattachée à un asset prefab)
  // L'état « ● modifié » et l'activation des boutons sont recalculés par le socle à chaque
  // synchronisation — c'est ce qui remplace updateStatePrefab().
  if(assetPrefabOf(selection)) html += '<div id="insp-prefab"></div>';

  // Les sections apportées par les plugins : un hôte vide par section, rempli après la pose du
  // HTML. Elles sont DÉCLARATIVES depuis l'API v2 — le socle les construit, les synchronise et
  // route leurs événements, comme celles de l'éditeur.
  html += PluginSections.html(selection);

  if(selection.getComponents){
    html += buildBlocksComponents(selection);
  }

  // Le SkinnedMeshRenderer d'un modèle vit d'ordinaire sur un DESCENDANT (le vrai
  // THREE.SkinnedMesh), jamais sur la racine Model qu'on sélectionne en pratique
  // (component-model.js : Model ne détient ni squelette ni maillage) — sauf quand l'export
  // n'a qu'un seul nœud et que la racine EST elle-même le SkinnedMesh, auquel cas le composant
  // vit déjà sur `selection` et `buildBlocksComponents` ci-dessus l'affiche déjà : le monter une
  // seconde fois ici doublerait la carte (squelette/avatar deux fois de suite dans l'inspecteur).
  let htmlSkinned = '';
  if(t === 'model'){
    const smr = skinnedMeshRendererOf(selection);
    if(smr && selection.getComponents().indexOf(smr) === -1) htmlSkinned = '<div id="insp-skinned-mesh"></div>';
  }
  html += htmlSkinned;

  inspBody.innerHTML = html;
  // Le socle construit la section Transform dans son hôte ; le reste de l'inspecteur continue
  // comme avant. Les deux cohabitent tout au long du lot 1a-bis.
  // Les composants MIGRÉS construisent leur formulaire dans l'hôte que leur bloc a laissé.
  if(typeof ComponentViews !== 'undefined' && ComponentViews.mount) ComponentViews.mount(selection, inspBody);
  // Le panneau du SkinnedMeshRenderer porté par un DESCENDANT (jamais la racine Model elle-même,
  // voir ci-dessus) : monté à la main, hors du tour normal de ComponentViews.mount qui ne
  // parcourt que selection.getComponents().
  if(t === 'model'){
    const smr = skinnedMeshRendererOf(selection);
    const hostSkinned = inspBody.querySelector('#insp-skinned-mesh');
    if(smr && hostSkinned && selection.getComponents().indexOf(smr) === -1){
      const descripteur = ComponentViews.panelFor(smr);
      if(descripteur){
        const form = createForm(hostSkinned, descripteur);
        form.setTargets([smr]);
        ComponentViews.forms.set(smr, form);
      }
    }
  }
  PluginSections.mount(selection);
  // Résoudre ces hôtes par `document.getElementById` échouait une fois insp-body déplacé
  // dans le document d'un onglet détaché (dock.js `popOutWindow` via `adoptNode`) : le
  // `document` de ce script reste celui de la fenêtre PRINCIPALE, où ces ids n'existent
  // plus. `inspBody` est lui-même une référence DOM directe (capturée une fois, valide
  // quel que soit son document courant) : chercher DANS lui via `querySelector` retrouve
  // toujours les enfants qu'on vient d'y créer par `innerHTML`, même hébergé ailleurs.
  if(typeof Panels !== 'undefined') Panels.boot({
    transform:              inspBody.querySelector('#insp-transform'),
    'inspector-identity':   inspBody.querySelector('#insp-identity'),
    'inspector-model':      inspBody.querySelector('#insp-model'),
    'inspector-model-materials': inspBody.querySelector('#insp-model-materials'),
    'inspector-prefab':     inspBody.querySelector('#insp-prefab'),
    'inspector-subscene':   inspBody.querySelector('#insp-subscene')
  });
  syncInspector();
}

// L'environnement et le post-traitement ont leurs PANNEAUX (js/ui/panels-scene.js) : ils se
// lisent, s'écrivent et se synchronisent par le socle. `syncEnvironment` et
// `readEnvironmentFromDom` allaient chercher trente éléments par leur id — c'est exactement ce
// dont trois d'entre eux étaient morts sans que rien ne le dise (v0.95.1).

/**
 * `syncInspector` pour les appelants PAR IMAGE (simulation, lecture de la timeline) : au plus dix
 * fois par seconde, et une dernière fois après le dernier appel pour ne jamais laisser l'inspecteur
 * sur une valeur intermédiaire. À 60 images par seconde, chaque image resynchronisait TOUS les
 * panneaux ouverts — du DOM et du style par image, pendant qu'on regarde justement la fluidité
 * (revue du 2026-09-29, § 5.5).
 */
let _syncDernier = 0, _syncTimer = null;
export function syncInspectorThrottled(){
  const t = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  if(t - _syncDernier >= 100){
    _syncDernier = t;
    if(_syncTimer){ clearTimeout(_syncTimer); _syncTimer = null; }
    syncInspector();
    return;
  }
  if(!_syncTimer){
    _syncTimer = setTimeout(function(){ _syncTimer = null; _syncDernier = Date.now(); syncInspector(); }, 100);
  }
}

export function syncInspector(){
  // `Panels.syncAll()` AVANT la garde de sélection, et c'est capital : il resynchronise TOUS
  // les panneaux enregistrés, y compris Environnement/Rendu/Paramètres du projet/Préférences
  // (js/ui/panels-shell.js), qui ne dépendent d'AUCUNE sélection. Posé après le `if(!selection)
  // return` (comme avant), il ne tournait que quand un objet était sélectionné — jamais quand on
  // regarde justement le panneau Environnement (rien de sélectionné). Symptôme mesuré : après le
  // chargement d'un projet, `applyEnvironment(fresh)` RÉASSIGNE la variable `env`
  // (js/environment.js) à un nouvel objet, mais le panneau Environnement avait capturé sa cible
  // au tout premier boot (avant tout chargement) et ne la rafraîchissait plus jamais tant qu'on
  // ne sélectionnait aucun objet — les réglages du panneau écrivaient donc dans un objet `env`
  // orphelin, sans le moindre effet sur la scène rendue.
  if(typeof Panels !== 'undefined') Panels.syncAll();
  if(!selection) return;
  // Position / Rotation / Échelle : c'est le socle qui les synchronise, et lui seul sait ne pas
  // écraser un champ en cours de saisie.
  const t = selection.userData.type;
  // Tag et calque : synchronisés par le socle (panneau inspector-identity).
  // La synchronisation des champs audio a suivi la section : elle vit dans le composant SourceAudio.
  // Animations : synchronisées par le socle (panneau inspector-animations).
  // Sous-scène : synchronisée par le socle (panneau inspector-subscene).
  // plugins : leurs formulaires sont ceux du socle, ils se synchronisent comme les autres.
  PluginSections.sync();
  // composants (Noeud + Component) : chacun synchronise ses propres champs DOM
  if(selection.getComponents){
    selection.getComponents().forEach(function(c){ ComponentViews.sync(c); });
  }
}


// un instantané d'historique par prise de focus dans l'inspecteur (pas un par frappe)
export let inspHistoTaken = true;
inspBody.addEventListener('focusin', function(){ inspHistoTaken = false; });

inspBody.addEventListener('input', function(e){
  if(assetSelected) return;   // panneau d'import : géré par import-settings.js
  if(!inspHistoTaken){ pushHistory(); inspHistoTaken = true; }
  if(!selection){
    // panneau environnement
    // Les champs `f-env-*` appartiennent aux panneaux Environnement et Rendu.
    return;
  }
  const id = e.target.id;

  // case d'activation d'un composant (avant la délégation aux inputDom, générique
  // à tous les composants — pas de champ dédié à écrire dans chaque classe)
  if(e.target.classList.contains('active-component') && selection.getComponents){
    const components = selection.getComponents();
    const c = components[parseInt(e.target.dataset.idx, 10)];
    if(c){
      pushHistory();
      c.active = e.target.checked;
      if(c.onActiveChange) c.onActiveChange(c.active);
      const block = e.target.closest('.block-component');
      if(block) block.classList.toggle('disabled', !c.active);
      ComponentViews.sync(c);
    }
    return;
  }

  // Un champ DANS le bloc d'un composant appartient au socle, qui a posé ses propres écouteurs
  // (js/ui/form.js) : le laisser repasser par le routage par id ci-dessous l'écrirait deux fois.
  if(e.target.closest && e.target.closest('[id^="cmp-host-"]')) return;

  // Les champs audio sont traités par le composant SourceAudio, via son inputDom.



  // Les champs des plugins sont dans un hôte `plug-host-*` : le socle y a posé ses propres
  // écouteurs, et le routage par identifiant ci-dessous n'a rien à y faire.
  if(e.target.closest && e.target.closest('[id^="plug-host-"]')) return;

  // sous-scène : changement de la scène source
  // La sous-scène est un panneau du socle (js/ui/panels-inspector.js).

  // LE CHEMIN « MODÈLE IMPORTÉ » A DISPARU, et il était déjà mort. Il relisait les champs de
  // collider et de physique d'un modèle glTF/FBX « parce qu'il n'a pas ces composants » — c'est
  // faux depuis que `createAssetModel` applique `applyNodeMixin` (assets.js) : un modèle porte
  // de VRAIS composants Collider et Physics, dont les vues sont consultées AVANT ce bloc et
  // consomment l'événement. Et `userData.collider` / `userData.phys` sont les données de ces
  // composants-là, pas des sacs séparés : on écrivait deux fois au même endroit.

  // Nom, tag et calque : écrits par le socle, sur toutes les cibles sélectionnées.
  // Position / Rotation / Échelle : écrites par le socle, sur TOUTES les cibles sélectionnées.
  // Les relire ici les réécrirait sur la seule `selection`, et une valeur divergente (« — »)
  // s'y lirait comme un vide.

  // L'état du prefab est une valeur du plan : le socle le recalcule à chaque synchronisation,
  // sans reconstruire le panneau — c'est ce que updateStatePrefab() ne savait pas faire.
});


inspBody.addEventListener('click', function(e){
  // Les deux boutons de l'état vide : ils ramènent au panneau qui porte le réglage cherché.
  // Ils vivent AVANT la garde `!selection` — ils ne s'affichent que là.
  if(e.target.id === 'btn-open-environment' || e.target.id === 'btn-open-render'){
    const id = (e.target.id === 'btn-open-environment') ? 'environment' : 'render';
    openPanelDock(id);
    return;
  }
  if(!selection) return;
  // pliage d'un bloc de composant : bascule l'état en mémoire et le DOM directement,
  // sans reconstruire tout l'inspecteur (ne coupe pas l'édition d'un autre champ)
  // `closest` et non `classList.contains` : le chevron et la corbeille sont des icônes
  // Phosphor, donc le clic atterrit sur le `<i>` INTÉRIEUR. Tester la cible elle-même
  // laissait tomber le clic — le composant ne se repliait plus et ne se retirait plus, sans
  // qu'aucune erreur ne soit levée. Même piège que dans la hiérarchie, même remède.
  const fold = e.target.closest ? e.target.closest('.fold-component') : null;
  if(fold){
    const block = fold.closest('.block-component');
    if(block){
      const key = block.dataset.key;
      const folded = !componentsReplies.get(key);
      componentsReplies.set(key, folded);
      block.classList.toggle('folded', folded);
      // `hidden` sur le corps : c'est ce que `.ui-card-body[hidden]` lit. La classe `folded`
      // reste posée sur la carte pour les tests et pour toute règle qui la cible encore.
      const body = block.querySelector('.body-component');
      if(body) body.hidden = folded;
      fold.innerHTML = Icons.html(folded ? 'caret-right' : 'caret-down');
    }
    return;
  }
  // Aperçu et arrêt d'animation : ce sont deux actions du panneau inspector-animations.
  // Les boutons des plugins sont des actions du socle, dans leur hôte : rien à router ici.
  // Les quatre boutons de sous-scène sont des actions du panneau inspector-subscene.
  // « Retirer la source audio » n'existe plus : le composant se retire par la croix de son en-tête,
  // comme tous les autres. Deux chemins de suppression pour une même chose, dont un seul appelait
  // onRemove, laissaient le son play après le retrait.
  // Les quatre boutons de prefab sont des actions du panneau inspector-prefab.
  // Même raison : les deux portent une icône, donc la cible du clic peut être le `<i>`.
  if(e.target.closest && e.target.closest('#btn-add-component')){
    openPopupComponents(selection);
    return;
  }
  const remove = e.target.closest ? e.target.closest('.remove-component') : null;
  if(remove){
    const c = selection.getComponents()[parseInt(remove.dataset.idx, 10)];
    if(c){ pushHistory(); selection.removeComponent(c); buildInspector(); }
  }
});

export function quitViewCamera(){
  setActiveCam(null);
  tc.camera = camEditor;
  document.getElementById('banner-cam').style.display = 'none';
  resize();
  if(selection) select(selection);
}


// ---------- Suppression / duplication ----------
export function removeHelper(o){
  const helper = ed(o).helper;
  if(helper){
    scene.remove(helper);
    const i = helpers.indexOf(helper);
    if(i !== -1) helpers.splice(i, 1);
    if(helper.dispose) helper.dispose();
    ed(o).helper = null;
  }
}

export function deleteRoot(root){
  const aRemove = [];
  root.traverse(function(o){ if(objects.indexOf(o) !== -1) aRemove.push(o); });
  root.parent.remove(root);
  aRemove.forEach(function(o){
    // Par `removeSceneObject`, et plus par un `splice` direct : celui-ci laissait l'objet dans
    // l'index (`isSceneObject`) et ses composants dans le Registry — des Systèmes itéraient
    // encore sur un objet supprimé.
    if(typeof removeSceneObject === 'function') removeSceneObject(o);
    else objects.splice(objects.indexOf(o), 1);
    // Le body physique part avec l'objet. Il ne se voit pas, donc un collider oublié ne se
    // remarque qu'au moment où quelque chose bute dans le vide.
    detachBodyPhysics(o);
    removeHelper(o);
    if(ed(o).cam && activeCam === ed(o).cam) quitViewCamera();
  });
  // Les géométries et matériaux d'un modèle importé sont PARTAGÉS avec son template et toutes
  // ses autres instances : les libérer ici les ferait retransférer au GPU à la prochaine image,
  // pour chaque instance restante. Ils partent avec l'asset, pas avec une instance.
  root.traverse(function(o){
    if(o.userData.modelNode !== undefined) return;
    if(o.getComponent && o.getComponent('Model')) return;
    if(o.geometry) o.geometry.dispose();
    listMats(o).forEach(function(m){ if(m.dispose) m.dispose(); });
  });
  // Les pistes de SCÈNE perdent l'objet supprimé. Celles d'un clip ouvert, non : elles visent
  // un CHEMIN, et un chemin survit à la disparition de ce qu'il désigne — comme une courbe
  // orpheline dans Unity. On se contente de recalculer la vue vivante du clip, dont l'entrée
  // pointerait sinon sur un objet détruit.
  setTracksOfScene(tracksOfScene().filter(function(p){ return aRemove.indexOf(p.obj) === -1; }));
  if(anim.assetClip){
    const a = assetClipOpen();
    if(a) anim.tracks = tracksLiveOfClip(a, anim.rootClip);
  }
  if(keySel && anim.tracks.indexOf(keySel.track) === -1) setKeySel(null);
}

export function deleteSelection(){
  // Comme Unity : un nœud d'une instance de modèle ne se supprime pas — il vient du fichier, et
  // la prochaine reconstruction le ferait revenir. On le désactive.
  const all = allSelection();
  const group = all.filter(function(o){ return o.userData.modelNode === undefined; });
  if(group.length < all.length){
    setStatus('Un nœud de modèle importé ne se supprime pas : désactivez-le (case de visibilité) '
      + '— il vient du fichier, comme l\'enfant d\'un prefab Unity', 5000);
  }
  if(!group.length) return;
  pushHistory();
  gizmoAttach(null);
  group.forEach(deleteRoot);
  select(null);
  updateHierarchy();
  updateTimeline();
}

export function duplicateRoot(root){
  const copie = cloneCleanly(root);
  // La peau de la copie doit suivre SES os, pas ceux de l'original.
  rebindSkeletons(copie, false);
  reenableSubTree(copie);
  copie.position.x += 2;
  root.parent.add(copie);
  return copie;
}

export function duplicateSelection(){
  const group = allSelection();
  if(!group.length) return;
  pushHistory();
  const copies = group.map(duplicateRoot);
  select(copies[0]);
  copies.slice(1).forEach(function(c){
    selectionMulti.push(c);
    setHighlight(c, true);
  });
  updateHierarchy();
}


// ---------- Copier / coller ----------
export let clipBoard = [];   // clones détachés servant de modèles

export function copySelection(){
  const group = allSelection();
  if(!group.length){ setStatus('Rien à copier — sélectionnez un objet', 2000); return; }
  clipBoard = group.map(cloneCleanly);
  setStatus(clipBoard.length + ' objet(s) copié(s) — Ctrl+V pour coller', 2500);
}

export function pasteClipBoard(){
  if(!clipBoard.length) return;
  pushHistory();
  const copies = clipBoard.map(function(mod){
    const c = mod.clone(true);
    rebindSkeletons(c, false);
    reenableSubTree(c);
    c.position.x += 1.5;
    c.position.z += 1.5;
    scene.add(c);
    return c;
  });
  select(copies[0]);
  copies.slice(1).forEach(function(c){
    selectionMulti.push(c);
    setHighlight(c, true);
  });
  updateHierarchy();
  applyFilters();
  setStatus(copies.length + ' objet(s) collé(s)', 2000);
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.buildInspector = buildInspector;
globalThis.quitViewCamera = quitViewCamera;
globalThis.removeHelper = removeHelper;