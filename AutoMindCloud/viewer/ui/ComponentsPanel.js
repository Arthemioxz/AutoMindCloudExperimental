// /viewer/ui/ComponentsPanel.js
// Floating gallery of components with thumbnails + type (.dae/.stl/.stp/...), hover on items,
// tween toggle with 'c' (dock left). Matches the same tween as Tools ('h').

export function createComponentsPanel(app, theme) {
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
  const SHADOW = (theme?.shadows?.md) || '0 8px 24px rgba(0,0,0,.14)';

  const ui = {
    root: document.createElement('div'),
    panel: document.createElement('div'),
    header: document.createElement('div'),
    title: document.createElement('div'),
    showAllBtn: document.createElement('button'),
    btn: document.createElement('button'),
    list: document.createElement('div')
  };

  Object.assign(ui.root.style, {
    position: 'absolute',
    left: '0', top: '0', width: '100%', height: '100%',
    pointerEvents: 'none', zIndex: 9999,
    fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial'
  });

  Object.assign(ui.panel.style, {
    position: 'absolute',
    left: '14px',
    bottom: '14px',
    width: '420px',
    maxHeight: '75%',
    background: theme?.bgPanel || '#fff',
    border: `1px solid ${theme?.stroke || '#d5e6e6'}`,
    boxShadow: SHADOW,
    borderRadius: '18px',
    overflow: 'hidden',
    display: 'none',
    pointerEvents: 'auto'
  });

  Object.assign(ui.header.style, {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: '8px', padding: '10px 12px',
    borderBottom: `1px solid ${theme?.stroke || '#d5e6e6'}`,
    background: theme?.tealFaint || 'rgba(20,184,185,0.12)'
  });
  ui.title.textContent = 'Components';
  Object.assign(ui.title.style, { fontWeight: 800, color: theme?.text || '#0d2022' });

  styleButton(ui.showAllBtn, 'Show all');

  styleButton(ui.btn, 'Components');
  Object.assign(ui.btn.style, { position: 'absolute', left: '14px', bottom: '14px' });

  Object.assign(ui.list.style, { overflow: 'auto', maxHeight: '60vh', padding: '10px 12px', display: 'grid', gap: '8px' });

  ui.header.appendChild(ui.title);
  ui.header.appendChild(ui.showAllBtn);
  ui.panel.appendChild(ui.header);
  ui.panel.appendChild(ui.list);
  ui.root.appendChild(ui.panel);
  ui.root.appendChild(ui.btn);

  const host = (app?.renderer?.domElement?.parentElement) || document.body;
  host.appendChild(ui.root);

  let open = false, building = false, disposed = false;

  function set(isOpen) { open = !!isOpen; ui.panel.style.display = open ? 'block' : 'none'; }
  function openPanel(){ set(true); maybeBuild(); }
  function closePanel(){ set(false); }

  // tween (same timing/curve as Tools)
  const CLOSED_TX = 520;
  function openWithTween(){
    if (ui.panel.style.display !== 'none') return;
    ui.panel.style.display='block';
    ui.panel.style.willChange='transform,opacity';
    ui.panel.style.transition='none';
    ui.panel.style.opacity='0';
    ui.panel.style.transform=`translateX(-${CLOSED_TX}px)`;
    requestAnimationFrame(()=>{
      ui.panel.style.transition='transform 260ms cubic-bezier(.2,.7,.2,1), opacity 200ms ease';
      ui.panel.style.opacity='1';
      ui.panel.style.transform='translateX(0)';
      setTimeout(()=>{ ui.panel.style.willChange='auto'; }, 320);
    });
    open=true; maybeBuild();
  }
  function closeWithTween(){
    if (ui.panel.style.display==='none') return;
    ui.panel.style.willChange='transform,opacity';
    ui.panel.style.transition='transform 260ms cubic-bezier(.2,.7,.2,1), opacity 200ms ease';
    ui.panel.style.opacity='0';
    ui.panel.style.transform=`translateX(-${CLOSED_TX}px)`;
    const onEnd=()=>{ ui.panel.style.display='none'; ui.panel.style.willChange='auto'; ui.panel.removeEventListener('transitionend', onEnd); };
    ui.panel.addEventListener('transitionend', onEnd);
    open=false;
  }

  const _onKeyDown = (e)=>{
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag==='input'||tag==='textarea'||tag==='select'||e.isComposing) return;
    if (e.key==='c'||e.key==='C'||e.code==='KeyC'){ e.preventDefault(); (ui.panel.style.display==='none')?openWithTween():closeWithTween(); try{console.log('pressed c');}catch{} }
  };
  document.addEventListener('keydown', _onKeyDown, true);

  ui.btn.addEventListener('click', ()=>{ (ui.panel.style.display==='none')?openWithTween():closeWithTween(); });
  ui.showAllBtn.addEventListener('click', ()=>{ try{ app.showAll?.(); }catch{} });

  async function maybeBuild(){
    if (building || disposed) return;
    building = true;
    try { await renderList(); } finally { building = false; }
  }

  function extFrom(str=''){ const m=(str.match(/\\.([a-z0-9]+)$/i)||[])[1]; return m?('.'+m.toLowerCase()):''; }

  function styleItem(el){
    Object.assign(el.style,{
      display:'grid', gridTemplateColumns:'64px 1fr auto',
      gap:'10px', alignItems:'center', padding:'8px',
      borderRadius:'12px', border:`1px solid ${theme?.stroke||'#d5e6e6'}`,
      background:'#fff', cursor:'pointer',
      transition:'transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease, border-color 120ms ease'
    });
    el.addEventListener('mouseenter', ()=>{
      el.style.transform='translateY(-1px)'; el.style.boxShadow='0 10px 26px rgba(0,0,0,.18)';
      el.style.background= theme?.tealFaint || 'rgba(20,184,185,0.12)'; el.style.borderColor= theme?.tealSoft || '#14b8b9';
    });
    el.addEventListener('mouseleave', ()=>{
      el.style.transform='none'; el.style.boxShadow='none'; el.style.background='#fff'; el.style.borderColor= theme?.stroke || '#d5e6e6';
    });
  }

  async function renderList(){
    ui.list.innerHTML='';
    let items=[];
    try{
      const raw = await app.assets?.list?.();
      items = Array.isArray(raw)? raw : [];
    }catch{}
    for(const it of items){
      const row = document.createElement('div'); styleItem(row);
      const thumb = document.createElement('div');
      Object.assign(thumb.style,{width:'64px',height:'64px',borderRadius:'10px',background:'#eef4f4',backgroundSize:'cover',backgroundPosition:'center'});
      if (it.thumb) thumb.style.backgroundImage = `url(${it.thumb})`;
      const name = document.createElement('div'); name.textContent = it.name || it.key || '(item)'; Object.assign(name.style,{fontWeight:700, color: theme?.text||'#0d2022'});
      const type = document.createElement('div'); type.textContent = extFrom(it.url||it.name||it.key) || '(?)'; Object.assign(type.style,{color: theme?.textMuted||'#577071', fontWeight:700});
      row.appendChild(thumb); row.appendChild(name); row.appendChild(type);
      row.addEventListener('click', ()=>{ try{ app.selectByAssetKey?.(it.key||it.name); }catch{} });
      ui.list.appendChild(row);
    }
  }

  function styleButton(btn, label){
    btn.textContent = label;
    Object.assign(btn.style,{
      padding:'10px 14px', borderRadius:'12px', border:`1px solid ${theme?.stroke||'#d5e6e6'}`,
      background: theme?.bgPanel || '#fff', color: theme?.text || '#0d2022', fontWeight:'700',
      cursor:'pointer', pointerEvents:'auto', boxShadow: SHADOW,
      transition:'transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease, border-color 120ms ease'
    });
    btn.addEventListener('mouseenter', ()=>{ btn.style.transform='translateY(-1px) scale(1.02)'; btn.style.boxShadow='0 10px 26px rgba(0,0,0,.18)'; btn.style.background= theme?.tealFaint||'rgba(20,184,185,0.12)'; btn.style.borderColor= theme?.tealSoft||'#14b8b9'; });
    btn.addEventListener('mouseleave', ()=>{ btn.style.transform='none'; btn.style.boxShadow=SHADOW; btn.style.background=theme?.bgPanel||'#fff'; btn.style.borderColor= theme?.stroke || '#d5e6e6'; });
  }

  return { open: openWithTween, close: closeWithTween, set, destroy(){
    disposed = true;
    try{ document.removeEventListener('keydown', _onKeyDown, true); }catch{}
    try{ ui.panel.remove(); }catch{}; try{ ui.root.remove(); }catch{};
  }};
}

