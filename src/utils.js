export function colorForCategory(k) {
  if (!k) return '#607D8B';
  const s = (k + '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('tr').replace(/ı/g, 'i');
  if (s.includes('park')) return '#4CAF50';
  if (s.includes('okul')) return '#2196F3';
  if (s.includes('ibadet')) return '#9C27B0';
  if (s.includes('belediye')) return '#a88c3fff';
  if (s.includes('su')) return '#00BCD4';
  if (s.includes('kültürel')) return '#d47800ff';
  if (s.includes('sağlık') || s.includes('saglik') || s.includes('hastane')) return '#F44336';
  if (s.includes('raylı') || s.includes('rayli')) return '#FF9800';
  return '#607D8B';
}

export function normTR(s = '') {
  let t = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('tr');
  return t.replace(/ı̇/g, 'i');
}

export function setModeBadge(ok = true) {
  const el = document.getElementById('modeBadge');
  if (!el) return;
  el.textContent = ok ? 'Mesafe Türü: Yol Ağı (Matrix)' : 'Mesafe Türü: Kuşbakışı (fallback)';
  el.style.color = ok ? '#2e7d32' : '#c62828';
}

export function delay(ms){ return new Promise(r => setTimeout(r, ms)); }
