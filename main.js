// ===========================
// main.js (OSRM entegrasyonlu: Kuşbakışı vs Yol Ağı seçimi)
// ===========================

mapboxgl.accessToken = 'pk.eyJ1IjoiYXRha2FuZSIsImEiOiJjbWNoNGUyNWkwcjFqMmxxdmVnb2tnMWJ4In0.xgo3tCNuq6kVXFYQpoS8PQ';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v11',
  center: [27.1428, 38.4192],
  zoom: 14
});

// ---- OSRM config
const OSRM_BASE = 'http://localhost:5000';        // ← Docker OSRM endpoint
const USE_OSRM_ROUTES_FOR_TOP = true;             // true: ilk N için gerçek rota polyline çizer
const OSRM_ROUTE_DRAW_TOP_N = 10;                 // kaç rota çizilsin (ağır olmasın diye 10 iyi bir sınır)

// ---- Global state
let parcels = [], parcelCentroids = [], amenities = [];
let proximityOrder = [], currentIndex = 0;
let currentLines = [], currentLabels = [], lastSpiderCoord = null;
let lastSpiderData = [];

// ---- Hover circle IDs / state
const HOVER_SRC = 'hover-circle-src';
const HOVER_FILL = 'hover-circle-fill';
const HOVER_OUTLINE = 'hover-circle-outline';
const IN_CIRCLE_SRC = 'amenities-in-circle-src';
const IN_CIRCLE_LAYER = 'amenities-in-circle-layer';
let lastMouseLngLat = null;

// Toggle (varsayılan kapalı)
let hoverEnabled = false;

// Fast circle query (opsiyonel)
let amenIdx = null;               // KDBush index
let amenPoints = [];              // [{lng,lat,idx}]
let allCategories = [];
let selectedCategories = new Set();

// ---- Kategori paneli görünürlük durumu (K kısayolu ile kontrol)
let legendVisible = true;

// ===========================
// Helpers
// ===========================
function getCentroids(features) {
  return features.map(f => {
    const centroid = turf.centroid(f);
    centroid.properties = { ...f.properties };
    return centroid;
  });
}

function clearVisuals() {
  currentLines.forEach(id => {
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  });
  currentLabels.forEach(id => {
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  });
  currentLines = [];
  currentLabels = [];
}

function getProximityOrder(centroids) {
  const base = centroids[0];
  return centroids
    .map((c, i) => ({ index: i, dist: turf.distance(base, c) }))
    .sort((a, b) => a.dist - b.dist)
    .map(e => e.index);
}

// ===========================
// OSRM helpers
// ===========================
async function osrmTableDistance(center, destFeatures) {
  // OSRM Table: tek kaynak (index 0 = center), çok hedef
  if (!destFeatures.length) return [];

  const coords = [
    `${center[0]},${center[1]}`,
    ...destFeatures.map(f => `${f.geometry.coordinates[0]},${f.geometry.coordinates[1]}`)
  ].join(';');

  const destIdx = destFeatures.map((_, i) => i + 1).join(';'); // 1..N
  const url = `${OSRM_BASE}/table/v1/driving/${coords}?sources=0&destinations=${destIdx}&annotations=duration,distance`;

  const res = await fetch(url);
  if (!res.ok) throw new Error('OSRM table hatası');
  const data = await res.json();

  // data.distances[0] ve data.durations[0] tek source olduğu için
  const distances = (data.distances && data.distances[0]) || [];
  const durations = (data.durations && data.durations[0]) || [];

  return destFeatures.map((f, i) => ({
    feature: f,
    distMeters: typeof distances[i] === 'number' ? distances[i] : null,
    durationSec: typeof durations[i] === 'number' ? durations[i] : null
  }));
}

async function osrmRouteGeoJSON(start, end) {
  // Tam rota geometri (isteğe bağlı)
  const coords = `${start[0]},${start[1]};${end[0]},${end[1]}`;
  const url = `${OSRM_BASE}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('OSRM route hatası');
  const data = await res.json();
  const route = data.routes && data.routes[0];
  return route ? route.geometry : null; // GeoJSON LineString
}

// ===========================
// Spider
// ===========================
async function updateSpider(center) {
  const roundedCenter = center.map(n => Number(n.toFixed(6)));
  if (lastSpiderCoord &&
      roundedCenter[0] === lastSpiderCoord[0] &&
      roundedCenter[1] === lastSpiderCoord[1]) return;

  lastSpiderCoord = roundedCenter;
  clearVisuals();

  const centerPoint = turf.point(center);
  const maxDistanceMeters = parseFloat(document.getElementById('distanceInput')?.value || '0'); // kullanıcı girdisi
  let count = document.getElementById('lineCountSelect')?.value ?? '10';
  const distanceMode = document.getElementById('distanceMode')?.value || 'haversine'; // 'haversine' | 'osrm'

  // Kategori filtresi
  const filtered = amenities.filter(f => {
    const k = f.properties?.Kategori || 'Bilinmiyor';
    return selectedCategories.size === 0 || selectedCategories.has(k);
  });

  let nearest = [];

  if (distanceMode === 'osrm') {
    // ---- OSRM ağ mesafesi (metre) + süre (sn)
    try {
      const rows = await osrmTableDistance(center, filtered);
      // metre filtresi (0 ise filtreleme yapma)
      let arr = rows.map(r => ({
        feature: r.feature,
        distMeters: r.distMeters,
        durationSec: r.durationSec
      })).filter(r => r.distMeters != null);

      if (!isNaN(maxDistanceMeters) && maxDistanceMeters > 0) {
        arr = arr.filter(r => r.distMeters <= maxDistanceMeters);
      }

      // OSRM sonucu distMeters'a göre sırala
      arr.sort((a, b) => a.distMeters - b.distMeters);

      if (count !== 'all') arr = arr.slice(0, parseInt(count));

      // Görselleştirme + etiketleme için formatla (dist = km cinsinden)
      nearest = arr.map(r => ({
        feature: r.feature,
        dist: (r.distMeters / 1000),
        distMeters: r.distMeters,
        durationSec: r.durationSec,
        geometryOverride: null
      }));

      // İsteğe bağlı: en yakın ilk N için gerçek rota çiz
      if (USE_OSRM_ROUTES_FOR_TOP && nearest.length) {
        const topN = nearest.slice(0, OSRM_ROUTE_DRAW_TOP_N);
        await Promise.all(topN.map(async (item, i) => {
          try {
            const geom = await osrmRouteGeoJSON(center, item.feature.geometry.coordinates);
            item.geometryOverride = geom; // LineString
          } catch (_) {}
        }));
      }
    } catch (err) {
      console.warn('OSRM erişilemedi, kuşbakışına düşüyorum. Hata:', err);
      // OSRM yoksa fallback haversine
      nearest = filtered.map(f => ({
        feature: f,
        dist: turf.distance(centerPoint, f, { units: 'kilometers' })
      }));
      if (!isNaN(maxDistanceMeters) && maxDistanceMeters > 0) {
        nearest = nearest.filter(e => (e.dist * 1000) <= maxDistanceMeters);
      }
      nearest.sort((a, b) => a.dist - b.dist);
      if (count !== 'all') nearest = nearest.slice(0, parseInt(count));
    }
  } else {
    // ---- Haversine (turf) – kuşbakışı
    nearest = filtered.map(f => ({
      feature: f,
      dist: turf.distance(centerPoint, f, { units: 'kilometers' })
    }));
    if (!isNaN(maxDistanceMeters) && maxDistanceMeters > 0) {
      nearest = nearest.filter(e => (e.dist * 1000) <= maxDistanceMeters);
    }
    nearest.sort((a, b) => a.dist - b.dist);
    if (count !== 'all') nearest = nearest.slice(0, parseInt(count));
  }

  lastSpiderData = nearest;

  // Çizimler
  for (let i = 0; i < nearest.length; i++) {
    const entry = nearest[i];
    const to = entry.feature.geometry.coordinates;

    const lineId = `line-${i}`, labelId = `label-${i}`;
    let lineGeom;

    // OSRM modunda ve geometriOverride varsa onu kullan, yoksa düz çizgi
    if (entry.geometryOverride && entry.geometryOverride.type === 'LineString') {
      lineGeom = {
        type: 'Feature',
        geometry: entry.geometryOverride
      };
    } else {
      lineGeom = turf.lineString([center, to]);
    }

    map.addSource(lineId, { type: 'geojson', data: lineGeom });
    map.addLayer({
      id: lineId, type: 'line', source: lineId,
      paint: { 'line-width': 2, 'line-color': (entry.geometryOverride ? '#1E88E5' : '#3F51B5') }
    });
    currentLines.push(lineId);

    // Etiket: OSRM metrikleri varsa onları önceliklendir
    const distM = (entry.distMeters != null) ? entry.distMeters : entry.dist * 1000;
    const durS = entry.durationSec;
    const labelText = (durS != null)
      ? `${entry.feature.properties?.Kategori || 'Donatı'}\n${Math.round(distM)} m • ${Math.round(durS / 60)} dk`
      : `${entry.feature.properties?.Kategori || 'Donatı'}\n${Math.round(distM)} m`;

    // Orta nokta (rota varsa yaklaşık orta koordinatı al)
    let midPoint;
    if (entry.geometryOverride && entry.geometryOverride.coordinates?.length > 1) {
      const coords = entry.geometryOverride.coordinates;
      const midIdx = Math.floor(coords.length / 2);
      midPoint = turf.point(coords[midIdx]);
    } else {
      midPoint = turf.midpoint(turf.point(center), turf.point(to));
    }

    const labelFeature = {
      type: 'Feature',
      geometry: midPoint.geometry,
      properties: { label: labelText }
    };

    map.addSource(labelId, { type: 'geojson', data: labelFeature });
    map.addLayer({
      id: labelId, type: 'symbol', source: labelId,
      layout: { 'text-field': ['get', 'label'], 'text-font': ['Open Sans Bold'], 'text-size': 12, 'text-offset': [0, -1], 'text-anchor': 'top' },
      paint: { 'text-color': '#000', 'text-halo-color': '#fff', 'text-halo-width': 1 }
    });
    currentLabels.push(labelId);
  }
}

function exportSpiderDataToExcel(nearestEntries) {
  const data = nearestEntries.map(entry => {
    const props = entry.feature.properties || {};
    const distM = (entry.distMeters != null) ? entry.distMeters : entry.dist * 1000;
    const durMin = (entry.durationSec != null) ? (entry.durationSec / 60).toFixed(1) : '';
    return {
      'Kategori': props.Kategori || 'Donatı',
      'Ad': props.Ad || 'Bilinmiyor',
      'Mesafe (m)': distM != null ? distM.toFixed(0) : '',
      'Süre (dk)': durMin,
      'Koordinat': `${entry.feature.geometry.coordinates[1]}, ${entry.feature.geometry.coordinates[0]}`
    };
  });
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Mesafe Çıktısı');
  XLSX.writeFile(wb, 'mesafe_baglantilari.xlsx');
}
document.getElementById('exportExcelButton')?.addEventListener('click', () => {
  if (lastSpiderData.length > 0) exportSpiderDataToExcel(lastSpiderData);
  else alert('Henüz gösterilecek bağlantı verisi yok.');
});

// ===========================
// Hover circle + panel (aynen)
// ===========================
function ensureHoverCircleLayers() {
  if (!map.getSource(HOVER_SRC)) map.addSource(HOVER_SRC, { type: 'geojson', data: turf.featureCollection([]) });
  if (!map.getLayer(HOVER_FILL)) {
    map.addLayer({ id: HOVER_FILL, type: 'fill', source: HOVER_SRC,
      paint: { 'fill-color': '#3F51B5', 'fill-opacity': 0.10 } });
  }
  if (!map.getLayer(HOVER_OUTLINE)) {
    map.addLayer({ id: HOVER_OUTLINE, type: 'line', source: HOVER_SRC,
      paint: { 'line-color': '#3F51B5', 'line-width': 2 } });
  }
  if (!map.getSource(IN_CIRCLE_SRC)) map.addSource(IN_CIRCLE_SRC, { type: 'geojson', data: turf.featureCollection([]) });
  if (!map.getLayer(IN_CIRCLE_LAYER)) {
    map.addLayer({ id: IN_CIRCLE_LAYER, type: 'circle', source: IN_CIRCLE_SRC,
      paint: { 'circle-radius': 7, 'circle-color': '#FFFFFF', 'circle-stroke-color': '#3F51B5', 'circle-stroke-width': 2 } });
  }
}

function setHoverVisibility(visible) {
  [HOVER_FILL, HOVER_OUTLINE, IN_CIRCLE_LAYER].forEach(id => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  });
  const panel = document.getElementById('categorySummary');
  if (panel) panel.style.display = visible ? 'block' : 'none';
  const body = document.getElementById('categorySummaryBody');
  if (!visible && body) body.innerHTML = 'İmleci harita üzerinde gezdirin…';
}

// hızlı veya fallback sorgu (hover için kuşbakışı kullanıyoruz)
function queryAmenitiesInRadius(centerLng, centerLat, radiusMeters) {
  const radiusKm = Math.max(0, radiusMeters) / 1000;
  // KDBush varsa:
  if (amenIdx && typeof geokdbush !== 'undefined') {
    const hits = geokdbush.around(amenIdx, centerLng, centerLat, Infinity, radiusKm);
    return hits
      .map(h => ({ feature: amenities[h.idx], distKm: h.distance }))
      .filter(h => {
        const k = h.feature?.properties?.Kategori || 'Bilinmiyor';
        return selectedCategories.size === 0 || selectedCategories.has(k);
      });
  }
  // Fallback: turf
  const circlePoly = turf.circle([centerLng, centerLat], radiusKm, { steps: 64, units: 'kilometers' });
  const inside = turf.pointsWithinPolygon({ type: 'FeatureCollection', features: amenities }, circlePoly);
  const filtered = inside.features.filter(f => {
    const k = f.properties?.Kategori || 'Bilinmiyor';
    return selectedCategories.size === 0 || selectedCategories.has(k);
  });
  return filtered.map(f => ({
    feature: f,
    distKm: turf.distance([centerLng, centerLat], f, { units: 'kilometers' })
  }));
}

function updateHoverCircleAt(lngLat) {
  if (!hoverEnabled) return;

  lastMouseLngLat = lngLat;

  const radiusMeters = parseFloat(document.getElementById('distanceInput')?.value || '500');
  const rM = (isNaN(radiusMeters) ? 500 : radiusMeters);
  const radiusKm = Math.max(0, rM) / 1000;

  ensureHoverCircleLayers();
  const circle = turf.circle(lngLat, radiusKm, { steps: 64, units: 'kilometers' });
  map.getSource(HOVER_SRC).setData(circle);

  const around = queryAmenitiesInRadius(lngLat[0], lngLat[1], rM);
  map.getSource(IN_CIRCLE_SRC).setData({ type: 'FeatureCollection', features: around.map(a => a.feature) });

  const counts = {};
  around.forEach(a => {
    const k = a.feature.properties?.Kategori || 'Bilinmiyor';
    counts[k] = (counts[k] || 0) + 1;
  });

  const total = around.length;
  const body = document.getElementById('categorySummaryBody');
  if (!body) return;

  if (total === 0) {
    body.innerHTML = `Yarıçap: <strong>${Math.round(rM)}</strong> m<br>Bu alanda donatı yok.`;
    return;
  }

  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<div style="display:flex;justify-content:space-between;gap:12px;">
      <span>${k}</span><strong>${v}</strong></div>`).join('');

  body.innerHTML = `
    <div style="margin-bottom:6px;">Yarıçap: <strong>${Math.round(rM)}</strong> m</div>
    <div style="border-top:1px solid #eee; padding-top:6px; margin-top:6px;">
      ${rows}
      <div style="margin-top:6px; border-top:1px dashed #e3e3e3; padding-top:6px; display:flex;justify-content:space-between;">
        <span>Toplam</span><strong>${total}</strong>
      </div>
    </div>
  `;
}

// mousemove – sadece AÇIKKEN
let hoverTicking = false;
map.on('mousemove', (e) => {
  if (!hoverEnabled) return;
  if (hoverTicking) return;
  hoverTicking = true;
  requestAnimationFrame(() => {
    updateHoverCircleAt([e.lngLat.lng, e.lngLat.lat]);
    hoverTicking = false;
  });
});

// yarıçap değişince anlık güncelle
['input','change'].forEach(evt =>
  document.getElementById('distanceInput')?.addEventListener(evt, () => {
    if (hoverEnabled && lastMouseLngLat) updateHoverCircleAt(lastMouseLngLat);
    // spider da yarıçap filtresine bağlı olduğundan güncelle
    const center = [map.getCenter().lng, map.getCenter().lat];
    updateSpider(center);
  })
);

// Toggle UI
function refreshHoverToggleUI() {
  const btn = document.getElementById('hoverToggleBtn');
  if (btn) {
    btn.textContent = hoverEnabled ? 'Yakın Çevre Analizi: AÇIK' : 'Yakın Çevre Analizi: KAPALI';
    btn.setAttribute('aria-pressed', hoverEnabled ? 'true' : 'false');
  }
  setHoverVisibility(hoverEnabled);
  if (hoverEnabled) {
    const center = lastMouseLngLat || [map.getCenter().lng, map.getCenter().lat];
    updateHoverCircleAt(center);
  }
}
function enableHover() { hoverEnabled = true; ensureHoverCircleLayers(); refreshHoverToggleUI(); }
function disableHover() { hoverEnabled = false; refreshHoverToggleUI(); }

document.getElementById('hoverToggleBtn')?.addEventListener('click', () => {
  hoverEnabled ? disableHover() : enableHover();
});

// ===========================
// Legend / kategori filtresi
// ===========================
function setLegendVisibility(visible) {
  legendVisible = visible;
  const el = document.getElementById('categoryLegend');
  if (el) el.style.display = legendVisible ? 'block' : 'none';
}
function toggleLegendVisibility() { setLegendVisibility(!legendVisible); }

function buildLegend(categories) {
  let legend = document.getElementById('categoryLegend');
  if (!legend) {
    legend = document.createElement('div');
    legend.id = 'categoryLegend';
    document.body.appendChild(legend);
  }

  // sol-alt konum
  Object.assign(legend.style, {
    position: 'absolute',
    left: '12px',
    right: 'auto',
    bottom: '12px',
    zIndex: '3',
    background: 'rgba(255,255,255,0.95)',
    border: '1px solid #ddd',
    borderRadius: '8px',
    padding: '10px 12px',
    fontSize: '13px',
    minWidth: '220px',
    maxWidth: '300px',
    maxHeight: '40vh',
    overflow: 'auto',
    boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
    lineHeight: '1.35',
    display: legendVisible ? 'block' : 'none'
  });

  legend.innerHTML = `<div style="font-weight:600; margin-bottom:6px;">Kategoriler</div>`;

  // baştan hepsi seçili
  selectedCategories = new Set(categories);

  categories.forEach(cat => {
    const id = `cat_${cat.replace(/\s+/g, '_')}`;
    const wrap = document.createElement('label');
    Object.assign(wrap.style, { display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0' });

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = id;
    cb.checked = true;
    cb.addEventListener('change', () => {
      if (cb.checked) selectedCategories.add(cat);
      else selectedCategories.delete(cat);
      applyAmenityFilter();
      const c = [map.getCenter().lng, map.getCenter().lat];
      updateSpider(c);
      if (hoverEnabled && lastMouseLngLat) updateHoverCircleAt(lastMouseLngLat);
    });

    const nameSpan = document.createElement('span');
    nameSpan.textContent = cat;

    wrap.appendChild(cb);
    wrap.appendChild(nameSpan);
    legend.appendChild(wrap);
  });

  const ctrlRow = document.createElement('div');
  Object.assign(ctrlRow.style, { display: 'flex', justifyContent: 'space-between', marginTop: '8px' });

  const selectAllBtn = document.createElement('button');
  selectAllBtn.textContent = 'Tümünü Seç';
  selectAllBtn.style.fontSize = '12px';
  selectAllBtn.onclick = () => {
    selectedCategories = new Set(categories);
    legend.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
    applyAmenityFilter();
    const c = [map.getCenter().lng, map.getCenter().lat];
    updateSpider(c);
    if (hoverEnabled && lastMouseLngLat) updateHoverCircleAt(lastMouseLngLat);
  };

  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Temizle';
  clearBtn.style.fontSize = '12px';
  clearBtn.onclick = () => {
    selectedCategories.clear();
    legend.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    applyAmenityFilter();
    const c = [map.getCenter().lng, map.getCenter().lat];
    updateSpider(c);
    if (hoverEnabled && lastMouseLngLat) updateHoverCircleAt(lastMouseLngLat);
  };

  ctrlRow.appendChild(selectAllBtn);
  ctrlRow.appendChild(clearBtn);
  legend.appendChild(ctrlRow);
}

function applyAmenityFilter() {
  if (!map.getLayer('amenities-points')) return;
  if (selectedCategories.size === 0) {
    map.setFilter('amenities-points', ['in', ['get', 'Kategori'], ['literal', []]]);
  } else {
    map.setFilter('amenities-points', ['in', ['get', 'Kategori'], ['literal', Array.from(selectedCategories)]]);
  }
}

// ===========================
// Load
// ===========================
map.on('load', () => {
  Promise.all([
    fetch('./data/parseller.geojson').then(r => r.json()),
    fetch('./data/donatilar.geojson').then(r => r.json())
  ]).then(async ([parcelData, amenityData]) => {
    parcels = parcelData.features;
    parcelCentroids = getCentroids(parcels);
    amenities = amenityData.features;
    proximityOrder = getProximityOrder(parcelCentroids);

    // Fast index (varsa)
    amenPoints = amenities.map((f, idx) => ({ lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], idx }));
    if (typeof KDBush !== 'undefined') {
      amenIdx = new KDBush(amenPoints, p => p.lng, p => p.lat);
    } else {
      console.warn('KDBush yok – turf fallback kullanılacak (daha yavaş).');
    }

    // Legend
    allCategories = Array.from(new Set(amenities.map(f => f.properties?.Kategori || 'Bilinmiyor'))).sort();
    buildLegend(allCategories);
    setLegendVisibility(legendVisible);

    // Parcels
    map.addSource('parcels', { type: 'geojson', data: parcelData });
    map.addLayer({ id: 'parcels-polygons', type: 'fill', source: 'parcels', paint: { 'fill-color': '#FFCDD2', 'fill-opacity': 0.3 } });

    // Centroids
    map.addSource('centroids', { type: 'geojson', data: { type: 'FeatureCollection', features: parcelCentroids } });
    map.addLayer({ id: 'centroids-points', type: 'circle', source: 'centroids', paint: { 'circle-radius': 5, 'circle-color': '#E91E63' } });
    map.addLayer({
      id: 'centroids-labels', type: 'symbol', source: 'centroids',
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Open Sans Bold'], 'text-size': 11, 'text-anchor': 'top', 'text-offset': [0, 0.5] },
      paint: { 'text-color': '#333', 'text-halo-color': '#fff', 'text-halo-width': 1 }
    });

    // Amenities
    map.addSource('amenities', { type: 'geojson', data: amenityData });
    map.addLayer({
      id: 'amenities-points', type: 'circle', source: 'amenities',
      paint: {
        'circle-radius': 5,
        'circle-color': [
          'match', ['get', 'Kategori'],
          'Okullar', '#2196F3',
          'Parklar', '#4CAF50',
          'Raylı Sistem Durakları', '#FF9800',
          'Su Kaynakları', '#00BCD4',
          '#9E9E9E'
        ]
      }
    });
    applyAmenityFilter();

    // Başlangıç
    const start = parcelCentroids[proximityOrder[currentIndex]].geometry.coordinates;
    map.flyTo({ center: start });
    setupParcelSearch();
    await updateSpider(start); // async

    // Hover varsayılan kapalı
    setHoverVisibility(false);
  });
});

// ===========================
// Stil değiştirici
// ===========================
document.getElementById('styleSwitcher')?.addEventListener('change', function () {
  const selectedStyle = this.value;
  const center = map.getCenter();
  const zoom = map.getZoom();

  clearVisuals();
  map.setStyle(selectedStyle);

  map.once('style.load', async () => {
    map.setCenter(center); map.setZoom(zoom);

    map.addSource('parcels', { type: 'geojson', data: { type: 'FeatureCollection', features: parcels } });
    map.addLayer({ id: 'parcels-polygons', type: 'fill', source: 'parcels', paint: { 'fill-color': '#FFCDD2', 'fill-opacity': 0.3 } });

    map.addSource('centroids', { type: 'geojson', data: { type: 'FeatureCollection', features: parcelCentroids } });
    map.addLayer({ id: 'centroids-points', type: 'circle', source: 'centroids', paint: { 'circle-radius': 5, 'circle-color': '#E91E63' } });
    map.addLayer({
      id: 'centroids-labels', type: 'symbol', source: 'centroids',
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Open Sans Bold'], 'text-size': 11, 'text-anchor': 'top', 'text-offset': [0, 0.5] },
      paint: { 'text-color': '#333', 'text-halo-color': '#fff', 'text-halo-width': 1 }
    });

    map.addSource('amenities', { type: 'geojson', data: { type: 'FeatureCollection', features: amenities } });
    map.addLayer({
      id: 'amenities-points', type: 'circle', source: 'amenities',
      paint: {
        'circle-radius': 5,
        'circle-color': [
          'match', ['get', 'Kategori'],
          'Okullar', '#2196F3',
          'Parklar', '#4CAF50',
          'Raylı Sistem Durakları', '#FF9800',
          'Su Kaynakları', '#00BCD4',
          '#9E9E9E'
        ]
      }
    });
    applyAmenityFilter();

    // Hover katmanları ve UI
    ensureHoverCircleLayers();
    refreshHoverToggleUI();

    // Legend yeniden görünür/kapalı durumunu uygula
    buildLegend(allCategories);
    setLegendVisibility(legendVisible);

    // Spider yenile
    const newCenter = parcelCentroids[proximityOrder[currentIndex]].geometry.coordinates;
    await updateSpider(newCenter);
  });
});

// ===========================
// Popup
// ===========================
map.on('contextmenu', e => {
  const features = map.queryRenderedFeatures(e.point, { layers: ['centroids-points', 'amenities-points'] });
  const content = features.length
    ? Object.entries(features[0].properties).map(([k, v]) => `<b>${k}</b>: ${v}`).join('<br>`)
    : 'Yakında veri bulunamadı.';
  new mapboxgl.Popup().setLngLat(e.lngLat).setHTML(content).addTo(map);
});

// ===========================
// Arama & gezinme
// ===========================
function getNearestCentroidIndex(lngLat) {
  let min = Infinity, nearest = 0;
  parcelCentroids.forEach((f, i) => {
    const d = turf.distance(turf.point(lngLat), f);
    if (d < min) { min = d; nearest = i; }
  });
  return nearest;
}

function setupParcelSearch() {
  const input = document.getElementById('parcelSearchInput');
  const resultsList = document.getElementById('searchResults');
  if (!input || !resultsList) return;

  input.addEventListener('input', () => {
    const query = input.value.toLowerCase().trim();
    resultsList.innerHTML = '';
    if (!query) return;

    const matches = parcels.filter(f => (f.properties.name || '').toLowerCase().includes(query));
    matches.forEach(f => {
      const li = document.createElement('li');
      li.textContent = f.properties.name;
      li.style.cursor = 'pointer';
      li.style.padding = '3px 6px';
      li.addEventListener('click', async () => {
        const centroid = turf.centroid(f).geometry.coordinates;
        map.flyTo({ center: centroid, zoom: 17 });
        await updateSpider(centroid);
        if (hoverEnabled) updateHoverCircleAt(centroid);
        resultsList.innerHTML = '';
        input.value = '';
      });
      resultsList.appendChild(li);
    });
  });
}

// map move (spider & hover)
let lastMove = 0;
function getMoveDelay() {
  const z = map.getZoom();
  return Math.max(120, 280 - (z - 10) * 25);
}
map.on('move', async () => {
  const now = Date.now();
  const delay = getMoveDelay();
  if (now - lastMove < delay) return;
  lastMove = now;

  const center = map.getCenter();
  const lngLat = [center.lng, center.lat];
  const nearest = getNearestCentroidIndex(lngLat);
  const target = parcelCentroids[nearest]?.geometry?.coordinates;
  if (!target) return;

  await updateSpider(target);
  if (hoverEnabled) updateHoverCircleAt(target);
});

// ===========================
// Kısayollar: H / +/- / K
// ===========================
window.addEventListener('keydown', async e => {
  const key = e.key;
  if (key === '3' || key === '9') {
    currentIndex = (currentIndex + 1) % proximityOrder.length;
  } else if (key === '1' || key === '7') {
    currentIndex = (currentIndex - 1 + proximityOrder.length) % proximityOrder.length;
  } else if (key.toLowerCase() === 'h') { // Hover toggle
    hoverEnabled ? disableHover() : enableHover();
    return;
  } else if (key.toLowerCase() === 'k') { // K: Kategori paneli
    toggleLegendVisibility();
    return;
  } else if (key === '+' || key === '=') {
    tweakRadius(+50);
    return;
  } else if (key === '-' || key === '_') {
    tweakRadius(-50);
    return;
  } else {
    return;
  }
  const newCenter = parcelCentroids[proximityOrder[currentIndex]].geometry.coordinates;
  map.flyTo({ center: newCenter });
  await updateSpider(newCenter);
  if (hoverEnabled) updateHoverCircleAt(newCenter);
});

function tweakRadius(delta){
  const el = document.getElementById('distanceInput');
  if (!el) return;
  const cur = +el.value || 500;
  el.value = Math.max(10, cur + delta);
  el.dispatchEvent(new Event('input'));
  el.dispatchEvent(new Event('change'));
}

// ===========================
// Grafikler (aynı, OSRM verisiyle de çalışır)
// ===========================
function drawCategoryChart() {
  const categoryCounts = {};
  lastSpiderData.forEach(entry => {
    const k = entry.feature.properties?.Kategori || 'Bilinmiyor';
    categoryCounts[k] = (categoryCounts[k] || 0) + 1;
  });
  const el = document.getElementById('categoryChartContainer'); if (!el) return;
  el.innerHTML = '<canvas id="categoryChart"></canvas>';
  const ctx = document.getElementById('categoryChart').getContext('2d');
  new Chart(ctx, {
    type: 'pie',
    data: { labels: Object.keys(categoryCounts), datasets: [{ data: Object.values(categoryCounts) }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' }, title: { display: true, text: 'Kategorisel Yoğunluk Dağılımı' },
        datalabels: { color: '#fff',
          formatter: (v, c) => { const t = c.chart.data.datasets[0].data.reduce((a,b)=>a+b,0); return `${v} (${(v/t*100).toFixed(1)}%)`; },
          font: { weight: 'bold' } } }
    },
    plugins: [ChartDataLabels]
  });
}

function drawWeightedCategoryChart() {
  const weightedCounts = {};
  lastSpiderData.forEach(entry => {
    const k = entry.feature.properties?.Kategori || 'Bilinmiyor';
    const dMeters = (entry.distMeters != null) ? entry.distMeters : (entry.dist * 1000);
    const w = 1 / Math.max(dMeters, 1); // metre tabanlı
    weightedCounts[k] = (weightedCounts[k] || 0) + w;
  });

  const el = document.getElementById('weightedChartContainer'); if (!el) return;
  el.innerHTML = '<canvas id="weightedCategoryChart"></canvas>';
  const ctx = document.getElementById('weightedCategoryChart').getContext('2d');

  new Chart(ctx, {
    type: 'pie',
    data: { labels: Object.keys(weightedCounts), datasets: [{ data: Object.values(weightedCounts) }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' }, title: { display: true, text: 'Mesafe Ağırlıklı Kategorisel Dağılım' },
        datalabels: { color: '#fff',
          formatter: (v, c) => { const t = c.chart.data.datasets[0].data.reduce((a,b)=>a+b,0); return `${v.toFixed(2)} (${(v/t*100).toFixed(1)}%)`; },
          font: { weight: 'bold' } } }
    },
    plugins: [ChartDataLabels]
  });
}

const chartButton = document.createElement('button');
chartButton.textContent = 'Kategorisel Grafik Göster';
chartButton.style.marginLeft = '10px';
chartButton.onclick = () => lastSpiderData.length ? drawCategoryChart() : alert('Henüz analiz edilen veri yok.');
document.getElementById('exportExcelButton')?.after(chartButton);

const weightedChartButton = document.createElement('button');
weightedChartButton.textContent = 'Mesafeli Grafik Göster';
weightedChartButton.style.marginLeft = '10px';
weightedChartButton.onclick = () => lastSpiderData.length ? drawWeightedCategoryChart() : alert('Henüz analiz edilen veri yok.');
chartButton.after(weightedChartButton);

// Teknik detay toggle
const detailToggleBtn = document.createElement('button');
detailToggleBtn.textContent = 'Teknik Detayı Göster';
detailToggleBtn.style.marginLeft = '10px';
let detailVisible = false;
const detailBox = document.createElement('div');
detailBox.id = 'technicalDetail';
detailBox.style.display = 'none';
detailBox.style.marginTop = '10px';
detailBox.style.padding = '10px';
detailBox.style.border = '1px solid #ccc';
detailBox.style.background = '#f9f9f9';
detailBox.innerHTML = `
  <strong>Teknik Hesaplama:</strong><br>
  Grafikler, seçilen mesafe türüne göre (OSRM yol ağı veya kuşbakışı) hesaplanan değerlere dayanır.<br>
  Ağırlık formülü: <code>Etki = 1 / Mesafe(m)</code>
`;
weightedChartButton.after(detailToggleBtn);
detailToggleBtn.after(detailBox);
detailToggleBtn.onclick = () => {
  detailVisible = !detailVisible;
  detailBox.style.display = detailVisible ? 'block' : 'none';
  detailToggleBtn.textContent = detailVisible ? 'Teknik Detayı Gizle' : 'Teknik Detayı Göster';
};

// indir fonksiyonu
function downloadChartImage(canvasId, filename) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const link = document.createElement('a');
  link.download = filename;
  link.href = canvas.toDataURL('image/png');
  link.click();
}
window.downloadChartImage = downloadChartImage;
