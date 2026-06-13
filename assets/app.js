
/* ── pdf.js worker (blob-loaded to avoid the "fake worker" cross-origin fallback) ── */
const WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const workerReady = (async () => {
  try {
    const code = await (await fetch(WORKER_URL)).text();
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  } catch (e) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;
  }
})();

/* ── Lazy library loading (expensive deps only on demand) ── */
const lazyLibs = { tesseract: false, html2canvas: false, jspdf: false, docxpreview: false };
const lazyPromises = {};
async function ensureLib(name) {
  if (!lazyLibs.hasOwnProperty(name)) return true;
  if (lazyLibs[name]) return true;
  const windowKeys = { jspdf: 'jspdf', html2canvas: 'html2canvas', tesseract: 'Tesseract', docxpreview: 'docx' };
  if (window[windowKeys[name]]) { lazyLibs[name] = true; return true; }
  if (lazyPromises[name]) return lazyPromises[name];
  const urls = {
    tesseract: 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.0.5/tesseract.min.js',
    html2canvas: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    docxpreview: 'https://cdn.jsdelivr.net/npm/docx-preview@0.3.7/dist/docx-preview.min.js',
  };
  lazyPromises[name] = new Promise(resolve => {
    const s = document.createElement('script');
    s.src = urls[name];
    s.onload = () => { lazyLibs[name] = true; resolve(true); };
    s.onerror = () => { console.warn(`Failed to load ${name}`); resolve(false); };
    document.head.appendChild(s);
  });
  return lazyPromises[name];
}

async function openPdf(buffer) {
  await workerReady;
  return pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
}

const { PDFDocument, StandardFonts, rgb, degrees } = PDFLib;
const state = { word2pdf: [], pdf2word: [], ocr: [], img2pdf: [], pdf2img: [], merge: [], split: [], compress: [], organize: [], watermark: [], pagenum: [], metadata: [] };
const SINGLE_TOOLS = ['word2pdf', 'pdf2word', 'ocr', 'pdf2img', 'split', 'compress', 'organize', 'watermark', 'pagenum', 'metadata'];
const REORDER_TOOLS = ['merge', 'img2pdf'];
const PAGE_SIZES = { a4: [595.28, 841.89], a4l: [841.89, 595.28], letter: [612, 792] };

let organizePages = [];

const $ = id => document.getElementById(id);
function on(id, ev, fn) { const el = $(id); if (el) el.addEventListener(ev, fn); }

/* ── Personality layer ───────────────── */
const QUIPS = [
  'Feeding paper into the press…',
  'Convincing pixels to cooperate…',
  'Politely negotiating with the PDF spec…',
  'Stapling bits together…',
  'Aligning electrons very carefully…',
  'Asking the bytes to form an orderly queue…',
  'Applying ink (digitally, no mess)…',
  'Doing the thing. The thing is being done…',
];
const TAGLINES = [
  'Thirteen tools. Zero servers. Your files never leave your device.',
  'The only PDF site that has literally never seen a PDF.',
  'Word ⇄ PDF, OCR in English, தமிழ் & සිංහල — all offline-grade private.',
  'No upload bar. Because there is no upload.',
  'Free forever. Our server costs are ₨ 0 — your browser is the server.',
];
let tagIdx = 0;
setInterval(() => {
  const el = $('tagline'); if (!el) return;
  el.classList.add('fade');
  setTimeout(() => {
    tagIdx = (tagIdx + 1) % TAGLINES.length;
    el.textContent = TAGLINES[tagIdx];
    el.classList.remove('fade');
  }, 350);
}, 6000);
on('logo', 'click', () => {
  $('logo').classList.remove('spin');
  void $('logo').offsetWidth;
  $('logo').classList.add('spin');
});
const randomQuip = () => QUIPS[Math.floor(Math.random() * QUIPS.length)];

function fmtSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(2) + ' MB';
}

function setStatus(key, msg, type = '', progress = null, quip = false) {
  const el = $(key + '-status');
  el.className = 'status' + (type ? ' ' + type : '');
  el.innerHTML = '';
  if (type === 'busy') el.insertAdjacentHTML('beforeend', '<div class="spinner"></div>');
  const span = document.createElement('span');
  span.textContent = msg;
  el.appendChild(span);
  if (progress !== null) {
    el.insertAdjacentHTML('beforeend',
      `<div class="progress-bar"><div style="width:${progress}%"></div></div>`);
  }
  if (quip && type === 'busy') {
    const q = document.createElement('div');
    q.className = 'quip';
    q.textContent = randomQuip();
    el.appendChild(q);
  }
}

function download(bytes, filename, mime) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function mkBtn(label, aria, fn) {
  const b = document.createElement('button');
  b.className = 'icon-btn'; b.textContent = label; b.setAttribute('aria-label', aria);
  b.addEventListener('click', fn);
  return b;
}

function baseNameOf(file, ext) {
  return file.name.replace(new RegExp('\\.' + ext + '$', 'i'), '');
}

function renderFileList(key) {
  const reorder = REORDER_TOOLS.includes(key);
  const wrap = $(key + '-files');
  wrap.innerHTML = '';
  state[key].forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'file-row';
    const thumb = document.createElement('div');
    thumb.className = 'file-thumb';
    if (f.preview) thumb.style.backgroundImage = `url(${f.preview})`;
    else thumb.textContent = f.kind === 'docx' ? 'DOCX' : f.kind === 'img' ? 'IMG' : 'PDF';
    const meta = document.createElement('div');
    meta.className = 'file-meta';
    meta.innerHTML = `<div class="file-name"></div><div class="file-size">${fmtSize(f.file.size)}${f.pages ? ' · ' + f.pages + ' pages' : ''}</div>`;
    meta.querySelector('.file-name').textContent = f.file.name;
    const actions = document.createElement('div');
    actions.className = 'file-actions';
    if (reorder) {
      actions.append(
        mkBtn('↑', 'Move up', () => { if (i > 0) { [state[key][i-1], state[key][i]] = [state[key][i], state[key][i-1]]; renderFileList(key); } }),
        mkBtn('↓', 'Move down', () => { if (i < state[key].length - 1) { [state[key][i+1], state[key][i]] = [state[key][i], state[key][i+1]]; renderFileList(key); } })
      );
    }
    actions.append(mkBtn('✕', 'Remove file', () => {
      state[key].splice(i, 1);
      if (key === 'organize') { organizePages = []; $('organize-pages').innerHTML = ''; }
      renderFileList(key);
    }));
    row.append(thumb, meta, actions);
    wrap.appendChild(row);
  });
  updateRunBtn(key);
}

function updateRunBtn(key) {
  const min = key === 'merge' ? 2 : 1;
  const empty = state[key].length < min;
  $(key + '-run').disabled = empty;
  const extra = $(key + '-print');
  if (extra) extra.disabled = empty;
}

/* ── Drop zones & inputs ─────────────── */
document.querySelectorAll('.tray').forEach(tray => {
  const input = $(tray.dataset.input);
  tray.addEventListener('click', () => input.click());
  tray.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  ['dragover', 'dragenter'].forEach(ev => tray.addEventListener(ev, e => { e.preventDefault(); tray.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach(ev => tray.addEventListener(ev, e => { e.preventDefault(); tray.classList.remove('dragover'); }));
  tray.addEventListener('drop', e => handleFiles(input.id.replace('-input',''), e.dataTransfer.files));
  input.addEventListener('change', () => { handleFiles(input.id.replace('-input',''), input.files); input.value = ''; });
});

function acceptsFile(key, file) {
  if (key === 'img2pdf') return /^image\/(jpeg|png|webp)$/.test(file.type);
  if (key === 'word2pdf') return /\.docx$/i.test(file.name);
  if (key === 'ocr') return file.type === 'application/pdf' || /^image\/(jpeg|png)$/.test(file.type);
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}
const ACCEPT_MSG = {
  img2pdf: 'Only JPG, PNG, or WebP images are accepted.',
  word2pdf: 'Only .docx Word documents are accepted (older .doc files need to be re-saved as .docx).',
  ocr: 'Only PDF, JPG, or PNG files are accepted.',
};

async function handleFiles(key, fileList) {
  const single = SINGLE_TOOLS.includes(key);
  const accepted = [...fileList].filter(f => acceptsFile(key, f));
  if (!accepted.length) { setStatus(key, ACCEPT_MSG[key] || 'Only PDF files are accepted.', 'err'); return; }
  setStatus(key, '');

  if (single) state[key] = [];
  for (const file of accepted.slice(0, single ? 1 : 40)) {
    const entry = { file };
    if (key === 'img2pdf' || (key === 'ocr' && file.type.startsWith('image/'))) {
      entry.preview = URL.createObjectURL(file);
      entry.kind = 'img';
      if (key === 'ocr') entry.buffer = await file.arrayBuffer();
    } else if (key === 'word2pdf') {
      entry.kind = 'docx';
      entry.buffer = await file.arrayBuffer();
    } else {
      try {
        const buf = await file.arrayBuffer();
        const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
        entry.pages = doc.getPageCount();
        entry.buffer = buf;
        entry.kind = 'pdf';
        if (key === 'metadata') {
          $('metadata-title').value = doc.getTitle() || '';
          $('metadata-author').value = doc.getAuthor() || '';
          $('metadata-subject').value = doc.getSubject() || '';
          $('metadata-keywords').value = doc.getKeywords() || '';
        }
      } catch (err) {
        setStatus(key, `Couldn't read "${file.name}" — it may be corrupted or password-protected.`, 'err');
        continue;
      }
    }
    state[key].push(entry);
  }
  renderFileList(key);
  if (key === 'organize' && state.organize.length) buildOrganizeThumbnails();
}

/* ── Tabs ────────────────────────────── */
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('show'));
    tab.classList.add('active'); tab.setAttribute('aria-selected', 'true');
    $(tab.dataset.panel).classList.add('show');
  });
});

/* ── Shared text helpers ─────────────── */
function sanitizeLatin(s) {
  return s.replace(/\t/g, '    ')
          .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
          .replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...')
          .replace(/[^\x00-\xFF]/g, '?');
}

function wrapText(font, text, size, maxW) {
  const lines = [];
  for (const para of text.split('\n')) {
    if (!para.trim()) { lines.push(''); continue; }
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? line + ' ' + word : word;
      if (font.widthOfTextAtSize(test, size) <= maxW) line = test;
      else {
        if (line) lines.push(line);
        let w = word;
        while (font.widthOfTextAtSize(w, size) > maxW) {
          let cut = w.length;
          while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > maxW) cut--;
          lines.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        line = w;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function xmlEscape(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function buildDocxFromParagraphs(pages, keepBreaks) {
  const paraXml = [];
  pages.forEach((paras, pi) => {
    for (const para of paras) {
      paraXml.push(
        `<w:p><w:pPr><w:spacing w:after="160"/></w:pPr><w:r><w:t xml:space="preserve">${xmlEscape(para)}</w:t></w:r></w:p>`
      );
    }
    if (keepBreaks && pi < pages.length - 1) {
      paraXml.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    }
  });
  if (!paraXml.length) paraXml.push('<w:p><w:r><w:t></w:t></w:r></w:p>');

  const documentXml =
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${paraXml.join('')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>
</w:body></w:document>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml',
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.file('_rels/.rels',
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.file('word/document.xml', documentXml);
  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  });
}

/* ── 1. Word → PDF ───────────────────── */
/* How big services (iLovePDF etc.) convert: your file is uploaded to a server
   running a full document layout engine (LibreOffice headless / MS Office) and
   the result is sent back. PaperPress never uploads, so it uses the closest
   local equivalent: the BROWSER's own layout engine renders the .docx as a
   real document — tables, borders, alignment, complex scripts — and that exact
   rendering is captured into the PDF page by page. */

const WORD_CSS = `
  .w2p-doc { font-family: Calibri,'Segoe UI',Arial,sans-serif; font-size: 11pt; line-height: 1.15; color: #000; word-wrap: break-word; }
  .w2p-doc p { margin: 0 0 10pt; }
  .w2p-doc h1 { font-family: 'Calibri Light',Calibri,sans-serif; font-size: 16pt; color: #2E74B5; font-weight: 700; border-bottom: 1px solid #2E74B5; padding-bottom: 3pt; margin: 12pt 0 4pt; }
  .w2p-doc h2 { font-family: 'Calibri Light',Calibri,sans-serif; font-size: 13pt; color: #2E74B5; font-weight: 700; margin: 10pt 0 4pt; }
  .w2p-doc h3 { font-family: 'Calibri Light',Calibri,sans-serif; font-size: 12pt; color: #1E4D78; font-weight: 700; margin: 8pt 0 3pt; }
  .w2p-doc h4 { font-family: 'Calibri Light',Calibri,sans-serif; font-size: 11.5pt; color: #2E74B5; font-style: italic; font-weight: 700; margin: 6pt 0 3pt; }
  .w2p-doc h5 { font-size: 11pt; color: #2E74B5; font-weight: 700; margin: 6pt 0 3pt; }
  .w2p-doc h6 { font-size: 11pt; color: #595959; font-style: italic; margin: 6pt 0 3pt; }
  .w2p-doc table { border-collapse: collapse; width: 100%; margin: 0 0 10pt; table-layout: auto; }
  .w2p-doc td, .w2p-doc th { border: 1px solid #000; padding: 3pt 5.4pt; vertical-align: top; font-size: 10.5pt; word-wrap: break-word; }
  .w2p-doc th { background: #F2F2F2; font-weight: 700; }
  .w2p-doc ul, .w2p-doc ol { margin: 0 0 10pt; padding-left: 36pt; }
  .w2p-doc li { margin-bottom: 0; line-height: 1.15; }
  .w2p-doc img { max-width: 100%; height: auto; display: block; }
  .w2p-doc a { color: #0563C1; text-decoration: underline; }
  .w2p-doc strong, .w2p-doc b { font-weight: 700; }
  .w2p-doc em, .w2p-doc i { font-style: italic; }
  .w2p-doc u { text-decoration: underline; }
  .w2p-doc s, .w2p-doc del, .w2p-doc strike { text-decoration: line-through; }
  .w2p-doc sup { vertical-align: super; font-size: 0.75em; line-height: 0; }
  .w2p-doc sub { vertical-align: sub; font-size: 0.75em; line-height: 0; }
  .w2p-doc blockquote { border-left: 3px solid #C0C0C0; margin: 0 0 10pt 18pt; padding-left: 10pt; color: #595959; }
  .w2p-doc pre, .w2p-doc code { font-family: 'Courier New',monospace; font-size: 10pt; background: #F2F2F2; padding: 1pt 3pt; }
  .w2p-doc hr { border: none; border-top: 1px solid #C0C0C0; margin: 10pt 0; }
  .w2p-doc p.no-spacing { margin-bottom: 0; }
  .w2p-doc p.list-indent { margin-left: 36pt; }
`;

async function docxToHtml(entry) {
  const styleMap = [
    "p[style-name='Normal'] => p:fresh",
    "p[style-name='Body Text'] => p:fresh",
    "p[style-name='No Spacing'] => p.no-spacing:fresh",
    "p[style-name='Quote'] => blockquote > p:fresh",
    "p[style-name='Intense Quote'] => blockquote > p:fresh",
    "p[style-name='List Paragraph'] => p.list-indent:fresh",
    "r[style-name='Strong'] => strong",
    "r[style-name='Emphasis'] => em",
    "r[style-name='Intense Emphasis'] => em > strong",
    "r[style-name='Subtle Reference'] => em",
    "r[style-name='Intense Reference'] => strong",
  ];
  const result = await mammoth.convertToHtml({
    arrayBuffer: entry.buffer.slice(0),
    styleMap,
    includeDefaultStyleMap: true,
    convertImage: mammoth.images.imgElement(image =>
      image.read('base64').then(data => ({ src: 'data:' + image.contentType + ';base64,' + data }))
    ),
  });
  return result.value;
}

function buildDocHolder(html, contentWidthPx) {
  const holder = document.createElement('div');
  holder.style.cssText = `position:absolute;left:-12000px;top:0;width:${contentWidthPx}px;background:#fff;`;
  holder.innerHTML = `<style>${WORD_CSS}</style><div class="w2p-doc">${html}</div>`;
  document.body.appendChild(holder);
  return holder;
}

async function waitForImages(root) {
  await Promise.all([...root.querySelectorAll('img')].map(img =>
    img.complete ? Promise.resolve() : new Promise(r => { img.onload = img.onerror = r; })));
}

on('word2pdf-mode', 'change', () => {
  const isLayout = $('word2pdf-mode').value === 'layout';
  const sizeField = $('word2pdf-size')?.closest('.field');
  if (sizeField) sizeField.style.display = isLayout ? 'none' : '';
});
$('word2pdf-mode')?.dispatchEvent(new Event('change'));

on('word2pdf-run', 'click', () => {
  const entry = state.word2pdf[0];
  const sizeKey = $('word2pdf-size').value;
  if ($('word2pdf-mode').value === 'layout') word2pdfLayout(entry, sizeKey);
  else word2pdfText(entry, sizeKey);
});

/* High-fidelity mode: docx-preview overlay in main window, window.print() with @media print CSS */
async function word2pdfLayout(entry, sizeKey) {
  document.getElementById('w2p-overlay')?.remove();
  document.getElementById('w2p-print-style')?.remove();
  let overlay = null;
  try {
    setStatus('word2pdf', 'Loading renderer…', 'busy', null, true);
    const ok = await ensureLib('docxpreview');
    if (!ok) {
      setStatus('word2pdf', 'Renderer unavailable — falling back to Print to PDF…', 'busy');
      const html = await docxToHtml(entry);
      if (!html.trim()) { setStatus('word2pdf', 'No readable content found.', 'err'); return; }
      const win = window.open('', '_blank');
      if (!win) { setStatus('word2pdf', 'Popup blocked — allow popups for this site and try again.', 'err'); return; }
      const sz = sizeKey === 'a4' ? 'A4' : 'letter';
      win.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + WORD_CSS +
        '@page{size:' + sz + ';margin:18mm}body{margin:0}</style></head><body><div class="w2p-doc">' + html + '</div></body></html>');
      win.document.close();
      setTimeout(() => { try { win.focus(); win.print(); } catch(e){} }, 700);
      setStatus('word2pdf', 'Print dialog opened — choose "Save as PDF".', 'ok');
      return;
    }

    setStatus('word2pdf', 'Rendering document…', 'busy', null, true);

    overlay = document.createElement('div');
    overlay.id = 'w2p-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9998;display:flex;flex-direction:column;';

    const safeTitle = entry.file.name.replace(/[<>&"]/g, '');
    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'flex-shrink:0;padding:10px 16px;background:#323639;display:flex;align-items:center;gap:10px;box-shadow:0 2px 4px rgba(0,0,0,.4);';
    toolbar.innerHTML = `<span style="color:#fff;font-family:'Space Grotesk',sans-serif;font-size:13px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${safeTitle}</span>` +
      `<span style="color:#aaa;font-family:sans-serif;font-size:11px;white-space:nowrap;flex-shrink:0">Print dialog → Margins: <b style="color:#fff">None</b>, Scale: <b style="color:#fff">100%</b></span>` +
      `<button id="w2p-save-btn" style="flex-shrink:0;padding:8px 20px;background:#1f4fd8;color:#fff;border:none;border-radius:8px;font-family:sans-serif;font-weight:700;font-size:13px;cursor:pointer">Save as PDF</button>` +
      `<button id="w2p-close-btn" style="flex-shrink:0;padding:8px 14px;background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:8px;font-family:sans-serif;font-size:13px;cursor:pointer">✕ Close</button>`;

    const scroll = document.createElement('div');
    scroll.id = 'w2p-scroll';
    scroll.style.cssText = 'flex:1;overflow:auto;background:#525659;padding:20px 0;';

    const docContainer = document.createElement('div');
    docContainer.id = 'w2p-doc';
    scroll.appendChild(docContainer);
    overlay.appendChild(toolbar);
    overlay.appendChild(scroll);

    const printStyle = document.createElement('style');
    printStyle.id = 'w2p-print-style';
    printStyle.textContent = `@media print{body>*:not(#w2p-overlay){display:none!important}body{background:#fff!important;margin:0!important}` +
      `#w2p-overlay{position:static!important;background:#fff!important;display:block!important;height:auto!important;overflow:visible!important}` +
      `#w2p-overlay>div:first-child{display:none!important}` +
      `#w2p-scroll{overflow:visible!important;background:#fff!important;padding:0!important;height:auto!important}` +
      `.docx-wrapper{background:#fff!important;padding:0!important}` +
      `.docx-wrapper>section{box-shadow:none!important;margin:0!important}` +
      `@page{size:auto;margin:0}}`;
    document.head.appendChild(printStyle);
    document.body.appendChild(overlay);

    await window.docx.renderAsync(entry.buffer.slice(0), docContainer, null, {
      className: 'docx', inWrapper: true,
      ignoreWidth: false, ignoreHeight: false,
      experimental: true,
      renderHeaders: true, renderFooters: true,
      renderFootnotes: true, renderEndnotes: true,
      useBase64URL: true,
    });

    const closeOverlay = () => {
      overlay?.remove(); overlay = null;
      document.getElementById('w2p-print-style')?.remove();
      setStatus('word2pdf', '', '');
    };
    overlay.querySelector('#w2p-save-btn').onclick = () => window.print();
    overlay.querySelector('#w2p-close-btn').onclick = closeOverlay;

    setStatus('word2pdf', 'Preview ready — click "Save as PDF" in the toolbar above.', 'ok');
  } catch (err) {
    console.error(err);
    overlay?.remove();
    document.getElementById('w2p-print-style')?.remove();
    setStatus('word2pdf', 'Render failed — try "Print to PDF" button instead.', 'err');
  }
}

/* Compact text mode: selectable text, simplified layout (Latin scripts) */
async function word2pdfText(entry, sizeKey) {
  const [PW, PH] = PAGE_SIZES[sizeKey];
  try {
    setStatus('word2pdf', 'Reading Word document…', 'busy', null, true);
    const html = await docxToHtml(entry);
    const holder = document.createElement('div');
    holder.innerHTML = html;

    const blocks = [];
    (function walk(node) {
      for (const el of node.children) {
        const tag = el.tagName.toLowerCase();
        if (/^h[1-6]$/.test(tag)) {
          const t = el.textContent.trim();
          if (t) blocks.push({ type: 'h', level: +tag[1], text: t });
        } else if (tag === 'p') {
          el.querySelectorAll('img').forEach(img => blocks.push({ type: 'img', src: img.src }));
          const t = el.textContent.trim();
          if (t) blocks.push({ type: 'p', text: t });
        } else if (tag === 'ul' || tag === 'ol') {
          [...el.querySelectorAll(':scope > li')].forEach((li, idx) =>
            blocks.push({ type: 'p', text: (tag === 'ol' ? (idx + 1) + '. ' : '• ') + li.textContent.trim() }));
        } else if (tag === 'table') {
          [...el.querySelectorAll('tr')].forEach(tr => {
            const cells = [...tr.children].map(c => c.textContent.trim()).filter(Boolean).join('   |   ');
            if (cells) blocks.push({ type: 'p', text: cells });
          });
        } else if (tag === 'img') {
          blocks.push({ type: 'img', src: el.src });
        } else {
          walk(el);
        }
      }
    })(holder);

    if (!blocks.length) { setStatus('word2pdf', 'No readable content found in this document.', 'err'); return; }

    setStatus('word2pdf', 'Building PDF…', 'busy', 10);
    const doc = await PDFDocument.create();
    const body = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const margin = 56, maxW = PW - margin * 2;
    let page = doc.addPage([PW, PH]);
    let y = PH - margin;
    const ensureRoom = need => {
      if (y - need < margin) { page = doc.addPage([PW, PH]); y = PH - margin; }
    };

    for (let bi = 0; bi < blocks.length; bi++) {
      const b = blocks[bi];
      if (b.type === 'img') {
        try {
          if (!/^data:image\/(jpeg|png)/.test(b.src)) continue;
          const bin = atob(b.src.split(',')[1]);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          const img = b.src.startsWith('data:image/png') ? await doc.embedPng(arr) : await doc.embedJpg(arr);
          const scale = Math.min(maxW / img.width, 1);
          const w = img.width * scale, h = img.height * scale;
          ensureRoom(h + 12);
          page.drawImage(img, { x: margin, y: y - h, width: w, height: h });
          y -= h + 14;
        } catch (e) { /* skip undecodable image */ }
        continue;
      }
      const isH = b.type === 'h';
      const size = isH ? Math.max(20 - b.level * 2, 13) : 11;
      const font = isH ? bold : body;
      const lineH = size * 1.5;
      const lines = wrapText(font, sanitizeLatin(b.text), size, maxW);
      if (isH) { ensureRoom(lineH * lines.length + 10); y -= 6; }
      for (const line of lines) {
        ensureRoom(lineH);
        if (line) page.drawText(line, { x: margin, y: y - size, size, font, color: rgb(0.08, 0.09, 0.12) });
        y -= lineH;
      }
      y -= isH ? 4 : 7;
      setStatus('word2pdf', 'Building PDF…', 'busy', 10 + Math.round((bi / blocks.length) * 90));
    }

    const bytes = await doc.save();
    download(bytes, baseNameOf(entry.file, 'docx') + '.pdf', 'application/pdf');
    setStatus('word2pdf', `Done — ${doc.getPageCount()}-page PDF downloaded (${fmtSize(bytes.length)}). Tip: High fidelity mode preserves tables & alignment.`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus('word2pdf', 'Conversion failed. The file may be corrupted, password-protected, or an old .doc format.', 'err');
  }
}

/* Print to PDF: the browser's print engine — vector text, perfect pagination */
on('word2pdf-print', 'click', async () => {
  const entry = state.word2pdf[0];
  if (!entry) return;
  try {
    setStatus('word2pdf', 'Preparing print view…', 'busy');
    const html = await docxToHtml(entry);
    const win = window.open('', '_blank');
    if (!win) { setStatus('word2pdf', 'Popup blocked — allow popups for this site and try again.', 'err'); return; }
    const sizeName = $('word2pdf-size').value === 'a4' ? 'A4' : 'letter';
    win.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>' +
      entry.file.name.replace(/[<>]/g, '') + '</title><style>' + WORD_CSS +
      ' @page { size: ' + sizeName + '; margin: 18mm; } body { margin: 0; }' +
      '</style></head><body><div class="w2p-doc">' + html + '</div></body></html>');
    win.document.close();
    setStatus('word2pdf', 'Print view opened — pick "Save as PDF" as the destination for a perfect, selectable-text PDF.', 'ok');
    setTimeout(() => { try { win.focus(); win.print(); } catch (e) {} }, 700);
  } catch (err) {
    console.error(err);
    setStatus('word2pdf', 'Could not open the print view.', 'err');
  }
});

/* ── 2. PDF → Word ───────────────────── */
async function extractPdfParagraphs(buffer, onProgress) {
  const pdf = await openPdf(buffer);
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    const lines = [];
    for (const it of tc.items) {
      if (!it.str) continue;
      const y = it.transform?.[5] ?? 0, x = it.transform?.[4] ?? 0;
      let line = lines.find(L => Math.abs(L.y - y) < 3);
      if (!line) { line = { y, items: [] }; lines.push(line); }
      line.items.push({ x, str: it.str });
    }
    lines.sort((a, b) => b.y - a.y);
    lines.forEach(L => L.items.sort((a, b) => a.x - b.x));
    const textLines = lines
      .map(L => ({ y: L.y, text: L.items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim() }))
      .filter(L => L.text);

    const gaps = [];
    for (let i = 0; i < textLines.length - 1; i++) gaps.push(textLines[i].y - textLines[i + 1].y);
    gaps.sort((a, b) => a - b);
    const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 14;
    const threshold = Math.max(median * 1.6, 18);

    const paras = [];
    let cur = [];
    for (let i = 0; i < textLines.length; i++) {
      cur.push(textLines[i].text);
      const gap = i < textLines.length - 1 ? textLines[i].y - textLines[i + 1].y : Infinity;
      if (gap > threshold) { paras.push(cur.join(' ')); cur = []; }
    }
    if (cur.length) paras.push(cur.join(' '));
    pages.push(paras);
    if (onProgress) onProgress(p, pdf.numPages);
  }
  return pages;
}

on('pdf2word-run', 'click', async () => {
  const entry = state.pdf2word[0];
  const keepBreaks = $('pdf2word-breaks').value === 'keep';
  try {
    setStatus('pdf2word', 'Extracting text…', 'busy', 0, true);
    const pages = await extractPdfParagraphs(entry.buffer, (p, n) =>
      setStatus('pdf2word', `Reading page ${p} of ${n}…`, 'busy', Math.round((p / n) * 80)));
    const totalChars = pages.flat().join('').length;
    if (totalChars < 5) {
      setStatus('pdf2word', 'No selectable text found — this looks like a scanned PDF. Try the OCR scan tool instead.', 'err');
      return;
    }
    setStatus('pdf2word', 'Building Word document…', 'busy', 90);
    const blob = await buildDocxFromParagraphs(pages, keepBreaks);
    download(blob, baseNameOf(entry.file, 'pdf') + '.docx');
    setStatus('pdf2word', `Done — editable .docx downloaded (${fmtSize(blob.size)}, ${pages.flat().length} paragraphs).`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus('pdf2word', 'Conversion failed. The PDF may be encrypted or damaged.', 'err');
  }
});

/* ── 3. OCR ──────────────────────────── */
on('ocr-run', 'click', async () => {
  const entry = state.ocr[0];
  const lang = $('ocr-lang').value;
  const outWrap = $('ocr-output-wrap');
  outWrap.style.display = 'none';
  let worker;
  try {
    setStatus('ocr', 'Loading language model (first run takes a moment)…', 'busy', null, true);
    worker = await Tesseract.createWorker(lang, 1, {
      logger: m => {
        if (m.status === 'recognizing text') {
          setStatus('ocr', 'Recognizing text…', 'busy', Math.round(m.progress * 100));
        }
      }
    });

    const canvases = [];
    if (entry.kind === 'img') {
      const bmp = await createImageBitmap(entry.file);
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      canvases.push(c);
    } else {
      const pdf = await openPdf(entry.buffer);
      const max = Math.min(pdf.numPages, 25);
      for (let p = 1; p <= max; p++) {
        const page = await pdf.getPage(p);
        const vp = page.getViewport({ scale: 2 });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        canvases.push(c);
      }
      if (pdf.numPages > 25) setStatus('ocr', `Processing first 25 of ${pdf.numPages} pages…`, 'busy');
    }

    let fullText = '';
    for (let i = 0; i < canvases.length; i++) {
      setStatus('ocr', `Reading ${canvases.length > 1 ? 'page ' + (i + 1) + ' of ' + canvases.length : 'image'}…`, 'busy', null, true);
      const { data } = await worker.recognize(canvases[i]);
      fullText += (i > 0 ? '\n\n——— Page ' + (i + 1) + ' ———\n\n' : '') + data.text.trim();
    }

    if (!fullText.trim()) {
      setStatus('ocr', 'No text could be recognized. Try a clearer scan, higher contrast, or a different language setting.', 'err');
      return;
    }
    $('ocr-output').value = fullText;
    outWrap.style.display = 'block';
    setStatus('ocr', `Done — ${fullText.length.toLocaleString()} characters recognized. Review and edit below.`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus('ocr', 'OCR failed. Check your internet connection (the language model downloads on first use) and try again.', 'err');
  } finally {
    if (worker) await worker.terminate().catch(() => {});
  }
});

on('ocr-copy', 'click', async () => {
  await navigator.clipboard.writeText($('ocr-output').value);
  setStatus('ocr', 'Copied to clipboard.', 'ok');
});
on('ocr-txt', 'click', () => {
  download(new Blob([$('ocr-output').value], { type: 'text/plain;charset=utf-8' }), 'ocr-text.txt');
});
on('ocr-docx', 'click', async () => {
  const paras = $('ocr-output').value.split(/\n{2,}/).map(s => s.replace(/\n/g, ' ').trim()).filter(Boolean);
  const blob = await buildDocxFromParagraphs([paras], false);
  download(blob, 'ocr-text.docx');
});

/* ── 4. Images → PDF ─────────────────── */
on('img2pdf-run', 'click', async () => {
  const files = state.img2pdf;
  const sizeOpt = $('img2pdf-size').value;
  const margin = parseInt($('img2pdf-margin').value, 10);
  try {
    setStatus('img2pdf', 'Building PDF…', 'busy', 0, true);
    const doc = await PDFDocument.create();
    for (let i = 0; i < files.length; i++) {
      const bytes = await files[i].file.arrayBuffer();
      let img;
      if (files[i].file.type === 'image/png') {
        img = await doc.embedPng(bytes);
      } else if (files[i].file.type === 'image/jpeg') {
        img = await doc.embedJpg(bytes);
      } else {
        const bmp = await createImageBitmap(files[i].file);
        const c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        const pngBlob = await new Promise(r => c.toBlob(r, 'image/png'));
        img = await doc.embedPng(await pngBlob.arrayBuffer());
      }
      let pw, ph;
      if (sizeOpt === 'fit') { pw = img.width + margin * 2; ph = img.height + margin * 2; }
      else { [pw, ph] = PAGE_SIZES[sizeOpt]; }
      const page = doc.addPage([pw, ph]);
      const maxW = pw - margin * 2, maxH = ph - margin * 2;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = img.width * scale, h = img.height * scale;
      page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
      setStatus('img2pdf', `Adding page ${i + 1} of ${files.length}…`, 'busy', Math.round(((i + 1) / files.length) * 100));
    }
    const out = await doc.save();
    download(out, 'images.pdf', 'application/pdf');
    setStatus('img2pdf', `Done — ${files.length}-page PDF downloaded (${fmtSize(out.length)}).`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus('img2pdf', 'Something went wrong creating the PDF. Try fewer or smaller images.', 'err');
  }
});

/* ── 5. PDF → Images ─────────────────── */
on('pdf2img-run', 'click', async () => {
  const entry = state.pdf2img[0];
  const format = $('pdf2img-format').value;
  const scale = parseFloat($('pdf2img-scale').value);
  const grid = $('pdf2img-results');
  grid.innerHTML = '';
  try {
    setStatus('pdf2img', 'Opening PDF…', 'busy', 0, true);
    const pdf = await openPdf(entry.buffer);
    const zip = new JSZip();
    const baseName = baseNameOf(entry.file, 'pdf');
    const mime = format === 'png' ? 'image/png' : 'image/jpeg';
    const ext = format === 'png' ? 'png' : 'jpg';

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width; canvas.height = vp.height;
      const ctx = canvas.getContext('2d');
      if (format === 'jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const blob = await new Promise(r => canvas.toBlob(r, mime, 0.92));
      zip.file(`${baseName}-page-${p}.${ext}`, blob);

      const card = document.createElement('div');
      card.className = 'result-card';
      const url = URL.createObjectURL(blob);
      card.innerHTML = `<img alt="Page ${p}"><a download="${baseName}-page-${p}.${ext}">Page ${p} ↓</a>`;
      card.querySelector('img').src = url;
      card.querySelector('a').href = url;
      grid.appendChild(card);

      setStatus('pdf2img', `Rendering page ${p} of ${pdf.numPages}…`, 'busy', Math.round((p / pdf.numPages) * 100));
    }
    if (pdf.numPages > 1) {
      setStatus('pdf2img', 'Packing ZIP…', 'busy', 100);
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      download(zipBlob, `${baseName}-images.zip`);
      setStatus('pdf2img', `Done — ${pdf.numPages} images downloaded as ZIP. Individual downloads below.`, 'ok');
    } else {
      const onlyBlob = await zip.file(`${baseName}-page-1.${ext}`).async('blob');
      download(onlyBlob, `${baseName}-page-1.${ext}`);
      setStatus('pdf2img', 'Done — image downloaded.', 'ok');
    }
  } catch (err) {
    console.error(err);
    setStatus('pdf2img', 'Could not render this PDF. It may be encrypted or damaged.', 'err');
  }
});

/* ── 6. Merge ────────────────────────── */
on('merge-run', 'click', async () => {
  try {
    setStatus('merge', 'Merging…', 'busy', 0, true);
    const out = await PDFDocument.create();
    const list = state.merge;
    for (let i = 0; i < list.length; i++) {
      const src = await PDFDocument.load(list[i].buffer, { ignoreEncryption: true });
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach(pg => out.addPage(pg));
      setStatus('merge', `Adding "${list[i].file.name}"…`, 'busy', Math.round(((i + 1) / list.length) * 100));
    }
    const bytes = await out.save();
    download(bytes, 'merged.pdf', 'application/pdf');
    setStatus('merge', `Done — ${out.getPageCount()}-page PDF downloaded (${fmtSize(bytes.length)}).`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus('merge', 'Merge failed. One of the files may be encrypted or damaged.', 'err');
  }
});

/* ── 7. Split ────────────────────────── */
function parseRange(text, max) {
  const pages = new Set();
  for (const part of text.split(',')) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) return null;
    const a = parseInt(m[1], 10), b = m[2] ? parseInt(m[2], 10) : a;
    if (a < 1 || b > max || a > b) return null;
    for (let i = a; i <= b; i++) pages.add(i - 1);
  }
  return [...pages].sort((x, y) => x - y);
}

on('split-run', 'click', async () => {
  const entry = state.split[0];
  const rangeText = $('split-range').value.trim();
  const mode = $('split-mode').value;
  if (!rangeText) { setStatus('split', 'Enter a page range first, e.g. 1-3 or 2, 5-7.', 'err'); return; }
  const indices = parseRange(rangeText, entry.pages);
  if (!indices) { setStatus('split', `Invalid range. This PDF has ${entry.pages} pages — try something like 1-${Math.min(3, entry.pages)}.`, 'err'); return; }
  try {
    setStatus('split', 'Extracting pages…', 'busy', null, true);
    const src = await PDFDocument.load(entry.buffer, { ignoreEncryption: true });
    const baseName = baseNameOf(entry.file, 'pdf');

    if (mode === 'one') {
      const out = await PDFDocument.create();
      const pages = await out.copyPages(src, indices);
      pages.forEach(pg => out.addPage(pg));
      const bytes = await out.save();
      download(bytes, `${baseName}-pages.pdf`, 'application/pdf');
      setStatus('split', `Done — extracted ${indices.length} page${indices.length > 1 ? 's' : ''} (${fmtSize(bytes.length)}).`, 'ok');
    } else {
      const zip = new JSZip();
      for (let i = 0; i < indices.length; i++) {
        const out = await PDFDocument.create();
        const [pg] = await out.copyPages(src, [indices[i]]);
        out.addPage(pg);
        zip.file(`${baseName}-page-${indices[i] + 1}.pdf`, await out.save());
        setStatus('split', `Creating PDF ${i + 1} of ${indices.length}…`, 'busy', Math.round(((i + 1) / indices.length) * 100));
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      download(zipBlob, `${baseName}-split.zip`);
      setStatus('split', `Done — ${indices.length} separate PDFs downloaded as ZIP.`, 'ok');
    }
  } catch (err) {
    console.error(err);
    setStatus('split', 'Extraction failed. The PDF may be encrypted or damaged.', 'err');
  }
});

/* ── 8. Compress ─────────────────────── */
on('compress-run', 'click', async () => {
  const entry = state.compress[0];
  const [quality, scale] = $('compress-level').value.split('|').map(Number);
  try {
    setStatus('compress', 'Opening PDF…', 'busy', 0, true);
    const pdf = await openPdf(entry.buffer);
    const out = await PDFDocument.create();

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width; canvas.height = vp.height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
      const jpg = await out.embedJpg(await blob.arrayBuffer());
      const newPage = out.addPage([vp1.width, vp1.height]);
      newPage.drawImage(jpg, { x: 0, y: 0, width: vp1.width, height: vp1.height });
      setStatus('compress', `Compressing page ${p} of ${pdf.numPages}…`, 'busy', Math.round((p / pdf.numPages) * 100));
    }
    const bytes = await out.save();
    const before = entry.file.size, after = bytes.length;
    const baseName = baseNameOf(entry.file, 'pdf');
    download(bytes, `${baseName}-compressed.pdf`, 'application/pdf');
    const saved = Math.max(0, Math.round((1 - after / before) * 100));
    const el = $('compress-status');
    setStatus('compress', `Done — ${fmtSize(before)} → ${fmtSize(after)} `, 'ok');
    if (after < before) el.insertAdjacentHTML('beforeend', `<span class="savings-badge">${saved}% smaller</span>`);
    else el.insertAdjacentHTML('beforeend', `<span>(this PDF was already well optimized)</span>`);
  } catch (err) {
    console.error(err);
    setStatus('compress', 'Compression failed. The PDF may be encrypted or damaged.', 'err');
  }
});

/* ── 9. Organize ─────────────────────── */
async function buildOrganizeThumbnails() {
  const entry = state.organize[0];
  organizePages = [];
  const grid = $('organize-pages');
  grid.innerHTML = '';
  setStatus('organize', 'Building page previews…', 'busy', 0, true);
  try {
    const pdf = await openPdf(entry.buffer);
    const max = Math.min(pdf.numPages, 100);
    for (let p = 1; p <= max; p++) {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 0.4 });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width; canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      organizePages.push({ srcIndex: p - 1, rotation: 0, deleted: false, thumbUrl: canvas.toDataURL('image/jpeg', 0.7) });
      setStatus('organize', `Preview ${p} of ${max}…`, 'busy', Math.round((p / max) * 100));
    }
    if (pdf.numPages > 100) setStatus('organize', `Showing first 100 of ${pdf.numPages} pages.`, '');
    else setStatus('organize', 'Reorder with arrows, rotate with ⟳, remove with ✕ — then save.', '');
    renderOrganizeGrid();
  } catch (err) {
    console.error(err);
    setStatus('organize', 'Could not build previews for this PDF.', 'err');
  }
}

function renderOrganizeGrid() {
  const grid = $('organize-pages');
  grid.innerHTML = '';
  organizePages.forEach((pg, i) => {
    const card = document.createElement('div');
    card.className = 'page-card' + (pg.deleted ? ' deleted' : '');
    const img = document.createElement('img');
    img.src = pg.thumbUrl;
    img.alt = 'Page ' + (pg.srcIndex + 1);
    img.style.transform = `rotate(${pg.rotation}deg)`;
    const num = document.createElement('div');
    num.className = 'page-num';
    num.textContent = `#${i + 1} (was p.${pg.srcIndex + 1})${pg.rotation ? ' · ' + pg.rotation + '°' : ''}`;
    const btns = document.createElement('div');
    btns.className = 'page-btns';
    btns.append(
      mkBtn('←', 'Move left', () => { if (i > 0) { [organizePages[i-1], organizePages[i]] = [organizePages[i], organizePages[i-1]]; renderOrganizeGrid(); } }),
      mkBtn('⟳', 'Rotate 90°', () => { pg.rotation = (pg.rotation + 90) % 360; renderOrganizeGrid(); }),
      mkBtn(pg.deleted ? '↺' : '✕', pg.deleted ? 'Restore page' : 'Delete page', () => { pg.deleted = !pg.deleted; renderOrganizeGrid(); }),
      mkBtn('→', 'Move right', () => { if (i < organizePages.length - 1) { [organizePages[i+1], organizePages[i]] = [organizePages[i], organizePages[i+1]]; renderOrganizeGrid(); } })
    );
    card.append(img, num, btns);
    grid.appendChild(card);
  });
}

on('organize-run', 'click', async () => {
  const entry = state.organize[0];
  const kept = organizePages.filter(p => !p.deleted);
  if (!kept.length) { setStatus('organize', 'All pages are deleted — restore at least one page.', 'err'); return; }
  try {
    setStatus('organize', 'Assembling new PDF…', 'busy', null, true);
    const src = await PDFDocument.load(entry.buffer, { ignoreEncryption: true });
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, kept.map(p => p.srcIndex));
    copied.forEach((pg, i) => {
      const extra = kept[i].rotation;
      if (extra) pg.setRotation(degrees((pg.getRotation().angle + extra) % 360));
      out.addPage(pg);
    });
    const bytes = await out.save();
    download(bytes, baseNameOf(entry.file, 'pdf') + '-organized.pdf', 'application/pdf');
    setStatus('organize', `Done — new ${kept.length}-page PDF downloaded (${fmtSize(bytes.length)}).`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus('organize', 'Could not save. The PDF may be encrypted or damaged.', 'err');
  }
});

/* ── 10. Watermark ───────────────────── */
on('watermark-run', 'click', async () => {
  const entry = state.watermark[0];
  const text = sanitizeLatin($('watermark-text').value.trim());
  const style = $('watermark-style').value;
  const opacity = parseFloat($('watermark-opacity').value);
  if (!text) { setStatus('watermark', 'Enter the watermark text first.', 'err'); return; }
  try {
    setStatus('watermark', 'Applying watermark…', 'busy', 0, true);
    const doc = await PDFDocument.load(entry.buffer, { ignoreEncryption: true });
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const pages = doc.getPages();

    pages.forEach((page, i) => {
      const { width, height } = page.getSize();
      if (style === 'diag') {
        const size = Math.min(width, height) / (text.length > 14 ? 12 : 8) + 18;
        const tw = font.widthOfTextAtSize(text, size);
        page.drawText(text, {
          x: width / 2 - (tw / 2) * 0.707,
          y: height / 2 - (tw / 2) * 0.707,
          size, font,
          color: rgb(0.45, 0.45, 0.5),
          opacity,
          rotate: degrees(45),
        });
      } else {
        const size = 10;
        const tw = font.widthOfTextAtSize(text, size);
        page.drawText(text, {
          x: width - tw - 28, y: 20,
          size, font,
          color: rgb(0.45, 0.45, 0.5),
          opacity: Math.min(opacity * 2.2, 0.9),
        });
      }
      setStatus('watermark', `Stamping page ${i + 1} of ${pages.length}…`, 'busy', Math.round(((i + 1) / pages.length) * 100));
    });

    const bytes = await doc.save();
    download(bytes, baseNameOf(entry.file, 'pdf') + '-watermarked.pdf', 'application/pdf');
    setStatus('watermark', `Done — watermark applied to ${pages.length} pages (${fmtSize(bytes.length)}).`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus('watermark', 'Watermarking failed. The PDF may be encrypted or damaged.', 'err');
  }
});

/* ── 11. Page numbers ────────────────── */
on('pagenum-run', 'click', async () => {
  const entry = state.pagenum[0];
  const format = $('pagenum-format').value;
  const pos = $('pagenum-pos').value;
  const start = parseInt($('pagenum-start').value, 10) || 1;
  try {
    setStatus('pagenum', 'Adding page numbers…', 'busy', 0, true);
    const doc = await PDFDocument.load(entry.buffer, { ignoreEncryption: true });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages();
    const total = pages.length;
    const size = 10;

    pages.forEach((page, i) => {
      const n = start + i;
      const label = format === 'ofN' ? `Page ${n} of ${start + total - 1}`
                  : format === 'dash' ? `— ${n} —`
                  : String(n);
      const { width, height } = page.getSize();
      const tw = font.widthOfTextAtSize(label, size);
      let x, y;
      if (pos === 'bc') { x = (width - tw) / 2; y = 24; }
      else if (pos === 'br') { x = width - tw - 32; y = 24; }
      else { x = width - tw - 32; y = height - 30; }
      page.drawText(label, { x, y, size, font, color: rgb(0.25, 0.27, 0.32) });
      setStatus('pagenum', `Numbering page ${i + 1} of ${total}…`, 'busy', Math.round(((i + 1) / total) * 100));
    });

    const bytes = await doc.save();
    download(bytes, baseNameOf(entry.file, 'pdf') + '-numbered.pdf', 'application/pdf');
    setStatus('pagenum', `Done — ${total} pages numbered (${fmtSize(bytes.length)}).`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus('pagenum', 'Numbering failed. The PDF may be encrypted or damaged.', 'err');
  }
});

/* ── 12. Metadata ────────────────────── */
on('metadata-run', 'click', async () => {
  const entry = state.metadata[0];
  try {
    setStatus('metadata', 'Saving metadata…', 'busy', null, true);
    const doc = await PDFDocument.load(entry.buffer, { ignoreEncryption: true });
    doc.setTitle($('metadata-title').value.trim());
    doc.setAuthor($('metadata-author').value.trim());
    doc.setSubject($('metadata-subject').value.trim());
    const kw = $('metadata-keywords').value.split(',').map(s => s.trim()).filter(Boolean);
    doc.setKeywords(kw);
    doc.setModificationDate(new Date());
    const bytes = await doc.save();
    download(bytes, baseNameOf(entry.file, 'pdf') + '-meta.pdf', 'application/pdf');
    setStatus('metadata', `Done — metadata saved (${fmtSize(bytes.length)}).`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus('metadata', 'Could not save metadata. The PDF may be encrypted or damaged.', 'err');
  }
});

/* ── 13. Text → PDF ──────────────────── */
on('text2pdf-run', 'click', async () => {
  const raw = $('text2pdf-text').value;
  const title = $('text2pdf-title').value.trim();
  const fontSize = parseInt($('text2pdf-fontsize').value, 10);
  const fontChoice = $('text2pdf-font').value;
  if (!raw.trim()) { setStatus('text2pdf', 'Type or paste some text first.', 'err'); return; }
  try {
    setStatus('text2pdf', 'Creating PDF…', 'busy', null, true);
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts[fontChoice]);
    const boldName = fontChoice === 'TimesRoman' ? 'TimesRomanBold' : fontChoice + 'Bold';
    const bold = await doc.embedFont(StandardFonts[boldName]);
    const [PW, PH] = PAGE_SIZES.a4;
    const margin = 56;
    const maxW = PW - margin * 2;
    const lineH = fontSize * 1.55;

    const lines = wrapText(font, sanitizeLatin(raw), fontSize, maxW);

    let page = doc.addPage([PW, PH]);
    let y = PH - margin;
    if (title) {
      page.drawText(sanitizeLatin(title), { x: margin, y: y - 18, size: fontSize + 6, font: bold, color: rgb(0.08, 0.09, 0.12) });
      y -= 18 + (fontSize + 6) * 1.2;
    }
    for (const line of lines) {
      if (y - lineH < margin) { page = doc.addPage([PW, PH]); y = PH - margin; }
      if (line) page.drawText(line, { x: margin, y: y - fontSize, size: fontSize, font, color: rgb(0.1, 0.11, 0.14) });
      y -= lineH;
    }

    const bytes = await doc.save();
    download(bytes, (title || 'document') + '.pdf', 'application/pdf');
    setStatus('text2pdf', `Done — ${doc.getPageCount()}-page PDF downloaded (${fmtSize(bytes.length)}).`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus('text2pdf', 'Could not create the PDF. Standard PDF fonts only support Latin characters — for Tamil/Sinhala text, use the OCR tool\u2019s .docx export or ask us to add custom font embedding.', 'err');
  }
});
