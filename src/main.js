import { MAPBOX_TOKEN } from './config.js';
import { state } from './state.js';
import { getCentroids, getProximityOrder } from './services/spatial.js';
import { addParcelsLayers } from './layers/parcels.js';
import { addAmenitiesLayers } from './layers/amenities.js';
import { buildLegend } from './ui/legend.js';
import { attachStyleSwitcher } from './ui/styleSwitcher.js';
import { attachHoverButton, setHoverVisibility } from './ui/hover.js';
import { updateSpider, applyAmenityFilter } from './features/spider.js';
import { attachAnalysisButtons } from './features/analysis.js';
import { attachExportButtons } from './features/export.js';
import { setupParcelSearch } from './features/search.js';
import { attachShortcuts } from './features/shortcuts.js';
import { attachPanelUX } from './ui/panel.js';

mapboxgl.accessToken = MAPBOX_TOKEN;

/* Chart.js – global varsayılanlar (legend fontlarını büyüt vs.) */
if (window.Chart) {
  Chart.defaults.font.family = "system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, 'Helvetica Neue', Arial";
  Chart.defaults.font.size = 15; // genel default
  Chart.defaults.plugins.legend.labels.font = { size: 15, weight: '500' };
  Chart.defaults.plugins.legend.labels.padding = 14;
  Chart.defaults.plugins.legend.labels.boxWidth = 16;
  if (window.ChartDataLabels) {
    Chart.defaults.set('plugins.datalabels', {
      font: { size: 12, weight: 'bold' },
      color: '#fff'
    });
  }
}

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v11',
  center: [27.1428, 38.4192],
  zoom: 14,
  preserveDrawingBuffer: true
});
state.map = map;

map.on('load', async () => {
  const [parcelData, amenityData] = await Promise.all([
    fetch('/data/parseller.geojson').then(r => r.json()),
    fetch('/data/donatilar.geojson').then(r => r.json())
  ]);

  state.parcels = parcelData.features;
  state.parcelCentroids = getCentroids(state.parcels);
  state.amenities = amenityData.features;
  state.proximityOrder = getProximityOrder(state.parcelCentroids);

  // KDBush index
  state.amenPoints = state.amenities.map((f, idx) => ({ lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], idx }));
  if (window.kdbush && typeof window.kdbush.KDBush === 'function') {
    try { state.amenIdx = new window.kdbush.KDBush(state.amenPoints, p => p.lng, p => p.lat); }
    catch(e){ console.warn('KDBush index kurulamadı:', e); }
  }

  addParcelsLayers(map, state.parcels, state.parcelCentroids);
  addAmenitiesLayers(map, amenityData);

  // Kategoriler + filtre
  state.allCategories = Array.from(new Set(state.amenities.map(f => f.properties?.Kategori || 'Bilinmiyor'))).sort();
  buildLegend(state.allCategories);
  applyAmenityFilter();

  // Başlangıç spider
  const start = state.parcelCentroids[state.proximityOrder[state.currentIndex]].geometry.coordinates;
  map.flyTo({ center: start });
  await updateSpider(start);

  // UI/Event bağları
  attachPanelUX();
  attachStyleSwitcher();
  attachHoverButton();
  attachAnalysisButtons();
  attachExportButtons();
  setupParcelSearch();
  attachShortcuts();

  // Hover paneli ilk kapalı
  setHoverVisibility(false);

  // Kontroller: yarıçap / mesafe türü değişince spider güncelle
  ['input','change'].forEach(evt =>
    document.getElementById('distanceInput')?.addEventListener(evt, async () => {
      if (state.hoverEnabled && state.lastMouseLngLat) {
        const { updateHoverCircleAt } = await import('./ui/hover.js');
        updateHoverCircleAt(state.lastMouseLngLat);
      }
      await updateSpider([map.getCenter().lng, map.getCenter().lat]);
    })
  );
  document.getElementById('distanceMode')?.addEventListener('change', async () => {
    await updateSpider([map.getCenter().lng, map.getCenter().lat]);
  });

  // Sağ tık popup
  map.on('contextmenu', e => {
    const features = map.queryRenderedFeatures(e.point, { layers: ['centroids-points', 'amenities-points'] });
    const content = features.length
      ? Object.entries(features[0].properties).map(([k, v]) => `<b>${k}</b>: ${v}`).join('<br>')
      : 'Yakında veri bulunamadı.';
    new mapboxgl.Popup().setLngLat(e.lngLat).setHTML(content).addTo(map);
  });
});
