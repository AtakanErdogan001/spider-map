import { state } from '../state.js';
import { addParcelsLayers } from '../layers/parcels.js';
import { addAmenitiesLayers } from '../layers/amenities.js';
import { buildLegend } from './legend.js';
import { updateSpider, applyAmenityFilter } from '../features/spider.js';

export function attachStyleSwitcher(){
  document.getElementById('styleSwitcher')?.addEventListener('change', function(){
    const selectedStyle = this.value;
    const center = state.map.getCenter();
    const zoom = state.map.getZoom();

    // Temiz görsel katmanlar spider içinde yönetiliyor; burada style değişimi
    state.map.setStyle(selectedStyle);

    state.map.once('style.load', async () => {
      state.map.setCenter(center); state.map.setZoom(zoom);

      addParcelsLayers(state.map, state.parcels, state.parcelCentroids);
      addAmenitiesLayers(state.map, { type:'FeatureCollection', features: state.amenities });

      state.map.setLayoutProperty('amenities-heat',   'visibility', state.heatmapOn ? 'visible' : 'none');
      state.map.setLayoutProperty('amenities-points', 'visibility', state.heatmapOn ? 'none'    : 'visible');

      applyAmenityFilter();
      buildLegend(state.allCategories);

      const newCenter = state.parcelCentroids[state.proximityOrder[state.currentIndex]].geometry.coordinates;
      await updateSpider(newCenter);
    });
  });
}
