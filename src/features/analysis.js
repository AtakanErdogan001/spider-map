import { state } from '../state.js';
import { CATEGORY_WEIGHTS } from '../config.js';
import { colorForCategory } from '../utils.js';

let sideChartInstance = null; // sağ paneldeki son grafiği temizlemek için

export function analyzeParcelsDynamic(){
  const radiusM = Math.max(0, parseFloat(document.getElementById('distanceInput')?.value || '500') || 500);
  const radiusKm = radiusM / 1000;
  const results = [];

  state.parcelCentroids.forEach((c) => {
    const [lng, lat] = c.geometry.coordinates;

    let hits = [];
    if (state.amenIdx && window.geokdbush) {
      hits = window.geokdbush.around(state.amenIdx, lng, lat, Infinity, radiusKm)
        .map(h => ({ feature: state.amenities[h.idx] }));
    } else {
      const circlePoly = turf.circle([lng, lat], radiusKm, { steps: 64, units: 'kilometers' });
      const inside = turf.pointsWithinPolygon({ type: 'FeatureCollection', features: state.amenities }, circlePoly);
      hits = inside.features.map(f => ({ feature: f }));
    }

    const counts = {};
    const parts = [];
    hits.forEach(h => {
      const k = h.feature.properties?.Kategori || 'Bilinmiyor';
      counts[k] = (counts[k] || 0) + 1;
    });

    let score = 0;
    Object.entries(CATEGORY_WEIGHTS).forEach(([k, w]) => {
      const cnt = counts[k] || 0;
      const v = w * Math.log1p(cnt);
      score += v;
      parts.push({ key:k, val:v });
    });

    parts.sort((a,b)=>b.val-a.val);
    const topKey = parts[0]?.key || '';
    const total = parts.reduce((a,b)=>a+b.val,0);
    const topPct = total>0 ? parts[0].val/total : 0;

    c.properties.impact_raw  = score;
    c.properties.top_category = topKey;
    c.properties.top_color = colorForCategory(topKey);

    const row = {
      'Parsel Adı': c.properties?.name || '',
      'Yarıçap (m)': radiusM,
      'Impact (Ham)': score,
      'En Etkileyen': topKey,
      'En Etkileyen %': topPct
    };
    Object.keys(CATEGORY_WEIGHTS).forEach(k => row[k] = counts[k] || 0);
    results.push(row);
  });

  const arr = state.parcelCentroids.map(c => c.properties.impact_raw || 0);
  const min = Math.min(...arr), max = Math.max(...arr);
  state.parcelCentroids.forEach(c => {
    const v = c.properties.impact_raw || 0;
    c.properties.impact_norm = (max>min) ? (v - min) / (max - min) : 0.5;
  });

  const src = state.map.getSource('centroids');
  if (src) src.setData({ type:'FeatureCollection', features: state.parcelCentroids });

  window.__lastAnalysisExcel = results;
  return results;
}

/* ---------------------------
   Sağ taraftaki grafik paneli
   --------------------------- */
function openSideChartPanel(title){
  const panel = document.getElementById('chartPanel');
  const titleEl = document.getElementById('chartPanelTitle');
  const host = document.getElementById('sideChartContainer');
  if (!panel || !host) return null;
  if (titleEl && title) titleEl.textContent = title;

  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');

  // Panel animasyonu bittiğinde Chart.js’e gerçek ölçüleri ver
  const fireResize = () => window.dispatchEvent(new Event('resize'));
  panel.addEventListener('transitionend', fireResize, { once: true });
  // Emniyet: bir sonraki frame'de de tetikle
  requestAnimationFrame(() => fireResize());

  return host;
}

(function wireChartPanelClose(){
  const btn = document.getElementById('chartPanelClose');
  const panel = document.getElementById('chartPanel');
  const host = document.getElementById('sideChartContainer');
  if (btn && panel){
    btn.addEventListener('click', () => {
      panel.classList.remove('open');
      panel.setAttribute('aria-hidden', 'true');
      // İstersen içerik temizlensin:
      if (host) host.innerHTML = '';
      if (sideChartInstance) { try { sideChartInstance.destroy(); } catch{} sideChartInstance = null; }
    });
  }
})();

/* ---------------------------
   Buton bağlama
   --------------------------- */
export function attachAnalysisButtons(){
  document.getElementById('exportExcelButton')?.addEventListener('click', () => {
    const data = window.__lastAnalysisExcel || analyzeParcelsDynamic();
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Analiz');
    XLSX.writeFile(wb, 'parseller_dinamik_analiz.xlsx');
  });

  document.getElementById('btnCatChart')?.addEventListener('click', ()=>{
    if (!state.lastSpiderData.length) return alert('Henüz analiz edilen veri yok.');
    const host = openSideChartPanel('Kategorisel Grafik');
    if (!host) return;
    drawCategoryChart(host);            // sağ panel
  });

  document.getElementById('btnWeightedChart')?.addEventListener('click', ()=>{
    if (!state.lastSpiderData.length) return alert('Henüz analiz edilen veri yok.');
    const host = openSideChartPanel('Mesafe Ağırlıklı Kategorisel Dağılım');
    if (!host) return;
    drawWeightedCategoryChart(host);    // sağ panel
  });
}

/* ---------------------------
   Grafik çizimleri
   --------------------------- */
function drawCategoryChart(hostEl) {
  const counts = {};
  state.lastSpiderData.forEach(e => {
    const k = e.feature.properties?.Kategori || 'Bilinmiyor';
    counts[k] = (counts[k] || 0) + 1;
  });

  const labels = Object.keys(counts);
  const data   = labels.map(l => counts[l]);
  const colors = labels.map(l => colorForCategory(l));

  const host = hostEl || document.getElementById('categoryChartContainer'); // yedek
  if (!host) return;

  host.innerHTML = '<div class="chart-slot"><canvas id="categoryChart"></canvas></div>';
  const canvas = host.querySelector('#categoryChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  if (sideChartInstance) { try { sideChartInstance.destroy(); } catch{} }

  const chart = new Chart(ctx, {
    type: 'pie',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: '#fff', borderWidth: 1 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            font: { size: 15, weight: '500' },
            color: '#222',
            padding: 14,
            boxWidth: 16
          }
        },
        title: { display: true, text: 'Kategorisel Yoğunluk Dağılımı', font: { size: 16, weight: '600' } },
        datalabels: { color: '#fff', font: { size: 12, weight: 'bold' } }
      }
    },
    plugins: [ChartDataLabels]
  });

  sideChartInstance = chart;
  canvas._chartInstance = chart;

  // ölçü otursun
  setTimeout(() => sideChartInstance?.resize(), 0);
}

function drawWeightedCategoryChart(hostEl) {
  const weighted = {};
  state.lastSpiderData.forEach(e => {
    const k = e.feature.properties?.Kategori || 'Bilinmiyor';
    const d = (e.distMeters != null) ? e.distMeters : (e.dist * 1000);
    const w = 1 / Math.max(d, 1);
    weighted[k] = (weighted[k] || 0) + w;
  });

  const labels = Object.keys(weighted);
  const data   = labels.map(l => weighted[l]);
  const colors = labels.map(l => colorForCategory(l));

  const host = hostEl || document.getElementById('weightedChartContainer'); // yedek
  if (!host) return;

  host.innerHTML = '<div class="chart-slot"><canvas id="weightedCategoryChart"></canvas></div>';
  const canvas = host.querySelector('#weightedCategoryChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  if (sideChartInstance) { try { sideChartInstance.destroy(); } catch{} }

  const chart = new Chart(ctx, {
    type: 'pie',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: '#fff', borderWidth: 1 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { font: { size: 15, weight: '500' }, color: '#222', padding: 14, boxWidth: 16 }
        },
        title: { display: true, text: 'Mesafe Ağırlıklı Kategorisel Dağılım', font: { size: 16, weight: '600' } },
        datalabels: {
          color: '#fff',
          formatter: (v, c) => {
            const t = c.chart.data.datasets[0].data.reduce((a,b)=>a+b,0);
            return `${v.toFixed(2)} (${(v/t*100).toFixed(1)}%)`;
          },
          font: { weight: 'bold' }
        }
      }
    },
    plugins: [ChartDataLabels]
  });

  sideChartInstance = chart;
  canvas._chartInstance = chart;
  setTimeout(() => sideChartInstance?.resize(), 0);
}
