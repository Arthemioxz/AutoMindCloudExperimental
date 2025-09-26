// ComponentsPanel.js — panel izquierdo con build perezoso (evita lag)

export function createComponentsPanel({ container, theme, onPick }) {
  const root = document.createElement('div');
  root.style.position = 'fixed';
  root.style.left = '16px';
  root.style.top = '16px';
  root.style.zIndex = '99999';
  root.style.background = 'rgba(255,255,255,0.95)';
  root.style.border = '1px solid #d7e7e7';
  root.style.borderRadius = '12px';
  root.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';
  root.style.padding = '8px';
  root.style.maxHeight = '70vh';
  root.style.overflow = 'auto';
  root.style.transform = 'translateX(-100%)';
  root.style.opacity = '0';
  root.style.pointerEvents = 'none';
  root.style.transition = 'transform .3s ease, opacity .3s ease';
  container.appendChild(root);

  let built = false;
  let selectedName = '';

  function buildOnce(robot) {
    if (built) return;
    built = true;
    const title = document.createElement('div');
    title.textContent = 'Components'; title.style.fontWeight = '800'; title.style.margin = '4px 6px 8px';
    root.appendChild(title);

    const table = document.createElement('table');
    table.style.borderCollapse = 'collapse'; table.style.width = '100%';
    const tbody = document.createElement('tbody'); table.appendChild(tbody);
    root.appendChild(table);

    const rows = [];
    const used = new Set();
    robot.traverse(o => {
      if (!o.isMesh) return;
      const name = (o.name || o.userData?.linkName || '(mesh)').trim();
      if (used.has(name)) return; used.add(name);
      const tr = document.createElement('tr');
      function styleTr(sel) { tr.style.background = sel ? '#dcf3f3' : 'transparent'; }
      const td = document.createElement('td'); td.textContent = name; td.style.padding = '6px 8px';
      td.style.borderBottom = '1px solid #d7e7e7'; tr.appendChild(td);
      tr.addEventListener('click', () => {
        selectedName = name; rows.forEach(r => styleTr(r.name === selectedName));
        styleTr(true);
        onPick && onPick(o, name);
      });
      tr.addEventListener('mouseenter', () => { tr.style.background = '#eef7f7'; if (selectedName === name) tr.style.background = '#dcf3f3'; });
      tr.addEventListener('mouseleave', () => { styleTr(selectedName === name); });
      rows.push({ tr, name }); tbody.appendChild(tr);
    });
  }

  function open()  { root.style.transform = 'translateX(0)'; root.style.opacity = '1'; root.style.pointerEvents = 'auto'; }
  function close() { root.style.transform = 'translateX(-100%)'; root.style.opacity = '0'; root.style.pointerEvents = 'none'; }
  function toggle() { (root.style.opacity === '1') ? close() : open(); }
  function isOpen() { return root.style.opacity === '1'; }

  function markSelected(name) {
    selectedName = name || '';
    const trs = root.querySelectorAll('tbody tr');
    trs.forEach(tr => {
      const td = tr.querySelector('td'); const nm = td ? td.textContent.trim() : '';
      tr.style.background = (nm === selectedName) ? '#dcf3f3' : 'transparent';
    });
  }

  return { open, close, toggle, isOpen, buildOnce, markSelected };
}

