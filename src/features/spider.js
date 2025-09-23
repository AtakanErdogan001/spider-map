import { state } from '../state.js';
import { colorForCategory, setModeBadge } from '../utils.js';
import { matrixDistance, routeGeoJSON } from '../services/mapbox.js';

export function applyAmenityFilter(){
  const ids = ['amenities-points', 'amenities-heat'];
  ids.forEach(id => {
    if (!state.map.getLayer(id)) return;
    if (state.selectedCategories.size === 0) {
      state.map.setFilter(id, ['in', ['get', 'Kategori'], ['literal', []]]);
    } else {
      state.map.setFilter(id, ['in', ['get', 'Kategori'], ['literal', Array.from(state.selectedCategories)]]);
    }
  });
}

function clearVisuals(){
  state.currentLines.forEach(id=>{
    if (state.map.getLayer(id)) state.map.removeLayer(id);
    if (state.map.getSource(id)) state.map.removeSource(id);
  });
  state.currentLabels.forEach(id=>{
    if (state.map.getLayer(id)) state.map.removeLayer(id);
    if (state.map.getSource(id)) state.map.removeSource(id);
  });
  state.currentLines = [];
  state.currentLabels = [];
  state.animDots.forEach(d=>{
    if (state.map.getLayer(d.layerId)) state.map.removeLayer(d.layerId);
    if (state.map.getSource(d.sourceId)) state.map.removeSource(d.sourceId);
  });
  state.animDots = [];
  state.animRunning = false;
}

function startDotAnimation(){ if (state.animRunning) return; state.animRunning = true; requestAnimationFrame(stepDots); }
function stepDots(ts){
  if (!state.animRunning) return;
  for (const d of state.animDots) {
    try {
      if (!d.lineGeom) continue;
      const lenKm = d.lengthKm ?? turf.length(d.lineGeom, { units:'kilometers' });
      if (lenKm <= 0) continue;
      const elapsed = (ts - d.startMs) % d.periodMs;
      const distKm = (elapsed / d.periodMs) * lenKm;
      const pt = turf.along(d.lineGeom, distKm, { units:'kilometers' });
      const src = state.map.getSource(d.sourceId);
      if (src) src.setData(pt);
    } catch {}
  }
  requestAnimationFrame(stepDots);
}
function createDotForLine(i, lineGeom, color){
  const dotSourceId = `dot-src-${i}`, dotLayerId = `dot-layer-${i}`;
  state.map.addSource(dotSourceId, { type:'geojson', data: turf.point(lineGeom.geometry.coordinates[0]) });
  state.map.addLayer({
    id: dotLayerId, type:'circle', source: dotSourceId,
    paint: { 'circle-radius': 8, 'circle-color': color, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 }
  });
  const lengthKm = turf.length(lineGeom, { units:'kilometers' });
  state.animDots.push({ sourceId: dotSourceId, layerId: dotLayerId, lineGeom, lengthKm, startMs: performance.now() + (i*250), periodMs: state.DOT_PERIOD_MS });
  startDotAnimation();
}

function preselectNearestByHaversine(center, features, limit=120, rM=null){
  const cPt = turf.point(center);
  let arr = features.map(f => ({ feature:f, hDistM: turf.distance(cPt, f, { units:'kilometers' })*1000 }));
  if (rM && rM > 0) { const tol = rM * 1.5; arr = arr.filter(x => x.hDistM <= tol); }
  arr.sort((a,b)=>a.hDistM-b.hDistM);
  return arr.slice(0, limit).map(x => x.feature);
}

function haversineNearest(center, features, rM, count){
  const cPt = turf.point(center);
  let nearest = features.map(f => ({ feature:f, dist: turf.distance(cPt, f, { units:'kilometers' }) }));
  if (!isNaN(rM) && rM > 0) nearest = nearest.filter(e => (e.dist*1000) <= rM);
  nearest.sort((a,b)=>a.dist-b.dist);
  if (count !== 'all') nearest = nearest.slice(0, parseInt(count));
  return nearest;
}

async function withOptionalRoutes(center, arr){
  const topN = arr.slice(0, 10);
  await Promise.all(topN.map(async n=>{
    try { n.geometryOverride = await routeGeoJSON(center, n.feature.geometry.coordinates); } catch {}
  }));
  return arr.map(r => ({
    feature: r.feature,
    dist: r.distMeters/1000,
    distMeters: r.distMeters,
    durationSec: r.durationSec,
    geometryOverride: r.geometryOverride || null
  }));
}

export async function updateSpider(center){
  const rounded = center.map(n => Number(n.toFixed(6)));
  if (state.lastSpiderCoord && rounded[0]===state.lastSpiderCoord[0] && rounded[1]===state.lastSpiderCoord[1]) return;

  state.lastSpiderCoord = rounded;
  clearVisuals();

  const maxDistanceMeters = parseFloat(document.getElementById('distanceInput')?.value || '0');
  let count = document.getElementById('lineCountSelect')?.value ?? '10';
  const distanceMode = document.getElementById('distanceMode')?.value || 'haversine';

  const filtered = state.amenities.filter(f => {
    const k = f.properties?.Kategori || 'Bilinmiyor';
    return state.selectedCategories.size === 0 || state.selectedCategories.has(k);
  });

  let nearest = [];
  if (distanceMode === 'network') {
    try {
      const pre = preselectNearestByHaversine(center, filtered, 120, maxDistanceMeters || 800);
      let arr = await matrixDistance(center, pre);
      if (!isNaN(maxDistanceMeters) && maxDistanceMeters > 0) arr = arr.filter(r => r.distMeters != null && r.distMeters <= maxDistanceMeters);
      arr.sort((a,b)=>a.distMeters-b.distMeters);
      if (count !== 'all') arr = arr.slice(0, parseInt(count));

      nearest = await withOptionalRoutes(center, arr);
      setModeBadge(true);
    } catch (err) {
      console.warn('Mapbox Matrix ulaşılamadı, kuşbakışına düştüm:', err);
      setModeBadge(false);
      nearest = haversineNearest(center, filtered, maxDistanceMeters, count);
    }
  } else {
    setModeBadge(false);
    nearest = haversineNearest(center, filtered, maxDistanceMeters, count);
  }

  state.lastSpiderData = nearest;

  for (let i = 0; i < nearest.length; i++) {
    const entry = nearest[i];
    const to = entry.feature.geometry.coordinates;
    let lineGeom;

    if (entry.geometryOverride && entry.geometryOverride.type === 'LineString') {
      lineGeom = { type:'Feature', geometry: entry.geometryOverride };
    } else {
      lineGeom = turf.lineString([center, to]);
    }

    const cat = entry.feature.properties?.Kategori || 'Donatı';
    const color = colorForCategory(cat);

    const lineId = `line-${i}`, labelId = `label-${i}`;
    state.map.addSource(lineId, { type:'geojson', data: lineGeom });
    state.map.addLayer({ id: lineId, type:'line', source: lineId, paint: { 'line-width': 4, 'line-color': color } });
    state.currentLines.push(lineId);

    const distM = (entry.distMeters != null) ? entry.distMeters : entry.dist * 1000;
    const durS  = entry.durationSec;
    const labelText = (durS != null)
      ? `${cat}\n${Math.round(distM)} m • ${Math.round(durS/60)} dk`
      : `${cat}\n${Math.round(distM)} m`;

    let midPoint;
    if (entry.geometryOverride?.coordinates?.length > 1) {
      const coords = entry.geometryOverride.coordinates;
      midPoint = turf.point(coords[Math.floor(coords.length / 2)]);
    } else {
      midPoint = turf.midpoint(turf.point(center), turf.point(to));
    }

    const labelFeature = { type:'Feature', geometry: midPoint.geometry, properties: { label: labelText } };
    state.map.addSource(labelId, { type:'geojson', data: labelFeature });
    state.map.addLayer({
      id: labelId, type:'symbol', source: labelId,
      layout: { 'text-field':['get','label'], 'text-font':['Open Sans Bold'], 'text-size':12, 'text-offset':[0,-1], 'text-anchor':'top' },
      paint: { 'text-color':'#000', 'text-halo-color':'#fff', 'text-halo-width': 1 }
    });
    state.currentLabels.push(labelId);

    createDotForLine(i, lineGeom, color);
  }
}
