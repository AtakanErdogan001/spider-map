export const state = {
  map: null,

  parcels: [],
  parcelCentroids: [],
  amenities: [],

  proximityOrder: [],
  currentIndex: 0,

  currentLines: [],
  currentLabels: [],

  lastSpiderCoord: null,
  lastSpiderData: [],

  lastMouseLngLat: null,

  amenIdx: null,
  amenPoints: [],

  selectedCategories: new Set(),
  allCategories: [],

  legendVisible: true,
  heatmapOn: false,
  hoverEnabled: false,

  animDots: [],
  animRunning: false,
  DOT_PERIOD_MS: 9000
};
