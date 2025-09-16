// ===========================
// main.js (Dinamik yarıçap analizi + Heatmap toggle + anim dots gizleyerek PNG)
// ===========================

mapboxgl.accessToken = 'pk.eyJ1IjoiYXRha2FuZSIsImEiOiJjbWNoNGUyNWkwcjFqMmxxdmVnb2tnMWJ4In0.xgo3tCNuq6kVXFYQpoS8PQ';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v11',
  center: [27.1428, 38.4192],
  zoom: 14,
  preserveDrawingBuffer: true   // <-- PNG’de siyah ekranı önler
});

// ---- Global state
let parcels = [], parcelCentroids = [], amenities = [];
let proximityOrder = [], currentIndex = 0;
let currentLines = [], currentLabels = [], lastSpiderCoord = null;
let lastSpiderData = [];

// Hover
const HOVER_SRC = 'hover-circle-src';
const HOVER_FILL = 'hover-circle-fill';
const HOVER_OUTLINE = 'hover-circle-outline';
const IN_CIRCLE_SRC = 'amenities-in-circle-src';
const IN_CIRCLE_LAYER = 'amenities-in-circle-layer';
let lastMouseLngLat = null;
let hoverEnabled = false;

// KDBush
let amenIdx = null;
let amenPoints = [];
let allCategories = [];
let selectedCategories = new Set();

// Legend
let legendVisible = true;

// Heatmap
let heatmapOn = false;

// ====== Animasyon: hat üzerindeki akan noktalar ======
let animDots = [];
let animRunning = false;
const DOT_PERIOD_MS = 9000;

function startDotAnimation() {
  if (animRunning) return;
  animRunning = true;
  requestAnimationFrame(stepDots);
}
function stopDotAnimation() { animRunning = false; }
function stepDots(ts) {
  if (!animRunning) return;
  for (const d of animDots) {
    try {
      if (!d.lineGeom) continue;
      const lenKm = d.lengthKm ?? turf.length(d.lineGeom, { units: 'kilometers' });
      if (lenKm <= 0) continue;
      const elapsed = (ts - d.startMs) % d.periodMs;
      const distKm = (elapsed / d.periodMs) * lenKm;
      const pt = turf.along(d.lineGeom, distKm, { units: 'kilometers' });
      const src = map.getSource(d.sourceId);
      if (src) src.setData(pt);
    } catch {}
  }
  requestAnimationFrame(stepDots);
}
function createDotForLine(i, lineGeom, color) {
  const dotSourceId = `dot-src-${i}`;
  const dotLayerId = `dot-layer-${i}`;
  map.addSource(dotSourceId, { type: 'geojson', data: turf.point(lineGeom.geometry.coordinates[0]) });
  map.addLayer({
    id: dotLayerId, type: 'circle', source: dotSourceId,
    paint: { 'circle-radius': 8, 'circle-color': color, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 }
  });
  const lengthKm = turf.length(lineGeom, { units: 'kilometers' });
  animDots.push({ sourceId: dotSourceId, layerId: dotLayerId, lineGeom, lengthKm, startMs: performance.now() + (i * 250), periodMs: DOT_PERIOD_MS });
  startDotAnimation();
}

// ===========================
// KONFİG (kategori ağırlıkları)
// ===========================
const CATEGORY_WEIGHTS = {
  'Belediye Binaları':            0.5,
  'Hizmet Binaları':              0.6,
  'Kültürel Miras':               0.2,
  'Mezarlıklar':                  0.8,
  'Okullar':                      0.4,
  'Parklar':                      0.3,
  'Raylı Sistem Durakları':       0.7,
  'Sağlık Kurumları':             0.9,
  'Stadyumlar':                   1.0,
  'Su Kaynakları':                0.6,
  'İbadet Alanları':              0.8
};

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
  animDots.forEach(d => {
    if (map.getLayer(d.layerId)) map.removeLayer(d.layerId);
    if (map.getSource(d.sourceId)) map.removeSource(d.sourceId);
  });
  animDots = [];
  stopDotAnimation();
}

function getProximityOrder(centroids) {
  const base = centroids[0];
  return centroids.map((c, i) => ({ index: i, dist: turf.distance(base, c) }))
                  .sort((a, b) => a.dist - b.dist)
                  .map(e => e.index);
}

function colorForCategory(k) {
  if (!k) return '#607D8B';
  const s = (k + '').toLowerCase();
  if (s.includes('park')) return '#4CAF50';
  if (s.includes('okul')) return '#2196F3';
  if (s.includes('ibadet')) return '#9C27B0';
  if (s.includes('su')) return '#00BCD4';
  if (s.includes('sağlık') || s.includes('saglik') || s.includes('hastane')) return '#F44336';
  if (s.includes('raylı') || s.includes('rayli')) return '#FF9800';
  return '#607D8B';
}

function setModeBadge(ok = true) {
  const el = document.getElementById('modeBadge');
  if (!el) return;
  el.textContent = ok ? 'Mesafe Türü: Yol Ağı (Matrix)' : 'Mesafe Türü: Kuşbakışı (fallback)';
  el.style.color = ok ? '#2e7d32' : '#c62828';
}

// ===========================
// Mapbox Directions helpers
// ===========================
async function mapboxMatrixDistance(center, destFeatures) {
  if (!destFeatures.length) return [];
  const chunks = [];
  for (let i = 0; i < destFeatures.length; i += 24) chunks.push(destFeatures.slice(i, i + 24));

  const all = [];
  for (const group of chunks) {
    const coords = [
      `${center[0]},${center[1]}`,
      ...group.map(f => `${f.geometry.coordinates[0]},${f.geometry.coordinates[1]}`)
    ].join(';');

    const destIdx = group.map((_, i) => i + 1).join(';');
    const url = `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coords}` +
                `?sources=0&destinations=${destIdx}&annotations=distance,duration&access_token=${mapboxgl.accessToken}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Matrix hata [${res.status}]: ${await res.text()}`);
    const data = await res.json();

    const distances = (data.distances && data.distances[0]) || [];
    const durations = (data.durations && data.durations[0]) || [];

    group.forEach((f, i) => {
      all.push({
        feature: f,
        distMeters: typeof distances[i] === 'number' ? distances[i] : null,
        durationSec: typeof durations[i] === 'number' ? durations[i] : null
      });
    });
  }
  return all;
}

async function mapboxRouteGeoJSON(start, end) {
  const coords = `${start[0]},${start[1]};${end[0]},${end[1]}`;
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?overview=full&geometries=geojson&access_token=${mapboxgl.accessToken}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Directions hata [${res.status}]`);
  const data = await res.json();
  const route = data.routes && data.routes[0];
  return route ? route.geometry : null;
}

// ===========================
// Spider (bağlantı çizimleri)
// ===========================
async function updateSpider(center) {
  const roundedCenter = center.map(n => Number(n.toFixed(6)));
  if (lastSpiderCoord && roundedCenter[0] === lastSpiderCoord[0] && roundedCenter[1] === lastSpiderCoord[1]) return;

  lastSpiderCoord = roundedCenter;
  clearVisuals();

  const centerPoint = turf.point(center);
  const maxDistanceMeters = parseFloat(document.getElementById('distanceInput')?.value || '0');
  let count = document.getElementById('lineCountSelect')?.value ?? '10';
  const distanceMode = document.getElementById('distanceMode')?.value || 'haversine';

  const filtered = amenities.filter(f => {
    const k = f.properties?.Kategori || 'Bilinmiyor';
    return selectedCategories.size === 0 || selectedCategories.has(k);
  });

  let nearest = [];

  if (distanceMode === 'network') {
    try {
      const pre = preselectNearestByHaversine(center, filtered, 120, maxDistanceMeters || 800);
      let arr = await mapboxMatrixDistance(center, pre);

      if (!isNaN(maxDistanceMeters) && maxDistanceMeters > 0) {
        arr = arr.filter(r => r.distMeters != null && r.distMeters <= maxDistanceMeters);
      }
      arr.sort((a,b) => a.distMeters - b.distMeters);
      if (count !== 'all') arr = arr.slice(0, parseInt(count));

      nearest = arr.map(r => ({
        feature: r.feature,
        dist: r.distMeters / 1000,
        distMeters: r.distMeters,
        durationSec: r.durationSec,
        geometryOverride: null
      }));

      const topN = nearest.slice(0, 10);
      await Promise.all(topN.map(async n => {
        try { n.geometryOverride = await mapboxRouteGeoJSON(center, n.feature.geometry.coordinates); } catch {}
      }));

      setModeBadge(true);
    } catch (err) {
      console.warn('Mapbox Matrix ulaşılamadı, kuşbakışına düşüyorum:', err);
      setModeBadge(false);
      nearest = filtered.map(f => ({ feature: f, dist: turf.distance(centerPoint, f, { units: 'kilometers' }) }));
      if (!isNaN(maxDistanceMeters) && maxDistanceMeters > 0) {
        nearest = nearest.filter(e => (e.dist * 1000) <= maxDistanceMeters);
      }
      nearest.sort((a, b) => a.dist - b.dist);
      if (count !== 'all') nearest = nearest.slice(0, parseInt(count));
    }
  } else {
    setModeBadge(false);
    nearest = filtered.map(f => ({ feature: f, dist: turf.distance(centerPoint, f, { units: 'kilometers' }) }));
    if (!isNaN(maxDistanceMeters) && maxDistanceMeters > 0) {
      nearest = nearest.filter(e => (e.dist * 1000) <= maxDistanceMeters);
    }
    nearest.sort((a, b) => a.dist - b.dist);
    if (count !== 'all') nearest = nearest.slice(0, parseInt(count));
  }

  lastSpiderData = nearest;

  for (let i = 0; i < nearest.length; i++) {
    const entry = nearest[i];
    const to = entry.feature.geometry.coordinates;

    const lineId = `line-${i}`, labelId = `label-${i}`;
    let lineGeom;

    if (entry.geometryOverride && entry.geometryOverride.type === 'LineString') {
      lineGeom = { type: 'Feature', geometry: entry.geometryOverride };
    } else {
      lineGeom = turf.lineString([center, to]);
    }

    const cat = entry.feature.properties?.Kategori || 'Donatı';
    const color = colorForCategory(cat);

    map.addSource(lineId, { type: 'geojson', data: lineGeom });
    map.addLayer({ id: lineId, type: 'line', source: lineId, paint: { 'line-width': 4, 'line-color': color } });
    currentLines.push(lineId);

    const distM = (entry.distMeters != null) ? entry.distMeters : entry.dist * 1000;
    const durS = entry.durationSec;
    const labelText = (durS != null)
      ? `${cat}\n${Math.round(distM)} m • ${Math.round(durS / 60)} dk`
      : `${cat}\n${Math.round(distM)} m`;

    let midPoint;
    if (entry.geometryOverride && entry.geometryOverride.coordinates?.length > 1) {
      const coords = entry.geometryOverride.coordinates;
      midPoint = turf.point(coords[Math.floor(coords.length / 2)]);
    } else {
      midPoint = turf.midpoint(turf.point(center), turf.point(to));
    }

    const labelFeature = { type: 'Feature', geometry: midPoint.geometry, properties: { label: labelText } };
    map.addSource(labelId, { type: 'geojson', data: labelFeature });
    map.addLayer({
      id: labelId, type: 'symbol', source: labelId,
      layout: { 'text-field': ['get', 'label'], 'text-font': ['Open Sans Bold'], 'text-size': 12, 'text-offset': [0, -1], 'text-anchor': 'top' },
      paint: { 'text-color': '#000', 'text-halo-color': '#fff', 'text-halo-width': 1 }
    });
    currentLabels.push(labelId);

    createDotForLine(i, lineGeom, color);
  }
}

// Prefilter (kuşbakışı)
function preselectNearestByHaversine(center, features, limit = 120, radiusMeters = null) {
  const cPt = turf.point(center);
  let arr = features.map(f => ({
    feature: f,
    hDistM: turf.distance(cPt, f, { units: 'kilometers' }) * 1000
  }));
  if (radiusMeters && radiusMeters > 0) {
    const tol = radiusMeters * 1.5;
    arr = arr.filter(x => x.hDistM <= tol);
  }
  arr.sort((a,b) => a.hDistM - b.hDistM);
  return arr.slice(0, limit).map(x => x.feature);
}

// ===========================
// Hover (daire içi özet)
// ===========================
function ensureHoverCircleLayers() {
  if (!map.getSource(HOVER_SRC)) map.addSource(HOVER_SRC, { type: 'geojson', data: turf.featureCollection([]) });
  if (!map.getLayer(HOVER_FILL)) {
    map.addLayer({ id: HOVER_FILL, type: 'fill', source: HOVER_SRC, paint: { 'fill-color': '#3F51B5', 'fill-opacity': 0.10 } });
  }
  if (!map.getLayer(HOVER_OUTLINE)) {
    map.addLayer({ id: HOVER_OUTLINE, type: 'line', source: HOVER_SRC, paint: { 'line-color': '#3F51B5', 'line-width': 4 } });
  }
  if (!map.getSource(IN_CIRCLE_SRC)) map.addSource(IN_CIRCLE_SRC, { type: 'geojson', data: turf.featureCollection([]) });
  if (!map.getLayer(IN_CIRCLE_LAYER)) {
    map.addLayer({ id: IN_CIRCLE_LAYER, type: 'circle', source: IN_CIRCLE_SRC,
      paint: { 'circle-radius': 10, 'circle-color': '#FFFFFF', 'circle-stroke-color': '#3F51B5', 'circle-stroke-width': 2 } });
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

// hızlı/fallback (hover için kuşbakışı)
function queryAmenitiesInRadius(centerLng, centerLat, radiusMeters) {
  const radiusKm = Math.max(0, radiusMeters) / 1000;
  if (amenIdx && typeof window.geokdbush !== 'undefined') {
    const hits = window.geokdbush.around(amenIdx, centerLng, centerLat, Infinity, radiusKm);
    return hits
      .map(h => ({ feature: amenities[h.idx], distKm: h.distance }))
      .filter(h => {
        const k = h.feature?.properties?.Kategori || 'Bilinmiyor';
        return selectedCategories.size === 0 || selectedCategories.has(k);
      });
  }
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

// yarıçap değişince
['input','change'].forEach(evt =>
  document.getElementById('distanceInput')?.addEventListener(evt, async () => {
    if (hoverEnabled && lastMouseLngLat) updateHoverCircleAt(lastMouseLngLat);
    await updateSpider([map.getCenter().lng, map.getCenter().lat]);
  })
);

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

// Legend / kategori filtresi
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

  Object.assign(legend.style, {
    position: 'absolute', left: '12px', right: 'auto', bottom: '12px', zIndex: '3',
    background: 'rgba(255,255,255,0.95)', border: '1px solid #ddd', borderRadius: '8px',
    padding: '10px 12px', fontSize: '13px', minWidth: '220px', maxWidth: '300px',
    maxHeight: '40vh', overflow: 'auto', boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
    lineHeight: '1.35', display: legendVisible ? 'block' : 'none'
  });

  legend.innerHTML = `<div style="font-weight:600; margin-bottom:6px;">Kategoriler</div>`;
  selectedCategories = new Set(categories);

  categories.forEach(cat => {
    const id = `cat_${cat.replace(/\s+/g, '_')}`;
    const wrap = document.createElement('label');
    Object.assign(wrap.style, { display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0' });

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = id;
    cb.checked = true;
    cb.addEventListener('change', async () => {
      if (cb.checked) selectedCategories.add(cat);
      else selectedCategories.delete(cat);
      applyAmenityFilter();
      const c = [map.getCenter().lng, map.getCenter().lat];
      await updateSpider(c);
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
  selectAllBtn.onclick = async () => {
    selectedCategories = new Set(categories);
    legend.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
    applyAmenityFilter();
    const c = [map.getCenter().lng, map.getCenter().lat];
    await updateSpider(c);
    if (hoverEnabled && lastMouseLngLat) updateHoverCircleAt(lastMouseLngLat);
  };

  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Temizle';
  clearBtn.style.fontSize = '12px';
  clearBtn.onclick = async () => {
    selectedCategories.clear();
    legend.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    applyAmenityFilter();
    const c = [map.getCenter().lng, map.getCenter().lat];
    await updateSpider(c);
    if (hoverEnabled && lastMouseLngLat) updateHoverCircleAt(lastMouseLngLat);
  };

  ctrlRow.appendChild(selectAllBtn);
  ctrlRow.appendChild(clearBtn);
  legend.appendChild(ctrlRow);
}

function applyAmenityFilter() {
  const lyrIds = ['amenities-points', 'amenities-heat'];
  lyrIds.forEach(id => {
    if (!map.getLayer(id)) return;
    if (selectedCategories.size === 0) {
      map.setFilter(id, ['in', ['get', 'Kategori'], ['literal', []]]);
    } else {
      map.setFilter(id, ['in', ['get', 'Kategori'], ['literal', Array.from(selectedCategories)]]);
    }
  });
}

// ===========================
// YÜKLEME
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

    // Parseller
    map.addSource('parcels', { type: 'geojson', data: parcelData });
    map.addLayer({ id: 'parcels-polygons', type: 'fill', source: 'parcels',
      paint: { 'fill-color': '#FFCDD2', 'fill-opacity': 0.3 } });

    // Centroidler (impact görselleştirme için stroke ve radius'u property'den okuyacağız)
    map.addSource('centroids', { type: 'geojson', data: { type: 'FeatureCollection', features: parcelCentroids } });
    map.addLayer({
      id: 'centroids-points',
      type: 'circle',
      source: 'centroids',
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['coalesce', ['get', 'impact_norm'], 0],
          0, 6,
          1, 22
        ],
        'circle-color': '#E91E63',
        'circle-stroke-color': ['coalesce', ['get','top_color'], '#333'],
        'circle-stroke-width': ['case', ['has','top_color'], 6, 3]
      }
    });
    map.addLayer({
      id: 'centroids-labels',
      type: 'symbol',
      source: 'centroids',
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Open Sans Bold'], 'text-size': 11, 'text-anchor': 'top', 'text-offset': [0, 0.5] },
      paint: { 'text-color': '#333', 'text-halo-color': '#fff', 'text-halo-width': 1 }
    });

    // Donatılar
    map.addSource('amenities', { type: 'geojson', data: amenityData });

    // Heatmap
    map.addLayer({
      id: 'amenities-heat',
      type: 'heatmap',
      source: 'amenities',
      maxzoom: 19,
      paint: {
        'heatmap-weight': ['case', ['has','weight'], ['coalesce', ['to-number', ['get', 'weight']], 1], 1],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 10, 1, 15, 3],
        'heatmap-radius':    ['interpolate', ['linear'], ['zoom'], 10, 15, 15, 40],
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(0,0,0,0)',
          0.2, '#2c7fb8',
          0.4, '#41b6c4',
          0.6, '#a1dab4',
          0.8, '#ffffcc',
          1, '#ffeda0'
        ],
        'heatmap-opacity': 0.85
      }
    });

    // Points
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

    // Heatmap toggle
    const heatBtn = document.createElement('button');
    heatBtn.id = 'heatmapToggleBtn';
    heatBtn.textContent = heatmapOn ? 'Heatmap Kapat' : 'Heatmap Aç';
    heatBtn.className = 'btn';
    heatBtn.style.marginLeft = '8px';
    heatBtn.onclick = () => {
      heatmapOn = !heatmapOn;
      if (map.getLayer('amenities-heat') && map.getLayer('amenities-points')) {
        map.setLayoutProperty('amenities-heat',   'visibility', heatmapOn ? 'visible' : 'none');
        map.setLayoutProperty('amenities-points', 'visibility', heatmapOn ? 'none'    : 'visible');
      }
      heatBtn.textContent = heatmapOn ? 'Heatmap Kapat' : 'Heatmap Aç';
    };
    document.getElementById('exportPNGButton')?.after(heatBtn);

    // KDBush index
    amenPoints = amenities.map((f, idx) => ({ lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], idx }));
    if (window.kdbush && typeof window.kdbush.KDBush === 'function') {
      try { amenIdx = new window.kdbush.KDBush(amenPoints, p => p.lng, p => p.lat); }
      catch(e){ console.warn('KDBush index kurulamadı:', e); }
    }

    allCategories = Array.from(new Set(amenities.map(f => f.properties?.Kategori || 'Bilinmiyor'))).sort();
    buildLegend(allCategories);
    setLegendVisibility(legendVisible);

    applyAmenityFilter();

    const start = parcelCentroids[proximityOrder[currentIndex]].geometry.coordinates;
    map.flyTo({ center: start });
    setupParcelSearch();
    await updateSpider(start);

    setHoverVisibility(false);
  });
});

// Stil değiştirici
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
    map.addLayer({
      id: 'centroids-points', type: 'circle', source: 'centroids',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['coalesce', ['get','impact_norm'], 0], 0, 6, 1, 22],
        'circle-color': '#E91E63',
        'circle-stroke-color': ['coalesce', ['get','top_color'], '#333'],
        'circle-stroke-width': ['case', ['has','top_color'], 3, 1]
      }
    });
    map.addLayer({
      id: 'centroids-labels', type: 'symbol', source: 'centroids',
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Open Sans Bold'], 'text-size': 11, 'text-anchor': 'top', 'text-offset': [0, 0.5] },
      paint: { 'text-color': '#333', 'text-halo-color': '#fff', 'text-halo-width': 1 }
    });

    map.addSource('amenities', { type: 'geojson', data: { type: 'FeatureCollection', features: amenities } });

    map.addLayer({
      id: 'amenities-heat',
      type: 'heatmap',
      source: 'amenities',
      maxzoom: 19,
      paint: {
        'heatmap-weight': ['interpolate', ['linear'], ['zoom'], 10, 1, 15, 2],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 10, 1, 15, 3],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 10, 15, 15, 40],
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(0,0,0,0)',
          0.2, '#2c7fb8', 0.4, '#41b6c4', 0.6, '#a1dab4', 0.8, '#ffffcc', 1, '#ffeda0'
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
          'Parklar', '#4CAF50','Okullar', '#2196F3','İbadet Alanları', '#9C27B0',
          'Su Kaynakları', '#00BCD4','Sağlık Kurumları', '#F44336','Raylı Sistem Durakları', '#FF9800',
          '#9E9E9E'
        ]
      }
    });

    map.setLayoutProperty('amenities-heat',   'visibility', heatmapOn ? 'visible' : 'none');
    map.setLayoutProperty('amenities-points', 'visibility', heatmapOn ? 'none'    : 'visible');

    applyAmenityFilter();
    ensureHoverCircleLayers();
    refreshHoverToggleUI();

    buildLegend(allCategories);
    setLegendVisibility(legendVisible);

    const newCenter = parcelCentroids[proximityOrder[currentIndex]].geometry.coordinates;
    await updateSpider(newCenter);
  });
});

// Popup (sağ tık)
map.on('contextmenu', e => {
  const features = map.queryRenderedFeatures(e.point, { layers: ['centroids-points', 'amenities-points'] });
  const content = features.length
    ? Object.entries(features[0].properties).map(([k, v]) => `<b>${k}</b>: ${v}`).join('<br>')
    : 'Yakında veri bulunamadı.';
  new mapboxgl.Popup().setLngLat(e.lngLat).setHTML(content).addTo(map);
});

// ===========================
// ARAMA & GEZİNME
// ===========================
function getNearestCentroidIndex(lngLat) {
  let min = Infinity, nearest = 0;
  parcelCentroids.forEach((f, i) => {
    const d = turf.distance(turf.point(lngLat), f);
    if (d < min) { min = d; nearest = i; }
  });
  return nearest;
}

function normTR(s) {
  if (!s) return '';
  let t = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  t = t.toLocaleLowerCase('tr');
  t = t.replace(/ı̇/g, 'i');
  return t;
}

function setupParcelSearch() {
  const input = document.getElementById('parcelSearchInput');
  const resultsList = document.getElementById('searchResults');
  if (!input || !resultsList) return;

  input.addEventListener('input', () => {
    const query = normTR(input.value.trim());
    resultsList.innerHTML = '';
    if (!query) return;

    const matches = parcels.filter(f => normTR((f.properties?.name ?? '').trim()).includes(query));

    matches.forEach(f => {
      const li = document.createElement('li');
      li.textContent = f.properties?.name ?? '(İsimsiz)';
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

// --- PANNING: merkeze en yakın centroid'e göre spider güncelle ---
let lastMove = 0;
function getMoveDelay() {
  const z = map.getZoom();
  return Math.max(120, 280 - (z - 10) * 25); // zoom'a göre hafif throttling
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
// ANALİZ (A tuşu): yarıçapa göre centroid skor/renk
// ===========================
function analyzeParcelsDynamic() {
  const radiusM = Math.max(0, parseFloat(document.getElementById('distanceInput')?.value || '500') || 500);
  const radiusKm = radiusM / 1000;

  const results = []; // Excel için

  // her centroid için daire içi donatıları topla
  parcelCentroids.forEach((c, idx) => {
    const [lng, lat] = c.geometry.coordinates;
    let hits = [];

    if (amenIdx && window.geokdbush) {
      hits = window.geokdbush.around(amenIdx, lng, lat, Infinity, radiusKm)
        .map(h => ({ feature: amenities[h.idx] }));
    } else {
      const circlePoly = turf.circle([lng, lat], radiusKm, { steps: 64, units: 'kilometers' });
      const inside = turf.pointsWithinPolygon({ type: 'FeatureCollection', features: amenities }, circlePoly);
      hits = inside.features.map(f => ({ feature: f }));
    }

    const counts = {};
    const parts = []; // katkılar

    hits.forEach(h => {
      const k = h.feature.properties?.Kategori || 'Bilinmiyor';
      counts[k] = (counts[k] || 0) + 1;
    });

    // ham skor = Σ w * log1p(count)
    let score = 0;
    Object.entries(CATEGORY_WEIGHTS).forEach(([k, w]) => {
      const cnt = counts[k] || 0;
      const v = w * Math.log1p(cnt);
      score += v;
      parts.push({ key: k, val: v });
    });

    parts.sort((a,b)=>b.val-a.val);
    const topKey = parts[0]?.key || '';
    const total = parts.reduce((a,b)=>a+b.val,0);
    const topPct = total>0 ? parts[0].val/total : 0;

    // properties'e yaz
    c.properties.impact_raw = score;
    c.properties.top_category = topKey;
    c.properties.top_color = colorForCategory(topKey);

    // excel satırı
    const row = {
      'Parsel Adı': c.properties?.name || '',
      'Yarıçap (m)': radiusM,
      'Impact (Ham)': score,
      'En Etkileyen': topKey,
      'En Etkileyen %': topPct
    };
    // tüm kategorileri de ekle (count)
    Object.keys(CATEGORY_WEIGHTS).forEach(k => row[k] = counts[k] || 0);
    results.push(row);
  });

  // normalize (min-max, 0..1)
  const arr = parcelCentroids.map(c => c.properties.impact_raw || 0);
  const min = Math.min(...arr), max = Math.max(...arr);
  parcelCentroids.forEach(c => {
    const v = c.properties.impact_raw || 0;
    c.properties.impact_norm = (max>min) ? (v - min) / (max - min) : 0.5;
  });

  // kaynak verisini güncelle
  const src = map.getSource('centroids');
  if (src) src.setData({ type:'FeatureCollection', features: parcelCentroids });

  // excel butonuna veri bağla
  window.__lastAnalysisExcel = results;
  return results;
}

// ===========================
// İNDİRME BUTONLARI
// ===========================
document.getElementById('exportExcelButton')?.addEventListener('click', () => {
  // analiz yapılmadıysa önce çalıştır
  const data = window.__lastAnalysisExcel || analyzeParcelsDynamic();
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Analiz');
  XLSX.writeFile(wb, 'parseller_dinamik_analiz.xlsx');
});

document.getElementById('exportPNGButton')?.addEventListener('click', async () => {
  await exportPNGStatic();
});

// PNG: ekrandaki merkeze en yakın parsel çevresini (1000m + R/2) kapsayacak şekilde,
// animasyonlu noktaları gizleyip, canvas görüntüsünü indir.
async function exportPNGStatic() {
  const R = Math.max(0, parseFloat(document.getElementById('distanceInput')?.value || '500') || 500);
  const center = map.getCenter();
  const nearestIdx = getNearestCentroidIndex([center.lng, center.lat]);
  const p = parcelCentroids[nearestIdx];
  if (!p) { alert('Yakında parsel bulunamadı.'); return; }

  // anim-dots gizle
  const hidden = [];
  animDots.forEach(d => {
    if (map.getLayer(d.layerId)) {
      hidden.push(d.layerId);
      map.setLayoutProperty(d.layerId, 'visibility', 'none');
    }
  });

  // kapsama: 1000 + R/2 (metre)
  const radiusM = 1000 + (R/2);
  const radiusKm = radiusM / 1000;
  const circle = turf.circle(p.geometry.coordinates, radiusKm, { steps: 64, units: 'kilometers' });
  const bbox = turf.bbox(circle);
  map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 40, animate: false });

  // render'ın oturması için bir micro-wait
  await new Promise(r => setTimeout(r, 300));

  const dataURL = map.getCanvas().toDataURL('image/png');
  const link = document.createElement('a');
  link.download = `harita_analiz_${Math.round(radiusM)}m.png`;
  link.href = dataURL;
  link.click();

  // geri göster
  hidden.forEach(id => map.setLayoutProperty(id, 'visibility', 'visible'));
}


// ============== MESAFE EXCEL ==============

// merkezdeki parsel centroid'ini bul
function getCurrentParcelCentroid() {
  const c = map.getCenter();
  const idx = getNearestCentroidIndex([c.lng, c.lat]);
  return parcelCentroids[idx];
}

// seçili kategorı filtresini uygulayarak yarıçap içindeki donatıları getir
function getAmenitiesWithinRadiusFiltered(centerLng, centerLat, radiusM) {
  const radiusKm = Math.max(0, radiusM) / 1000;
  // önce kategori filtresi uygula
  const catFilter = f => {
    const k = f.properties?.Kategori || 'Bilinmiyor';
    return selectedCategories.size === 0 || selectedCategories.has(k);
  };

  if (amenIdx && typeof window.geokdbush !== 'undefined') {
    // hızlı (kdbush)
    const hits = window.geokdbush.around(amenIdx, centerLng, centerLat, Infinity, radiusKm);
    return hits.map(h => amenities[h.idx]).filter(catFilter);
  } else {
    // fallback (turf)
    const circlePoly = turf.circle([centerLng, centerLat], radiusKm, { steps: 64, units: 'kilometers' });
    const inside = turf.pointsWithinPolygon({ type: 'FeatureCollection', features: amenities }, circlePoly);
    return inside.features.filter(catFilter);
  }
}

// export: en yakın parsel için yarıçap içindeki donatıların mesafe/süre listesi
async function exportDistancesExcelForCurrentParcel() {
  const parcel = getCurrentParcelCentroid();
  if (!parcel) { alert('Yakında parsel bulunamadı.'); return; }

  const R = Math.max(0, parseFloat(document.getElementById('distanceInput')?.value || '500') || 500);
  const mode = (document.getElementById('distanceMode')?.value || 'haversine');
  const center = parcel.geometry.coordinates; // [lng, lat]

  // yarıçap içindeki ve kategori filtresine uyan donatılar
  const feats = getAmenitiesWithinRadiusFiltered(center[0], center[1], R);
  if (!feats.length) {
    alert('Bu yarıçap içinde donatı bulunamadı.');
    return;
  }

  let rows = [];

  if (mode === 'network') {
    // yol ağı mesafe & süre için matrix
    try {
      const enriched = await mapboxMatrixDistance(center, feats);
      // sıralayıp tablo yap
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
      // kuşbakışı yedek
      rows = feats.map(f => {
        const d = turf.distance(turf.point(center), f, { units: 'kilometers' }) * 1000;
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
      }).sort((a,b) => a['Mesafe (m)'] - b['Mesafe (m)']);
    }
  } else {
    // kuşbakışı mesafe
    rows = feats.map(f => {
      const d = turf.distance(turf.point(center), f, { units: 'kilometers' }) * 1000;
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
    }).sort((a,b) => a['Mesafe (m)'] - b['Mesafe (m)']);
  }

  // Excel çıktısı
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Mesafeler');
  const parcelNameSafe = (parcel.properties?.name || 'parsel').replace(/[\\/:*?"<>|]/g, '_');
  XLSX.writeFile(wb, `${parcelNameSafe}_${R}m_mesafe.xlsx`);
}

// click handler
document.getElementById('exportProxExcelButton')?.addEventListener('click', async () => {
  await exportDistancesExcelForCurrentParcel();
});


// ===========================
// KISAYOLLAR (+ mevcutlar)
// ===========================
window.addEventListener('keydown', async e => {
  const key = e.key;
  if (key === '3' || key === '9') {
    currentIndex = (currentIndex + 1) % proximityOrder.length;
  } else if (key === '1' || key === '7') {
    currentIndex = (currentIndex - 1 + proximityOrder.length) % proximityOrder.length;
  } else if (key.toLowerCase() === 'h') {
    hoverEnabled ? disableHover() : enableHover(); return;
  } else if (key.toLowerCase() === 'k') {
    toggleLegendVisibility(); return;
  } else if (key === '+' || key === '=') {
    tweakRadius(+50); return;
  } else if (key === '-' || key === '_') {
    tweakRadius(-50); return;
  } else if (key.toLowerCase() === 'a') {
    // *** İSTENEN ANALİZ ***
    analyzeParcelsDynamic();
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
// Grafikler (opsiyonel)
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
        datalabels: { color: '#fff', formatter: (v) => v, font: { weight: 'bold' } } }
    },
    plugins: [ChartDataLabels]
  });
}

function drawWeightedCategoryChart() {
  const weightedCounts = {};
  lastSpiderData.forEach(entry => {
    const k = entry.feature.properties?.Kategori || 'Bilinmiyor';
    const dMeters = (entry.distMeters != null) ? entry.distMeters : (entry.dist * 1000);
    const w = 1 / Math.max(dMeters, 1);
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

document.getElementById('btnCatChart')?.addEventListener('click', () =>
  lastSpiderData.length ? drawCategoryChart() : alert('Henüz analiz edilen veri yok.')
);
document.getElementById('btnWeightedChart')?.addEventListener('click', () =>
  lastSpiderData.length ? drawWeightedCategoryChart() : alert('Henüz analiz edilen veri yok.')
);

// grafik png indir
function downloadChartImage(canvasId, filename) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const link = document.createElement('a');
  link.download = filename;
  link.href = canvas.toDataURL('image/png');
  link.click();
}
window.downloadChartImage = downloadChartImage;

// Mesafe türü değişince spider’ı yenile
document.getElementById('distanceMode')?.addEventListener('change', async () => {
  await updateSpider([map.getCenter().lng, map.getCenter().lat]);
});
