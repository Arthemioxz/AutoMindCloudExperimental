// /viewer/ui/ComponentsPanel.js
// Floating gallery of components (assets) with thumbnails + isolate/show-all
// Dependencies: None (expects an app facade and a theme object)

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

/**
 * Create the Components Panel (floating UI).
 * @param {Object} app
 * @param {Theme} theme
 * @returns {{
 *   open: () => void,
 *   close: () => void,
 *   set: (open:boolean) => void,
 *   refresh: () => Promise<void>,
 *   destroy: () => void
 * }}
 */
export function createComponentsPanel(app, theme) {
  if (!app || !app.assets || !app.isolate || !app.showAll)
    throw new Error('[ComponentsPanel] Missing required app APIs');

  // ---- DOM structure
  const ui = {
    root: document.createElement('div'),
    btn: document.createElement('button'),
    panel: document.createElement('div'),
    header: document.createElement('div'),
    title: document.createElement('div'),
    showAllBtn: document.createElement('button'),
    list: document.createElement('div')
  };

  // ---- Styles
  const css = {
    root: {
      position: 'absolute',
      left: '0', top: '0',
      width: '100%', height: '100%',
      pointerEvents: 'none',
      zIndex: '9999',
      fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial',
    },
    btn: {
      position: 'absolute',
      left: '14px',
      bottom: '14px',
      padding: '8px 12px',
      borderRadius: '12px',
      border: `1px solid ${theme.stroke}`,
      background: theme.bgPanel,
      color: theme.text,
      fontWeight: '700',
      cursor: 'pointer',
      boxShadow: theme.shadow,
      pointerEvents: 'auto'
    },
    panel: {
      position: 'absolute',
      right: '14px',
      bottom: '14px',
      width: '440px',
      maxHeight: '72%',
      background: theme.bgPanel,
      border: `1px solid ${theme.stroke}`,
      boxShadow: theme.shadow,
      borderRadius: '18px',
      overflow: 'hidden',
      display: 'none',
      pointerEvents: 'auto'
    },
    header: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
      padding: '10px 12px',
      borderBottom: `1px solid ${theme.stroke}`,
      background: theme.tealFaint
    },
    title: { fontWeight: '800', color: theme.text },
    showAllBtn: {
      padding: '6px 10px',
      borderRadius: '10px',
      border: `1px solid ${theme.stroke}`,
      background: theme.bgPanel,
      fontWeight: '700',
      cursor: 'pointer'
    },
    list: {
      overflowY: 'auto',
      maxHeight: 'calc(72vh - 52px)',
      padding: '10px'
    }
  };

  applyStyles(ui.root, css.root);
  applyStyles(ui.btn, css.btn);
  applyStyles(ui.panel, css.panel);
  applyStyles(ui.header, css.header);
  applyStyles(ui.title, css.title);
  applyStyles(ui.showAllBtn, css.showAllBtn);
  applyStyles(ui.list, css.list);

  ui.btn.textContent = 'Components';
  ui.title.textContent = 'Components';
  ui.showAllBtn.textContent = 'Show all';

  ui.header.appendChild(ui.title);
  ui.header.appendChild(ui.showAllBtn);
  ui.panel.appendChild(ui.header);
  ui.panel.appendChild(ui.list);

  ui.root.appendChild(ui.panel);
  ui.root.appendChild(ui.btn);

  // Attach to the same container as the viewer canvas (assume renderer DOM parent)
  const host = (app?.renderer?.domElement?.parentElement) || document.body;
  host.appendChild(ui.root);

  // ---- State
  let open = false;
  let building = false; // prevent concurrent refresh
  let disposed = false;

  // ---- Behavior
  function set(isOpen) {
    open = !!isOpen;
    ui.panel.style.display = open ? 'block' : 'none';
  }
  function openPanel() { set(true); maybeBuild(); }
  function closePanel() { set(false); }

  // cambio
    // Floating toggle button (with hover)
  ui.btn.textContent = 'Open Tools';
 
  
  ui.btn.addEventListener('click', () => {
    set(ui.panel.style.display === 'none');
    if (open) maybeBuild();
  });

  ui.showAllBtn.addEventListener('click', () => {
    try { app.showAll?.(); } catch (_) {}
  });

  async function maybeBuild() {
    if (building || disposed) return;
    building = true;
    try {
      await renderList();
    } finally {
      building = false;
    }
  }

  async function renderList() {
    clearElement(ui.list);

    // Retrieve assets list; support sync or async
    let items = [];
    try {
      const res = app.assets.list?.();
      items = Array.isArray(res) ? res : (await res);
    } catch (e) {
      items = [];
    }

    if (!items || !items.length) {
      const empty = document.createElement('div');
      empty.textContent = 'No components with visual geometry found.';
      empty.style.color = theme.textMuted;
      empty.style.fontWeight = '600';
      empty.style.padding = '8px 2px';
      ui.list.appendChild(empty);
      return;
    }

    // Normalize and sort (by base name)
    const normalized = items.map((it) => ({
      assetKey: it.assetKey || it.key || '',
      base: it.base || basenameNoExt(it.assetKey || ''),
      ext: it.ext || extOf(it.assetKey || ''),
      count: it.count || 1,
      desc: it.desc || ''
    })).sort((a, b) => a.base.localeCompare(b.base, undefined, { numeric: true, sensitivity: 'base' }));

    // Build rows
    for (const ent of normalized) {
      const row = document.createElement('div');
      applyStyles(row, rowStyles(theme));

      const img = document.createElement('img');
      applyStyles(img, thumbStyles(theme));
      img.alt = ent.base;
      img.loading = 'lazy';

      const meta = document.createElement('div');
      const title = document.createElement('div');
      title.textContent = ent.base;
      title.style.fontWeight = '700';
      title.style.fontSize = '14px';
      title.style.color = theme.text;

      const small = document.createElement('div');
      small.textContent = `.${ent.ext || 'asset'} • ${ent.count} instance${ent.count > 1 ? 's' : ''}`;
      small.style.color = theme.textMuted;
      small.style.fontSize = '12px';
      small.style.marginTop = '2px';

      const desc = document.createElement('div');
      desc.textContent = ent.desc || ' ';
      desc.style.color = theme.textMuted;
      desc.style.fontSize = '12px';
      desc.style.marginTop = '4px';

      meta.appendChild(title);
      meta.appendChild(small);
      if (desc.textContent.trim()) meta.appendChild(desc);

      row.appendChild(img);
      row.appendChild(meta);
      ui.list.appendChild(row);

      // Click → isolate this asset
      row.addEventListener('click', () => {
        try { app.isolate.asset?.(ent.assetKey); } catch (_) {}
      });

      // Async thumbnail
      try {
        const url = await app.assets.thumbnail?.(ent.assetKey);
        if (url) img.src = url;
        else img.replaceWith(makeThumbFallback(ent.base, theme));
      } catch (_) {
        img.replaceWith(makeThumbFallback(ent.base, theme));
      }
    }
  }

  // Public API
  async function refresh() {
    if (disposed) return;
    await renderList();
  }

  function destroy() {
    disposed = true;
    try { ui.btn.remove(); } catch (_) {}
    try { ui.panel.remove(); } catch (_) {}
    try { ui.root.remove(); } catch (_) {}
  }

  // Initial defaults
  set(false);

  return { open: openPanel, close: closePanel, set, refresh, destroy };
}

/* ------------------ Helpers ------------------ */

function applyStyles(el, styles) {
  Object.assign(el.style, styles);
}

function clearElement(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function basenameNoExt(p) {
  const q = String(p || '').split('/').pop().split('?')[0].split('#')[0];
  const dot = q.lastIndexOf('.');
  return dot >= 0 ? q.slice(0, dot) : q;
}

function extOf(p) {
  const q = String(p || '').split('?')[0].split('#')[0];
  const dot = q.lastIndexOf('.');
  return dot >= 0 ? q.slice(dot + 1).toLowerCase() : '';
}

function rowStyles(theme) {
  return {
    display: 'grid',
    gridTemplateColumns: '128px 1fr',
    gap: '12px',
    alignItems: 'center',
    padding: '10px',
    borderRadius: '12px',
    border: `1px solid ${theme.stroke}`,
    marginBottom: '10px',
    background: '#fff',
    cursor: 'pointer',
    transition: 'transform .08s ease, box-shadow .12s ease',
  };
}

function thumbStyles(theme) {
  return {
    width: '128px',
    height: '96px',
    objectFit: 'contain',
    background: '#f7fbfb',
    borderRadius: '10px',
    border: `1px solid ${theme.stroke}`
  };
}

function makeThumbFallback(label, theme) {
  const wrap = document.createElement('div');
  wrap.style.width = '128px';
  wrap.style.height = '96px';
  wrap.style.display = 'flex';
  wrap.style.alignItems = 'center';
  wrap.style.justifyContent = 'center';
  wrap.style.background = '#f7fbfb';
  wrap.style.border = `1px solid ${theme.stroke}`;
  wrap.style.borderRadius = '10px';
  wrap.style.fontSize = '11px';
  wrap.style.color = theme.textMuted;
  wrap.style.textAlign = 'center';
  wrap.textContent = label || '—';
  return wrap;
}
