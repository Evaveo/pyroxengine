// moteur/js/systems/tilemap-system.js
//
// Reconstruit les mailles des tilemaps marquées `_dirty`. Une par tuile de palette utilisée, et
// pas une seule : deux tuiles, ce sont deux planches, donc deux textures, donc deux matériaux de
// rendu. Les fondre exigerait des graphistes qu'ils dessinent tout sur une seule image.
//
// Le même système pour l'éditeur ET le jeu publié : c'est ce qui remplace `rtBuildTilemap`, un
// miroir qui avait déjà divergé de son original (le compteur de version y manquait, et une
// porte ouverte par un script continuait de bloquer).
import { rebuildTilemap } from '../components/component-tilemap.js';
import { System } from '../systems.js';

System.register({
  name: 'TilemapSystem',
  requires: ['Tilemap'],
  order: 200,
  onFrame(instances){
    instances.forEach(function(t){
      if(!t._dirty) return;
      // `rebuildTilemap` décide lui-même de `_dirty` : il le LAISSE levé quand une texture n'est
      // pas encore décodée, pour réessayer à l'image suivante.
      rebuildTilemap(t.node);
    });
  }
});
