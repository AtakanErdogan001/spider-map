mapboxgl.accessToken = 'pk.eyJ1IjoiYXRha2FuZSIsImEiOiJjbWNoZDR5d3UwbGJmMm9xdnF3d2Y5cXdwIn0.I3QIz42RMN2zGZHqsH4ueA';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v11',
  center: [27.1428, 38.4192],
  zoom: 14
});

let parcels = [];
let parcelCentroids = [];
let amenities = [];
let proximityOrder = [];
let currentIndex = 0;
let currentLines = [];
let currentLabels = [];
let lastSpiderCoord = null;

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

function updateSpider(center) {
  const roundedCenter = center.map(n => Number(n.toFixed(6)));
  if (lastSpiderCoord && roundedCenter[0] === lastSpiderCoord[0] && roundedCenter[1] === lastSpiderCoord[1]) return;

  lastSpiderCoord = roundedCenter;
  clearVisuals();

  const centerPoint = turf.point(center);
  const maxDistance = parseFloat(document.getElementById('distanceInput').value || '0') / 1000;
  let count = document.getElementById('lineCountSelect').value;

  let nearest = amenities.map(f => ({
    feature: f,
    dist: turf.distance(centerPoint, f, { units: 'kilometers' })
  }));

  if (!isNaN(maxDistance) && maxDistance > 0) {
    nearest = nearest.filter(e => e.dist <= maxDistance);
  }

  nearest.sort((a, b) => a.dist - b.dist);
  if (count !== 'all') {
    nearest = nearest.slice(0, parseInt(count));
  }

  nearest.forEach((entry, i) => {
    const coords = [center, entry.feature.geometry.coordinates];
    const lineId = `line-${i}`;
    const labelId = `label-${i}`;

    map.addSource(lineId, { type: 'geojson', data: turf.lineString(coords) });
    map.addLayer({
      id: lineId,
      type: 'line',
      source: lineId,
      paint: {
        'line-width': 1.5,
        'line-color': '#3F51B5'
      }
    });
    currentLines.push(lineId);

    const mid = turf.midpoint(turf.point(coords[0]), turf.point(coords[1]));
    const labelFeature = {
      type: 'Feature',
      geometry: mid.geometry,
      properties: {
        label: `${entry.feature.properties.Kategori || 'Donatı'}\n${(entry.dist * 1000).toFixed(0)} m`
      }
    };

    map.addSource(labelId, { type: 'geojson', data: labelFeature });
    map.addLayer({
      id: labelId,
      type: 'symbol',
      source: labelId,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Open Sans Bold'],
        'text-size': 12,
        'text-offset': [0, -1],
        'text-anchor': 'top'
      },
      paint: {
        'text-color': '#000000',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1
      }
    });
    currentLabels.push(labelId);
  });

  // exportExcelCheckbox varsa ve işaretliyse Excel çıktısı al
  const nearestCopy = nearest.map(n => ({ ...n })); // Deep copy
  if (document.getElementById('exportExcelCheckbox')?.checked) {
    exportSpiderDataToExcel(nearestCopy);
  }
}

function getProximityOrder(centroids) {
  const base = centroids[0];
  return centroids
    .map((c, i) => ({ index: i, dist: turf.distance(base, c) }))
    .sort((a, b) => a.dist - b.dist)
    .map(e => e.index);
}

map.on('load', () => {
  Promise.all([
    fetch('./data/parseller.geojson').then(res => res.json()),
    fetch('./data/donatilar.geojson').then(res => res.json())
  ]).then(([parcelData, amenityData]) => {
    parcels = parcelData.features;
    parcelCentroids = getCentroids(parcels);
    amenities = amenityData.features;
    proximityOrder = getProximityOrder(parcelCentroids);

    map.addSource('parcels', { type: 'geojson', data: parcelData });
    map.addLayer({
      id: 'parcels-polygons',
      type: 'fill',
      source: 'parcels',
      paint: {
        'fill-color': '#FFCDD2',
        'fill-opacity': 0.3
      }
    });

    map.addSource('centroids', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: parcelCentroids }
    });
    map.addLayer({
      id: 'centroids-points',
      type: 'circle',
      source: 'centroids',
      paint: {
        'circle-radius': 5,
        'circle-color': '#E91E63'
      }
    });

    // ✅ 2. Parsel noktaları üzerine 'name' etiketi eklemek için:
    map.addLayer({
      id: 'centroids-labels',
      type: 'symbol',
      source: 'centroids',
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Open Sans Bold'],
        'text-size': 11,
        'text-anchor': 'top',
        'text-offset': [0, 0.5]
      },
      paint: {
        'text-color': '#333333',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1
      }
    });

    map.addSource('amenities', { type: 'geojson', data: amenityData });
    map.addLayer({
      id: 'amenities-points',
      type: 'circle',
      source: 'amenities',
      paint: {
        'circle-radius': 5,
        'circle-color': [
          'match',
          ['get', 'Kategori'],
          'Okullar', '#2196F3',
          'Parklar', '#4CAF50',
          'Raylı Sistem Durakları', '#FF9800',
          'Su Kaynakları', '#00BCD4',
          /* default */ '#9E9E9E'
        ]
      }
    });

    const startCenter = parcelCentroids[proximityOrder[currentIndex]].geometry.coordinates;
    map.flyTo({ center: startCenter });
    updateSpider(startCenter);
  });
});

document.getElementById('styleSwitcher').addEventListener('change', function () {
  const selectedStyle = this.value;
  map.setStyle(selectedStyle);

  map.once('styledata', () => {
    map.addSource('parcels', { type: 'geojson', data: { type: 'FeatureCollection', features: parcels } });
    map.addLayer({
      id: 'parcels-polygons',
      type: 'fill',
      source: 'parcels',
      paint: {
        'fill-color': '#f5021b',
        'fill-opacity': 0.3
      }
    });

    map.addSource('centroids', { type: 'geojson', data: { type: 'FeatureCollection', features: parcelCentroids } });
    map.addLayer({
      id: 'centroids-points',
      type: 'circle',
      source: 'centroids',
      paint: {
        'circle-radius': 5,
        'circle-color': '#E91E63'
      }
    });

    map.addSource('amenities', { type: 'geojson', data: { type: 'FeatureCollection', features: amenities } });
    map.addLayer({
      id: 'amenities-points',
      type: 'circle',
      source: 'amenities',
      paint: {
        'circle-radius': 5,
        'circle-color': [
          'match',
          ['get', 'Kategori'],
          'Okullar', '#2196F3',
          'Parklar', '#4CAF50',
          'Raylı Sistem Durakları', '#FF9800',
          'Su Kaynakları', '#00BCD4',
          /* default */ '#9E9E9E'
        ]
      }
    });

    const center = map.getCenter();
    updateSpider([center.lng, center.lat]);
  });
});

window.addEventListener('keydown', e => {
  if (e.key === 'd' || e.key === 'D') {
    currentIndex = (currentIndex + 1) % proximityOrder.length;
  } else if (e.key === 'a' || e.key === 'A') {
    currentIndex = (currentIndex - 1 + proximityOrder.length) % proximityOrder.length;
  } else if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
    return;
  }
  const newCenter = parcelCentroids[proximityOrder[currentIndex]].geometry.coordinates;
  map.flyTo({ center: newCenter });
  updateSpider(newCenter);
});

function getNearestCentroidIndex(lngLat) {
  let minDist = Infinity;
  let nearest = 0;
  parcelCentroids.forEach((f, i) => {
    const dist = turf.distance(turf.point(lngLat), f);
    if (dist < minDist) {
      minDist = dist;
      nearest = i;
    }
  });
  return nearest;
}

let lastMove = 0;
map.on('move', () => {
  const now = Date.now();
  if (now - lastMove < 300) return;
  lastMove = now;

  const center = map.getCenter();
  const lngLat = [center.lng, center.lat];
  const nearest = getNearestCentroidIndex(lngLat);
  const nearestCenter = parcelCentroids[nearest].geometry.coordinates;

  updateSpider(nearestCenter);
});

map.on('contextmenu', (e) => {
  const features = map.queryRenderedFeatures(e.point, {
    layers: ['centroids-points', 'amenities-points']
  });

  if (features.length > 0) {
    const props = features[0].properties;
    const content = Object.entries(props)
      .map(([k, v]) => `<b>${k}</b>: ${v}`)
      .join('<br>');

    new mapboxgl.Popup()
      .setLngLat(e.lngLat)
      .setHTML(content)
      .addTo(map);
  } else {
    new mapboxgl.Popup()
      .setLngLat(e.lngLat)
      .setHTML('Yakında veri bulunamadı.')
      .addTo(map);
  }
});

function exportSpiderDataToExcel(nearestEntries) {
  const data = nearestEntries.map(entry => ({
    'Kategori': entry.feature.properties.Kategori || 'Donatı',
    'Mesafe (m)': (entry.dist * 1000).toFixed(2),
    'Koordinat': `${entry.feature.geometry.coordinates[1]}, ${entry.feature.geometry.coordinates[0]}`
  }));

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Mesafe Çıktısı");
  XLSX.writeFile(workbook, "mesafe_baglantilari.xlsx");
}
