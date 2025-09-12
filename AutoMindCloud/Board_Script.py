"""
cadview_panel.py

Jupyter widget panel to cycle orthographic views of a STEP file using CadQuery.
- Title centered, teal, large font, Computer Modern (via MathJax if present).
- PNG save as an icon button (no text).
- Click sound plays on BOTH "Next view" and the save icon.
- Bottom-right watermark image overlay (Gyazo).

Usage:
from cadview_panel import Step_Orthographic_Render, create_panel_from_step
display(Step_Orthographic_Render("Sketch"))
"""

import os
import re
import json
import uuid
import base64
import cadquery as cq
from cadquery import exporters
import ipywidgets as widgets


def _generate_orthographic_svgs(result):
    views = [
        ("Front View", (1, 0, 0), 0),
        ("Top View", (1, 0, 0), 90),
        ("Right Side View", (0, 1, 0), 90),
        ("Bottom View", (1, 0, 0), -90),
    ]
    svgs = []
    for title, axis, angle in views:
        try:
            rotated = result.rotate((0, 0, 0), axis, angle)
            shape = rotated.val() if hasattr(rotated, "val") else rotated
            svg_str = exporters.getSVG(shape, opts={"showAxes": False})
            svgs.append((title, svg_str))
        except Exception as e:
            err_svg = (
                "<svg xmlns='http://www.w3.org/2000/svg' width='480' height='120'>"
                f"<text x='10' y='24' fill='red'>Error generating {title}: {e}</text></svg>"
            )
            svgs.append((title, err_svg))
    return svgs


def _latex_escape(text: str) -> str:
    replacements = {
        "\\": r"\textbackslash{}",
        "{": r"\{",
        "}": r"\}",
        "_": r"\_",
        "%": r"\%",
        "&": r"\&",
        "$": r"\$",
        "#": r"\#",
        "^": r"\^{}",
        "~": r"\~{}",
    }
    escaped = text
    for k, v in replacements.items():
        escaped = escaped.replace(k, v)
    return escaped


def _strip_background_rects(svg: str) -> str:
    if not svg:
        return svg
    svg = re.sub(r"<\?xml[^>]*\?>", "", svg, flags=re.IGNORECASE).strip()
    svg = re.sub(
        r'<rect\b[^>]*(?:width\s*=\s*"[^\"]*"|height\s*=\s*"[^\"]*"|fill\s*=\s*"[^\"]*")[^>]*\/?>',
        "",
        svg,
        flags=re.IGNORECASE,
    )
    svg = re.sub(r"</rect\s*>", "", svg, flags=re.IGNORECASE)
    return svg


def _embed_audio_b64(filename="click_sound.mp3"):
    if not os.path.exists(filename):
        return None
    try:
        with open(filename, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("ascii")
        return f"data:audio/mpeg;base64,{b64}"
    except Exception:
        return None


def _make_client_side_html(
    svgs,
    audio_dataurl=None,
    watermark_url="https://i.gyazo.com/30a9ecbd8f1a0483a7e07a10eaaa8522.png",
):
    uid = "cadview_" + uuid.uuid4().hex[:8]

    titles = []
    clean_svgs = []
    for title, svg in svgs:
        titles.append(_latex_escape(title))
        clean_svgs.append(_strip_background_rects(svg))

    titles_js = json.dumps(titles)
    svgs_js = json.dumps(clean_svgs)
    audio_js = json.dumps(audio_dataurl) if audio_dataurl else "null"
    wm_js = json.dumps(watermark_url)

    html = f"""
<div id="{uid}" style="color:#0f172a;text-align:center;">
  <!-- Title -->
  <div id="{uid}_title"
       style="font-size:22px; font-weight:600; margin:10px 0;
              color:#009688;
              font-family:'Latin Modern Roman','CMU Serif','Computer Modern Serif',
                          'STIX Two Text','Times New Roman',serif;">
  </div>

  <!-- Viewer wrapper (relative for watermark overlay) -->
  <div id="{uid}_wrap" style="display:inline-block; position:relative;">
    <!-- SVG display -->
    <div id="{uid}_svgbox"
         style="display:inline-block;border:1px solid #666;padding:8px;
                background:#fff;border-radius:4px;max-width:100%;">
    </div>

    <!-- Watermark (bottom-right) -->
    <div id="{uid}_wm"
         style="position:absolute; right:10px; bottom:10px; z-index:5;
                pointer-events:none; user-select:none;">
      <img id="{uid}_wmimg" src="" alt="wm" style="max-height:40px; opacity:0.9; display:block;"/>
    </div>
  </div>

  <!-- Buttons -->
  <div style="margin-top:12px; display:flex; justify-content:center; gap:12px;">
    <button id="{uid}_btn"
            style="background:#009688;color:white;border:0;padding:8px 12px;
                   border-radius:6px;cursor:pointer;">
      Next view
    </button>
    <button id="{uid}_save"
            title="Save current view as PNG"
            style="background:#334155;color:white;border:0;padding:8px 12px;
                   border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;">
      <!-- download icon -->
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"
           viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
    </button>
  </div>
</div>

<script>
(function(){{
  const titles = {titles_js};
  const svgs = {svgs_js};
  const AUDIO_DATA_URL = {audio_js};
  const WM_URL = {wm_js};

  const nextBtn = document.getElementById("{uid}_btn");
  const saveBtn = document.getElementById("{uid}_save");
  const titleEl = document.getElementById("{uid}_title");
  const svgBox  = document.getElementById("{uid}_svgbox");
  const wmImg   = document.getElementById("{uid}_wmimg");

  let idx = 0;
  let clickAudio = null;

  // set watermark src
  try {{ wmImg.src = WM_URL || ""; }} catch(_){{
  }}

  if (AUDIO_DATA_URL) {{
    try {{
      clickAudio = new Audio(AUDIO_DATA_URL);
      clickAudio.preload = "auto";
      clickAudio.loop = false;
      clickAudio.volume = 1.0;
    }} catch(e) {{ clickAudio = null; }}
  }}

  function renderTitle(t) {{
    if (window.MathJax && typeof window.MathJax.typesetPromise === "function") {{
      titleEl.innerHTML = "$$\\\\displaystyle \\\\text{{" + t + "}}$$";
      window.MathJax.typesetPromise([titleEl]).catch(()=>{{}});
    }} else {{
      titleEl.textContent = t;
    }}
  }}

  function render() {{
    renderTitle(titles[idx] || "");
    svgBox.innerHTML = svgs[idx] || "";
  }}

  function downloadCurrentAsPNG() {{
    const svgEl = svgBox.querySelector("svg");
    if (!svgEl) return;
    const clone = svgEl.cloneNode(true);
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(clone);
    const blob = new Blob([svgStr], {{type:"image/svg+xml"}});
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = function() {{
      const canvas = document.createElement("canvas");
      const w = parseFloat(svgEl.getAttribute("width")) || 800;
      const h = parseFloat(svgEl.getAttribute("height")) || 600;
      canvas.width = w*2; canvas.height = h*2;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(img,0,0,canvas.width,canvas.height);
      URL.revokeObjectURL(url);
      const a = document.createElement("a");
      const safeTitle = (titles[idx]||"view").replace(/[^A-Za-z0-9_\\-]+/g,"_");
      a.download = safeTitle + ".png";
      a.href = canvas.toDataURL("image/png");
      a.click();
    }};
    img.onerror = function(e) {{
      console.error("Failed to load SVG for PNG export", e);
      URL.revokeObjectURL(url);
    }};
    img.src = url;
  }}

  function playSound() {{
    if (clickAudio) {{
      try {{ clickAudio.pause(); clickAudio.currentTime = 0; }} catch(_){{
      }}
      clickAudio.play().catch(()=>{{}});
    }}
  }}

  // Events
  nextBtn.addEventListener("click", (ev) => {{
    ev.preventDefault();
    ev.stopPropagation();
    playSound();
    idx = (idx + 1) % svgs.length;
    render();
  }});

  saveBtn.addEventListener("click", (ev) => {{
    ev.preventDefault();
    ev.stopPropagation();
    playSound();
    downloadCurrentAsPNG();
  }});

  // initial
  render();
}})();
</script>
"""
    return html


def Step_Orthographic_Render(sketch_name_or_path, audio_filename="click_sound.mp3"):
    if not sketch_name_or_path.lower().endswith(".step"):
        sketch_path = sketch_name_or_path + ".step"
    else:
        sketch_path = sketch_name_or_path

    if not os.path.exists(sketch_path):
        raise FileNotFoundError(f"STEP file not found: {sketch_path}")

    result = cq.importers.importStep(sketch_path)
    svgs = _generate_orthographic_svgs(result)
    audio_dataurl = _embed_audio_b64(audio_filename)
    html_blob = _make_client_side_html(svgs, audio_dataurl=audio_dataurl)
    return widgets.HTML(value=html_blob)


def create_panel_from_step(sketch_name_or_path, audio_filename="click_sound.mp3"):
    return Step_Orthographic_Render(sketch_name_or_path, audio_filename=audio_filename)
