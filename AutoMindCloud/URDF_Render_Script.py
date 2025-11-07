# ==========================================================
# URDF_Render_Script.py
# Puente Colab <-> JS para descripciones de piezas del URDF.
# Versión: batch con fallback seguro
# ==========================================================
#
# Uso en Colab:
#   from URDF_Render_Script import URDF_Render
#   URDF_Render("URDFModel2")
#
# JS (desde AutoMindCloudExperimental):
#   - Genera thumbnails base64 de cada componente al inicio.
#   - Llama:
#       google.colab.kernel.invokeFunction(
#           "describe_component_images",
#           [entries],
#           {}
#       )
#     donde entries = [{ "key": assetKey, "image_b64": "<b64_sin_prefijo>" }, ...]
#   - Recibe { assetKey: descripcion }.
#   - ComponentsPanel muestra la descripción al hacer click.

import base64
import re
import os
import json
import shutil
import zipfile
import requests
from IPython.display import HTML

API_DEFAULT_BASE = "https://gpt-proxy-github-619255898589.us-central1.run.app"
API_INFER_PATH = "/infer"

_COLAB_CALLBACK_REGISTERED = False


# ==========================================================
# Download_URDF (tu implementación original)
# ==========================================================
def Download_URDF(Drive_Link, Output_Name="Model"):
    root_dir = "/content"
    file_id = Drive_Link.split("/d/")[1].split("/")[0]
    url = f"https://drive.google.com/uc?id={file_id}"
    zip_path = os.path.join(root_dir, Output_Name + ".zip")
    tmp_extract = os.path.join(root_dir, f"__tmp_extract_{Output_Name}")
    final_dir = os.path.join(root_dir, Output_Name)

    if os.path.exists(tmp_extract):
        shutil.rmtree(tmp_extract)
    os.makedirs(tmp_extract, exist_ok=True)
    if os.path.exists(final_dir):
        shutil.rmtree(final_dir)

    import gdown

    gdown.download(url, zip_path, quiet=True)
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(tmp_extract)

    def junk(n: str) -> bool:
        return n.startswith(".") or n == "__MACOSX"

    top = [n for n in os.listdir(tmp_extract) if not junk(n)]
    if len(top) == 1 and os.path.isdir(os.path.join(tmp_extract, top[0])):
        shutil.move(os.path.join(tmp_extract, top[0]), final_dir)
    else:
        os.makedirs(final_dir, exist_ok=True)
        for n in top:
            shutil.move(os.path.join(tmp_extract, n), os.path.join(final_dir, n))

    shutil.rmtree(tmp_extract, ignore_errors=True)
    return final_dir


# ==========================================================
# Callback describe_component_images
#   - Intenta batch (todas las imágenes en 1 request)
#   - Si falla o no hay JSON utilizable → fallback 1x1
# ==========================================================
def _register_colab_callback(
    api_base: str = API_DEFAULT_BASE,
    timeout: int = 90,
):
    global _COLAB_CALLBACK_REGISTERED
    if _COLAB_CALLBACK_REGISTERED:
        return

    try:
        from google.colab import output  # type: ignore

        api_base = api_base.rstrip("/")
        infer_url = api_base + API_INFER_PATH

        def _parse_json_flexible(raw: str):
            """Intenta parsear un JSON {..} desde el texto."""
            if not raw:
                return None
            raw = raw.strip()
            # Intento directo
            try:
                val = json.loads(raw)
                if isinstance(val, dict):
                    return val
            except Exception:
                pass
            # Buscar bloque {...}
            s0 = raw.find("{")
            s1 = raw.rfind("}")
            if s0 != -1 and s1 != -1 and s1 > s0:
                try:
                    val = json.loads(raw[s0 : s1 + 1])
                    if isinstance(val, dict):
                        return val
                except Exception:
                    pass
            return None

        def _call_api(text: str, images, timeout: int):
            """Llama a /infer con el payload dado, devuelve texto o levanta."""
            r = requests.post(
                infer_url,
                json={"text": text, "images": images},
                timeout=timeout,
            )
            if r.status_code != 200:
                raise RuntimeError(
                    f"HTTP {r.status_code}: {(r.text or '')[:200].replace(chr(10), ' ')}"
                )
            return (r.text or "").strip()

        def _describe_component_images(entries):
            """
            Callback invocado desde JS.

            entries: [{ "key": assetKey, "image_b64": "<b64_sin_prefijo>" }, ...]
            Debe devolver: { assetKey: descripcion }
            """
            try:
                n = len(entries)
            except TypeError:
                n = 0
            print(f"[Colab] describe_component_images: recibido {n} entradas.")

            if not isinstance(entries, (list, tuple)) or n == 0:
                print("[Colab] ❌ entries vacío o no es lista.")
                return {}

            # Normalizar/filtrar
            keys = []
            imgs = []
            for i, item in enumerate(entries):
                if not isinstance(item, dict):
                    print(f"[Colab] ⚠️ item {i} no dict: {item}")
                    continue
                key = item.get("key")
                img_b64 = item.get("image_b64")
                if not key or not isinstance(img_b64, str) or not img_b64.strip():
                    print(f"[Colab] ⚠️ item {i} sin key o image_b64 válido.")
                    continue
                keys.append(str(key))
                imgs.append({"image_b64": img_b64.strip(), "mime": "image/png"})

            if not keys:
                print("[Colab] ❌ No hay imágenes válidas tras filtrar.")
                return {}

            # =====================================================
            # 1) Intento BATCH: todas las imágenes en una sola call
            # =====================================================
            print(f"[Colab] 🚀 Intentando batch con {len(keys)} imágenes...")

            batch_instructions = {
                "keys": keys,
                "rules": [
                    "Responde EXCLUSIVAMENTE con un JSON válido (sin texto extra).",
                    "Cada clave del JSON debe ser exactamente uno de los valores de 'keys'.",
                    "Cada valor: máximo 2 frases en español.",
                    "Describe función mecánica, ubicación aproximada en el robot y tipo de unión/movimiento.",
                ],
            }

            batch_text = (
                "Eres un generador de JSON estricto.\n"
                "Para las imágenes de componentes de robot que se adjuntan, sigue estas reglas:\n"
                + json.dumps(batch_instructions, ensure_ascii=False)
            )

            results: dict[str, str] = {}

            try:
                raw = _call_api(batch_text, imgs, timeout)
                print(
                    f"[Colab] Batch respuesta len={len(raw)}. Intentando parsear JSON..."
                )
                parsed = _parse_json_flexible(raw)
                if isinstance(parsed, dict):
                    # Filtrar solo las keys que conocemos
                    for k, v in parsed.items():
                        if k in keys:
                            if isinstance(v, (dict, list)):
                                v = json.dumps(v, ensure_ascii=False)
                            results[k] = (str(v).strip() if v is not None else "")
                    if results:
                        print(
                            f"[Colab] ✅ Batch OK: {len(results)} descripciones mapeadas."
                        )
                        return results
                    else:
                        print(
                            "[Colab] ⚠️ Batch JSON parseado pero sin claves válidas."
                        )
                else:
                    print("[Colab] ⚠️ Batch no devolvió JSON interpretable.")
            except Exception as e:
                print(f"[Colab] ⚠️ Batch falló: {e}")

            # =====================================================
            # 2) Fallback: modo 1x1 (compatible con tu versión previa)
            # =====================================================
            print(
                "[Colab] ↩️ Usando fallback 1x1 (una request por imagen, más lento pero seguro)."
            )
            for key, img in zip(keys, imgs):
                single_text = (
                    "Describe brevemente qué pieza de robot se ve en esta imagen. "
                    "Indica su función mecánica, la zona aproximada del robot "
                    "y el tipo de unión o movimiento que sugiere. Español, máximo 2 frases."
                )
                try:
                    raw = _call_api(single_text, [img], timeout)
                except Exception as e:
                    print(f"[Colab] ❌ Error API para {key}: {e}")
                    results[key] = ""
                    continue

                # raw aquí es texto libre → lo usamos directo
                desc = (raw or "").strip()
                # si por error vino JSON, lo aplastamos a string corto
                try:
                    maybe = json.loads(desc)
                    if isinstance(maybe, (dict, list)):
                        desc = json.dumps(maybe, ensure_ascii=False)
                except Exception:
                    pass
                results[key] = desc

            print(
                f"[Colab] ✅ Fallback completado: {len(results)} descripciones generadas."
            )
            return results

        output.register_callback("describe_component_images", _describe_component_images)
        _COLAB_CALLBACK_REGISTERED = True
        print("[Colab] ✅ Callback 'describe_component_images' registrado (batch+fallback).")

    except Exception as e:
        print(
            f"[Colab] ❌ No se pudo registrar callback describe_component_images: {e}"
        )


# ==========================================================
# URDF_Render
#   - Igual que tu versión (viewer completo)
#   - Solo añade registro del callback al inicio
# ==========================================================
def URDF_Render(
    folder_path: str = "Model",
    select_mode: str = "link",
    background: int | None = 0xFFFFFF,
    repo: str = "Arthemioxz/AutoMindCloudExperimental",
    branch: str = "main",
    compFile: str = "AutoMindCloud/viewer/urdf_viewer_main.js",
    api_base: str = API_DEFAULT_BASE,
):
    _register_colab_callback(api_base=api_base)

    # --------- localizar /urdf y /meshes ---------
    def find_dirs(root):
        u = os.path.join(root, "urdf")
        m = os.path.join(root, "meshes")
        if os.path.isdir(u) and os.path.isdir(m):
            return u, m
        if os.path.isdir(root):
            for name in os.listdir(root):
                cand = os.path.join(root, name)
                uu = os.path.join(cand, "urdf")
                mm = os.path.join(cand, "meshes")
                if os.path.isdir(uu) and os.path.isdir(mm):
                    return uu, mm
        return None, None

    urdf_dir, meshes_dir = find_dirs(folder_path)
    if not urdf_dir or not meshes_dir:
        return HTML(
            f"<b style='color:red'>No se encontró /urdf y /meshes en {folder_path}</b>"
        )

    # --------- URDF principal ---------
    urdf_files = [
        os.path.join(urdf_dir, f)
        for f in os.listdir(urdf_dir)
        if f.lower().endswith(".urdf")
    ]
    urdf_files.sort(
        key=lambda p: os.path.getsize(p) if os.path.exists(p) else 0,
        reverse=True,
    )

    urdf_raw = ""
    mesh_refs: list[str] = []

    for upath in urdf_files:
        try:
            with open(upath, "r", encoding="utf-8", errors="ignore") as f:
                txt = f.read().lstrip("\ufeff")
            refs = re.findall(
                r'filename="([^"]+\.(?:stl|dae))"', txt, re.IGNORECASE
            )
            if refs:
                urdf_raw = txt
                mesh_refs = list(dict.fromkeys(refs))
                break
        except Exception:
            pass

    if not urdf_raw and urdf_files:
        with open(urdf_files[0], "r", encoding="utf-8", errors="ignore") as f:
            urdf_raw = f.read().lstrip("\ufeff")

    # --------- Construir meshDB ---------
    disk_files = []
    for root, _, files in os.walk(meshes_dir):
        for name in files:
            if name.lower().endswith(
                (".stl", ".dae", ".png", ".jpg", ".jpeg")
            ):
                disk_files.append(os.path.join(root, name))

    meshes_root_abs = os.path.abspath(meshes_dir)
    by_rel, by_base = {}, {}
    for path in disk_files:
        rel = (
            os.path.relpath(os.path.abspath(path), meshes_root_abs)
            .replace("\\", "/")
            .lower()
        )
        by_rel[rel] = path
        by_base[os.path.basename(path).lower()] = path

    _cache: dict[str, str] = {}
    mesh_db: dict[str, str] = {}

    def b64(path: str) -> str:
        if path not in _cache:
            with open(path, "rb") as f:
                _cache[path] = base64.b64encode(f.read()).decode("ascii")
        return _cache[path]

    def add_entry(key: str, path: str):
        k = key.replace("\\", "/").lower().lstrip("./")
        if k.startswith("package://"):
            k = k[len("package://") :]
        if k not in mesh_db:
            mesh_db[k] = b64(path)

    for ref in mesh_refs:
        raw = ref.replace("\\", "/").lower().lstrip("./")
        pkg = raw[10:] if raw.startswith("package://") else raw
        bn = os.path.basename(raw).lower()
        cand = by_rel.get(raw) or by_rel.get(pkg) or by_base.get(bn)
        if cand:
            add_entry(raw, cand)
            add_entry(pkg, cand)
            add_entry(bn, cand)

    for path in disk_files:
        bn = os.path.basename(path).lower()
        if bn.endswith((".png", ".jpg", ".jpeg")) and bn not in mesh_db:
            add_entry(bn, path)

    def esc(s: str) -> str:
        return (
            s.replace("\\", "\\\\")
            .replace("`", "\\`")
            .replace("$", "\\$")
            .replace("</script>", "<\\/script>")
        )

    urdf_js = esc(urdf_raw)
    mesh_js = json.dumps(mesh_db)
    bg_js = "null" if background is None else str(int(background))
    sel_js = json.dumps(select_mode)

    # --------- HTML (igual enfoque original: fullscreen + jsdelivr) ---------
    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport"
      content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"/>
<title>URDF Viewer</title>
<style>
  :root {{
    --vh: 1vh;
  }}
  html, body {{
    margin:0;
    padding:0;
    width:100%;
    height:100dvh;
    overflow:hidden;
    background:#{int(background or 0xFFFFFF):06x};
  }}
  @supports not (height: 100dvh) {{
    html, body {{ height: calc(var(--vh) * 100); }}
  }}
  body {{
    padding-top: env(safe-area-inset-top);
    padding-right: env(safe-area-inset-right);
    padding-bottom: env(safe-area-inset-bottom);
    padding-left: env(safe-area-inset-left);
  }}
  #app {{
    position:fixed;
    inset:0;
    width:100vw;
    height:100dvh;
    touch-action:none;
  }}
  @supports not (height: 100dvh) {{
    #app {{ height: calc(var(--vh) * 100); }}
  }}
  .badge {{
    position:fixed;
    right:14px;
    bottom:12px;
    z-index:10;
    user-select:none;
    pointer-events:none;
  }}
  .badge img {{
    max-height:40px;
    display:block;
  }}
</style>
</head>
<body>
<div id="app"></div>
<div class="badge">
  <img src="https://i.gyazo.com/30a9ecbd8f1a0483a7e07a10eaaa8522.png" alt="AutoMind"/>
</div>

<script>
  function applyVHVar() {{
    const vh = (window.visualViewport?.height || window.innerHeight || 600) * 0.01;
    document.documentElement.style.setProperty('--vh', vh + 'px');
  }}
  applyVHVar();
  function setColabFrameHeight() {{
    const h = Math.ceil(
      (window.visualViewport?.height ||
       window.innerHeight ||
       document.documentElement.clientHeight || 600)
    );
    try {{
      if (window.google?.colab?.output?.setIframeHeight) {{
        window.google.colab.output.setIframeHeight(h, true);
      }}
    }} catch(e) {{}}
  }}
  const ro = new ResizeObserver(() => {{
    applyVHVar();
    setColabFrameHeight();
  }});
  ro.observe(document.body);
  window.addEventListener('resize', () => {{
    applyVHVar();
    setColabFrameHeight();
  }});
  if (window.visualViewport) {{
    window.visualViewport.addEventListener('resize', () => {{
      applyVHVar();
      setColabFrameHeight();
    }});
  }}
  setTimeout(setColabFrameHeight, 50);
</script>

<script src="https://cdn.jsdelivr.net/npm/three@0.132.2/build/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/controls/OrbitControls.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/loaders/STLLoader.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/loaders/ColladaLoader.js"></script>
<script src="https://cdn.jsdelivr.net/npm/urdf-loader@0.12.6/umd/URDFLoader.js"></script>

<script type="module">
  const repo = {json.dumps(repo)};
  const branch = {json.dumps(branch)};
  const compFile = {json.dumps(compFile)};

  async function latest() {{
    try {{
      const api = 'https://api.github.com/repos/' + repo + '/commits/' + branch + '?_=' + Date.now();
      const r = await fetch(api, {{
        headers: {{ 'Accept': 'application/vnd.github+json' }},
        cache: 'no-store'
      }});
      if (!r.ok) throw 0;
      const j = await r.json();
      return (j.sha || '').slice(0, 7) || branch;
    }} catch (_e) {{
      return branch;
    }}
  }}

  const SELECT_MODE = {sel_js};
  const BACKGROUND = {bg_js};

  const opts = {{
    container: document.getElementById('app'),
    urdfContent: `{urdf_js}`,
    meshDB: {mesh_js},
    selectMode: SELECT_MODE,
    background: BACKGROUND,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    autoResize: true,
  }};

  let mod = null;
  try {{
    const ver = await latest();
    const base = 'https://cdn.jsdelivr.net/gh/' + repo + '@' + ver + '/';
    mod = await import(base + compFile + '?v=' + Date.now());
    console.debug('[URDF] Cargado viewer desde commit', ver);
  }} catch (_e) {{
    console.debug('[URDF] Fallback a branch', branch);
    mod = await import(
      'https://cdn.jsdelivr.net/gh/' + repo + '@' + branch + '/' + compFile + '?v=' + Date.now()
    );
  }}

  if (!mod || typeof mod.render !== 'function') {{
    console.error('[URDF] No se pudo cargar el módulo de entrada o no expone render()');
  }} else {{
    const app = mod.render(opts);
    window.URDF_APP = app;

    function onResize() {{
      try {{
        if (app && typeof app.resize === 'function') {{
          const w = window.innerWidth || document.documentElement.clientWidth;
          const h = (
            window.visualViewport?.height ||
            window.innerHeight ||
            document.documentElement.clientHeight
          );
          app.resize(w, h, Math.min(window.devicePixelRatio || 1, 2));
        }}
      }} catch(e) {{
        console.warn('[URDF] Error en resize:', e);
      }}
    }}

    window.addEventListener('resize', onResize);
    if (window.visualViewport) {{
      window.visualViewport.addEventListener('resize', onResize);
    }}
    setTimeout(onResize, 0);
  }}
</script>
</body>
</html>
"""
    return HTML(html)
