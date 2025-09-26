// Theme.js — estilo global teal-white y helper para botones

export function applyGlobalTheme(root = document) {
  const id = '__am_theme__';
  if (root.getElementById(id)) return;
  const style = root.createElement('style'); style.id = id;
  style.textContent = `
  :root{
    --teal:#0ea5a6; --dark-teal:#0b3b3c; --light-teal:#d7e7e7;
    --white:#fff; --shadow:0 4px 12px rgba(0,0,0,.08); --shadow-hover:0 8px 24px rgba(0,0,0,.12);
  }
  .am-btn{
    background:var(--white); color:#111; border:1px solid var(--light-teal); border-radius:10px;
    padding:8px 12px; font-weight:700; font-size:13px; cursor:pointer; box-shadow:var(--shadow);
    transition:transform .12s ease, box-shadow .12s ease, background .12s ease, color .12s ease, border-color .12s ease;
  }
  .am-btn:hover{ background:var(--teal); color:#fff; border-color:var(--teal); transform:translateY(-1px); box-shadow:var(--shadow-hover); }
  .am-btn:active{ transform:translateY(0); box-shadow:var(--shadow); }
  `;
  root.head.appendChild(style);
}

export function enhanceButtons(root = document) {
  const btns = root.querySelectorAll('button');
  btns.forEach(b => b.classList.add('am-btn'));
}
