// urdf_viewer_main.js — entrypoint: ensambla Core + UI + Interaction (sin tecla 'f')

import { initCore, loadRobot, snapshotInitialPose, restoreInitialPose, boxCenter, boxMax, tweenOrbits } from './core/ViewerCore.js';
import { applyGlobalTheme, enhanceButtons } from './Theme.js';
import { createComponentsPanel } from './ui/ComponentsPanel.js';
import { createToolsDock } from './ui/ToolsDock.js';
import { attachInteraction } from './interaction/SelectionAndDrag.js';

export function render(opts = {}) {
  const { container, urdfContent, meshDB, selectMode = 'link', background = 0xffffff, clickAudioDataURL = null } = opts;
  if (!container) throw new Error('[urdf_viewer_main] container requerido');

  // estilo
  applyGlobalTheme(document); enhanceButtons(document);
  // exponer meshDB global para URDFLoader
  window.__AMC_meshDB__ = meshDB || {};

  const core = { boxCenter, boxMax, tweenOrbits, restoreInitialPose };
  let app = { };

  (async () => {
    const coreCtx = await initCore({ container, background });
    Object.assign(app, coreCtx);

    const { robot } = await loadRobot({ urdfContent, meshDB, selectMode });
    app.robot = robot; app.scene.add(robot);
    snapshotInitialPose(robot);

    // UI
    const components = createComponentsPanel({
      container,
      onPick: (obj, name) => { api.setSelection(obj); }
    });
    const tools = createToolsDock({
      container,
      navigateToView: (view) => api.navigateToViewFixedDistance(view, 750)
    });

    // Interaction
    const inter = attachInteraction({
      scene: app.scene, camera: app.camera, controls: app.controls, renderer: app.renderer,
      robot, ui: { components, tools }, coreAPI: core
    });

    // API pública
    const api = app.api = {
      ...coreCtx,
      robot,
      getSelection: inter.getSelection,
      setSelection: inter.setSelection,
      toggleComponents: components.toggle,
      toggleTools: tools.toggle,
      restoreInitialPose: () => restoreInitialPose(robot),
      navigateToViewFixedDistance: (view, ms = 700) => {
        const THREE = window.THREE;
        const obj = inter.getSelection() || robot;
        const center = boxCenter(obj) || boxCenter(robot);
        const L = boxMax(robot);
        const fov = (app.camera.fov || 60) * Math.PI / 180;
        const dist = (L * 0.8) / Math.tan(fov / 2);
        let az, el;
        switch (String(view).toLowerCase()) {
          case 'iso': az = 45*Math.PI/180; el = 25*Math.PI/180; break;
          case 'top': az = 0; el = Math.PI/2 - 1e-3; break;
          case 'front': az = Math.PI/2; el = 0; break;
          case 'right': az = 0; el = 0; break;
          default: az = 45*Math.PI/180; el = 25*Math.PI/180;
        }
        const dir = new THREE.Vector3(Math.cos(el)*Math.cos(az), Math.sin(el), Math.cos(el)*Math.sin(az)).normalize();
        const toPos = center.clone().add(dir.multiplyScalar(dist));
        tweenOrbits(app.camera, app.controls, { toPos, toTarget: center, ms });
      },
      resetAll: ({ tweenMs = 800 } = {}) => {
        try {
          if (robot.setJointValue && robot.joints) Object.keys(robot.joints).forEach(n => robot.setJointValue(n, 0));
          else if (robot.joints) Object.values(robot.joints).forEach(j => { if ('angle' in j) j.angle = 0; if ('position' in j) j.position = 0; });
        } catch {}
        try { restoreInitialPose(robot); } catch {}
        api.navigateToViewFixedDistance('iso', tweenMs);
      },
      destroy: () => { inter.onDestroy(); coreCtx.destroy(); }
    };

    // construir lista una sola vez (lazy: aquí o al abrir con components.toggle())
    components.buildOnce(robot);

    // pos inicial: ISO
    api.navigateToViewFixedDistance('iso', 600);
  })();

  return app;
}
