import { state } from '../state.js';

export function addAmenitiesLayers(map, amenityData) {
  map.addSource('amenities', { type: 'geojson', data: amenityData });

  map.addLayer({
    id: 'amenities-heat',
    type: 'heatmap',
    source: 'amenities',
    maxzoom: 19,
    paint: {
      'heatmap-weight': ['case', ['has', 'weight'], ['coalesce', ['to-number', ['get', 'weight']], 1], 1],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 10, 1, 15, 3],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 10, 15, 15, 40],
      'heatmap-color': [
        'interpolate', ['linear'], ['heatmap-density'],
        0, 'rgba(0,0,0,0)', 0.2, '#2c7fb8', 0.4, '#41b6c4', 0.6, '#a1dab4', 0.8, '#ffffcc', 1, '#ffeda0'
      ],
      'heatmap-opacity': 0.85
    }
  });

  map.addLayer({
    id: 'amenities-points', type: 'circle', source: 'amenities',
    paint: {
      'circle-radius': 5,
      'circle-color': [
        'match', ['get', 'Kategori'],
        'Parklar', '#4CAF50',
        'Okullar', '#2196F3',
        'İbadet Alanları', '#9C27B0',
        'Su Kaynakları', '#00BCD4',
        'Sağlık Kurumları', '#F44336',
        'Raylı Sistem Durakları', '#FF9800',
        '#9E9E9E'
      ]
    }
  });

  // Heatmap toggle düğmesi (exportPNGButton sonrasına ekle)
  const btn = document.createElement('button');
  btn.id = 'heatmapToggleBtn';
  btn.className = 'btn';
  btn.style.marginLeft = '8px';
  btn.textContent = state.heatmapOn ? 'Heatmap Kapat' : 'Heatmap Aç';
  btn.onclick = () => {
    state.heatmapOn = !state.heatmapOn;
    if (map.getLayer('amenities-heat') && map.getLayer('amenities-points')) {
      map.setLayoutProperty('amenities-heat', 'visibility', state.heatmapOn ? 'visible' : 'none');
      map.setLayoutProperty('amenities-points', 'visibility', state.heatmapOn ? 'none' : 'visible');
    }
    btn.textContent = state.heatmapOn ? 'Heatmap Kapat' : 'Heatmap Aç';
  };
  document.getElementById('exportPNGButton')?.after(btn);
}
