import './style.css'
import { PDFDocument } from 'pdf-lib'
import JSZip from 'jszip'
import * as pdfjsLib from 'pdfjs-dist'
import ePub from 'epubjs'
import jsPDF from 'jspdf'

// Worker Setup
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// --- State ---
let currentFile = null;
let fileType = null;
let pdfLibDoc = null;
let pdfProxy = null;
let epubBook = null;
let epubRendition = null;

let totalPages = 0;
let epubChapters = [];

let currentPage = 1;

// GLOBAL cache
window.epubContentCache = {};

// --- DOM ---
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
const fileNameSpan = document.getElementById('fileName');
const fileIcon = document.getElementById('fileIcon');
const removeBtn = document.getElementById('removeFileBtn');

const rangesContainer = document.getElementById('rangesContainer');
const autoDetectBtn = document.getElementById('autoDetectBtn');
const clearRowsBtn = document.getElementById('clearRowsBtn');
const downloadBtn = document.getElementById('downloadBtn');
const statusMsg = document.getElementById('statusMsg');

const previewArea = document.getElementById('previewArea');
const pdfCanvas = document.getElementById('pdfCanvas');
const pdfCtx = pdfCanvas.getContext('2d');
const epubContainer = document.getElementById('epubPreviewContainer');
const epubViewer = document.getElementById('epubViewer');

const pdfPreviewContainer = document.getElementById('previewContainer');
const emptyState = document.getElementById('emptyState');
const previewPageNum = document.getElementById('previewPageNum');
const previewTotal = document.getElementById('previewTotal');

// --- Initialization ---

addRangeRow();

function clearRows() {
  rangesContainer.innerHTML = '';
  addRangeRow();
  updateValidation();
}

clearRowsBtn.onclick = clearRows;

function createRangeRow(vals = {}) {
  const row = document.createElement('div');
  row.className = 'range-row';

  const startInput = document.createElement('input');
  startInput.type = 'number';

  if (fileType === 'epub') {
    startInput.placeholder = '#';
    startInput.className = 'input-start epub-index';
    startInput.title = "Bölüm Sırası";
  } else {
    startInput.placeholder = 'Başla';
    startInput.className = 'input-start';
  }

  if (vals.start) startInput.value = vals.start;

  const sep = document.createElement('span');
  sep.className = 'separator';
  sep.textContent = '-';

  const endInput = document.createElement('input');
  endInput.type = 'number';
  endInput.placeholder = 'Bitir';
  endInput.className = 'input-end';
  if (vals.end) endInput.value = vals.end;

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = fileType === 'epub' ? 'Bölüm Adı' : 'Başlık (Opsiyonel)';
  nameInput.className = 'input-name';
  if (fileType === 'epub') {
    nameInput.style.flex = "2";
    nameInput.style.minWidth = "150px";
  }
  if (vals.title) nameInput.value = vals.title;

  const delBtn = document.createElement('button');
  delBtn.className = 'delete-row-btn';
  delBtn.innerHTML = '×';
  delBtn.tabIndex = -1;
  delBtn.onclick = () => {
    row.remove();
    if (rangesContainer.children.length === 0) addRangeRow();
    updateValidation();
  };

  row.appendChild(startInput);
  if (fileType !== 'epub') {
    row.appendChild(sep);
    row.appendChild(endInput);
  }
  row.appendChild(nameInput);
  row.appendChild(delBtn);

  const onInput = () => {
    updateValidation();
    if (fileType === 'pdf' && startInput.value) {
      goToPage(parseInt(startInput.value));
    }
    if (row === rangesContainer.lastElementChild && (startInput.value || (endInput && endInput.value))) {
      addRangeRow();
    }
  };

  startInput.addEventListener('input', onInput);
  startInput.addEventListener('focus', () => {
    if (fileType === 'pdf' && startInput.value) goToPage(parseInt(startInput.value));
    document.querySelectorAll('.range-row').forEach(r => r.classList.remove('active-row'));
    row.classList.add('active-row');
  });

  if (endInput) endInput.addEventListener('input', onInput);

  return row;
}

function addRangeRow(vals = {}) {
  const row = createRangeRow(vals);
  rangesContainer.appendChild(row);
}


// --- File Processing ---

dropZone.onclick = () => fileInput.click();
dropZone.ondragover = e => { e.preventDefault(); dropZone.classList.add('dragover'); };
dropZone.ondragleave = () => dropZone.classList.remove('dragover');
dropZone.ondrop = e => {
  e.preventDefault(); dropZone.classList.remove('dragover');
  if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
};
fileInput.onchange = e => { if (e.target.files[0]) loadFile(e.target.files[0]); };

removeBtn.onclick = () => {
  currentFile = null;
  fileType = null;
  pdfLibDoc = null;
  pdfProxy = null;
  epubBook = null;
  window.epubContentCache = {};

  dropZone.classList.remove('hidden');
  fileInfo.classList.add('hidden');
  emptyState.classList.remove('hidden');
  pdfPreviewContainer.classList.add('hidden');
  epubContainer.classList.add('hidden');

  if (epubRendition) {
    epubRendition.destroy();
    epubRendition = null;
  }
  document.getElementById('epubViewer').innerHTML = '';
  clearRows();
};

async function loadFile(file) {
  statusMsg.innerText = 'Dosya yükleniyor...';
  currentFile = file;
  fileNameSpan.innerText = file.name;

  if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
    fileType = 'pdf';
    fileIcon.innerText = '📕';
    await loadPDF(file);
  } else if (file.type === 'application/epub+zip' || file.name.endsWith('.epub')) {
    fileType = 'epub';
    fileIcon.innerText = '📘';
    await loadEPUB(file);
  } else {
    alert("Sadece PDF ve EPUB dosyaları desteklenmektedir.");
    return;
  }

  dropZone.classList.add('hidden');
  fileInfo.classList.remove('hidden');
  emptyState.classList.add('hidden');
  statusMsg.innerText = '';
  previewArea.focus();
  rangesContainer.innerHTML = '';
  addRangeRow();
}

async function loadPDF(file) {
  const arrayBuf = await file.arrayBuffer();
  pdfLibDoc = await PDFDocument.load(arrayBuf);
  totalPages = pdfLibDoc.getPageCount();
  const uint8 = new Uint8Array(arrayBuf);
  pdfProxy = await pdfjsLib.getDocument(uint8).promise;
  previewTotal.innerText = totalPages;
  pdfPreviewContainer.classList.remove('hidden');
  epubContainer.classList.add('hidden');
  goToPage(1);
}

let renderTask = null;
async function renderPDFPage(num) {
  if (!pdfProxy) return;
  try {
    if (renderTask) renderTask.cancel();
    const page = await pdfProxy.getPage(num);
    const viewport = page.getViewport({ scale: 1.2 });
    pdfCanvas.height = viewport.height;
    pdfCanvas.width = viewport.width;
    const ctx = { canvasContext: pdfCtx, viewport };
    renderTask = page.render(ctx);
    await renderTask.promise;
    previewPageNum.innerText = num;
  } catch (e) { }
}

async function loadEPUB(file) {
  const arrayBuf = await file.arrayBuffer();
  epubBook = ePub(arrayBuf);
  await epubBook.ready;

  pdfPreviewContainer.classList.add('hidden');
  epubContainer.classList.remove('hidden');
  epubRendition = epubBook.renderTo('epubViewer', {
    width: "100%",
    height: "100%",
    flow: "scrolled-doc"
  });
  await epubRendition.display();

  const nav = await epubBook.loaded.navigation;
  epubChapters = nav.toc;

  // --- BUILD CONTENT CACHE ---
  window.epubContentCache = {};
  statusMsg.innerText = "İçerik okunuyor...";

  console.log("=== STARTING CACHE BUILD ===");

  try {
    const archive = epubBook.archive;
    const zip = archive.zip;
    const files = zip.files;
    const paths = Object.keys(files);

    console.log("Archive paths:", paths);

    let successCount = 0;
    let errorCount = 0;

    for (const fullPath of paths) {
      if (fullPath.match(/\.(xhtml|html|htm)$/i) &&
        !fullPath.toLowerCase().includes('toc') &&
        !fullPath.toLowerCase().includes('nav') &&
        !fullPath.toLowerCase().includes('container')) {

        try {
          // Try method 1: archive.getText
          let content = null;

          try {
            content = await archive.getText(fullPath);
          } catch (e1) {
            console.log("getText failed for", fullPath, ":", e1.message);
          }

          // Try method 2: Direct zip file access
          if (!content) {
            try {
              const zipFile = files[fullPath];
              if (zipFile && !zipFile.dir) {
                content = await zipFile.async('string');
              }
            } catch (e2) {
              console.log("Direct zip access failed for", fullPath, ":", e2.message);
            }
          }

          if (content && content.length > 0) {
            const filename = fullPath.split('/').pop().toLowerCase();
            window.epubContentCache[filename] = content;
            successCount++;
            console.log("✓ Cached:", filename, "(" + content.length + " chars)");
          } else {
            console.log("✗ Empty content for:", fullPath);
            errorCount++;
          }

        } catch (e) {
          console.error("Error processing", fullPath, ":", e);
          errorCount++;
        }
      }
    }

    console.log("=== CACHE BUILD COMPLETE ===");
    console.log("Success:", successCount, "Error:", errorCount);
    console.log("Cache keys:", Object.keys(window.epubContentCache));

    statusMsg.innerText = `Hazır (${successCount} dosya okundu, ${epubChapters.length} bölüm).`;

  } catch (e) {
    console.error("Cache build failed:", e);
    statusMsg.innerText = "Hazır (Cache hatası).";
  }
}


function goToPage(p) {
  if (p < 1) p = 1;
  if (p > totalPages) p = totalPages;
  currentPage = p;
  renderPDFPage(currentPage);
}

previewArea.addEventListener('wheel', (e) => {
  if (fileType !== 'pdf') return;
  e.preventDefault();
  if (e.deltaY > 0) goToPage(currentPage + 1);
  else goToPage(currentPage - 1);
}, { passive: false });

previewArea.addEventListener('keydown', (e) => {
  if (fileType !== 'pdf') return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') goToPage(currentPage + 1);
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') goToPage(currentPage - 1);
});

autoDetectBtn.onclick = async () => {
  if (!fileType) return;
  rangesContainer.innerHTML = '';

  if (fileType === 'pdf') {
    const outline = await pdfProxy.getOutline();
    if (!outline || outline.length === 0) {
      alert("Bölüm yapısı bulunamadı.");
      addRangeRow();
      return;
    }
    const items = [];
    const processItems = async (nodes) => {
      for (const node of nodes) {
        let dest = node.dest;
        if (typeof dest === 'string') dest = await pdfProxy.getDestination(dest);
        if (Array.isArray(dest)) {
          const idx = await pdfProxy.getPageIndex(dest[0]);
          items.push({ title: node.title, start: idx + 1 });
        }
        if (node.items && node.items.length) await processItems(node.items);
      }
    };
    await processItems(outline);
    items.sort((a, b) => a.start - b.start);
    for (let i = 0; i < items.length; i++) {
      const current = items[i];
      const next = items[i + 1];
      const start = current.start;
      const end = next ? (next.start - 1) : totalPages;
      if (start <= end) addRangeRow({ start, end, title: current.title });
    }
    statusMsg.innerText = `${items.length} bölüm bulundu!`;

  } else if (fileType === 'epub') {
    if (!epubChapters.length) {
      alert("Bölüm listesi bulunamadı.");
      addRangeRow();
      return;
    }
    epubChapters.forEach((ch, idx) => {
      addRangeRow({ start: idx + 1, title: ch.label });
    });
    statusMsg.innerText = "EPUB bölümleri listelendi.";
  }
  addRangeRow();
  updateValidation();
};

function getRanges() {
  const data = [];
  rangesContainer.querySelectorAll('.range-row').forEach(row => {
    const start = row.querySelector('.input-start').value;
    const end = row.querySelector('.input-end') ? row.querySelector('.input-end').value : null;
    const name = row.querySelector('.input-name').value;
    if (start) {
      data.push({
        start: parseInt(start),
        end: end ? parseInt(end) : null,
        name: name
      });
    }
  });
  return data;
}

function updateValidation() {
  const ranges = getRanges();
  downloadBtn.disabled = ranges.length === 0;
}

// HELPER: Extract text from HTML
function extractTextFromHTML(rawHTML) {
  if (!rawHTML) return "";

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHTML, "text/html");

    const bads = doc.querySelectorAll('script, style, meta, link, svg, head');
    bads.forEach(b => b.remove());

    const imgs = doc.querySelectorAll('img');
    imgs.forEach(img => {
      if (img.alt && img.alt.trim().length > 0) {
        const t = document.createTextNode(` [Gorsel: ${img.alt}] `);
        img.replaceWith(t);
      } else {
        img.remove();
      }
    });

    return doc.body.innerText || doc.body.textContent || "";
  } catch (e) {
    return rawHTML.replace(/<[^>]+>/g, " ");
  }
}

// Find content by filename
function findContent(tocHref) {
  const cleanHref = tocHref.split('#')[0];
  const targetFilename = cleanHref.split('/').pop().toLowerCase();

  console.log("Looking for:", targetFilename);
  console.log("Cache has keys:", Object.keys(window.epubContentCache));

  // Exact match
  if (window.epubContentCache[targetFilename]) {
    console.log("FOUND exact match!");
    return window.epubContentCache[targetFilename];
  }

  // Partial match
  for (const key of Object.keys(window.epubContentCache)) {
    if (key.includes(targetFilename) || targetFilename.includes(key)) {
      console.log("FOUND partial match:", key);
      return window.epubContentCache[key];
    }
  }

  console.log("NOT FOUND in cache");
  return null;
}


downloadBtn.onclick = async () => {
  const ranges = getRanges();
  if (!ranges.length) return;

  downloadBtn.disabled = true;
  downloadBtn.querySelector('.btn-text').innerText = 'İşleniyor...';
  downloadBtn.querySelector('.loading-spinner').classList.remove('hidden');

  const zip = new JSZip();

  try {
    if (fileType === 'pdf') {
      for (const r of ranges) {
        if (!r.end) continue;
        const newPdf = await PDFDocument.create();
        const indices = [];
        for (let p = r.start; p <= r.end; p++) indices.push(p - 1);
        const validIndices = indices.filter(i => i >= 0 && i < totalPages);
        if (validIndices.length === 0) continue;
        const copied = await newPdf.copyPages(pdfLibDoc, validIndices);
        copied.forEach(page => newPdf.addPage(page));
        const bytes = await newPdf.save();
        let fname = r.name ? `${r.name}.pdf` : `bolum_${r.start}-${r.end}.pdf`;
        fname = fname.replace(/[\/\\?%*:|"<>]/g, '-');
        zip.file(fname, bytes);
      }
    } else if (fileType === 'epub') {

      for (const r of ranges) {
        const chRef = epubChapters[r.start - 1];
        if (!chRef) continue;

        statusMsg.innerText = `İşleniyor: ${chRef.label.substring(0, 30)}...`;

        try {
          const rawHTML = findContent(chRef.href);

          let textContent = "";

          if (rawHTML) {
            textContent = extractTextFromHTML(rawHTML);
          }

          if (!textContent || textContent.replace(/\s/g, '').length === 0) {
            textContent = `[İÇERİK BULUNAMADI]\n\nAranan: ${chRef.href}\n\nKonsolu (F12) kontrol edin.`;
          }

          textContent = textContent.replace(/\t/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n').trim();

          const trMap = {
            'ğ': 'g', 'Ğ': 'G', 'ü': 'u', 'Ü': 'U', 'ş': 's', 'Ş': 'S',
            'ı': 'i', 'İ': 'I', 'ö': 'o', 'Ö': 'O', 'ç': 'c', 'Ç': 'C',
            'â': 'a', 'î': 'i'
          };
          textContent = textContent.replace(/[ğĞüÜşŞıİöÖçÇâî]/g, c => trMap[c] || c);

          const doc = new jsPDF();
          doc.setFont("times", "normal");

          const pageWidth = 210, margin = 20, maxW = pageWidth - 40;
          let y = margin;

          doc.setFontSize(16);
          doc.setFont("times", "bold");
          let safeTitle = chRef.label.replace(/[ğĞüÜşŞıİöÖçÇâî]/g, c => trMap[c] || c);
          const titleLines = doc.splitTextToSize(safeTitle, maxW);
          doc.text(titleLines, margin, y);
          y += (titleLines.length * 8) + 10;

          doc.setFontSize(11);
          doc.setFont("times", "normal");
          const lines = doc.splitTextToSize(textContent, maxW);

          for (const line of lines) {
            if (y > 280) { doc.addPage(); y = margin; }
            doc.text(line, margin, y);
            y += 6;
          }

          const blob = doc.output('blob');
          let fname = r.name ? r.name : chRef.label;
          fname = fname.replace(/[^a-zA-Z0-9\s\-_]/g, '').trim();
          if (!fname) fname = `bolum_${r.start}`;
          zip.file(`${fname}.pdf`, blob);

        } catch (err) {
          console.error(err);
          zip.file(`HATA_${r.start}.txt`, `Hata: ${err.message}`);
        }
      }
    }

    statusMsg.innerText = 'Paketleniyor...';
    const content = await zip.generateAsync({ type: "blob" });

    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    link.download = fileType === 'pdf' ? 'bolunmus_pdf.zip' : 'epub_bolumleri.zip';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    statusMsg.innerText = "Tamamlandı! 🎉";

  } catch (e) {
    console.error(e);
    alert("Hata: " + e.message);
  } finally {
    downloadBtn.disabled = false;
    downloadBtn.querySelector('.btn-text').innerText = 'Böl ve Zip İndir';
    downloadBtn.querySelector('.loading-spinner').classList.add('hidden');
  }
};
