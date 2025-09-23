import { state } from '../state.js';
import { normTR } from '../utils.js';
import { updateSpider } from './spider.js';

export function setupParcelSearch(){
  const input = document.getElementById('parcelSearchInput');
  const resultsList = document.getElementById('searchResults');
  if (!input || !resultsList) return;

  input.addEventListener('input', () => {
    const query = normTR(input.value.trim());
    resultsList.innerHTML = '';
    if (!query) return;

    const matches = state.parcels.filter(f => normTR((f.properties?.name ?? '').trim()).includes(query));
    matches.forEach(f => {
      const li = document.createElement('li');
      li.textContent = f.properties?.name ?? '(İsimsiz)';
      li.style.cursor = 'pointer';
      li.style.padding = '3px 6px';
      li.addEventListener('click', async () => {
        const centroid = turf.centroid(f).geometry.coordinates;
        state.map.flyTo({ center: centroid, zoom: 17 });
        await updateSpider(centroid);
        resultsList.innerHTML = '';
        input.value = '';
      });
      resultsList.appendChild(li);
    });
  });
}
