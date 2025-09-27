// /viewer/ui/ui_utils.js
// Reusable UI component factories

export function createButton(text, onClick) {
  const button = document.createElement('button');
  button.textContent = text;
  button.style.cssText = `
    width: 100%;
    padding: 8px 12px;
    margin: 2px 0;
    border: 1px solid #ddd;
    border-radius: 4px;
    background: #f8f9fa;
    cursor: pointer;
    font-size: 14px;
  `;
  button.onmouseover = () => button.style.background = '#e9ecef';
  button.onmouseout = () => button.style.background = '#f8f9fa';
  button.onclick = onClick;
  return button;
}

export function createSlider(min, max, value, step, onChange) {
  const container = document.createElement('div');
  container.style.display = 'flex';
  container.style.alignItems = 'center';
  container.style.gap = '10px';
  
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = min;
  slider.max = max;
  slider.value = value;
  slider.step = step;
  slider.style.flex = '1';
  
  const valueDisplay = document.createElement('span');
  valueDisplay.textContent = value.toFixed(2);
  valueDisplay.style.minWidth = '40px';
  valueDisplay.style.textAlign = 'right';
  valueDisplay.style.fontFamily = 'monospace';
  
  slider.oninput = (e) => {
    const val = parseFloat(e.target.value);
    valueDisplay.textContent = val.toFixed(2);
    onChange(val);
  };
  
  container.appendChild(slider);
  container.appendChild(valueDisplay);
  return container;
}

export function createCheckbox(checked, onChange) {
  const label = document.createElement('label');
  label.style.display = 'flex';
  label.style.alignItems = 'center';
  label.style.cursor = 'pointer';
  label.style.margin = '4px 0';
  
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = checked;
  checkbox.style.margin = '0 8px 0 0';
  
  const text = document.createElement('span');
  
  checkbox.onchange = (e) => onChange(e.target.checked);
  
  label.appendChild(checkbox);
  label.appendChild(text);
  
  // Return the label but expose text content setter
  label.setText = (content) => text.textContent = content;
  return label;
}

export function createLabel(text) {
  const label = document.createElement('span');
  label.textContent = text;
  label.style.display = 'block';
  label.style.marginBottom = '4px';
  label.style.fontWeight = 'bold';
  label.style.color: '#555';
  return label;
}
