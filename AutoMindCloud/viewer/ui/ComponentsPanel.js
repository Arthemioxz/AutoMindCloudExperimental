// /viewer/ui/ComponentsPanel.js
// Floating gallery of components with thumbnails + type (.dae/.stl/.stp/...), hover on items, tween toggle with 'c' (dock left).

/**
 * @typedef {Object} Theme
 * @property {string} teal
 * @property {string} tealSoft
 * @property {string} tealFaint
 * @property {string} bgPanel
 * @property {string|number} bgCanvas
 * @property {string} stroke
 * @property {string} text
 * @property {string} textMuted
 * @property {string} shadow
 */

export function createComponentsPanel(app, theme) {
  // ---- Normalize theme ----
  if (theme && theme.colors) {
    theme.teal       ??= theme.colors.teal;
    theme.tealSoft   ??= theme.colors.tealSoft;
    theme.tealFaint  ??= theme.colors.tealFaint;
    theme.bgPanel    ??= theme.colors.panelBg;
    theme.bgCanvas   ??= theme.colors.canvasBg;
    theme.stroke     ??= theme.colors.stroke;
    theme.text       ??= theme.colors.text;
    theme.textMuted  ??= theme.colors.textMuted;
  }
  if (theme && theme.shadows) {
    theme.shadow ??= (theme.shadows.lg || theme.shadows.md || theme.shadows.sm);
  }
  theme = theme || {};
  const SHADOW = theme.shadow || '0 8px 24px rgba(0,0,0,.15)';

  // ---- UI ----
  const ui = {
    root: document.createElement('div'),
    panel: document.createElement('div'),
    header: document.createElement('div'),
    title: document.createElement('div'),
    showAllBtn: document.createElement('button'),
    btn: document.createElement('button'),
    list: document.createElement('div')
  };

  // Root layer
  Object.assign(ui.root.style, {
    position: 'absolute',
    left: '0', top: '0', width: '100%', height: '100%',
    pointerEvents: 'none', zIndex: 9999,
    fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial'
  });

  // Panel (A LA IZQUIERDA)
  Object.assign(ui.panel.style, {
    position: 'absolute',
    left: '14px',
    bottom: '14px',
    width: '420px',
    maxHeight: '75%',
    background: theme.bgPanel || '#fff',
    border: `1px solid ${theme.stroke || '#d5e6e6'}`,
    boxShadow: SHADOW,
    borderRadius: '18px',
    overflow: 'hidden',
    display: 'none',
    pointerEvents: 'auto'
  });

  // Header
  Object.assign(ui.header.style, {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: '8px', padding: '10px 12px',
    borderBottom: `1px solid ${theme.stroke || '#d5e6e6'}`,
    background: theme.tealFaint || '#e8fbfc'
  });
  ui.title.textContent = 'Components';
  Object.assign(ui.title.style, { fontWeight: 800, color: theme.text || '#0d2022' });

  // Show all
  styleButton(ui.showAllBtn, 'Show all');

  // Toggle btn (inferior izquierda)
  styleButton(ui.btn, 'Components');
  Object.assign(ui.btn.style, { position: 'absolute', left: '14px', bottom: '14px' });

  // List
  Object.assign(ui.list.style, { overflow: 'auto', maxHeight: '60vh', padding: '10px 12px' });

  ui.header.appendChild(ui.title);
  ui.header.appendChild(ui.showAllBtn);
  ui.panel.appendChild(ui.header);
  ui.panel.appendChild(ui.list);

  ui.root.appendChild(ui.panel);
  ui.root.appendChild(ui.btn);

  // Mount
  const host = (app?.renderer?.domElement?.parentElement) || document.body;
  host.appendChild(ui.root);

  // ---- State ----
  let open = false;
  let building = false;
  let disposed = false;

  function set(isOpen) {
    open = !!isOpen;
    ui.panel.style.display = open ? 'block' : 'none';
  }
  function openPanel() { set(true); maybeBuild(); }
  function closePanel() { set(false); }

  // ======== 'c' hotkey: tween igual a Tools ========
  const CLOSED_TX = 520; // px, slide a la izquierda (entra desde -X)
  function openWithTween() {
    if (disposed) return;
    if (ui.panel.style.display !== 'none') return;
    ui.panel.style.display = 'block';
    ui.panel.style.willChange = 'transform, opacity';
    ui.panel.style.transition = 'none';
    ui.panel.style.opacity = '0';
    ui.panel.style.transform = `translateX(-${CLOSED_TX}px)`;
    requestAnimationFrame(() => {
      ui.panel.style.transition = 'transform 260ms cubic-bezier(.2,.7,.2,1), opacity 200ms ease';
      ui.panel.style.opacity = '1';
      ui.panel.style.transform = 'translateX(0px)';
      setTimeout(() => { ui.panel.style.willChange = 'auto'; }, 300);
    });
    open = true; maybeBuild();
  }
  function closeWithTween() {
    if (disposed) return;
    if (ui.panel.style.display === 'none') return;
    ui.panel.style.willChange = 'transform, opacity';
    ui.panel.style.transition = 'transform 260ms cubic-bezier(.2,.7,.2,1), opacity 200ms ease';
    ui.panel.style.opacity = '0';
    ui.panel.style.transform = `translateX(-${CLOSED_TX}px)`;
    const onEnd = () => {
      ui.panel.style.display = 'none';
      ui.panel.style.willChange = 'auto';
      ui.panel.removeEventListener('transitionend', onEnd);
    };
    ui.panel.addEventListener('transitionend', onEnd);
    open = false;
  }
  const _onKeyDownToggleComponents = (e) => {
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.isComposing) return;
    if (e.key === 'c' || e.key === 'C' || e.code === 'KeyC') {
      e.preventDefault();
      try { console.log('pressed c'); } catch(_) {}
      const isOpen = ui.panel.style.display !== 'none';
      if (!isOpen) openWithTween(); else closeWithTween();
    }
  };
  document.addEventListener('keydown', _onKeyDownToggleComponents, true);

  // Click en botón
  ui.btn.addEventListener('click', () => {
    const isOpen = ui.panel.style.display !== 'none';
    if (!isOpen) openWithTween(); else closeWithTween();
  });
  ui.showAllBtn.addEventListener('click', () => { try { app.showAll?.(); } catch(_) {} });

  // ---- Lista con hover + tipo (.dae/.stl/...) ----
  async function maybeBuild() {
    if (building || disposed) return;
    building = true;
    try { await renderList(); } finally { building = false; }
  }

  function extFrom(str='') {
    const m = (str.match(/\.([a-z0-9]+)$/i) || [])[1];
    return m ? ('.' + m.toLowerCase()) : '';
  }

  function styleItem(container) {
    Object.assign(container.style, {
      display: 'grid',
      gridTemplateColumns: '64px 1fr auto',
      gap: '10px',
      alignItems: 'center',
      padding: '8px',
      borderRadius: '12px',
      border: `1px solid ${theme.stroke || '#d5e6e6'}`,
      background: '#fff',
      transition: 'transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease, border-color 120ms ease',
      cursor: 'pointer'
    });
    container.addEventListener('mouseenter', () => {
      container.style.transform = 'translateY(-1px)';
      container.style.boxShadow = '0 10px 26px rgba(0,0,0,.18)';
      container.style.background = theme.tealFaint || '#e8fbfc';
      container.style.borderColor = theme.tealSoft || '#8ef5f7';
    });
    container.addEventListener('mouseleave', () => {
      container.style.transform = 'none';
      container.style.boxShadow = 'none';
      container.style.background = '#fff';
      container.style.borderColor = theme.stroke || '#d5e6e6';
    });
  }

  async function renderList() {
    ui.list.innerHTML = '';

    const items = await (async () => {
      try {
        const raw = await app.assets.list?.(); // [{key,name,url,thumb}]
        return Array.isArray(raw) ? raw : [];
      } catch (_) { return []; }
    })();

    for (const it of items) {
      const row = document.createElement('div');
      styleItem(row);

      const img = document.createElement('div');
      Object.assign(img.style, { width: '64px', height: '64px', background: '#eef4f4', borderRadius: '10px' });
      // thumb (si existe)
      if (it.thumb) {
        img.style.backgroundImage = `url(${it.thumb})`;
        img.style.backgroundSize = 'cover';
        img.style.backgroundPosition = 'center';
      }

      const name = document.createElement('div');
      name.textContent = it.name || it.key || '(item)';
      Object.assign(name.style, { fontWeight: 700, color: theme.text || '#0d2022' });

      const type = document.createElement('div');
      const typ = extFrom(it.url || it.name || it.key);
      type.textContent = typ || '(?)';
      Object.assign(type.style, { color: theme.textMuted || '#577071', fontWeight: 700 });

      row.appendChild(img);
      row.appendChild(name);
      row.appendChild(type);

      row.addEventListener('click', () => {
        try { app.selectByAssetKey?.(it.key || it.name); } catch(_) {}
      });

      ui.list.appendChild(row);
    }
  }

  // ---- Helpers ----
  function styleButton(btn, label) {
    btn.textContent = label;
    Object.assign(btn.style, {
      padding: '10px 14px',
      borderRadius: '12px',
      border: `1px solid ${theme.stroke || '#d5e6e6'}`,
      background: theme.bgPanel || '#fff',
      color: theme.text || '#0d2022',
      fontWeight: '700',
      cursor: 'pointer',
      pointerEvents: 'auto',
      boxShadow: SHADOW,
      transition: 'transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease, border-color 120ms ease'
    });
    btn.addEventListener('mouseenter', () => {
      btn.style.transform = 'translateY(-1px) scale(1.02)';
      btn.style.boxShadow = '0 10px 26px rgba(0,0,0,.18)';
      btn.style.background = theme.tealFaint || '#e8fbfc';
      btn.style.borderColor = theme.tealSoft || '#8ef5f7';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'none';
      btn.style.boxShadow = SHADOW;
      btn.style.background = theme.bgPanel || '#fff';
      btn.style.borderColor = theme.stroke || '#d5e6e6';
    });
  }

  // Public API
  return {
    open: openWithTween,
    close: closeWithTween,
    set,
    destroy(){
      disposed = true;
      try { document.removeEventListener('keydown', _onKeyDownToggleComponents, true); } catch(_) {}
      try { ui.panel.remove(); } catch(_) {}
      try { ui.root.remove(); } catch(_) {}
    }
  };
}

