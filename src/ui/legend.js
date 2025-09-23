import { state } from '../state.js';
import { applyAmenityFilter, updateSpider } from '../features/spider.js';

export function setLegendVisibility(visible){
  state.legendVisible = visible;
  const el = document.getElementById('categoryLegend');
  if (el) el.style.display = visible ? 'block' : 'none';
}

export function buildLegend(categories){
  let legend = document.getElementById('categoryLegend');
  if (!legend) {
    legend = document.createElement('div');
    legend.id = 'categoryLegend';
    document.body.appendChild(legend);
  }

  Object.assign(legend.style, {
    position: 'absolute', top:'12px', left: 'auto', right: '12px', bottom: 'auto', zIndex: '3',
    background: 'rgba(255,255,255,0.65)', border: '1px solid #ddd', borderRadius: '8px',
    padding: '10px 12px', fontSize: '13px', minWidth: '220px', maxWidth: '300px',
    maxHeight: '40vh', overflow: 'auto', boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
    lineHeight: '1.35', display: state.legendVisible ? 'block' : 'none'
  });

  legend.innerHTML = `<div style="font-weight:600; margin-bottom:6px;">Kategoriler</div>`;
  state.selectedCategories = new Set(categories);

  categories.forEach(cat => {
    const id = `cat_${cat.replace(/\s+/g, '_')}`;
    const wrap = document.createElement('label');
    Object.assign(wrap.style, { display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0' });

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = id;
    cb.checked = true;
    cb.addEventListener('change', async () => {
      cb.checked ? state.selectedCategories.add(cat) : state.selectedCategories.delete(cat);
      applyAmenityFilter();
      const c = [state.map.getCenter().lng, state.map.getCenter().lat];
      await updateSpider(c);
    });

    const nameSpan = document.createElement('span'); nameSpan.textContent = cat;
    wrap.append(cb, nameSpan);
    legend.appendChild(wrap);
  });

  const ctrlRow = document.createElement('div');
  Object.assign(ctrlRow.style, { display: 'flex', justifyContent: 'space-between', marginTop: '8px' });

  const selectAllBtn = document.createElement('button');
  selectAllBtn.textContent = 'Tümünü Seç';
  selectAllBtn.style.fontSize = '12px';
  selectAllBtn.onclick = async () => {
    state.selectedCategories = new Set(categories);
    legend.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
    applyAmenityFilter();
    const c = [state.map.getCenter().lng, state.map.getCenter().lat];
    await updateSpider(c);
  };

  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Temizle';
  clearBtn.style.fontSize = '12px';
  clearBtn.onclick = async () => {
    state.selectedCategories.clear();
    legend.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    applyAmenityFilter();
    const c = [state.map.getCenter().lng, state.map.getCenter().lat];
    await updateSpider(c);
  };

  ctrlRow.append(selectAllBtn, clearBtn);
  legend.appendChild(ctrlRow);
}
