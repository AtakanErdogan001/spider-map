import { state } from '../state.js';
import { updateSpider } from './spider.js';
import { analyzeParcelsDynamic, toggleParcelsDynamic, clearParcelsDynamic } from './analysis.js';


function tweakRadius(delta){
  const el = document.getElementById('distanceInput');
  if (!el) return;
  const cur = +el.value || 500;
  el.value = Math.max(10, cur + delta);
  el.dispatchEvent(new Event('input'));
  el.dispatchEvent(new Event('change'));
}

export function attachShortcuts(){
  window.addEventListener('keydown', async e => {
    const key = e.key;
    if (key === '3' || key === '9') {
      state.currentIndex = (state.currentIndex + 1) % state.proximityOrder.length;
    } else if (key === '1' || key === '7') {
      state.currentIndex = (state.currentIndex - 1 + state.proximityOrder.length) % state.proximityOrder.length;
    } else if (key.toLowerCase() === 'h') {
      const btn = document.getElementById('hoverToggleBtn');
      btn?.click(); return;
    } else if (key.toLowerCase() === 'k') {
      const legend = document.getElementById('categoryLegend');
      if (legend) legend.style.display = (legend.style.display === 'none' ? 'block' : 'none');
      return;
    } else if (key === '+' || key === '=') {
      tweakRadius(+50); return;
    } else if (key === '-' || key === '_') {
      tweakRadius(-50); return;
    } else if (key.toLowerCase() === 'a') {
      // ⬇️ daha önce analyzeParcelsDynamic idi; artık toggle
      toggleParcelsDynamic(); return;
    } else if (key.toLowerCase() === 'c') {
      // c tuşu “yeniden hesapla” olarak kalsın (istersen toggle’a da yönlendirebilirsin)
      analyzeParcelsDynamic(); return;
      // veya kapamak istersen: clearParcelsDynamic(); return;
    } else {
      return;
    }

    const newCenter = state.parcelCentroids[state.proximityOrder[state.currentIndex]].geometry.coordinates;
    state.map.flyTo({ center: newCenter });
    await updateSpider(newCenter);
  });

  // Pan hareketinde merkez en yakın centroid’e göre güncelle (hafif throttle)
  let lastMove = 0;
  function getMoveDelay(){
    const z = state.map.getZoom();
    return Math.max(120, 280 - (z - 10) * 25);
  }
  state.map.on('move', async () => {
    const now = Date.now();
    const delay = getMoveDelay();
    if (now - lastMove < delay) return;
    lastMove = now;

    const center = state.map.getCenter();
    const lngLat = [center.lng, center.lat];

    // en yakın centroid
    let min = Infinity, nearest = 0;
    state.parcelCentroids.forEach((f, i) => {
      const d = turf.distance(turf.point(lngLat), f);
      if (d < min) { min = d; nearest = i; }
    });
    const target = state.parcelCentroids[nearest]?.geometry?.coordinates;
    if (!target) return;
    await updateSpider(target);
  });
}
