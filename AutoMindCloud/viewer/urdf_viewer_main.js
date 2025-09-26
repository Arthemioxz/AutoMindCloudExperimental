// 5) UI panels (safe)
let toolsDock = null;
if (createToolsDock) {
  try { toolsDock = createToolsDock(app, theme) || null; toolsDock?.open?.(); toolsDock && (toolsDock._open = true); } catch (e) { console.warn('[ToolsDock] init failed:', e); }
}

let componentsPanel = null;
if (createComponentsPanel) {
  try {
    // Check what ComponentsPanel requires; if app lacks APIs, synthesize minimal ones.
    const needs = {
      hasList: !!(app.listLinks || app.getLinks),
      hasFocus: !!(app.focusLink || app.frameLink || app.zoomTo),
      hasEvents: !!(app.events && (app.events.on || app.on)),
    };

    // Build a tiny adapter over the app to provide expected shape
    const adapter = {
      listLinks: () => {
        if (typeof app.listLinks === 'function') return app.listLinks();
        if (typeof app.getLinks === 'function') return app.getLinks();
        // derive by traversing robot
        const names = [];
        try {
          app.robot?.traverse?.((o) => {
            const nm = o.userData?.linkName || o.name;
            if (nm && !names.includes(nm)) names.push(nm);
          });
        } catch (_) {}
        return names;
        },
      focusLink: (name) => {
        if (typeof app.focusLink === 'function') return app.focusLink(name);
        if (typeof app.frameLink === 'function') return app.frameLink(name);
        // generic frame by name
        try {
          let target = null;
          app.robot?.traverse?.((o) => {
            const nm = o.userData?.linkName || o.name;
            if (nm === name) target = o;
          });
          if (!target) return;
          // simple tween-to-fit
          const cam = app.camera, ctrl = app.controls;
          const box = new THREE.Box3().setFromObject(target);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z) || 1;
          const fov = (cam.fov || 60) * Math.PI / 180;
          const dist = (maxDim * 1.2) / Math.tan(fov / 2);
          const p0 = cam.position.clone(), t0 = ctrl.target.clone();
          const dir = p0.clone().sub(t0).normalize();
          const toPos = center.clone().add(dir.multiplyScalar(dist));
          const tStart = performance.now(), ms = 650;
          const ease = (t)=> (t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2);
          function step(now){
            const u = Math.min(1,(now - tStart)/ms), e = ease(u);
            cam.position.lerpVectors(p0, toPos, e);
            ctrl.target.lerpVectors(t0, center, e);
            ctrl.update?.(); app.renderer.render(app.scene, cam);
            if (u < 1) requestAnimationFrame(step);
          }
          requestAnimationFrame(step);
        } catch (_){}
      },
      onSelect: (cb) => {
        // best-effort wire (selection module often exposes this via app.events)
        try {
          if (app.events?.on) app.events.on('select', cb);
          else if (typeof app.on === 'function') app.on('select', cb);
        } catch (_){}
      }
    };

    // Pass adapter if needed; ComponentsPanel should accept (app, theme, adapter?)
    componentsPanel = createComponentsPanel(app, theme, adapter) || null;
    componentsPanel?.open?.(); componentsPanel && (componentsPanel._open = true);
  } catch (e) {
    console.warn('[ComponentsPanel] init skipped:', e);
  }
}
