import { MAPBOX_TOKEN } from '../config.js';

export async function matrixDistance(center, destFeatures) {
  if (!destFeatures.length) return [];
  const chunks = [];
  for (let i = 0; i < destFeatures.length; i += 24) chunks.push(destFeatures.slice(i, i + 24));
  const all = [];

  for (const group of chunks) {
    const coords = [`${center[0]},${center[1]}`, ...group.map(f => `${f.geometry.coordinates[0]},${f.geometry.coordinates[1]}`)].join(';');
    const destIdx = group.map((_, i) => i + 1).join(';');
    const url = `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coords}?sources=0&destinations=${destIdx}&annotations=distance,duration&access_token=${MAPBOX_TOKEN}`;

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

export async function routeGeoJSON(start, end) {
  const coords = `${start[0]},${start[1]};${end[0]},${end[1]}`;
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?overview=full&geometries=geojson&access_token=${MAPBOX_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Directions hata [${res.status}]`);
  const data = await res.json();
  const route = data.routes && data.routes[0];
  return route ? route.geometry : null;
}
