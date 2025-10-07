# urdf_render.py — Colab helper con import dinámico ESM (último commit), dock izquierda, vistas tween, tecla "i"
import base64, re, os, json, shutil, zipfile
from IPython.display import HTML
import gdown

# -------------------------------
# Descargar ZIP con /urdf y /meshes desde Drive
# -------------------------------
def Download_URDF(Drive_Link, Output_Name="Model"):
    root_dir = "/content"
    file_id = Drive_Link.split('/d/')[1].split('/')[0]
    url = f"https://drive.google.com/uc?id={file_id}"
    zip_path = os.path.join(root_dir, Output_Name + ".zip")
    tmp_extract = os.path.join(root_dir, f"__tmp_extract_{Output_Name}")
    final_dir = os.path.join(root_dir, Output_Name)

    if os.path.exists(tmp_extract): shutil.rmtree(tmp_extract)
    os.makedirs(tmp_extract, exist_ok=True)
    if os.path.exists(final_dir): shutil.rmtree(final_dir)

    gdown.download(url, zip_path, quiet=True)
    with zipfile.ZipFile(zip_path, 'r') as zf:
        zf.extractall(tmp_extract)

    def junk(n): return n.startswith('.') or n == '__MACOSX'
    top = [n for n in os.listdir(tmp_extract) if not junk(n)]
    if len(top)==1 and os.path.isdir(os.path.join(tmp_extract, top[0])):
        shutil.move(os.path.join(tmp_extract, top[0]), final_dir)
    else:
        os.makedirs(final_dir, exist_ok=True)
        for n in top: shutil.move(os.path.join(tmp_extract, n), os.path.join(final_dir, n))
    shutil.rmtree(tmp_extract, ignore_errors=True)
    return final_dir


# -------------------------------
# Render URDF (viewport completo; ESM dinámico desde último commit)
# -------------------------------
def URDF_Render(folder_path="Model",
                select_mode="link",
                background=0xffffff,
                repo="ArtemioA/AutoMindCloudExperimental",
                branch="main",
                compFile="AutoMindCloud/viewer/urdf_viewer_main.js",  # ES module que exporta render()
                ensure_three=True,
                click_sound_path=None,
                init_az_deg=45,
                init_el_deg=25,
                init_zoom_out=1.90):

    # ---- Buscar /urdf + /meshes y armar meshDB robusto ----
    def find_dirs(root):
        u, m = os.path.join(root, "urdf"), os.path.join(root, "meshes")
        if os.path.isdir(u) and os.path.isdir(m): return u, m
        if os.path.isdir(root):
            for name in os.listdir(root):
                cand = os.path.join(root, name)
                uu, mm = os.path.join(cand, "urdf"), os.path.join(cand, "meshes")
                if os.path.isdir(uu) and os.path.isdir(mm): return uu, mm
        return None, None

    urdf_dir, meshes_dir = find_dirs(folder_path)
    urdf_raw, mesh_db = "", {}

    if urdf_dir and meshes_dir:
        # Elige el URDF que realmente referencia meshes si hay varios
        urdf_files = [os.path.join(urdf_dir, f) for f in os.listdir(urdf_dir) if f.lower().endswith(".urdf")]
        urdf_files.sort(key=lambda p: os.path.getsize(p) if os.path.exists(p) else 0, reverse=True)

        mesh_refs = []
        for upath in urdf_files:
            try:
                with open(upath, "r", encoding="utf-8", errors="ignore") as f:
                    txt = f.read().lstrip('\ufeff')
                refs = re.findall(r'filename="([^"]+\.(?:stl|dae))"', txt, re.I)
                if refs:
                    urdf_raw = txt
                    mesh_refs = list(dict.fromkeys(refs))
                    break
            except Exception:
                continue
        if not urdf_raw and urdf_files:
            with open(urdf_files[0], "r", encoding="utf-8", errors="ignore") as f:
                urdf_raw = f.read().lstrip('\ufeff')

        # Recolectar ficheros en /meshes
        disk_files = []
        for root, _, files in os.walk(meshes_dir):
            for name in files:
                if name.lower().endswith((".stl", ".dae", ".png", ".jpg", ".jpeg")):
                    disk_files.append(os.path.join(root, name))

        meshes_root_abs = os.path.abspath(meshes_dir)
        by_rel = {}
        by_base = {}
        for p in disk_files:
            rel = os.path.relpath(os.path.abspath(p), meshes_root_abs).replace("\\", "/").lower()
            by_rel[rel] = p
            by_base[os.path.basename(p).lower()] = p

        _cache = {}
        def b64(path):
            if path not in _cache:
                with open(path, "rb") as f:
                    _cache[path] = base64.b64encode(f.read()).decode("ascii")
            return _cache[path]

        def add_entry(key, path):
            k = key.replace("\\", "/").lower().lstrip("./")
            if k.startswith("package://"): k = k[len("package://"):]
            if k not in mesh_db: mesh_db[k] = b64(path)

        for ref in mesh_refs:
            raw = ref.replace("\\", "/").lower().lstrip("./")
            pkg = raw[10:] if raw.startswith("package://") else raw
            bn  = os.path.basename(raw).lower()

            cand = None
            if raw in by_rel: cand = by_rel[raw]
            elif pkg in by_rel: cand = by_rel[pkg]
            elif bn in by_base: cand = by_base[bn]
            else:
                for rel, real in by_rel.items():
                    if rel.endswith("/"+bn) or rel == bn:
                        cand = real; break
            if cand:
                add_entry(raw, cand); add_entry(pkg, cand); add_entry(bn, cand)

        # Texturas sueltas
        for p in disk_files:
            bn = os.path.basename(p).lower()
            if bn.endswith((".png", ".jpg", ".jpeg")) and bn not in mesh_db:
                add_entry(bn, p)

    # ---- Audio opcional embebido ----
    click_data_url = None
    if click_sound_path and os.path.exists(click_sound_path):
        try:
            with open(click_sound_path, "rb") as f:
                click_b64 = base64.b64encode(f.read()).decode("ascii")
            click_data_url = f"data:audio/mpeg;base64,{click_b64}"
        except Exception:
            click_data_url = None

    # ---- HTML (import ESM dinámico) ----
    esc = lambda s: (s.replace('\\','\\\\').replace('`','\\`').replace('$','\\$').replace("</script>","<\\/script>"))
    urdf_js  = esc(urdf_raw) if urdf_raw else ""
    mesh_js  = json.dumps(mesh_db)
    bg_js    = 'null' if (background is None) else str(int(background))
    sel_js   = json.dumps(select_mode)

    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
<title>URDF Viewer</title>
<style>
  :root {{
    --teal: #0ea5a6; --dark-teal: #0b3b3c; --light-teal: #d7e7e7;
    --white: #ffffff; --gray-light: #f8f8f8;
    --shadow: 0 4px 12px rgba(0,0,0,0.08); --shadow-hover: 0 8px 24px rgba(0,0,0,0.12);
  }}
  html,body {{
    margin:0 !important; padding:0 !important; height:100vh; width:100vw; overflow:hidden;
    background:var(--white); font-family: 'Inter','Segoe UI',system-ui,-apple-system,sans-serif; color:var(--dark-teal);
  }}
  #app {{ position:fixed; inset:0; width:100vw; height:100vh; outline:none; }}

  /* Dock a la izquierda (cuando esté abierto) */
  .viewer-dock-fix {{
    position:fixed !important; left:16px !important; right:auto !important; top:16px !important;
    z-index:99999 !important; background:rgba(255,255,255,0.95) !important;
    border:1px solid var(--light-teal) !important; border-radius:12px !important;
    box-shadow:var(--shadow) !important; padding:6px !important; backdrop-filter: blur(8px) !important;
  }}
  .viewer-dock-fix input[type="range"] {{ accent-color: var(--teal) !important; }}
  .viewer-dock-fix input[type="checkbox"] {{ accent-color: var(--teal) !important; border-radius:3px !important; }}
  @media (max-width:768px) {{
    .viewer-dock-fix {{ left:12px !important; top:12px !important; max-width:min(86vw, 420px); }}
  }}
</style>
</head>
<body>
  <div id="app" tabindex="0"></div>


  <!-- Add this right after <div id="app"...> in the HTML your Python builds -->
<button id="dl-html"
  style="position:fixed;left:14px;top:14px;z-index:10001;
         padding:8px 12px;border-radius:12px;border:1px solid #d7e7e7;
         background:#fff;font-weight:700;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,0.12)">
  ⬇ Download HTML
</button>

<script>
  (function () {
    const btn = document.getElementById('dl-html');
    if (!btn) return;
    btn.addEventListener('mouseenter', () => {
      btn.style.transform = 'translateY(-1px) scale(1.02)';
      btn.style.background = 'rgba(20,184,185,0.12)'; // tealFaint
      btn.style.borderColor = '#14b8b9';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'none';
      btn.style.background = '#fff';
      btn.style.borderColor = '#d7e7e7';
    });
    btn.addEventListener('click', () => {
      // 1) Freeze current HTML
      const html = '<!doctype html>\n' + document.documentElement.outerHTML;

      // 2) Blob → download
      const blob = new Blob([html], { type: 'text/html' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = 'urdf_viewer_with_tools.html';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 250);
    });
  })();
</script>


  <script>
  (async function(){{
    const repo={json.dumps(repo)}, branch={json.dumps(branch)}, compFile={json.dumps(compFile)};
    const haveURDF={json.dumps(bool(urdf_raw))};
    const SELECT_MODE={sel_js};
    const BACKGROUND={bg_js};
    const CLICK_URL={json.dumps(click_data_url)};
    const INIT={{ az: ({float(init_az_deg)})*Math.PI/180, el: ({float(init_el_deg)})*Math.PI/180, pad: Math.max(1.0,{float(init_zoom_out)}), topEps:1e-3 }};

    // Ajuste de iframe en Colab
    function syncIframeHeight(){{
      const h = Math.max(320, window.innerHeight || document.documentElement.clientHeight || 600);
      try{{ if(window.google?.colab?.output?.setIframeHeight) window.google.colab.output.setIframeHeight(h,true); }}catch(_e){{}}
    }}
    syncIframeHeight(); window.addEventListener('resize', syncIframeHeight);

    // Helpers
    function loadScript(url){{return new Promise((res,rej)=>{{const s=document.createElement('script'); s.src=url; s.defer=true; s.onload=()=>res(url); s.onerror=()=>rej(new Error('load fail: '+url)); document.head.appendChild(s);}});}}
    async function latest(){{ try{{ const api='https://api.github.com/repos/'+repo+'/commits/'+branch+'?_='+Date.now(); const r=await fetch(api,{{headers:{{'Accept':'application/vnd.github+json'}}, cache:'no-store'}}); if(!r.ok) throw 0; const j=await r.json(); return (j.sha||'').slice(0,7)||branch; }}catch(_e){{ return branch; }} }}

    // Three + loaders UMD antes del ESM (ok vía <script>)
    await loadScript("https://cdn.jsdelivr.net/npm/three@0.132.2/build/three.min.js");
    await loadScript("https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/controls/OrbitControls.js");
    await loadScript("https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/loaders/STLLoader.js");
    await loadScript("https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/loaders/ColladaLoader.js");
    await loadScript("https://cdn.jsdelivr.net/npm/urdf-loader@0.12.6/umd/URDFLoader.js");

    // Import dinámico del entry ESM desde el último commit (con cache-buster)
    const ver = await latest();
    const base = 'https://cdn.jsdelivr.net/gh/' + repo + '@' + ver + '/';
    let mod = null;
    try {{
      mod = await import(base + compFile + '?v=' + Date.now());
    }} catch (_e) {{
      mod = await import('https://cdn.jsdelivr.net/gh/' + repo + '@' + branch + '/' + compFile + '?v=' + Date.now());
    }}

    if (!mod || typeof mod.render !== 'function' || !haveURDF) {{
      console.error('No se pudo cargar el módulo o falta URDF');
      return;
    }}

    // Contenedor y tamaño
    const container = document.getElementById('app');
    const sizeContainer = () => {{ container.style.width = (window.innerWidth || 1) + 'px'; container.style.height = (window.innerHeight || 1) + 'px'; }};
    sizeContainer(); window.addEventListener('resize', sizeContainer);

    // Render
    const opts = {{
      container,
      urdfContent: `{urdf_js}`,
      meshDB: {mesh_js},
      selectMode: SELECT_MODE,
      background: BACKGROUND,
      clickAudioDataURL: CLICK_URL
    }};
    const app = window.__URDF_APP__ = mod.render(opts);

    // Bloquear zoom por doble clic
    app?.renderer?.domElement?.addEventListener('dblclick', (e)=>{{ e.stopImmediatePropagation?.(); e.stopPropagation?.(); e.preventDefault?.(); }}, true);

    // --------- utilidades de vista con tween ---------
    function easeInOutCubic(t){{ return t<0.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2; }}
    function dirFromAzEl(az, el){{ return new THREE.Vector3(Math.cos(el)*Math.cos(az), Math.sin(el), Math.cos(el)*Math.sin(az)).normalize(); }}
    function currentAzEl(cam, target){{
      const v=cam.position.clone().sub(target); const len=Math.max(1e-9, v.length());
      return {{ el: Math.asin(v.y/len), az: Math.atan2(v.z, v.x), r: len }};
    }}
    function tweenOrbits(cam,ctrl,toPos,toTarget=null,ms=700){{
      const p0=cam.position.clone(), t0=ctrl.target.clone(), tStart=performance.now(); ctrl.enabled=false; cam.up.set(0,1,0);
      const moveTarget = (toTarget!==null);
      function step(t){{ const u=Math.min(1,(t-tStart)/ms), e=easeInOutCubic(u);
        cam.position.set(p0.x+(toPos.x-p0.x)*e, p0.y+(toPos.y-p0.y)*e, p0.z+(toPos.z-p0.z)*e);
        if(moveTarget) ctrl.target.set(t0.x+(toTarget.x-t0.x)*e, t0.y+(toTarget.y-t0.y)*e, t0.z+(toTarget.z-t0.z)*e);
        ctrl.update(); app.renderer.render(app.scene, cam);
        if(u<1) requestAnimationFrame(step); else ctrl.enabled=true; }}
      requestAnimationFrame(step);
    }}
    function frameObjectAnimated(obj, pad=1.2, azEl, ms=700){{
      const cam=app.camera, ctrl=app.controls;
      const box=new THREE.Box3().setFromObject(obj); const c=box.getCenter(new THREE.Vector3()); const s=box.getSize(new THREE.Vector3());
      const r3=Math.sqrt(s.x*s.x+s.y*s.y+s.z*s.z)/2*pad;
      const fov=(cam.fov||60)*Math.PI/180; const dist=Math.max(r3/Math.tan(fov/2), 0.001);
      const cur=currentAzEl(cam, ctrl.target);
      const az = (azEl?azEl.az:cur.az);
      let  el = (azEl?azEl.el:cur.el); if(Math.abs(el-Math.PI/2)<1e-6) el=Math.PI/2-INIT.topEps;
      const dir=dirFromAzEl(az,el); const toPos=c.clone().add(dir.multiplyScalar(dist));
      tweenOrbits(cam, ctrl, toPos, c, ms);
    }}

    // Dock a la izquierda SOLO cuando se abra
    function styleDockLeft(){{
      const dock = Array.from(document.querySelectorAll('div')).find(el => (el.textContent||'').includes('Viewer Tools') && getComputedStyle(el).borderRadius);
      if(dock) dock.classList.add('viewer-dock-fix');
    }}
    new MutationObserver((muts)=>{{ for(const m of muts) for(const n of m.addedNodes||[]) if(n.nodeType===1) styleDockLeft(); }}).observe(document.body, {{ childList:true, subtree:true }});

    // Quitar botones "Fit"
    function removeFitButtons(root){{ root=root||document; const killers=Array.from(root.querySelectorAll('button')).filter(b=>(b.textContent||'').trim()==='Fit'); killers.forEach(b=>b.remove()); }}
    removeFitButtons(); new MutationObserver(m=>m.forEach(x=>x.addedNodes&&x.addedNodes.forEach(n=>n.nodeType===1&&removeFitButtons(n)))).observe(document.body,{{childList:true,subtree:true}});

    // Vistas (Iso/Top/Front/Right) con tween desde la cámara actual
    function snap90(a){{ const k=Math.round(a/(Math.PI/2)); return k*(Math.PI/2); }}
    function viewEndPosition(kind){{
      const cam=app.camera, ctrl=app.controls, t=ctrl.target.clone();
      const cur=currentAzEl(cam, t);
      let az=cur.az, el=cur.el;
      if(kind==='iso')    {{ az=INIT.az; el=INIT.el; }}
      if(kind==='top')    {{ az=snap90(cur.az); el=Math.PI/2-INIT.topEps; }}
      if(kind==='front') {{ az=Math.PI/2; el=0; }}
      if(kind==='right') {{ az=0; el=0; }}
      const pos = t.clone().add( dirFromAzEl(az, el).multiplyScalar(cur.r) );
      return pos;
    }}
    document.addEventListener('click', (ev)=>{{
      const b=ev.target.closest && ev.target.closest('button'); if(!b) return;
      const label=(b.textContent || '').trim().toLowerCase();
      if(!/^(iso|top|front|right)$/i.test(label)) return;
      const toPos = viewEndPosition(label);
      tweenOrbits(app.camera, app.controls, toPos, null, 750);
    }}, true);

    // Aislar con "i": ocultar otros + zoom animado
    const ray=new THREE.Raycaster(); const pointer=new THREE.Vector2(0,0);
    const canvas = app && app.renderer && app.renderer.domElement;
    let allMeshes=[]; app.robot.traverse(o=>{{ if(o.isMesh && o.geometry) allMeshes.push(o); }});
    let lastHover=null, isolating=false, isolatedRoot=null;

    // Guardar posición ISO inicial para restaurar
    let isoPosition=null, isoTarget=null;

    function setPointerFromClient(x,y){{
      const r=canvas.getBoundingClientRect();
      pointer.x=((x-r.left)/r.width)*2-1; pointer.y=-((y-r.top)/r.height)*2+1;
    }}
    if(canvas){{
      canvas.addEventListener('pointermove', e=>{{
        setPointerFromClient(e.clientX,e.clientY);
        ray.setFromCamera(pointer, app.camera);
        const hits=ray.intersectObjects(allMeshes,true);
        lastHover = hits.length ? hits[0].object : null;
      }});
      const focus = ()=>{{ try{{ container.focus({{preventScroll:true}}); }}catch(_e){{}} }};
      canvas.addEventListener('pointerenter', focus);
      canvas.addEventListener('pointerdown',  focus);
    }}

    function centerPick(){{
      pointer.set(0,0); ray.setFromCamera(pointer, app.camera);
      const hits=ray.intersectObjects(allMeshes, true);
      return hits.length ? hits[0].object : null;
    }}
    function getLinkRoot(mesh){{
      if(!mesh) return null; let n=mesh;
      while(n && n!==app.robot){{ if((n.children||[]).some(ch=>ch.isMesh)) return n; n=n.parent; }}
      return mesh||app.robot;
    }}
    function buildMeshCache(){{
      allMeshes=[]; app.robot.traverse(o=>{{ if(o.isMesh && o.geometry) allMeshes.push(o); }});
    }}
    function bulkSetVisible(v){{
      if(!allMeshes || !allMeshes.length) buildMeshCache();
      for(let i=0;i<allMeshes.length;i++) allMeshes[i].visible = v;
    }}
    function setVisibleSubtree(root, v){{
      root.traverse(o=>{{ if(o.isMesh) o.visible=v; }});
    }}

    function isolateHideZoom(){{
      const hit = lastHover || centerPick();
      const target = getLinkRoot(hit);
      if(!target) return;

      if(!isolating){{ // guardar ISO antes del primer aislamiento
        isoPosition = app.camera.position.clone();
        isoTarget = app.controls.target.clone();
      }}

      bulkSetVisible(false);
      setVisibleSubtree(target, true);
      frameObjectAnimated(target, 1.25, null, 700);
      isolating=true; isolatedRoot=target;
    }}
    function restoreAll(){{
      bulkSetVisible(true);
      if(isoPosition && isoTarget){{
        tweenOrbits(app.camera, app.controls, isoPosition, isoTarget, 600);
      }} else {{
        const cam=app.camera, ctrl=app.controls, cur=currentAzEl(cam, ctrl.target);
        const box=new THREE.Box3().setFromObject(app.robot); const c=box.getCenter(new THREE.Vector3());
        const toPos = c.clone().add( dirFromAzEl(cur.az, cur.el).multiplyScalar(cur.r) );
        tweenOrbits(cam, ctrl, toPos, c, 600);
      }}
      isolating=false; isolatedRoot=null;
    }}

    function handleKey(e){{
      const k=(e.key||'').toLowerCase();
      if(k==='i'){{ e.preventDefault(); if(isolating) restoreAll(); else isolateHideZoom(); }}
    }}
    container.addEventListener('keydown', handleKey, true);
    canvas && canvas.addEventListener('keydown', handleKey, true);

    // Encuadre inicial ISO y guardar pose para restaurar
    setTimeout(()=>{{
      if(!app.robot) return;
      frameObjectAnimated(app.robot, INIT.pad, {{az:INIT.az, el:INIT.el}}, 650);
      setTimeout(()=>{{ isoPosition = app.camera.position.clone(); isoTarget = app.controls.target.clone(); }}, 700);
    }}, 260);
  }})();
  </script>
</body>
</html>
"""
    return HTML(html)
