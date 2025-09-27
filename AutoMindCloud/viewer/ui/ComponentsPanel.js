// /viewer/ui/ComponentsPanel.js
// Components/parts list panel

import { createButton } from './ui_utils.js';

/**
 * Creates a components/parts list panel
 * @param {Object} app - The main app facade
 * @param {Object} theme - Theme colors
 * @returns {Object} { destroy() }
 */
export function createComponentsPanel(app, theme) {
  const { container, assets, isolate } = app;
  
  // Create panel container
  const panelDiv = document.createElement('div');
  panelDiv.className = 'urdf-components-panel';
  Object.assign(panelDiv.style, {
    position: 'absolute',
    top: '10px',
    left: '10px',
    width: '300px',
    maxHeight: '80vh',
    background: theme.bgPanel || '#ffffff',
    border: `1px solid ${theme.border || '#cccccc'}`,
    borderRadius: '8px',
    padding: '12px',
    fontFamily: 'Arial, sans-serif',
    fontSize: '14px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
    zIndex: '1000',
    overflowY: 'auto'
  });

  // Title
  const title = document.createElement('h3');
  title.textContent = 'Robot Components';
  title.style.margin = '0 0 15px 0';
  title.style.color = theme.textPrimary || '#333333';
  panelDiv.appendChild(title);

  // Search box
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search components...';
  searchInput.style.cssText = `
    width: 100%;
    padding: 8px;
    margin-bottom: 15px;
    border: 1px solid #ddd;
    border-radius: 4px;
    box-sizing: border-box;
  `;
  panelDiv.appendChild(searchInput);

  // Components list container
  const listDiv = document.createElement('div');
  panelDiv.appendChild(listDiv);

  // Load and display components
  let allComponents = [];
  let currentFilter = '';

  function loadComponents() {
    allComponents = assets.list();
    filterComponents();
  }

  function filterComponents() {
    listDiv.innerHTML = '';
    
    const filtered = allComponents.filter(comp => 
      comp.base.toLowerCase().includes(currentFilter.toLowerCase()) ||
      comp.ext.toLowerCase().includes(currentFilter.toLowerCase())
    );

    if (filtered.length === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.textContent = 'No components found';
      emptyMsg.style.textAlign = 'center';
      emptyMsg.style.color = '#999';
      emptyMsg.style.padding = '20px';
      listDiv.appendChild(emptyMsg);
      return;
    }

    filtered.forEach(comp => {
      const compDiv = document.createElement('div');
      compDiv.style.cssText = `
        border: 1px solid #eee;
        border-radius: 6px;
        padding: 10px;
        margin-bottom: 8px;
        background: #fafafa;
      `;

      // Header with name and count
      const headerDiv = document.createElement('div');
      headerDiv.style.display = 'flex';
      headerDiv.style.justifyContent = 'space-between';
      headerDiv.style.alignItems = 'center';
      headerDiv.style.marginBottom = '8px';

      const nameDiv = document.createElement('div');
      nameDiv.style.fontWeight = 'bold';
      nameDiv.textContent = comp.base;
      
      const countDiv = document.createElement('div');
      countDiv.style.background = '#666';
      countDiv.style.color = 'white';
      countDiv.style.padding = '2px 6px';
      countDiv.style.borderRadius = '10px';
      countDiv.style.fontSize = '12px';
      countDiv.textContent = comp.count;

      headerDiv.appendChild(nameDiv);
      headerDiv.appendChild(countDiv);
      compDiv.appendChild(headerDiv);

      // File info
      const fileDiv = document.createElement('div');
      fileDiv.style.color: '#666';
      fileDiv.style.fontSize: '12px';
      fileDiv.style.marginBottom: '8px';
      fileDiv.textContent = `${comp.assetKey} (${comp.ext.toUpperCase()})`;
      compDiv.appendChild(fileDiv);

      // Actions
      const actionsDiv = document.createElement('div');
      actionsDiv.style.display = 'flex';
      actionsDiv.style.gap: '8px';

      const isolateBtn = createButton('Isolate', () => {
        isolate.asset(comp.assetKey);
        if (window.__urdf_click__) window.__urdf_click__();
      });
      isolateBtn.style.flex = '1';

      const showAllBtn = createButton('Show All', () => {
        isolate.clear();
        if (window.__urdf_click__) window.__urdf_click__();
      });
      showAllBtn.style.flex = '1';

      actionsDiv.appendChild(isolateBtn);
      actionsDiv.appendChild(showAllBtn);
      compDiv.appendChild(actionsDiv);

      listDiv.appendChild(compDiv);
    });
  }

  // Search functionality
  searchInput.addEventListener('input', (e) => {
    currentFilter = e.target.value;
    filterComponents();
  });

  // Initial load
  loadComponents();

  // Add to container
  container.appendChild(panelDiv);

  function destroy() {
    if (panelDiv.parentNode) {
      panelDiv.parentNode.removeChild(panelDiv);
    }
  }

  return {
    destroy
  };
}
