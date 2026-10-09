// ---------- Assembler des planches : la face d'édition ----------
//
// Le rangement est dans js/sprite-atlas.js, pur et vérifié par balayage. Ici ne vivent que la
// fenêtre de choix et le DESSIN sur un canvas.
//
// Le découpage n'est pas cosmétique : le seul défaut vraiment coûteux d'un atlas est le
// chevauchement de deux images — un sprite avec un bout d'un autre collé au bord — et il se vérifie
// sur des centaines de cas dans un test, ce qu'un canvas ne permettrait pas.

import { assetId, assets, createAssetTexture, folderCurrent, nextAssetId, updateProject } from './assets.js';
import { setStatus } from './hierarchy.js';
import { pushHistory } from './history.js';
import { ensureParamsImport } from './import-settings.js';
import { escapeHtml } from './objects.js';
import { selectAsset } from './selection.js';
import { slugFile } from './serialization.js';
import { planeAtlasFromSprites, validateAtlas } from './sprite-atlas.js';
import { closeModal, openModal } from './ui.js';
import { loop } from './viewport.js';

/** L'image source d'un asset de sprite, prête à dessiner, ou `null`. */
export function imageSourceSprite(a){
  const tex = assets.find(function(x){ return x.id === a.textureId; });
  if(!tex) return null;
  // `imageSource` est posée par le chargement asynchrone de la texture. Sans elle, l'image n'est pas
  // encore arrivée : dessiner maintenant produirait un atlas VIDE — une texture transparente, un
  // asset qui a l'air correct, et des sprites invisibles qu'on mettrait sur le compte des régions.
  return tex.imageSource || (tex.texture && tex.texture.image) || null;
}

/** La fenêtre de choix des planches à assembler. */
export function modalAtlasSprite(start){
  const sprites = assets.filter(function(x){ return x.kind === 'sprite'; });
  const row = function(a){
    const img = imageSourceSprite(a);
    const n = (a.regions || []).length;
    const ready = !!img && n > 0;
    return '<tr><td><input type="checkbox" class="atlas-choice" data-id="' + a.id + '"'
      + (a === start ? ' checked' : '') + (ready ? '' : ' disabled') + '></td>'
      + '<td>' + escapeHtml(a.name) + '</td>'
      + '<td style="text-align:right">' + n + '</td>'
      + '<td style="text-align:right">' + (Number(a.ppu) || 0) + '</td>'
      + '<td>' + (ready ? '' : (!img ? 'image non chargée' : 'non découpée')) + '</td></tr>';
  };
  openModal('Assembler des planches en une seule',
    '<p style="margin-bottom:8px;line-height:1.5">Un <b>animateur de sprite</b> lit toutes ses '
    + 'suites dans <b>une seule</b> planche. Un personnage livré en plusieurs fichiers — un par '
    + 'état — doit donc être réuni ici. L\'assemblage crée une <b>nouvelle</b> planche : les '
    + 'originales ne sont pas touchées.</p>'
    + '<table><tr><th></th><th>Planche</th><th>Images</th><th>px/unité</th><th></th></tr>'
    + sprites.map(row).join('') + '</table>'
    + '<div class="ip-note" id="atlas-verdict" style="margin-top:10px"></div>'
    + '<div style="display:flex;gap:8px;margin-top:12px;justify-content:space-between">'
    + '<button class="btn-modal" id="atlas-cancel">Annuler</button>'
    + '<button class="btn-modal accent" id="atlas-make">🧩 Assembler</button></div>');

  const choisies = function(){
    return Array.from(document.querySelectorAll('.atlas-choice'))
      .filter(function(c){ return c.checked; })
      .map(function(c){ return assets.find(function(x){ return x.id === c.dataset.id; }); })
      .filter(Boolean);
  };
  // Le verdict est affiché AVANT d'assembler, et il se met à jour à chaque checked : un atlas de
  // 4096 × 4096 ou un mélange de ppu se corrige mieux avant qu'après.
  const updateVerdict = function(){
    const el = document.getElementById('atlas-verdict');
    const l = choisies();
    const soucis = validateAtlas(l);
    if(soucis.length){
      el.innerHTML = soucis.map(function(s){ return escapeHtml(s); }).join('<br>');
      return;
    }
    const plan = planeAtlasFromSprites(l, 1);
    if(!plan){ el.textContent = 'Rien à assembler.'; return; }
    const useful = plan.regions.reduce(function(s, r){ return s + r.l * r.h; }, 0);
    el.innerHTML = '<b>' + plan.regions.length + ' image(s)</b> dans une planche de <b>'
      + plan.l + ' × ' + plan.h + '</b> px — ' + Math.round(100 * useful / (plan.l * plan.h))
      + ' % de place utilisée, ' + (Number(plan.ppu) || 0) + ' px par unité.';
  };
  document.getElementById('modal-body').addEventListener('change', updateVerdict);
  updateVerdict();

  document.getElementById('atlas-cancel').addEventListener('click', closeModal);
  document.getElementById('atlas-make').addEventListener('click', function(){
    const l = choisies();
    const soucis = validateAtlas(l);
    if(soucis.length){ setStatus(soucis[0], 7000); return; }
    assembleAtlasSprite(l);
  });
}

/**
 * Dessine l'atlas et crée les deux assets : la texture, et la planche qui la découpe.
 *
 * Les originales ne sont PAS modifiées. Un assemblage qui remplacerait ses sources casserait toutes
 * les scènes qui les citent, et l'auteur n'aurait aucun medium de revenir en arrière — alors qu'il
 * voudra souvent réassembler après avoir redécoupé une planche.
 */
/**
 * Rend une PROMESSE de l'asset produit.
 *
 * `canvas.toBlob` est asynchrone : sans promesse, un appelant qui veut enchaîner — une commande du
 * copilot, un script d'automatisation — ne peut pas savoir quand l'atlas existe. Il lisait alors la
 * liste des assets AVANT que le nouvel asset y soit, concluait à un échec, et réassemblait.
 */
export function assembleAtlasSprite(sources){
  return new Promise(function(resolve, rejeter){
    assembleAtlasSpriteInternal(sources, resolve, rejeter);
  });
}

export function assembleAtlasSpriteInternal(sources, resolve, rejeter){
  const plan = planeAtlasFromSprites(sources, 1);
  if(!plan){ setStatus('Rien à assembler.', 4000); rejeter(new Error('rien à assembler')); return; }

  const cv = document.createElement('canvas');
  cv.width = plan.l; cv.height = plan.h;
  const cx = cv.getContext('2d');
  // PAS DE LISSAGE. Le dessin est une recopie pixel pour pixel à l'échelle 1 ; le lissage n'aurait
  // rien à interpoler, mais il suffit d'un demi-pixel d'arrondi pour qu'il mélange le bord de
  // l'image avec le vide qui l'entoure — un liseré translucide sur chaque sprite.
  cx.imageSmoothingEnabled = false;
  cx.clearRect(0, 0, cv.width, cv.height);

  let dessinees = 0;
  plan.regions.forEach(function(r){
    const img = imageSourceSprite(r.source);
    if(!img) return;
    const s = r.sourceRegion;
    cx.drawImage(img, s.x, s.y, s.l, s.h, r.x, r.y, r.l, r.h);
    dessinees++;
  });
  if(!dessinees){
    setStatus('Aucune image n\'a pu être dessinée : les planches ne sont pas encore chargées. '
      + 'Réessayez dans un instant.', 7000);
    rejeter(new Error('planches pas encore chargées'));
    return;
  }

  const base = (sources[0] && sources[0].name ? String(sources[0].name).split(/[ _\-/]/)[0] : 'Atlas');
  const name = base + ' (atlas)';
  cv.toBlob(function(blob){
    if(!blob){ setStatus('L\'image de l\'atlas n\'a pas pu être produite.', 5000);
               rejeter(new Error('image de l\'atlas non produite')); return; }
    pushHistory();
    const file = new File([blob], slugFile(name) + '.png', {type: 'image/png'});
    const tex = createAssetTexture(file, {name: name});
    // Filtrage au plus proche et pas de mipmaps : un atlas de pixel-art lissé perd exactement ce
    // qui fait son intérêt, et les mipmaps mélangeraient les images voisines entre elles.
    const p = ensureParamsImport(tex);
    if(p){ p.filtrage = 'near'; p.mipmaps = false; }
    const a = {id: 'a' + (nextAssetId()), kind: 'sprite', folder: folderCurrent,
      name: name, format: 'sprite', version: 1,
      textureId: tex.id, ppu: plan.ppu,
      pivot: {x: (sources[0] && sources[0].pivot && sources[0].pivot.x) || 0.5,
              y: (sources[0] && sources[0].pivot && sources[0].pivot.y) || 0.5},
      // Les régions SANS `source`/`sourceRegion` : ces deux champs servaient au dessin et
      // référencent des assets. Les garder ferait une référence circulaire que la sérialisation
      // n'écrirait pas, et un atlas rechargé pointerait sur des objets absents.
      regions: plan.regions.map(function(r){
        return {name: r.name, x: r.x, y: r.y, l: r.l, h: r.h};
      }),
      // Une suite par planche source, dans l'ordre de découpe : c'est presque toujours ce qu'on
      // veut, et le seul geste que l'assemblage peut deviner sans se tromper. L'auteur renomme et
      // règle la cadence ensuite.
      sequences: sources.map(function(s){
        const images = plan.regions
          .filter(function(r){ return r.source === s; })
          .map(function(r){ return r.name; });
        return {name: s.name, images: images, ips: 12, loop: true, events: []};
      }).filter(function(su){ return su.images.length > 0; })};
    assets.push(a);
    updateProject();
    closeModal();
    selectAsset(a);
    setStatus('« ' + name + ' » : ' + a.regions.length + ' image(s) de ' + sources.length
      + ' planche(s) dans ' + plan.l + ' × ' + plan.h + ' px, et ' + a.sequences.length
      + ' suite(s) prêtes à régler.', 8000);
    resolve(a);
  }, 'image/png');
}
