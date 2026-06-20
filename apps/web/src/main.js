import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import * as fabric from 'fabric';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const API = '/api/v1';
const SCALE = 1.5;

const state = { docId: null, viewports: [], fabrics: [], activePage: 0 };

const $ = (id) => document.getElementById(id);
const pagesEl = $('pages');

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
  state.viewports = [];
  state.fabrics = [];
  for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1);
    const viewport = page.getViewport({ scale: SCALE });
    state.viewports[i] = viewport;

    const wrap = document.createElement('div');
    wrap.className = 'page-wrap';
    wrap.dataset.page = i;
    wrap.addEventListener('click', () => (state.activePage = i));

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

    const fl = document.createElement('div');
    fl.className = 'field-layer';
    fields.filter((f) => f.page === i).forEach((f) => fl.appendChild(fieldInput(f, viewport)));
    wrap.appendChild(fl);

    pagesEl.appendChild(wrap);
  }
}

function fieldInput(f, viewport) {
  const [x0, y0, x1, y1] = f.rect;
  const r = viewport.convertToViewportRectangle([x0, y0, x1, y1]);
  const left = Math.min(r[0], r[2]);
  const top = Math.min(r[1], r[3]);
  const w = Math.max(Math.abs(r[2] - r[0]), 10);
  const h = Math.max(Math.abs(r[3] - r[1]), 14);
  const el = document.createElement('input');
  el.className = 'field-input';
  el.dataset.name = f.name;
  el.style.left = left + 'px';
  el.style.top = top + 'px';
  if (f.type === 'checkbox') {
    el.type = 'checkbox';
    el.checked = f.value !== null && f.value !== false && f.value !== 'Off';
    el.style.width = Math.min(w, 20) + 'px';
    el.style.height = Math.min(h, 20) + 'px';
  } else {
    el.type = 'text';
    if (f.value) el.value = String(f.value);
    el.placeholder = f.name;
    el.style.width = w + 'px';
    el.style.height = h + 'px';
  }
  return el;
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
  document.querySelectorAll('.field-input').forEach((el) => {
    const val = el.type === 'checkbox' ? el.checked : el.value;
    if (el.type === 'checkbox' ? val : val.trim() !== '') fields[el.dataset.name] = val;
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
