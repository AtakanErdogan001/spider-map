export function addParcelsLayers(map, parcels, centroids) {
  map.addSource('parcels', { type: 'geojson', data: { type: 'FeatureCollection', features: parcels } });
  map.addLayer({ id: 'parcels-polygons', type: 'fill', source: 'parcels', paint: { 'fill-color': '#FFCDD2', 'fill-opacity': 0.6 } });

  map.addSource('centroids', { type: 'geojson', data: { type: 'FeatureCollection', features: centroids } });
  map.addLayer({
    id: 'centroids-points',
    type: 'circle',
    source: 'centroids',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['coalesce', ['get', 'impact_norm'], 0], 0, 6, 1, 22],
      'circle-color': '#E91E63',
      'circle-stroke-color': ['coalesce', ['get', 'top_color'], '#333'],
      'circle-stroke-width': ['case', ['has', 'top_color'], 6, 3]
    }
  });
  map.addLayer({
    id: 'centroids-labels',
    type: 'symbol',
    source: 'centroids',
    layout: { 'text-field': ['get', 'name'], 'text-font': ['Open Sans Bold'], 'text-size': 11, 'text-anchor': 'top', 'text-offset': [0, 0.5] },
    paint: { 'text-color': '#333', 'text-halo-color': '#fff', 'text-halo-width': 1 }
  });
}
