import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import * as fabric from 'fabric';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const API = '/api/v1';
const SCALE = 1.5;

const state = { docId: null, viewports: [], fabrics: [], pageWraps: [], activePage: 0 };

const $ = (id) => document.getElementById(id);
const pagesEl = $('pages');
const thumbsEl = $('thumbs');

$('file').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) openPdf(f);
});

async function openPdf(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${API}/documents`, { method: 'POST', body: fd });
  if (!res.ok) return alert(`Upload failed: ${(await res.json()).detail}`);
  const meta = await res.json();
  state.docId = meta.id;
  await renderPdf(await file.arrayBuffer(), meta.fields);
  for (const id of ['add-text', 'img', 'download']) $(id).disabled = false;
}

async function renderPdf(buf, fields) {
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  pagesEl.innerHTML = '';
  thumbsEl.innerHTML = '';
  state.viewports = [];
  state.fabrics = [];
  state.pageWraps = [];
  for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1);
    const viewport = page.getViewport({ scale: SCALE });
    state.viewports[i] = viewport;

    const wrap = document.createElement('div');
    wrap.className = 'page-wrap';
    wrap.style.width = viewport.width + 'px';
    wrap.style.height = viewport.height + 'px';
    wrap.dataset.page = i;
    wrap.style.display = 'none';

    const pdfCanvas = document.createElement('canvas');
    pdfCanvas.className = 'pdf-layer';
    pdfCanvas.width = viewport.width;
    pdfCanvas.height = viewport.height;
    await page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport }).promise;
    wrap.appendChild(pdfCanvas);

    const fEl = document.createElement('canvas');
    wrap.appendChild(fEl);
    const fc = new fabric.Canvas(fEl, { width: viewport.width, height: viewport.height });
    state.fabrics[i] = fc;
    wireContextMenu(fc);

    const fl = document.createElement('div');
    fl.className = 'field-layer';
    fields.filter((f) => f.page === i).forEach((f) => fl.appendChild(fieldInput(f, viewport)));
    wrap.appendChild(fl);

    pagesEl.appendChild(wrap);
    state.pageWraps[i] = wrap;
    thumbsEl.appendChild(thumbnail(i, pdfCanvas));
  }
  setActivePage(0);
}

function thumbnail(i, srcCanvas) {
  const item = document.createElement('button');
  item.className = 'thumb';
  item.dataset.page = i;
  const tw = 150;
  const th = Math.round(srcCanvas.height * (tw / srcCanvas.width));
  const c = document.createElement('canvas');
  c.width = tw;
  c.height = th;
  c.getContext('2d').drawImage(srcCanvas, 0, 0, tw, th);
  const label = document.createElement('span');
  label.textContent = 'Page ' + (i + 1);
  item.append(c, label);
  item.addEventListener('click', () => setActivePage(i));
  return item;
}

function setActivePage(i) {
  state.activePage = i;
  state.pageWraps.forEach((w, idx) => {
    if (w) w.style.display = idx === i ? '' : 'none';
  });
  thumbsEl.querySelectorAll('.thumb').forEach((t) =>
    t.classList.toggle('active', +t.dataset.page === i),
  );
}

function fieldInput(f, viewport) {
  const [x0, y0, x1, y1] = f.rect;
  const r = viewport.convertToViewportRectangle([x0, y0, x1, y1]);
  const left = Math.min(r[0], r[2]);
  const top = Math.min(r[1], r[3]);
  const w = Math.max(Math.abs(r[2] - r[0]), 10);
  const h = Math.max(Math.abs(r[3] - r[1]), 14);

  if (f.type === 'checkbox') {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.className = 'field-input';
    el.dataset.name = f.name;
    const initial = f.value !== null && f.value !== false && f.value !== 'Off';
    el.checked = initial;
    el.dataset.initial = String(initial);
    el.addEventListener('change', () => {
      el.classList.toggle('override', String(el.checked) !== el.dataset.initial);
    });
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.style.width = Math.min(w, 20) + 'px';
    el.style.height = Math.min(h, 20) + 'px';
    return el;
  }

  // Comb field: one character per cell across max_len cells.
  if (f.comb && f.max_len) {
    const wrap = document.createElement('div');
    wrap.className = 'comb-field';
    wrap.style.left = left + 'px';
    wrap.style.top = top + 'px';
    wrap.style.width = w + 'px';
    wrap.style.height = h + 'px';
    const initial = f.value ? String(f.value) : '';
    for (let i = 0; i < f.max_len; i++) {
      const c = document.createElement('input');
      c.type = 'text';
      c.maxLength = 1;
      c.className = 'field-input comb-cell';
      c.placeholder = ' ';
      c.value = initial[i] || '';
      c.dataset.name = f.name;
      c.dataset.comb = '1';
      c.dataset.cell = i;
      wireCombCell(c);
      wrap.appendChild(c);
    }
    return wrap;
  }

  const el = document.createElement('input');
  el.type = 'text';
  el.className = 'field-input';
  el.dataset.name = f.name;
  el.placeholder = ' ';
  if (f.value) el.value = String(f.value);
  if (f.max_len) el.maxLength = f.max_len;
  el.style.left = left + 'px';
  el.style.top = top + 'px';
  el.style.width = w + 'px';
  el.style.height = h + 'px';
  return el;
}

// Auto-advance comb cells: a character jumps to the next box, Backspace jumps back.
function wireCombCell(c) {
  c.addEventListener('input', () => {
    if (c.value.length >= 1 && c.nextElementSibling) c.nextElementSibling.focus();
  });
  c.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !c.value && c.previousElementSibling) {
      c.previousElementSibling.focus();
    }
  });
}

$('add-text').addEventListener('click', () => {
  const fc = state.fabrics[state.activePage];
  if (!fc) return;
  fc.add(new fabric.Textbox('Double-click to edit', {
    left: 50, top: 50, width: 200, fontSize: 16, fill: '#111',
  }));
});

$('img').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) addImage(f, state.activePage, 50, 50);
  e.target.value = '';
});

async function addImage(file, i, x, y) {
  const src = await readDataUrl(file);
  const img = await fabric.FabricImage.fromURL(src);
  img.set({ left: x, top: y, _src: src });
  img.scaleToWidth(160);
  state.fabrics[i].add(img);
}

function readDataUrl(file) {
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.readAsDataURL(file);
  });
}

// --- Delete overlays: keyboard (Del/Backspace) + right-click menu. ---
// Guard so typing in field inputs / editing text never triggers deletion.
function isTyping(e) {
  const tag = (e.target.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Backspace' && e.key !== 'Delete') return;
  if (isTyping(e)) return;
  const fc = state.fabrics[state.activePage];
  const obj = fc && fc.getActiveObject();
  if (!obj || obj.isEditing) return;
  e.preventDefault();
  fc.remove(obj);
  fc.discardActiveObject();
  fc.requestRenderAll();
});

const ctxMenu = document.createElement('div');
ctxMenu.className = 'ctx-menu';
ctxMenu.innerHTML = '<button type="button">Delete</button>';
document.body.appendChild(ctxMenu);
let ctxFc = null, ctxObj = null;
ctxMenu.querySelector('button').addEventListener('click', () => {
  if (ctxFc && ctxObj) { ctxFc.remove(ctxObj); ctxFc.requestRenderAll(); }
  ctxMenu.style.display = 'none';
});
document.addEventListener('click', () => (ctxMenu.style.display = 'none'));
document.addEventListener('contextmenu', (e) => {
  if (e.target.closest('.canvas-container')) e.preventDefault(); // suppress browser menu over fabric
});

function wireContextMenu(fc) {
  fc.on('mouse:down', (opt) => {
    const right = opt.e.button === 2 || opt.e.which === 3;
    if (!right || !opt.target) return;
    opt.e.preventDefault();
    ctxFc = fc;
    ctxObj = opt.target;
    ctxMenu.style.display = 'block';
    ctxMenu.style.left = opt.e.clientX + 'px';
    ctxMenu.style.top = opt.e.clientY + 'px';
  });
}

// Drag & drop images onto a page.
pagesEl.addEventListener('dragover', (e) => e.preventDefault());
pagesEl.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  const wrap = e.target.closest('.page-wrap');
  const i = wrap ? +wrap.dataset.page : state.activePage;
  const rect = wrap.getBoundingClientRect();
  addImage(file, i, e.clientX - rect.left, e.clientY - rect.top);
});

$('download').addEventListener('click', async () => {
  if (!state.docId) return;
  const fields = {};
  const comb = {};
  document.querySelectorAll('.field-input').forEach((el) => {
    const name = el.dataset.name;
    if (el.type === 'checkbox') {
      fields[name] = el.checked; // send bool always so unchecking clears it
    } else if (el.dataset.comb) {
      (comb[name] ||= [])[+el.dataset.cell] = el.value || '';
    } else if (el.value.trim() !== '') {
      fields[name] = el.value;
    }
  });
  Object.entries(comb).forEach(([name, arr]) => {
    const joined = arr.join('');
    if (joined.trim()) fields[name] = joined;
  });
  const overlays = [];
  for (let i = 0; i < state.fabrics.length; i++) {
    const vp = state.viewports[i];
    for (const obj of state.fabrics[i].getObjects()) {
      const b = obj.getBoundingRect();
      const [ax, ay] = vp.convertToPdfPoint(b.left, b.top);
      const [bx, by] = vp.convertToPdfPoint(b.left + b.width, b.top + b.height);
      const rect = [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
      if (obj instanceof fabric.Textbox) {
        overlays.push({ kind: 'text', page: i, rect, value: obj.text, font_size: obj.fontSize / SCALE });
      } else if (obj._src) {
        overlays.push({ kind: 'image', page: i, rect, src: obj._src });
      }
    }
  }
  const res = await fetch(`${API}/documents/${state.docId}/fill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields, overlays }),
  });
  if (!res.ok) return alert(`Fill failed: ${(await res.json()).detail}`);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await res.blob());
  a.download = 'filled.pdf';
  a.click();
  URL.revokeObjectURL(a.href);
});
