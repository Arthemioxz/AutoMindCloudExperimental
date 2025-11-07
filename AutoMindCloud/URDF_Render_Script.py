# URDF_Render_Script.py
# Render URDF + puente Colab <-> JS para descripciones de componentes.
#
# Todo el código Python está aquí dentro, nada suelto en el notebook.
# JS (urdf_viewer_main.js + ComponentsPanel.js) espera:
#   invokeFunction("describe_component_images", [entries], {})
# donde entries = [{ "key": assetKey, "image_b64": "<b64>" }, ...]
#
# Este callback ahora:
#   - Envía TODAS las imágenes en UNA sola request al endpoint.
#   - Pide explícitamente un JSON { key: descripcion }.
#   - Devuelve ese dict directamente al JS.
#   - Incluye logs detallados para debug.

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


def _register_colab_callback(
    api_base: str = API_DEFAULT_BASE,
    timeout: int = 60,
):
    """
    Registra describe_component_images para ser llamado desde JS.

    ✅ NUEVO COMPORTAMIENTO:
      - Recibe entries = [{key, image_b64}, ...]
      - Envía UNA sola request al endpoint:
            {
              "text": "Instrucciones + lista de keys",
              "images": [ {image_b64, mime}, ... ]
            }
      - Pide como salida EXCLUSIVAMENTE un JSON:
            { "key1": "desc...", "key2": "desc..." }
      - Devuelve ese dict tal cual a JS.

    Incluye logs detallados para identificar cualquier problema.
    """
    global _COLAB_CALLBACK_REGISTERED
    if _COLAB_CALLBACK_REGISTERED:
        return

    try:
        from google.colab import output  # type: ignore

        api_base = api_base.rstrip("/")
        infer_url = api_base + API_INFER_PATH

        def _describe_component_images(entries):
            # ---- Validar entrada ----
            try:
                total = len(entries)
            except TypeError:
                total = 0

            print(
                f"[Colab] describe_component_images: recibido entries={total}"
            )

            if not isinstance(entries, (list, tuple)) or total == 0:
                print("[Colab] ERROR: entries no es lista o está vacío.")
                return {}

            keys = []
            images = []

            for i, item in enumerate(entries):
                if not isinstance(item, dict):
                    print(f"[Colab] WARN: item {i} no es dict: {item}")
                    continue
                key = item.get("key")
                img_b64 = item.get("image_b64")
                if not key or not img_b64:
                    print(
                        f"[Colab] WARN: item {i} sin key o image_b64 (key={key})."
                    )
                    continue
                keys.append(str(key))
                images.append({"image_b64": img_b64, "mime": "image/png"})

            if not keys or not images or len(keys) != len(images):
                print(
                    "[Colab] ERROR: listado inconsistente de keys/imágenes."
                    f" keys={len(keys)} images={len(images)}"
                )
                return {}

            # ---- Construir prompt para salida estructurada ----
            # Le damos la lista de keys en el mismo orden que las imágenes.
            instruction = {
                "keys": keys,
                "instrucciones": [
                    "Cada imagen corresponde al ID en 'keys', mismo índice.",
                    "Devuélveme EXCLUSIVAMENTE un objeto JSON válido.",
                    "Cada clave del JSON debe ser exactamente uno de los IDs de 'keys'.",
                    (
                        "Cada valor debe ser una descripción breve en español (máximo 2 frases) "
                        "de la pieza de robot correspondiente: función mecánica, zona aproximada "
                        "del cuerpo y tipo de unión o movimiento que sugiere."
                    ),
                    "No incluyas texto adicional fuera del JSON.",
                ],
                "ejemplo_salida": {
                    "base.dae": "Descripción de la base...",
                    "foot.dae": "Descripción del pie...",
                },
            }

            text = (
                "Analiza las imágenes adjuntas. "
                "Sigue estrictamente las siguientes instrucciones (en JSON):\n"
                + json.dumps(instruction, ensure_ascii=False)
            )

            payload = {
                "text": text,
                "images": images,
            }

            print(
                f"[Colab] Enviando UNA request para {len(keys)} imágenes al endpoint..."
            )
            try:
                r = requests.post(infer_url, json=payload, timeout=timeout)
            except Exception as e:
                print(f"[Colab] ERROR de conexión con el endpoint: {e}")
                return {}

            print(
                f"[Colab] Respuesta HTTP {r.status_code}, len={len(r.text or '')}"
            )

            if r.status_code != 200:
                preview = (r.text or "").replace("\n", " ")[:300]
                print(f"[Colab] ERROR API: {preview}")
                return {}

            raw = (r.text or "").strip()
            if not raw:
                print("[Colab] WARN: respuesta vacía del modelo.")
                return {}

            # ---- Intentar parsear como JSON directo ----
            def _try_parse_json(s: str):
                try:
                    return json.loads(s)
                except Exception:
                    return None

            parsed = _try_parse_json(raw)
            if isinstance(parsed, dict):
                # Aseguramos filtrar solo claves que estén en keys
                filtered = {
                    k: (str(v).strip() if v is not None else "")
                    for k, v in parsed.items()
                    if k in keys
                }
                print(
                    f"[Colab] JSON parseado correctamente. "
                    f"{len(filtered)} descripciones mapeadas."
                )
                return filtered

            # ---- Si vino con texto extra, intentar extraer el JSON ----
            start = raw.find("{")
            end = raw.rfind("}")
            if start != -1 and end != -1 and end > start:
                candidate = raw[start : end + 1]
                parsed2 = _try_parse_json(candidate)
                if isinstance(parsed2, dict):
                    filtered = {
                        k: (str(v).strip() if v is not None else "")
                        for k, v in parsed2.items()
                        if k in keys
                    }
                    print(
                        "[Colab] JSON embebido extraído correctamente. "
                        f"{len(filtered)} descripciones mapeadas."
                    )
                    return filtered

            print(
                "[Colab] No se pudo interpretar la respuesta como JSON de mapeo."
            )
            print(f"[Colab] Respuesta (preview): {raw[:300]}")
            return {}

        output.register_callback("describe_component_images", _describe_component_images)
        _COLAB_CALLBACK_REGISTERED = True
        print("[Colab] Callback 'describe_component_images' registrado correctamente.")

    except Exception as e:
        print(
            f"[Colab] No se pudo registrar callback describe_component_images (no Colab o error): {e}"
        )


def _ensure_local_viewer_sources():
    """
    Copia los JS que subiste (en /mnt/data) a /content/AutoMindCloud/viewer
    para que el HTML los importe vía /files/....
    """
    base = "/content/AutoMindCloud/viewer"
    subdirs = ["", "/core", "/interaction", "/ui"]
    for sd in subdirs:
        os.makedirs(base + sd, exist_ok=True)

    src_map = {
        "/mnt/data/urdf_viewer_main.js": f"{base}/urdf_viewer_main.js",
        "/mnt/data/Theme.js": f"{base}/Theme.js",
        "/mnt/data/ViewerCore.js": f"{base}/core/ViewerCore.js",
        "/mnt/data/AssetDB.js": f"{base}/core/AssetDB.js",
        "/mnt/data/SelectionAndDrag.js": f"{base}/interaction/SelectionAndDrag.js",
        "/mnt/data/ToolsDock.js": f"{base}/ui/ToolsDock.js",
        "/mnt/data/ComponentsPanel.js": f"{base}/ui/ComponentsPanel.js",
    }

    for src, dst in src_map.items():
        if os.path.exists(src):
            try:
                shutil.copy2(src, dst)
                print(f"[URDF_Render] Copiado {src} -> {dst}")
            except Exception as e:
                print(f"[URDF_Render] No se pudo copiar {src} -> {dst}: {e}")


def URDF_Render(
    folder_path: str = "Model",
    select_mode: str = "link",
    background: int | None = 0xFFFFFF,
    api_base: str = API_DEFAULT_BASE,
):
    """
    Render principal.

    - Registra el callback (si estamos en Colab).
    - Asegura scripts locales del viewer en /content/AutoMindCloud/viewer.
    - Lee URDF y meshes, construye meshDB (base64).
    - Inyecta HTML que importa /files/AutoMindCloud/viewer/urdf_viewer_main.js.
    - JS:
        * Toma thumbnails de componentes al inicio.
        * Llama describe_component_images(entries).
        * Recibe { key: descripcion }.
        * ComponentsPanel muestra esa descripción al hacer click.
    """
    _register_colab_callback(api_base=api_base)
    _ensure_local_viewer_sources()

    # ---- 1) Encontrar /urdf y /meshes ----
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

    # ---- 2) Seleccionar URDF principal ----
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

    # ---- 3) Construir meshDB (key -> base64) ----
    disk_files = []
    for root, _, files in os.walk(meshes_dir):
        for name in files:
            if name.lower().endswith(
                (".stl", ".dae", ".png", ".jpg", ".jpeg")
            ):
                disk_files.append(os.path.join(root, name))

    meshes_root_abs = os.path.abspath(meshes_dir)
    by_rel = {}
    by_base = {}

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

    # ---- 4) HTML que carga los módulos locales ----
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
    margin:0; padding:0;
    width:100%;
    height:100dvh;
    background:#{int(background or 0xFFFFFF):06x};
    overflow:hidden;
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
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100dvh;
    touch-action: none;
  }}
</style>
</head>
<body>
<div id="app"></div>

<script src="https://cdn.jsdelivr.net/npm/three@0.132.2/build/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/controls/OrbitControls.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/loaders/STLLoader.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/loaders/ColladaLoader.js"></script>
<script src="https://cdn.jsdelivr.net/npm/urdf-loader@0.12.6/umd/URDFLoader.js"></script>

<script type="module">
  function applyVHVar() {{
    const vh = (window.visualViewport?.height || window.innerHeight || 600) * 0.01;
    document.documentElement.style.setProperty('--vh', `${{vh}}px`);
  }}
  applyVHVar();

  import {{ render }} from "/files/AutoMindCloud/viewer/urdf_viewer_main.js";

  const opts = {{
    container: document.getElementById('app'),
    urdfContent: `{urdf_js}`,
    meshDB: {mesh_js},
    selectMode: {sel_js},
    background: {bg_js},
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    autoResize: true,
  }};

  console.debug("[URDF] Lanzando viewer con opts:", opts);
  const app = render(opts);
  window.URDF_APP = app;

  function onResize() {{
    try {{
      if (app && typeof app.resize === "function") {{
        const w = window.innerWidth || document.documentElement.clientWidth;
        const h = (
          window.visualViewport?.height ||
          window.innerHeight ||
          document.documentElement.clientHeight
        );
        app.resize(w, h, Math.min(window.devicePixelRatio || 1, 2));
      }}
    }} catch (e) {{
      console.warn("[URDF] Error en resize:", e);
    }}
  }}

  window.addEventListener("resize", onResize);
  if (window.visualViewport) {{
    window.visualViewport.addEventListener("resize", onResize);
  }}
  setTimeout(onResize, 0);
</script>
</body>
</html>
"""
    return HTML(html)
