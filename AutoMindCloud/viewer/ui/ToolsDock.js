// ToolsDock.js — dock derecho con vistas Iso/Top/Front/Right (distancia fija)

export function createToolsDock({ container, theme, navigateToView, onToggle }) {
  const root = document.createElement('div');
  root.style.position = 'fixed';
  root.style.right = '16px';
  root.style.top = '16px';
  root.style.zIndex = '99999';
  root.style.background = 'rgba(255,255,255,0.95)';
  root.style.border = '1px solid #d7e7e7';
  root.style.borderRadius = '12px';
  root.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';
  root.style.padding = '8px';
  root.style.transform = 'translateX(100%)';
  root.style.opacity = '0';
  root.style.pointerEvents = 'none';
  root.style.transition = 'transform .3s ease, opacity .3s ease';
  container.appendChild(root);

  const title = document.createElement('div');
  title.textContent = 'Viewer Tools'; title.style.fontWeight = '800'; title.style.margin = '4px 6px 8px';
  root.appendChild(title);

  const row = document.createElement('div');
  row.style.display = 'flex'; row.style.gap = '8px';
  root.appendChild(row);

  function mk(label) {
    const b = document.createElement('button');
    b.textContent = label;
    b.classList.add('am-btn');
    b.addEventListener('click', (e) => { e.preventDefault(); navigateToView && navigateToView(label.toLowerCase()); });
    return b;
  }
  row.appendChild(mk('Iso'));
  row.appendChild(mk('Top'));
  row.appendChild(mk('Front'));
  row.appendChild(mk('Right'));

  function open()  { root.style.transform = 'translateX(0)'; root.style.opacity = '1'; root.style.pointerEvents = 'auto'; onToggle && onToggle(true); }
  function close() { root.style.transform = 'translateX(100%)'; root.style.opacity = '0'; root.style.pointerEvents = 'none'; onToggle && onToggle(false); }
  function toggle(){ (root.style.opacity === '1') ? close() : open(); }

  return { open, close, toggle, isOpen: () => root.style.opacity === '1' };
}
