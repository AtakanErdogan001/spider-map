// src/ui/panel.js
export function attachPanelUX(){
  const panel = document.getElementById('controlPanel');
  const collapseBtn = document.getElementById('panelCollapseBtn');
  if (!panel || !collapseBtn) return;

  // Daralt/aç
  collapseBtn.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('collapsed');
    collapseBtn.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
  });

  // Genişlik değişiminde otomatik "compact" modu
  const applyCompact = () => {
    const w = panel.getBoundingClientRect().width;
    panel.classList.toggle('compact', w < 360);  // eşik: 360px
  };

  // Native resize'ı izlemek için ResizeObserver
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(() => applyCompact());
    ro.observe(panel);
  } else {
    // Eski tarayıcılar için yedek: pencere boyutunda tetikle
    window.addEventListener('resize', applyCompact);
  }
  // ilk kurulum
  applyCompact();
}
