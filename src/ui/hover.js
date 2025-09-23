import { state } from '../state.js';

const HOVER_SRC = 'hover-circle-src';
const HOVER_FILL = 'hover-circle-fill';
const HOVER_OUTLINE = 'hover-circle-outline';
const IN_CIRCLE_SRC = 'amenities-in-circle-src';
const IN_CIRCLE_LAYER = 'amenities-in-circle-layer';

export function ensureHoverCircleLayers(){
  const { map } = state;
  if (!map.getSource(HOVER_SRC)) map.addSource(HOVER_SRC, { type:'geojson', data:turf.featureCollection([]) });
  if (!map.getLayer(HOVER_FILL)) {
    map.addLayer({ id:HOVER_FILL, type:'fill', source:HOVER_SRC, paint:{ 'fill-color':'#3F51B5', 'fill-opacity':0.10 } });
  }
  if (!map.getLayer(HOVER_OUTLINE)) {
    map.addLayer({ id:HOVER_OUTLINE, type:'line', source:HOVER_SRC, paint:{ 'line-color':'#3F51B5', 'line-width':4 } });
  }
  if (!map.getSource(IN_CIRCLE_SRC)) map.addSource(IN_CIRCLE_SRC, { type:'geojson', data:turf.featureCollection([]) });
  if (!map.getLayer(IN_CIRCLE_LAYER)) {
    map.addLayer({ id:IN_CIRCLE_LAYER, type:'circle', source:IN_CIRCLE_SRC,
      paint:{ 'circle-radius':10, 'circle-color':'#FFFFFF', 'circle-stroke-color':'#3F51B5', 'circle-stroke-width':2 } });
  }
}

export function setHoverVisibility(visible){
  const { map } = state;
  [HOVER_FILL, HOVER_OUTLINE, IN_CIRCLE_LAYER].forEach(id=>{
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  });
  const panel = document.getElementById('categorySummary');
  if (panel) panel.style.display = visible ? 'block' : 'none';
  const body = document.getElementById('categorySummaryBody');
  if (!visible && body) body.innerHTML = 'İmleci harita üzerinde gezdirin…';
}

function queryAmenitiesInRadius(centerLng, centerLat, radiusMeters){
  const radiusKm = Math.max(0, radiusMeters) / 1000;
  if (state.amenIdx && typeof window.geokdbush !== 'undefined') {
    const hits = window.geokdbush.around(state.amenIdx, centerLng, centerLat, Infinity, radiusKm);
    return hits
      .map(h => ({ feature: state.amenities[h.idx], distKm: h.distance }))
      .filter(h => {
        const k = h.feature?.properties?.Kategori || 'Bilinmiyor';
        return state.selectedCategories.size === 0 || state.selectedCategories.has(k);
      });
  }
  const circlePoly = turf.circle([centerLng, centerLat], radiusKm, { steps: 64, units: 'kilometers' });
  const inside = turf.pointsWithinPolygon({ type: 'FeatureCollection', features: state.amenities }, circlePoly);
  const filtered = inside.features.filter(f => {
    const k = f.properties?.Kategori || 'Bilinmiyor';
    return state.selectedCategories.size === 0 || state.selectedCategories.has(k);
  });
  return filtered.map(f => ({
    feature: f,
    distKm: turf.distance([centerLng, centerLat], f, { units: 'kilometers' })
  }));
}

export function updateHoverCircleAt(lngLat){
  if (!state.hoverEnabled) return;
  state.lastMouseLngLat = lngLat;

  const input = document.getElementById('distanceInput');
  const rM = Math.max(0, parseFloat(input?.value || '500') || 500);
  const radiusKm = rM / 1000;

  ensureHoverCircleLayers();
  const circle = turf.circle(lngLat, radiusKm, { steps: 64, units: 'kilometers' });
  state.map.getSource(HOVER_SRC).setData(circle);

  const around = queryAmenitiesInRadius(lngLat[0], lngLat[1], rM);
  state.map.getSource(IN_CIRCLE_SRC).setData({ type: 'FeatureCollection', features: around.map(a => a.feature) });

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

export function refreshHoverToggleUI(){
  const btn = document.getElementById('hoverToggleBtn');
  if (btn) {
    btn.textContent = state.hoverEnabled ? 'Yakın Çevre Analizi: AÇIK' : 'Yakın Çevre Analizi: KAPALI';
    btn.setAttribute('aria-pressed', state.hoverEnabled ? 'true' : 'false');
  }
  setHoverVisibility(state.hoverEnabled);
  if (state.hoverEnabled) {
    const center = state.lastMouseLngLat || [state.map.getCenter().lng, state.map.getCenter().lat];
    updateHoverCircleAt(center);
  }
}

export function enableHover(){ state.hoverEnabled = true; ensureHoverCircleLayers(); refreshHoverToggleUI(); }
export function disableHover(){ state.hoverEnabled = false; refreshHoverToggleUI(); }

export function attachHoverButton(){
  document.getElementById('hoverToggleBtn')?.addEventListener('click', ()=>{
    state.hoverEnabled ? disableHover() : enableHover();
  });

  let hoverTicking = false;
  state.map.on('mousemove', (e) => {
    if (!state.hoverEnabled) return;
    if (hoverTicking) return;
    hoverTicking = true;
    requestAnimationFrame(() => {
      updateHoverCircleAt([e.lngLat.lng, e.lngLat.lat]);
      hoverTicking = false;
    });
  });
}
