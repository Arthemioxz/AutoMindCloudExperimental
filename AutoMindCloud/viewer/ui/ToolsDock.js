// /viewer/ui/ToolsDock.js
// Tools panel with camera controls, display options, etc.

import { createButton, createSlider, createCheckbox, createLabel } from './ui_utils.js';

/**
 * Creates a dockable tools panel
 * @param {Object} app - The main app facade
 * @param {Object} theme - Theme colors
 * @returns {Object} { set(open), destroy() }
 */
export function createToolsDock(app, theme) {
  const { container, robot, camera, controls, fitAndCenter } = app;
  
  // Create tools container
  const toolsDiv = document.createElement('div');
  toolsDiv.className = 'urdf-tools-dock';
  Object.assign(toolsDiv.style, {
    position: 'absolute',
    top: '10px',
    right: '10px',
    width: '250px',
    background: theme.bgPanel || '#ffffff',
    border: `1px solid ${theme.border || '#cccccc'}`,
    borderRadius: '8px',
    padding: '12px',
    fontFamily: 'Arial, sans-serif',
    fontSize: '14px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
    zIndex: '1000',
    transition: 'transform 0.3s ease, opacity 0.3s ease',
    transform: 'translateX(0)',
    opacity: '1'
  });

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.title = 'Close tools';
  Object.assign(closeBtn.style, {
    position: 'absolute',
    top: '5px',
    right: '5px',
    background: 'none',
    border: 'none',
    fontSize: '18px',
    cursor: 'pointer',
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  });
  closeBtn.onmouseover = () => closeBtn.style.background = '#f0f0f0';
  closeBtn.onmouseout = () => closeBtn.style.background = 'none';
  
  let isOpen = true;
  closeBtn.onclick = () => setOpen(false);

  toolsDiv.appendChild(closeBtn);

  // Title
  const title = document.createElement('h3');
  title.textContent = 'Viewer Tools';
  title.style.margin = '0 0 15px 0';
  title.style.color = theme.textPrimary || '#333333';
  toolsDiv.appendChild(title);

  // Camera Controls Section
  const camSection = createSection('Camera Controls');
  toolsDiv.appendChild(camSection);

  // Reset camera button
  const resetCamBtn = createButton('Reset View', () => {
    if (robot) fitAndCenter(robot, 1.06);
    if (window.__urdf_click__) window.__urdf_click__();
  });
  camSection.appendChild(resetCamBtn);

  // Camera type toggle
  const camTypeDiv = document.createElement('div');
  camTypeDiv.style.marginBottom = '10px';
  
  const camLabel = createLabel('Camera:');
  camTypeDiv.appendChild(camLabel);
  
  const camToggle = createCheckbox(camera.isPerspectiveCamera, (checked) => {
    if (checked) {
      // Switch to perspective
      const aspect = camera.aspect || 1;
      const newCam = new THREE.PerspectiveCamera(60, aspect, 0.01, 10000);
      newCam.position.copy(camera.position);
      newCam.quaternion.copy(camera.quaternion);
      
      // Replace camera
      app.camera = newCam;
      controls.object = newCam;
      app.setCamera(newCam);
    } else {
      // Switch to orthographic
      const dim = 10;
      const newCam = new THREE.OrthographicCamera(-dim, dim, dim, -dim, 0.01, 10000);
      newCam.position.copy(camera.position);
      newCam.quaternion.copy(camera.quaternion);
      
      app.camera = newCam;
      controls.object = newCam;
      app.setCamera(newCam);
    }
    if (window.__urdf_click__) window.__urdf_click__();
  });
  camToggle.textContent = camera.isPerspectiveCamera ? 'Perspective' : 'Orthographic';
  camTypeDiv.appendChild(camToggle);
  camSection.appendChild(camTypeDiv);

  // Display Options Section
  const displaySection = createSection('Display Options');
  toolsDiv.appendChild(displaySection);

  // Background color
  const bgDiv = document.createElement('div');
  bgDiv.style.marginBottom = '10px';
  
  const bgLabel = createLabel('Background:');
  bgDiv.appendChild(bgLabel);
  
  const bgInput = document.createElement('input');
  bgInput.type = 'color';
  bgInput.value = `#${(theme.bgCanvas || 0xffffff).toString(16).padStart(6, '0')}`;
  bgInput.style.marginLeft = '10px';
  bgInput.onchange = (e) => {
    app.renderer.setClearColor(parseInt(e.target.value.slice(1), 16));
    if (window.__urdf_click__) window.__urdf_click__();
  };
  bgDiv.appendChild(bgInput);
  displaySection.appendChild(bgDiv);

  // Grid toggle
  let gridVisible = true;
  const grid = findGrid(app.scene);
  
  const gridToggle = createCheckbox(gridVisible, (checked) => {
    gridVisible = checked;
    if (grid) grid.visible = checked;
    if (window.__urdf_click__) window.__urdf_click__();
  });
  gridToggle.textContent = 'Show Grid';
  displaySection.appendChild(gridToggle);

  // Axes toggle
  let axesVisible = true;
  const axes = findAxes(app.scene);
  
  const axesToggle = createCheckbox(axesVisible, (checked) => {
    axesVisible = checked;
    if (axes) axes.visible = checked;
    if (window.__urdf_click__) window.__urdf_click__();
  });
  axesToggle.textContent = 'Show Axes';
  displaySection.appendChild(axesToggle);

  // Animation Section (if robot has joints)
  const joints = robot ? collectJoints(robot) : [];
  if (joints.length > 0) {
    const animSection = createSection('Joint Controls');
    toolsDiv.appendChild(animSection);

    joints.forEach(joint => {
      const jointDiv = document.createElement('div');
      jointDiv.style.marginBottom = '8px';
      
      const label = createLabel(`${joint.name}:`);
      jointDiv.appendChild(label);
      
      const slider = createSlider(
        joint.limit?.lower ?? -Math.PI,
        joint.limit?.upper ?? Math.PI,
        joint.angle ?? 0,
        0.01,
        (value) => {
          joint.setAngle(value);
          if (window.__urdf_click__) window.__urdf_click__();
        }
      );
      jointDiv.appendChild(slider);
      
      animSection.appendChild(jointDiv);
    });

    // Reset all joints button
    const resetJointsBtn = createButton('Reset All Joints', () => {
      joints.forEach(joint => {
        joint.setAngle(0);
        // Update sliders if they exist
        const sliders = animSection.querySelectorAll('input[type="range"]');
        sliders.forEach(slider => {
          if (slider.value !== '0') slider.value = 0;
        });
      });
      if (window.__urdf_click__) window.__urdf_click__();
    });
    animSection.appendChild(resetJointsBtn);
  }

  // Add to container
  container.appendChild(toolsDiv);

  function setOpen(open) {
    isOpen = open;
    if (open) {
      toolsDiv.style.transform = 'translateX(0)';
      toolsDiv.style.opacity = '1';
    } else {
      toolsDiv.style.transform = 'translateX(300px)';
      toolsDiv.style.opacity = '0';
    }
  }

  function destroy() {
    if (toolsDiv.parentNode) {
      toolsDiv.parentNode.removeChild(toolsDiv);
    }
  }

  // Return public API
  return {
    set: setOpen,
    destroy
  };
}

function createSection(title) {
  const section = document.createElement('div');
  section.style.marginBottom = '20px';
  
  const header = document.createElement('h4');
  header.textContent = title;
  header.style.margin = '0 0 10px 0';
  header.style.color = '#666666';
  header.style.fontSize = '12px';
  header.style.textTransform = 'uppercase';
  header.style.letterSpacing = '1px';
  
  section.appendChild(header);
  return section;
}

function findGrid(scene) {
  let grid = null;
  scene.traverse(obj => {
    if (obj.isGridHelper) grid = obj;
  });
  return grid;
}

function findAxes(scene) {
  let axes = null;
  scene.traverse(obj => {
    if (obj.isAxesHelper) axes = obj;
  });
  return axes;
}

function collectJoints(robot) {
  const joints = [];
  robot.traverse(obj => {
    if (obj.jointType !== undefined && obj.setAngle) {
      joints.push(obj);
    }
  });
  return joints;
}
