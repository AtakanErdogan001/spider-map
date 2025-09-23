export function getCentroids(features) {
  return features.map(f => {
    const c = turf.centroid(f);
    c.properties = { ...f.properties };
    return c;
  });
}

export function getProximityOrder(centroids) {
  const base = centroids[0];
  return centroids
    .map((c, i) => ({ index: i, dist: turf.distance(base, c) }))
    .sort((a, b) => a.dist - b.dist)
    .map(e => e.index);
}

export function nearestCentroidIndex(centroids, lngLat) {
  let min = Infinity, idx = 0;
  centroids.forEach((f, i) => {
    const d = turf.distance(turf.point(lngLat), f);
    if (d < min) { min = d; idx = i; }
  });
  return idx;
}
