# ==========================================================
# URDF_Render_Script.py
# Puente Colab <-> JS para descripciones de piezas del URDF.
#
# - Genera viewer HTML embebido.
# - Registra callback "describe_component_images" para ser llamado desde JS.
# - Callback:
#     * Recibe mini-lotes con {key, image_b64}
#     * Baja resolución SOLO para la copia enviada a la API
#     * Aplica 3 mecanismos:
#           M1: batch grande
#           M2: mini-batches
#           M3: 1x1 fallback
#     * Devuelve SIEMPRE dict Python { assetKey: "descripcion" }
#       (Colab lo serializa bien → JS lo lee como objeto)
# ==========================================================

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


# ======================= Download_URDF =======================
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


# ======================= Helpers =======================
def _parse_json_flexible(raw: str):
    """Intenta extraer un dict JSON desde texto potencialmente ruidoso."""
    if not raw:
        return None
    raw = raw.strip()

    # Intento directo
    try:
        v = json.loads(raw)
        if isinstance(v, dict):
            return v
    except Exception:
        pass

    # Buscar primer bloque {...}
    s0 = raw.find("{")
    s1 = raw.rfind("}")
    if s0 != -1 and s1 != -1 and s1 > s0:
        try:
            v = json.loads(raw[s0 : s1 + 1])
            if isinstance(v, dict):
                return v
        except Exception:
            pass

    return None


def _call_api(infer_url: str, text: str, images, timeout: int) -> str:
    r = requests.post(
        infer_url,
        json={"text": text, "images": images},
        timeout=timeout,
    )
    if r.status_code != 200:
        raise RuntimeError(
            f"HTTP {r.status_code}: {(r.text or '')[:280].replace(chr(10), ' ')}"
        )
    return (r.text or "").strip()


def _downscale_b64_for_api(img_b64: str, max_size: int = 384) -> str:
    """
    Baja resolución SOLO para la copia enviada a la API.
    No toca la imagen original que usa la UI.
    """
    try:
        import io
        from PIL import Image  # type: ignore

        data = base64.b64decode(img_b64)
        im = Image.open(io.BytesIO(data)).convert("RGB")
        w, h = im.size
        max_dim = max(w, h)

        if max_dim <= max_size:
            buf = io.BytesIO()
            im.save(buf, format="JPEG", quality=80)
            return base64.b64encode(buf.getvalue()).decode("ascii")

        scale = float(max_size) / float(max_dim)
        new_w = max(32, int(w * scale))
        new_h = max(32, int(h * scale))
        im = im.resize((new_w, new_h), Image.LANCZOS)

        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=80)
        return base64.b64encode(buf.getvalue()).decode("ascii")

    except Exception as e:
        print(f"[Colab] ⚠️ No se pudo redimensionar imagen para API: {e}")
        return img_b64


# ======================= Callback con 3 mecanismos =======================
def _register_colab_callback(
    api_base: str = API_DEFAULT_BASE,
    timeout: int = 90,
):
    """
    Registra el callback 'describe_component_images' para ser llamado desde JS.

    Retorna SIEMPRE un dict Python:
      { assetKey: "descripcion en español (≤2 frases)", ... }
    """
    global _COLAB_CALLBACK_REGISTERED
    if _COLAB_CALLBACK_REGISTERED:
        return

    try:
        from google.colab import output  # type: ignore

        infer_url = api_base.rstrip("/") + API_INFER_PATH

        def _describe_component_images(entries):
            if not isinstance(entries, (list, tuple)) or not entries:
                print("[Colab] ❌ entries vacío/incorrecto.")
                return {}

            keys = []
            imgs = []

            for item in entries:
                if not isinstance(item, dict):
                    continue
                key = item.get("key") or item.get("assetKey")
                img_b64 = item.get("image_b64")
                if not key or not isinstance(img_b64, str) or not img_b64.strip():
                    continue

                small_b64 = _downscale_b64_for_api(img_b64.strip())
                keys.append(str(key))
                imgs.append({"image_b64": small_b64, "mime": "image/jpeg"})

            if not keys:
                return {}

            n = len(keys)
            print(f"[Colab] describe_component_images: {n} imágenes válidas.")
            results: dict[str, str] = {}

            # ---------- M1: Batch grande ----------
            try:
                instr = {
                    "keys": keys,
                    "reglas": [
                        "Responde SOLO con un JSON válido.",
                        "Cada clave debe ser una de 'keys'.",
                        "Máximo 2 frases por componente.",
                        "Idioma: español.",
                    ],
                }
                prompt = (
                    "Eres un generador de JSON estricto. Devuelve únicamente un objeto JSON.\n"
                    + json.dumps(instr, ensure_ascii=False)
                )
                raw = _call_api(infer_url, prompt, imgs, timeout)
                parsed = _parse_json_flexible(raw)

                if isinstance(parsed, dict):
                    for k, v in parsed.items():
                        if k in keys:
                            if isinstance(v, (dict, list)):
                                v = json.dumps(v, ensure_ascii=False)
                            results[k] = (str(v).strip() if v is not None else "")

                    if len(results) >= max(1, int(0.6 * n)):
                        print(f"[Colab] ✅ M1 OK: {len(results)}/{n}.")
                        return results
                    else:
                        print(
                            f"[Colab] ⚠️ M1 incompleto ({len(results)}/{n}), usando M2."
                        )
                else:
                    print("[Colab] ⚠️ M1 sin JSON utilizable, usando M2.")
            except Exception as e:
                print(f"[Colab] ⚠️ M1 falló: {e}")

            # ---------- M2: Mini-batches ----------
            print("[Colab] 🔁 M2 Mini-batches.")
            BATCH = 6
            for i in range(0, n, BATCH):
                sub_keys = keys[i : i + BATCH]
                sub_imgs = imgs[i : i + BATCH]
                instr2 = {
                    "keys": sub_keys,
                    "reglas": [
                        "Responde SOLO con un JSON.",
                        "Solo usa claves dentro de 'keys'.",
                        "Máximo 2 frases, español.",
                    ],
                }
                prompt2 = (
                    "Genera descripciones para este subconjunto de componentes.\n"
                    + json.dumps(instr2, ensure_ascii=False)
                )
                try:
                    raw2 = _call_api(infer_url, prompt2, sub_imgs, timeout)
                    parsed2 = _parse_json_flexible(raw2)
                    if isinstance(parsed2, dict):
                        for k, v in parsed2.items():
                            if k in sub_keys:
                                if isinstance(v, (dict, list)):
                                    v = json.dumps(v, ensure_ascii=False)
                                results[k] = (str(v).strip() if v is not None else "")
                except Exception as e:
                    print(f"[Colab] ⚠️ M2 error lote {i//BATCH}: {e}")

            if len(results) == n:
                print(f"[Colab] ✅ M2 completó {n}/{n}.")
                return results
            elif results:
                print(
                    f"[Colab] ⚠️ M2 parcial {len(results)}/{n}, el resto pasa a M3."
                )
            else:
                print("[Colab] ⚠️ M2 sin resultados, pasamos a M3.")

            # ---------- M3: 1x1 ----------
            print("[Colab] 🛟 M3 1x1.")
            for k, img in zip(keys, imgs):
                if k in results:
                    continue

                single_prompt = (
                    "Describe brevemente la pieza del robot en la imagen: "
                    "indica función mecánica, zona aproximada en el robot y tipo de unión o movimiento. "
                    "Máximo 2 frases. Español."
                )
                try:
                    raw3 = _call_api(infer_url, single_prompt, [img], timeout)
                except Exception as e:
                    print(f"[Colab] ❌ M3 error para {k}: {e}")
                    results[k] = ""
                    continue

                desc = (raw3 or "").strip()
                try:
                    maybe = json.loads(desc)
                    if isinstance(maybe, (dict, list)):
                        desc = json.dumps(maybe, ensure_ascii=False)
                except Exception:
                    pass

                results[k] = desc

            print(f"[Colab] ✅ M3 completado. Total: {len(results)}/{n}.")
            return results

        output.register_callback(
            "describe_component_images", _describe_component_images
        )
        _COLAB_CALLBACK_REGISTERED = True
        print(
            "[Colab] ✅ Callback 'describe_component_images' registrado (M1+M2+M3 + downscale)."
        )

    except Exception as e:
        print(
            f"[Colab] ❌ No se pudo registrar callback describe_component_images: {e}"
        )


# ======================= URDF_Render =======================
def URDF_Render(
    folder_path: str = "Model",
    select_mode: str = "link",
    background: int | None = 0xFFFFFF,
    # Ajusta repo/branch a tu repo real:
    repo: str = "ArtemioA/AutoMindCloudExperimental",
    branch: str = "main",
    compFile: str = "AutoMindCloud/viewer/urdf_viewer_main.js",
    api_base: str = API_DEFAULT_BASE,
):
    _register_colab_callback(api_base=api_base)

    # ---- localizar /urdf y /meshes ----
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

    # ---- URDF principal ----
    urdf_files = [
        os.path.join(urdf_dir, f)
        for f in os.listdir(urdf_dir)
        if f.lower().endswith(".urdf")
    ]
    urdf_files.sort(
        key=lambda p: os.path.getsize(p) if os.path.exists(p) else 0, reverse=True
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

    # ---- meshDB ----
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

    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport"
      content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"/>
<title>URDF Viewer</title>
<style>
  :root {{ --vh: 1vh; }}
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
  }}
</script>
</body>
</html>
"""
    return HTML(html)
