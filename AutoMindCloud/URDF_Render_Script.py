# urdf_render_fixed.py — Full-screen, always-fit viewer (minimal, fixed braces)
import base64, re, os, json, shutil, zipfile
from IPython.display import HTML
import gdown


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
    if len(top) == 1 and os.path.isdir(os.path.join(tmp_extract, top[0])):
        shutil.move(os.path.join(tmp_extract, top[0]), final_dir)
    else:
        os.makedirs(final_dir, exist_ok=True)
        for n in top:
            shutil.move(os.path.join(tmp_extract, n), os.path.join(final_dir, n))
    shutil.rmtree(tmp_extract, ignore_errors=True)
    return final_dir


def URDF_Render(folder_path="Model",
                select_mode="link",
                background=0xffffff,
                entry_js_url="https://cdn.jsdelivr.net/gh/ArtemioA/AutoMindCloudExperimental@main/AutoMindCloud/viewer/urdf_viewer_main.js"):

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
    if not urdf_dir or not meshes_dir:
        return HTML(f"<b style='color:red'>No se encontró /urdf y /meshes en {folder_path}</b>")

    urdf_files = [os.path.join(urdf_dir, f) for f in os.listdir(urdf_dir) if f.lower().endswith(".urdf")]
    urdf_files.sort(key=lambda p: os.path.getsize(p) if os.path.exists(p) else 0, reverse=True)

    urdf_raw = ""
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
            pass
    if not urdf_raw and urdf_files:
        with open(urdf_files[0], "r", encoding="utf-8", errors="ignore") as f:
            urdf_raw = f.read().lstrip('\ufeff')

    disk_files = []
    for root, _, files in os.walk(meshes_dir):
        for name in files:
            if name.lower().endswith((".stl", ".dae", ".png", ".jpg", ".jpeg")):
                disk_files.append(os.path.join(root, name))

    meshes_root_abs = os.path.abspath(meshes_dir)
    by_rel, by_base = {}, {}
    for p in disk_files:
        rel = os.path.relpath(os.path.abspath(p), meshes_root_abs).replace("\\", "/").lower()
        by_rel[rel] = p
        by_base[os.path.basename(p).lower()] = p

    _cache, mesh_db = {}, {}
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
        bn = os.path.basename(raw).lower()
        cand = by_rel.get(raw) or by_rel.get(pkg) or by_base.get(bn)
        if cand:
            add_entry(raw, cand); add_entry(pkg, cand); add_entry(bn, cand)

    for p in disk_files:
        bn = os.path.basename(p).lower()
        if bn.endswith((".png", ".jpg", ".jpeg")) and bn not in mesh_db:
            add_entry(bn, p)

    esc = lambda s: (s.replace('\\','\\\\').replace('`','\\`').replace('$','\\$').replace("</script>","<\\/script>"))
    urdf_js, mesh_js = esc(urdf_raw), json.dumps(mesh_db)
    bg_js, sel_js = 'null' if (background is None) else str(int(background)), json.dumps(select_mode)

    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>URDF Viewer</title>
<style>
  html, body {{
    margin:0; padding:0;
    width:100vw; height:100vh;
    overflow:hidden;
    background:#{int(background):06x};
  }}
  #app {{ position:fixed; inset:0; width:100vw; height:100vh; }}
</style>
</head>
<body>
<div id="app"></div>

<script defer src="https://cdn.jsdelivr.net/npm/three@0.132.2/build/three.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/controls/OrbitControls.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/loaders/STLLoader.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/loaders/ColladaLoader.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/urdf-loader@0.12.6/umd/URDFLoader.js"></script>

<script>
function setColabHeight(){{
  const h = Math.max(320, window.innerHeight||600);
  try{{ if(window.google?.colab?.output?.setIframeHeight) window.google.colab.output.setIframeHeight(h,true); }}catch(_e){{}}
}}
window.addEventListener('resize', setColabHeight); setColabHeight();
</script>

<script type="module">
import * as Main from "{entry_js_url}";
const opts = {{
  container: document.getElementById('app'),
  urdfContent: `{urdf_js}`,
  meshDB: {mesh_js},
  selectMode: {sel_js},
  background: {bg_js}
}};
if(Main && typeof Main.render==="function"){{
  const app = Main.render(opts);
  function currentAzEl(cam, target){{
    const v=cam.position.clone().sub(target);
    const len=Math.max(1e-9,v.length());
    return {{ el: Math.asin(v.y/len), az: Math.atan2(v.z,v.x), r: len }};
  }}
  function dirFromAzEl(az,el){{
    return new THREE.Vector3(Math.cos(el)*Math.cos(az),Math.sin(el),Math.cos(el)*Math.sin(az)).normalize();
  }}
  function fitWhole() {{
    const box=new THREE.Box3().setFromObject(app.robot);
    const center=box.getCenter(new THREE.Vector3());
    const size=box.getSize(new THREE.Vector3());
    const maxDim=Math.max(size.x,size.y,size.z)||1;
    const fov=(app.camera.fov||60)*Math.PI/180;
    const dist=(maxDim*1.25)/Math.tan(fov/2);
    const cur=currentAzEl(app.camera,app.controls.target);
    const pos=center.clone().add(dirFromAzEl(cur.az,cur.el).multiplyScalar(dist));
    app.controls.target.copy(center);
    app.camera.position.copy(pos);
    app.camera.near=Math.max(0.01,dist/1000);
    app.camera.far=dist*1000;
    app.camera.updateProjectionMatrix();
    app.controls.update();
  }}
  window.addEventListener('resize',()=>{{
    app.renderer.setSize(window.innerWidth,window.innerHeight,false);
    app.camera.aspect=window.innerWidth/window.innerHeight;
    app.camera.updateProjectionMatrix();
    fitWhole();
  }});
  fitWhole();
}}
</script>
</body>
</html>
"""
    return HTML(html)

