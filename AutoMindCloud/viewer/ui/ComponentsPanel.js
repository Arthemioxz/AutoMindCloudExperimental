// /viewer/ui/ComponentsPanel.js
// Panel de Componentes completo (dock IZQUIERDA, hotkey 'c' con mismo tween de Tools, hover en items y botones).
// Muestra tipo real (.dae/.stl/.stp/...) en la lista; botón "Show all" mantiene lógica original.

export function createComponentsPanel(app, theme) {
  if (!app || !app.assets || !app.isolate || !app.showAll)
    throw new Error('[ComponentsPanel] Missing required app APIs');

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
  theme = {
    teal: '#0ea5a6', tealSoft: '#8ef5f7', tealFaint:'#e8fbfc',
    bgPanel:'#fff', stroke:'#d5e6e6', text:'#0d2022', textMuted:'#577071',
    shadow: '0 8px 24px rgba(0,0,0,.15)', ...(theme||{})
  };

  const ui = {
    root: document.createElement('div'),
    btn: document.createElement('button'),
    panel: document.createElement('div'),
    header: document.createElement('div'),
    title: document.createElement('div'),
    showAllBtn: document.createElement('button'),
    list: document.createElement('div')
  };

  Object.assign(ui.root.style,{position:'absolute',left:0,top:0,width:'100%',height:'100%',pointerEvents:'none',zIndex:9999,fontFamily:'Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial'});
  Object.assign(ui.btn.style,{position:'absolute',left:'14px',bottom:'14px',padding:'8px 12px',borderRadius:'12px',border:`1px solid ${theme.stroke}`,background:theme.bgPanel,color:theme.text,fontWeight:'700',cursor:'pointer',boxShadow:theme.shadow,pointerEvents:'auto',transition:'transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease, border-color 120ms ease'});
  ui.btn.textContent='Components';
  ui.btn.addEventListener('mouseenter',()=>{ ui.btn.style.transform='translateY(-1px) scale(1.02)'; ui.btn.style.background=theme.tealFaint; ui.btn.style.borderColor=theme.tealSoft; });
  ui.btn.addEventListener('mouseleave',()=>{ ui.btn.style.transform='none'; ui.btn.style.background=theme.bgPanel; ui.btn.style.borderColor=theme.stroke; });

  Object.assign(ui.panel.style,{position:'absolute',left:'14px',bottom:'14px',width:'440px',maxHeight:'72%',background:theme.bgPanel,border:`1px solid ${theme.stroke}`,boxShadow:theme.shadow,borderRadius:'18px',overflow:'hidden',display:'none',pointerEvents:'auto'});
  Object.assign(ui.header.style,{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'8px',padding:'10px 12px',borderBottom:`1px solid ${theme.stroke}`,background:theme.tealFaint});
  ui.title.textContent='Components'; Object.assign(ui.title.style,{fontWeight:800,color:theme.text});
  Object.assign(ui.showAllBtn.style,{padding:'6px 10px',borderRadius:'10px',border:`1px solid ${theme.stroke}`,background:theme.bgPanel,fontWeight:'700',cursor:'pointer',transition:'transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease, border-color 120ms ease'});
  ui.showAllBtn.textContent='Show all';
  ui.showAllBtn.addEventListener('mouseenter',()=>{ ui.showAllBtn.style.transform='translateY(-1px)'; ui.showAllBtn.style.background=theme.tealFaint; ui.showAllBtn.style.borderColor=theme.tealSoft; });
  ui.showAllBtn.addEventListener('mouseleave',()=>{ ui.showAllBtn.style.transform='none'; ui.showAllBtn.style.background=theme.bgPanel; ui.showAllBtn.style.borderColor=theme.stroke; });

  Object.assign(ui.list.style,{overflowY:'auto',maxHeight:'calc(72vh - 52px)',padding:'10px'});

  ui.header.appendChild(ui.title);
  ui.header.appendChild(ui.showAllBtn);
  ui.panel.appendChild(ui.header);
  ui.panel.appendChild(ui.list);
  ui.root.appendChild(ui.panel);
  ui.root.appendChild(ui.btn);
  (app?.renderer?.domElement?.parentElement || document.body).appendChild(ui.root);

  // Estado
  function openTween(){
    if (ui.panel.style.display!=='none') return;
    ui.panel.style.display='block';
    ui.panel.style.willChange='transform, opacity';
    ui.panel.style.transition='none';
    ui.panel.style.opacity='0';
    ui.panel.style.transform='translateX(-520px)'; // entra desde la izquierda
    requestAnimationFrame(()=>{
      ui.panel.style.transition='transform 260ms cubic-bezier(.2,.7,.2,1), opacity 200ms ease';
      ui.panel.style.opacity='1';
      ui.panel.style.transform='translateX(0px)';
      setTimeout(()=>{ ui.panel.style.willChange='auto'; }, 300);
    });
  }
  function closeTween(){
    if (ui.panel.style.display==='none') return;
    ui.panel.style.willChange='transform, opacity';
    ui.panel.style.transition='transform 260ms cubic-bezier(.2,.7,.2,1), opacity 200ms ease';
    ui.panel.style.opacity='0';
    ui.panel.style.transform='translateX(-520px)';
    const onEnd=()=>{ ui.panel.style.display='none'; ui.panel.style.willChange='auto'; ui.panel.removeEventListener('transitionend',onEnd); };
    ui.panel.addEventListener('transitionend',onEnd);
  }
  ui.btn.addEventListener('click', ()=>{ const isOpen = ui.panel.style.display!=='none'; if(!isOpen) openTween(); else closeTween(); });
  document.addEventListener('keydown',(e)=>{ const tag=(e.target?.tagName||'').toLowerCase(); if(tag==='input'||tag==='textarea'||tag==='select'||e.isComposing) return; if(e.code==='KeyC'||e.key==='c'||e.key==='C'){ e.preventDefault(); const isOpen = ui.panel.style.display!=='none'; if(!isOpen) openTween(); else closeTween(); } }, true);

  ui.showAllBtn.addEventListener('click',()=>{ try { app.showAll?.(); } catch{} });

  // Lista
  function rowStyles() {
    return {
      display:'grid', gridTemplateColumns:'64px 1fr auto', gap:'10px', alignItems:'center',
      padding:'8px', borderRadius:'12px', border:`1px solid ${theme.stroke}`, background:'#fff',
      transition:'transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease, border-color 120ms ease', cursor:'pointer'
    };
  }
  function thumbStyles() {
    return { width:'64px', height:'64px', background:'#eef4f4', borderRadius:'10px', objectFit:'cover' };
  }
  function applyHover(el) {
    el.addEventListener('mouseenter',()=>{ el.style.transform='translateY(-1px)'; el.style.boxShadow='0 10px 26px rgba(0,0,0,.18)'; el.style.background=theme.tealFaint; el.style.borderColor=theme.tealSoft; });
    el.addEventListener('mouseleave',()=>{ el.style.transform='none'; el.style.boxShadow='none'; el.style.background='#fff'; el.style.borderColor=theme.stroke; });
  }

  function extOf(str=''){ const m=(str.match(/\.([a-z0-9]+)$/i)||[])[1]; return m?('.'+m.toLowerCase()):''; }

  async function refresh() {
    ui.list.innerHTML='';
    let items=[]; try { const res=app.assets.list?.(); items = Array.isArray(res) ? res : await res; } catch {}
    if (!items || !items.length) {
      const empty=document.createElement('div'); empty.textContent='No components with visual geometry found.'; empty.style.color=theme.textMuted; empty.style.fontWeight='600'; empty.style.padding='8px 2px'; ui.list.appendChild(empty); return;
    }
    const norm = items.map(it=>({ assetKey: it.assetKey||it.key||'', base: it.base||(it.name?it.name.replace(/\.[^.]+$/,''):''), ext: (it.ext || extOf(it.assetKey||it.key||it.name||'')), count: it.count||1 }));
    for (const ent of norm) {
      const row=document.createElement('div'); Object.assign(row.style,rowStyles()); applyHover(row);
      const img=document.createElement('img'); Object.assign(img.style,thumbStyles()); img.alt=ent.base; img.loading='lazy';
      const thumb = app.assets.thumbnail?.(ent.assetKey); if (thumb) img.src=thumb;
      const meta=document.createElement('div'); const title=document.createElement('div'); title.textContent=ent.base; title.style.fontWeight='700'; title.style.fontSize='14px'; title.style.color=theme.text;
      const sub=document.createElement('div'); sub.textContent = ent.ext || '(?)'; sub.style.color=theme.textMuted; sub.style.fontWeight='700'; sub.style.fontSize='12px';
      const type=document.createElement('div'); type.textContent = ent.count>1 ? `x${ent.count}` : ''; type.style.color=theme.textMuted; type.style.fontWeight='700';
      meta.appendChild(title); meta.appendChild(sub);
      row.appendChild(img); row.appendChild(meta); row.appendChild(type);
      row.addEventListener('click', ()=>{ try { app.isolate.asset?.(ent.assetKey); } catch{} });
      ui.list.appendChild(row);
    }
  }

  // Construcción inicial al abrir
  const maybeBuild = ()=>refresh();
  return { open: openTween, close: closeTween, set:(o)=>{ o?openTween():closeTween(); }, refresh: maybeBuild, destroy(){ try{ui.root.remove();}catch{} } };
}
