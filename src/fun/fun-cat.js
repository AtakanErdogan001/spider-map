// fun-cat.js  — “kedi gezintisi” modülü (ESM)

export function initFunCat(map) {
  // butona tıkla -> kedi
  const btn = document.getElementById('funCatBtn');
  if (btn) {
    btn.addEventListener('click', () => {
      const dur = 5000 + Math.floor(Math.random() * 5000);
      launchCatParade(map, dur);
    });
  }

  // C kısayolu
  window.addEventListener('keydown', e => {
    if (e.key.toLowerCase() === 'c') launchCatParade(map);
  });
}

export function launchCatParade(map, durationMs = 9000) {
  // sprite elemanı (emoji; istersen <img src="cat.png"> kullan)
  const el = document.createElement('div');
  el.className = 'cat-sprite';
  el.textContent = '🐈‍⬛';

  const start = map.getCenter();
  const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
    .setLngLat([start.lng, start.lat])
    .addTo(map);

  const rand = (a, b) => a + Math.random() * (b - a);
  let vx = rand(-120, 120);
  let vy = rand(-90, 90);
  if (Math.abs(vx) < 40) vx = 40 * Math.sign(vx || 1);

  let running = true;
  const t0 = performance.now();

  function step(t) {
    if (!running) return;
    const dt = Math.min(40, t - (step._prev || t)); // ms
    step._prev = t;

    const curLngLat = marker.getLngLat();
    const curPx = map.project([curLngLat.lng, curLngLat.lat]);
    curPx.x += vx * (dt / 1000);
    curPx.y += vy * (dt / 1000);

    const pad = 30;
    const w = map.getContainer().clientWidth;
    const h = map.getContainer().clientHeight;
    if (curPx.x < pad || curPx.x > w - pad) vx = -vx;
    if (curPx.y < pad || curPx.y > h - pad) vy = -vy;

    const nextLngLat = map.unproject(curPx);
    marker.setLngLat(nextLngLat);

    if (Math.random() < 0.02) { vx += rand(-40, 40); vy += rand(-30, 30); }

    if (t - t0 >= durationMs) { running = false; marker.remove(); return; }
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
