import { state } from '../state.js';
import { nearestCentroidIndex } from '../services/spatial.js';

export function attachExportButtons(){
  document.getElementById('exportPNGButton')?.addEventListener('click', async () => {
    await exportPNGStatic();
  });

  document.getElementById('exportProxExcelButton')?.addEventListener('click', async () => {
    await exportDistancesExcelForCurrentParcel();
  });
}

export async function exportPNGStatic(){
  const R = Math.max(0, parseFloat(document.getElementById('distanceInput')?.value || '500') || 500);
  const center = state.map.getCenter();
  const nearestIdx = nearestCentroidIndex(state.parcelCentroids, [center.lng, center.lat]);
  const p = state.parcelCentroids[nearestIdx];
  if (!p) { alert('Yakında parsel bulunamadı.'); return; }

  const hidden = [];
  state.animDots.forEach(d => {
    if (state.map.getLayer(d.layerId)) {
      hidden.push(d.layerId);
      state.map.setLayoutProperty(d.layerId, 'visibility', 'none');
    }
  });

  const radiusM = 1000 + (R / 2);
  const radiusKm = radiusM / 1000;
  const circle = turf.circle(p.geometry.coordinates, radiusKm, { steps: 64, units: 'kilometers' });
  const bbox = turf.bbox(circle);
  state.map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 40, animate: false });

  await new Promise(r => setTimeout(r, 300));

  const dataURL = state.map.getCanvas().toDataURL('image/png');
  const link = document.createElement('a');
  link.download = `harita_analiz_${Math.round(radiusM)}m.png`;
  link.href = dataURL;
  link.click();

  hidden.forEach(id => state.map.setLayoutProperty(id, 'visibility', 'visible'));
}

function getCurrentParcelCentroid(){
  const c = state.map.getCenter();
  const idx = nearestCentroidIndex(state.parcelCentroids, [c.lng, c.lat]);
  return state.parcelCentroids[idx];
}

function getAmenitiesWithinRadiusFiltered(centerLng, centerLat, radiusM){
  const radiusKm = Math.max(0, radiusM) / 1000;
  const catFilter = f => {
    const k = f.properties?.Kategori || 'Bilinmiyor';
    return state.selectedCategories.size === 0 || state.selectedCategories.has(k);
  };

  if (state.amenIdx && typeof window.geokdbush !== 'undefined') {
    const hits = window.geokdbush.around(state.amenIdx, centerLng, centerLat, Infinity, radiusKm);
    return hits.map(h => state.amenities[h.idx]).filter(catFilter);
  } else {
    const circlePoly = turf.circle([centerLng, centerLat], radiusKm, { steps: 64, units: 'kilometers' });
    const inside = turf.pointsWithinPolygon({ type: 'FeatureCollection', features: state.amenities }, circlePoly);
    return inside.features.filter(catFilter);
  }
}

async function exportDistancesExcelForCurrentParcel(){
  const parcel = getCurrentParcelCentroid();
  if (!parcel) { alert('Yakında parsel bulunamadı.'); return; }

  const R = Math.max(0, parseFloat(document.getElementById('distanceInput')?.value || '500') || 500);
  const mode = (document.getElementById('distanceMode')?.value || 'haversine');
  const center = parcel.geometry.coordinates;

  const feats = getAmenitiesWithinRadiusFiltered(center[0], center[1], R);
  if (!feats.length) { alert('Bu yarıçap içinde donatı bulunamadı.'); return; }

  let rows = [];
  if (mode === 'network') {
    try {
      const enriched = await (await import('../services/mapbox.js')).matrixDistance(center, feats);
      enriched
        .filter(e => e.distMeters != null)
        .sort((a,b) => a.distMeters - b.distMeters)
        .forEach(e => {
          const p = e.feature.properties || {};
          rows.push({
            'Parsel': parcel.properties?.name || '',
            'Yarıçap (m)': R,
            'Kategori': p.Kategori || 'Donatı',
            'Ad': p.Ad || 'Bilinmiyor',
            'Mesafe (m)': Math.round(e.distMeters),
            'Süre (dk)': (e.durationSec != null) ? (e.durationSec/60).toFixed(1) : '',
            'Donatı Koordinat': `${e.feature.geometry.coordinates[1]}, ${e.feature.geometry.coordinates[0]}`
          });
        });
    } catch (err) {
      console.warn('Matrix hatası, kuşbakışıya düşüyorum:', err);
      rows = feats.map(f => {
        const d = turf.distance(turf.point(center), f, { units:'kilometers' }) * 1000;
        const p = f.properties || {};
        return {
          'Parsel': parcel.properties?.name || '',
          'Yarıçap (m)': R,
          'Kategori': p.Kategori || 'Donatı',
          'Ad': p.Ad || 'Bilinmiyor',
          'Mesafe (m)': Math.round(d),
          'Süre (dk)': '',
          'Donatı Koordinat': `${f.geometry.coordinates[1]}, ${f.geometry.coordinates[0]}`
        };
      }).sort((a,b)=>a['Mesafe (m)'] - b['Mesafe (m)']);
    }
  } else {
    rows = feats.map(f => {
      const d = turf.distance(turf.point(center), f, { units:'kilometers' }) * 1000;
      const p = f.properties || {};
      return {
        'Parsel': parcel.properties?.name || '',
        'Yarıçap (m)': R,
        'Kategori': p.Kategori || 'Donatı',
        'Ad': p.Ad || 'Bilinmiyor',
        'Mesafe (m)': Math.round(d),
        'Süre (dk)': '',
        'Donatı Koordinat': `${f.geometry.coordinates[1]}, ${f.geometry.coordinates[0]}`
      };
    }).sort((a,b)=>a['Mesafe (m)'] - b['Mesafe (m)']);
  }

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Mesafeler');
  const parcelNameSafe = (parcel.properties?.name || 'parsel').replace(/[\\/:*?"<>|]/g, '_');
  XLSX.writeFile(wb, `${parcelNameSafe}_${R}m_mesafe.xlsx`);
}
