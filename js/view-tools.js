// ---------- Grille de sol ----------
// Le même réglage que Préférences → Apparence, atteignable là où on s'en sert : on cache la
// grille pour juger un sol ou un cadrage, c'est-à-dire au moment précis où l'on regarde la
// scène — pas au moment où l'on ouvre les préférences.
//
// LA PRÉFÉRENCE RESTE LA SOURCE DE VÉRITÉ. Le bouton ne retient rien : il écrit `grid.visible`
// et relit son état depuis elle. Un booléen gardé dans ce fichier aurait divergé de la case des
// préférences dès qu'on aurait touché l'une des deux — deux commandes pour un réglage, c'est
// une commande de trop si elles ne partagent pas la même valeur.
import { activeCam, orbit, tc, updateCamera } from './scene.js';
import { selection } from './selection.js';
import { Prefs } from './ui/prefs.js';

(function(){
  const btn = document.getElementById('filter-grid');
  if(!btn) return;
  const visible = () => (typeof Prefs === 'undefined') || Prefs.get('grid.visible') !== false;
  function sync(){ btn.classList.toggle('active', visible()); }
  btn.addEventListener('click', function(){
    Prefs.set('grid.visible', !visible());
    sync();
  });
  sync();
})();

// ---------- Aimant du gizmo ----------
document.getElementById('filter-magnet').addEventListener('click', function(){
  const active = !this.classList.contains('active');
  this.classList.toggle('active', active);
  tc.setTranslationSnap(active ? 0.5 : null);
  tc.setRotationSnap(active ? THREE.MathUtils.degToRad(15) : null);
  tc.setScaleSnap(active ? 0.1 : null);
});


// ---------- Cadrage (F) ----------
export function frameSelection(){
  if(!selection || activeCam) return;
  const box = new THREE.Box3().setFromObject(selection);
  if(box.isEmpty()) return;
  box.getCenter(orbit.target);
  const size = box.getSize(new THREE.Vector3());
  orbit.dist = Math.max(4, Math.max(size.x, size.y, size.z) * 2.2);
  updateCamera();
}
