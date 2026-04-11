(function (global) {
  "use strict";

  const DEFAULTS = {
    scale: 1.5,
    pdfjsSrc: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js",
    workerSrc: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js",
    themeColor: "#1a73e8",
    zoomColor: "#34a853"
  };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === "true") return resolve();
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("No se pudo cargar " + src)), { once: true });
        return;
      }

      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => {
        s.dataset.loaded = "true";
        resolve();
      };
      s.onerror = () => reject(new Error("No se pudo cargar " + src));
      document.head.appendChild(s);
    });
  }

  async function ensurePdfJs(options) {
    if (!global.pdfjsLib) {
      await loadScript(options.pdfjsSrc);
    }
    global.pdfjsLib.GlobalWorkerOptions.workerSrc = options.workerSrc;
  }

  function normalizeBase64(base64) {
    if (!base64 || typeof base64 !== "string") {
      throw new Error("Debes pasar un base64 válido.");
    }
    return base64
      .replace(/^data:application\/pdf;base64,/, "")
      .replace(/\s+/g, "");
  }

  function base64ToUint8Array(base64) {
    const clean = normalizeBase64(base64);
    const binaryString = atob(clean);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  function getContainer(container) {
    if (typeof container === "string") {
      const el = document.getElementById(container);
      if (!el) throw new Error(`No existe un elemento con id="${container}"`);
      return el;
    }
    if (container instanceof HTMLElement) return container;
    throw new Error("container debe ser un id o un HTMLElement.");
  }

  function createViewerLayout(container, options) {
    container.innerHTML = "";

    const wrapper = document.createElement("div");
    wrapper.style.fontFamily = "Arial,sans-serif";
    wrapper.style.maxWidth = "100%";

    const toolbar = document.createElement("div");
    toolbar.style.marginBottom = "14px";
    toolbar.style.display = "flex";
    toolbar.style.gap = "10px";
    toolbar.style.alignItems = "center";
    toolbar.style.flexWrap = "wrap";
    toolbar.style.background = "#f5f7fb";
    toolbar.style.border = "1px solid #d9e2f1";
    toolbar.style.borderRadius = "14px";
    toolbar.style.padding = "12px 14px";
    toolbar.style.boxShadow = "0 2px 8px rgba(0,0,0,0.06)";

    function makeButton(text, bg) {
      const btn = document.createElement("button");
      btn.textContent = text;
      btn.style.padding = "10px 18px";
      btn.style.border = "none";
      btn.style.borderRadius = "10px";
      btn.style.background = bg;
      btn.style.color = "white";
      btn.style.fontSize = "15px";
      btn.style.fontWeight = "600";
      btn.style.cursor = "pointer";
      btn.style.transition = "0.2s";
      return btn;
    }

    function makeInfoBox(html) {
      const box = document.createElement("div");
      box.style.padding = "10px 14px";
      box.style.background = "white";
      box.style.border = "1px solid #d9e2f1";
      box.style.borderRadius = "10px";
      box.style.fontSize = "15px";
      box.style.fontWeight = "600";
      box.style.color = "#333";
      box.innerHTML = html;
      return box;
    }

    const prevBtn = makeButton("◀ Anterior", options.themeColor);
    const nextBtn = makeButton("Siguiente ▶", options.themeColor);
    const zoomOutBtn = makeButton("− Zoom", options.zoomColor);
    const zoomInBtn = makeButton("+ Zoom", options.zoomColor);

    const pageBox = makeInfoBox(`Página <span data-role="page_num">1</span> de <span data-role="page_count">?</span>`);
    const zoomBox = makeInfoBox(`Zoom: <span data-role="zoom_value">${Math.round(options.scale * 100)}%</span>`);

    toolbar.appendChild(prevBtn);
    toolbar.appendChild(nextBtn);
    toolbar.appendChild(zoomOutBtn);
    toolbar.appendChild(zoomInBtn);
    toolbar.appendChild(pageBox);
    toolbar.appendChild(zoomBox);

    const canvasWrap = document.createElement("div");
    canvasWrap.style.overflow = "auto";
    canvasWrap.style.border = "1px solid #ccc";
    canvasWrap.style.borderRadius = "12px";
    canvasWrap.style.background = "white";
    canvasWrap.style.padding = "10px";

    const canvas = document.createElement("canvas");
    canvas.style.display = "block";
    canvas.style.margin = "auto";

    const errorBox = document.createElement("div");
    errorBox.style.marginTop = "12px";
    errorBox.style.color = "red";
    errorBox.style.fontSize = "14px";

    canvasWrap.appendChild(canvas);
    wrapper.appendChild(toolbar);
    wrapper.appendChild(canvasWrap);
    wrapper.appendChild(errorBox);
    container.appendChild(wrapper);

    return {
      canvas,
      prevBtn,
      nextBtn,
      zoomOutBtn,
      zoomInBtn,
      pageNumEl: pageBox.querySelector('[data-role="page_num"]'),
      pageCountEl: pageBox.querySelector('[data-role="page_count"]'),
      zoomValueEl: zoomBox.querySelector('[data-role="zoom_value"]'),
      errorBox
    };
  }

  async function render(config) {
    const options = Object.assign({}, DEFAULTS, config || {});
    const container = getContainer(options.container);

    if (!options.base64 && !options.url) {
      throw new Error("Debes pasar base64 o url.");
    }

    await ensurePdfJs(options);

    const ui = createViewerLayout(container, options);
    const ctx = ui.canvas.getContext("2d");

    let pdfDoc = null;
    let pageNum = 1;
    let pageRendering = false;
    let pageNumPending = null;
    let scale = options.scale;

    function updateButtons() {
      if (!pdfDoc) return;

      ui.prevBtn.disabled = pageNum <= 1;
      ui.nextBtn.disabled = pageNum >= pdfDoc.numPages;

      ui.prevBtn.style.opacity = ui.prevBtn.disabled ? "0.5" : "1";
      ui.nextBtn.style.opacity = ui.nextBtn.disabled ? "0.5" : "1";

      ui.prevBtn.style.cursor = ui.prevBtn.disabled ? "not-allowed" : "pointer";
      ui.nextBtn.style.cursor = ui.nextBtn.disabled ? "not-allowed" : "pointer";

      ui.zoomValueEl.textContent = Math.round(scale * 100) + "%";
      ui.pageNumEl.textContent = String(pageNum);
      ui.pageCountEl.textContent = String(pdfDoc.numPages);
    }

    function renderPage(num) {
      pageRendering = true;

      pdfDoc.getPage(num).then((page) => {
        const viewport = page.getViewport({ scale });
        ui.canvas.width = viewport.width;
        ui.canvas.height = viewport.height;

        const renderContext = {
          canvasContext: ctx,
          viewport
        };

        const renderTask = page.render(renderContext);

        renderTask.promise.then(() => {
          pageRendering = false;
          updateButtons();

          if (pageNumPending !== null) {
            const pending = pageNumPending;
            pageNumPending = null;
            renderPage(pending);
          }
        });
      }).catch((err) => {
        ui.errorBox.textContent = "Error al renderizar página: " + err.message;
      });
    }

    function queueRenderPage(num) {
      if (pageRendering) {
        pageNumPending = num;
      } else {
        renderPage(num);
      }
    }

    ui.prevBtn.onclick = function () {
      if (!pdfDoc || pageNum <= 1) return;
      pageNum--;
      queueRenderPage(pageNum);
    };

    ui.nextBtn.onclick = function () {
      if (!pdfDoc || pageNum >= pdfDoc.numPages) return;
      pageNum++;
      queueRenderPage(pageNum);
    };

    ui.zoomInBtn.onclick = function () {
      scale += 0.2;
      queueRenderPage(pageNum);
    };

    ui.zoomOutBtn.onclick = function () {
      if (scale <= 0.4) return;
      scale -= 0.2;
      queueRenderPage(pageNum);
    };

    try {
      let loadingTask;

      if (options.base64) {
        const pdfData = base64ToUint8Array(options.base64);
        loadingTask = global.pdfjsLib.getDocument({ data: pdfData });
      } else {
        loadingTask = global.pdfjsLib.getDocument(options.url);
      }

      pdfDoc = await loadingTask.promise;
      updateButtons();
      renderPage(pageNum);
    } catch (error) {
      ui.errorBox.textContent = "Error al cargar PDF: " + error.message;
      throw error;
    }

    return {
      rerender() {
        queueRenderPage(pageNum);
      },
      goToPage(n) {
        if (!pdfDoc) return;
        const target = Math.max(1, Math.min(pdfDoc.numPages, Number(n) || 1));
        pageNum = target;
        queueRenderPage(pageNum);
      }
    };
  }

  global.PdfBase64Viewer = {
    render
  };
})(window);
