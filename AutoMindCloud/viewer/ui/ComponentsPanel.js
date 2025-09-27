// /viewer/ui/ComponentsPanel.js
export function createComponentsPanel(app){
  if(!app || !app.assets || !app.isolate || !app.showAll) throw new Error('[ComponentsPanel] Missing app APIs');
  const ui={ root:document.createElement('div'), panel:document.createElement('div'), header:document.createElement('div'), title:document.createElement('div'), showAllBtn:document.createElement('button'), list:document.createElement('div'), btn:document.createElement('button') };
  Object.assign(ui.root.style,{ position:'absolute', left:0, top:0, width:'100%', height:'100%', pointerEvents:'none', zIndex:9999, fontFamily:'Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial' });
  Object.assign(ui.panel.style,{ position:'absolute', right:'14px', bottom:'14px', width:'440px', maxHeight:'72%', background:'#fff', border:'1px solid #d7e7e7', boxShadow:'0 8px 24px rgba(0,0,0,0.12)', borderRadius:'18px', overflow:'hidden', display:'none', pointerEvents:'auto' });
  Object.assign(ui.header.style,{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'8px', padding:'10px 12px', borderBottom:'1px solid #d7e7e7', background:'rgba(20,184,185,0.12)' });
  ui.title.textContent='Components'; Object.assign(ui.title.style,{ fontWeight:'800', color:'#0b3b3c' });
  ui.showAllBtn.textContent='Show all'; Object.assign(ui.showAllBtn.style,{ padding:'6px 10px', borderRadius:'10px', border:'1px solid #d7e7e7', background:'#fff', fontWeight:'700', cursor:'pointer' });
  Object.assign(ui.list.style,{ overflowY:'auto', maxHeight:'calc(72vh - 52px)', padding:'10px' });
  Object.assign(ui.btn.style,{ position:'absolute', left:'14px', bottom:'14px', padding:'8px 12px', borderRadius:'12px', border:'1px solid #d7e7e7', background:'#fff', color:'#0b3b3c', fontWeight:'700', cursor:'pointer', pointerEvents:'auto', boxShadow:'0 8px 24px rgba(0,0,0,0.12)' });

  ui.header.appendChild(ui.title); ui.header.appendChild(ui.showAllBtn);
  ui.panel.appendChild(ui.header); ui.panel.appendChild(ui.list);
  ui.root.appendChild(ui.panel); ui.root.appendChild(ui.btn);
  const host=(app?.renderer?.domElement?.parentElement)||document.body; host.appendChild(ui.root);

  let open=false, building=false;
  function set(isOpen){ open=!!isOpen; ui.panel.style.display=open?'block':'none'; }
  function openPanel(){ set(true); maybeBuild(); }
  function closePanel(){ set(false); }

  ui.btn.textContent='Components';
  ui.btn.addEventListener('click', ()=>{ set(ui.panel.style.display==='none'); if(open) maybeBuild(); });
  ui.showAllBtn.addEventListener('click', ()=>{ try{ app.showAll?.(); }catch(_){ } });

  async function maybeBuild(){ if(building) return; building=true; try{ await renderList(); } finally{ building=false; } }
  function clearNode(n){ while(n.firstChild) n.removeChild(n.firstChild); }

  async function renderList(){
    clearNode(ui.list);
    let items=[]; try{ const res=app.assets.list?.(); items = Array.isArray(res)?res:await res; }catch(_){ items=[]; }
    if(!items?.length){ const empty=document.createElement('div'); empty.textContent='No components with visual geometry found.'; empty.style.color='#577e7f'; empty.style.fontWeight='600'; empty.style.padding='8px 2px'; ui.list.appendChild(empty); return; }
    items.sort((a,b)=>String(a.base||'').localeCompare(String(b.base||''), undefined, { numeric:true, sensitivity:'base' }));
    for(const it of items){
      const row=document.createElement('div'); Object.assign(row.style,{ display:'grid', gridTemplateColumns:'56px 1fr', gap:'10px', alignItems:'center', padding:'8px', borderRadius:'12px', border:'1px solid #eef3f3', marginBottom:'8px', cursor:'pointer' });
      const img=document.createElement('img'); img.alt=it.base||it.assetKey||''; img.loading='lazy'; Object.assign(img.style,{ width:'56px', height:'56px', objectFit:'contain', background:'#fafafa', border:'1px solid #eef3f3', borderRadius:'10px' });
      const meta=document.createElement('div'); const title=document.createElement('div'); Object.assign(title.style,{ fontWeight:'700', color:'#0b3b3c', fontSize:'14px' }); title.textContent = it.base || it.assetKey || '';
      const small=document.createElement('div'); Object.assign(small.style,{ color:'#577e7f', fontSize:'12px', marginTop:'2px' }); small.textContent = `.${it.ext||'asset'} • ${it.count||1} instance${(it.count||1)>1?'s':''}`;
      meta.appendChild(title); meta.appendChild(small);
      row.appendChild(img); row.appendChild(meta); ui.list.appendChild(row);
      row.addEventListener('click', ()=>{ try{ app.isolate.asset?.(it.assetKey); }catch(_){ } });
      try{ const url=await app.assets.thumbnail?.(it.assetKey); if(url) img.src=url; }catch(_){}
    }
  }

  function destroy(){ try{ ui.root.remove(); }catch(_){ } }
  set(false);
  return { open:openPanel, close:closePanel, set, refresh:renderList, destroy };
}
