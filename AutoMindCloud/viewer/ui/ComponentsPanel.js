// /viewer/ui/ComponentsPanel.js
// Panel de componentes: lista + thumbnails + descripción incremental.
/* global document */

export function createComponentsPanel(app, theme) {
  if (!app) throw new Error('[ComponentsPanel] Missing app');

  // Normaliza theme
  theme = theme || {};
  const stroke = theme.stroke || (theme.colors && theme.colors.stroke) || '#d7e7e7';
  const teal = (theme.colors && theme.colors.teal) || '#0ea5a6';
  const tealSoft = (theme.colors && theme.colors.tealSoft) || teal;
  const tealFaint = (theme.colors && theme.colors.tealFaint) || 'rgba(14,165,166,0.06)';
  const text = (theme.colors && theme.colors.text) || '#0b3b3c';
  const textMuted = (theme.colors && theme.colors.textMuted) || '#577e7f';
  const shadow = (theme.shadows && (theme.shadows.md || theme.shadows.sm)) || '0 8px 24px rgba(0,0,0,0.12)';
  const fontUI = (theme.fonts && theme.fonts.ui) || "Inter, system-ui, -apple-system, sans-serif";

  // ---------- DOM ----------
  const ui = {
    root: document.createElement('div'),
    btn: document.createElement('button'),
    panel: document.createElement('div'),
    header: document.createElement('div'),
    title: document.createElement('div'),
    close: document.createElement('button'),
    listWrap: document.createElement('div'),
    list: document.createElement('div'),
    details: document.createElement('div'),
    detailsTitle: document.createElement('div'),
    detailsBody: document.createElement('div')
  };

  // root
  Object.assign(ui.root.style, {
    position: 'fixed',
    right: '16px',
    top: '16px',
    zIndex: 10010,
    fontFamily: fontUI,
    pointerEvents: 'none'
  });

  // toggle button
  ui.btn.textContent = 'Components';
  Object.assign(ui.btn.style, {
    padding: '8px 14px',
    borderRadius: '999px',
    border: `1px solid ${stroke}`,
    background: '#ffffff',
    color: text,
    boxShadow: shadow,
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600,
    pointerEvents: 'auto',
    marginBottom: '8px',
    transition: 'all 0.14s ease'
  });
  ui.btn.addEventListener('mouseenter', () => {
    ui.btn.style.transform = 'translateY(-1px)';
    ui.btn.style.background = tealFaint;
    ui.btn.style.borderColor = tealSoft;
  });
  ui.btn.addEventListener('mouseleave', () => {
    ui.btn.style.transform = 'none';
    ui.btn.style.background = '#ffffff';
    ui.btn.style.borderColor = stroke;
  });

  // panel
  Object.assign(ui.panel.style, {
    width: '360px',
    maxHeight: '75vh',
    background: '#ffffff',
    borderRadius: '18px',
    border: `1px solid ${stroke}`,
    boxShadow: shadow,
    padding: '14px',
    display: 'none',
    flexDirection: 'column',
    gap: '8px',
    pointerEvents: 'auto',
  });

  // header
  Object.assign(ui.header.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    marginBottom: '4px'
  });
  ui.title.textContent = 'Componentes';
  Object.assign(ui.title.style, {
    fontSize: '14px',
    fontWeight: 700,
    color: text
  });
  ui.close.textContent = '×';
  Object.assign(ui.close.style, {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: '18px',
    lineHeight: '18px',
    color: textMuted
  });

  // list
  Object.assign(ui.listWrap.style, {
    overflowY: 'auto',
    flex: '1 1 auto',
    paddingRight: '4px'
  });
  Object.assign(ui.list.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  });

  // details
  Object.assign(ui.details.style, {
    marginTop: '6px',
    padding: '8px',
    borderRadius: '12px',
    border: `1px solid ${stroke}`,
    background: '#f7fbfb',
    display: 'none'
  });
  Object.assign(ui.detailsTitle.style, {
    fontSize: '13px',
    fontWeight: 600,
    marginBottom: '4px',
    color: text
  });
  Object.assign(ui.detailsBody.style, {
    fontSize: '12px',
    color: textMuted,
    whiteSpace: 'pre-wrap'
  });

  ui.details.appendChild(ui.detailsTitle);
  ui.details.appendChild(ui.detailsBody);

  ui.header.appendChild(ui.title);
  ui.header.appendChild(ui.close);
  ui.listWrap.appendChild(ui.list);
  ui.panel.appendChild(ui.header);
  ui.panel.appendChild(ui.listWrap);
  ui.panel.appendChild(ui.details);
  ui.root.appendChild(ui.btn);
  ui.root.appendChild(ui.panel);

  document.body.appendChild(ui.root);

  // ---------- Estado ----------
  let open = false;
  let built = false;
  let disposed = false;
  let lastShown = null;

  function set(v) {
    open = !!v;
    ui.panel.style.display = open ? 'flex' : 'none';
  }
  function openPanel() { set(true); }
  function closePanel() { set(false); }

  ui.btn.addEventListener('click', () => {
    set(!open);
    if (open) maybeBuild();
  });
  ui.close.addEventListener('click', () => set(false));

  // ---------- Render list ----------
  async function renderList() {
    if (disposed) return;
    ui.list.innerHTML = '';

    const assetsApi = app.assets;
    if (!assetsApi || typeof assetsApi.list !== 'function') {
      const p = document.createElement('div');
      p.textContent = 'No hay datos de componentes.';
      p.style.fontSize = '12px';
      p.style.color = textMuted;
      ui.list.appendChild(p);
      return;
    }

    const entries = await assetsApi.list();
    if (!entries || !entries.length) {
      const p = document.createElement('div');
      p.textContent = 'No se detectaron componentes aún.';
      p.style.fontSize = '12px';
      p.style.color = textMuted;
      ui.list.appendChild(p);
      return;
    }

    entries.forEach((ent, index) => {
      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'grid',
        gridTemplateColumns: '112px 1fr',
        gap: '10px',
        alignItems: 'center',
        padding: '8px',
        borderRadius: '12px',
        border: `1px solid ${stroke}`,
        background: '#ffffff',
        cursor: 'pointer',
        transition: 'transform .08s ease, box-shadow .12s ease, background-color .12s ease, border-color .12s ease'
      });

      const thumbWrap = document.createElement('div');
      Object.assign(thumbWrap.style, {
        width: '112px',
        height: '84px',
        borderRadius: '10px',
        background: '#f7fbfb',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        border: `1px solid ${stroke}`
      });

      const img = document.createElement('img');
      Object.assign(img.style, {
        width: '100%',
        height: '100%',
        objectFit: 'contain',
      });

      (async () => {
        try {
          const url = assetsApi.thumbnail
            ? await assetsApi.thumbnail(ent.assetKey)
            : null;
          if (url) img.src = url;
          else {
            img.style.display = 'none';
            thumbWrap.textContent = 'Sin vista previa';
            thumbWrap.style.fontSize = '10px';
            thumbWrap.style.color = textMuted;
          }
        } catch {
          img.style.display = 'none';
          thumbWrap.textContent = 'Sin vista previa';
          thumbWrap.style.fontSize = '10px';
          thumbWrap.style.color = textMuted;
        }
      })();

      thumbWrap.appendChild(img);

      const meta = document.createElement('div');
      const title = document.createElement('div');
      title.textContent = ent.base || ent.assetKey || 'Componente';
      Object.assign(title.style, {
        fontSize: '13px',
        fontWeight: 600,
        color: text,
        marginBottom: '2px'
      });

      const small = document.createElement('div');
      small.textContent = `${ent.count || 1} mesh • ${ent.ext || ''}`.trim();
      Object.assign(small.style, {
        fontSize: '10px',
        color: textMuted
      });

      meta.appendChild(title);
      meta.appendChild(small);

      row.appendChild(thumbWrap);
      row.appendChild(meta);
      ui.list.appendChild(row);

      row.addEventListener('mouseenter', () => {
        row.style.transform = 'translateY(-1px) scale(1.02)';
        row.style.background = tealFaint;
        row.style.borderColor = tealSoft;
      });
      row.addEventListener('mouseleave', () => {
        row.style.transform = 'none';
        row.style.background = '#ffffff';
        row.style.borderColor = stroke;
      });

      row.addEventListener('click', () => {
        try { app.isolate && app.isolate.asset && app.isolate.asset(ent.assetKey); } catch (_) {}
        showDetails(ent, index);
        set(true);
      });
    });
  }

  async function maybeBuild() {
    if (disposed || built) return;
    built = true;
    await renderList();
  }

  function showDetails(ent, _index) {
    lastShown = ent;
    const getDesc = app.getComponentDescription;
    let textContent = '';

    if (typeof getDesc === 'function') {
      textContent = getDesc(ent.assetKey) || '';
    }

    if (!textContent) {
      if (app.descriptionsReady) {
        textContent = 'Sin descripción generada.';
      } else {
        textContent = 'Generando descripción…';
      }
    }

    ui.detailsTitle.textContent = ent.base || ent.assetKey;
    ui.detailsBody.textContent = textContent;
    ui.details.style.display = 'block';
  }

  function hideDetails() {
    lastShown = null;
    ui.details.style.display = 'none';
    ui.detailsTitle.textContent = '';
    ui.detailsBody.textContent = '';
  }

  async function refresh() {
    if (disposed) return;
    await renderList();
  }

  function destroy() {
    disposed = True;
  }

  // incremental descriptions desde JS
  function updateDescriptions(partial) {
    if (!partial || typeof partial !== 'object') return;
    if (!lastShown) return;
    const txt = partial[lastShown.assetKey];
    if (typeof txt === 'string' && txt.trim()) {
      ui.detailsBody.textContent = txt.trim();
    }
  }

  // Hotkey 'c'
  function onHotkeyC(e) {
    const tag = (e.target && e.target.tagName) || '';
    const t = tag.toLowerCase();
    if (t === 'input' || t === 'textarea' || t === 'select' || e.isComposing) return;
    if (e.key === 'c' || e.key === 'C' || e.code === 'KeyC') {
      e.preventDefault();
      set(!open);
      if (open) maybeBuild();
    }
  }
  document.addEventListener('keydown', onHotkeyC, true);

  // Inicial
  set(false);
  maybeBuild();

  return { open: openPanel, close: closePanel, set, refresh, destroy, updateDescriptions };
}
