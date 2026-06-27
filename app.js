// ============================================================
// VideoClean — app.js
// Remove metadata from videos using FFmpeg.wasm (browser-side)
// ============================================================

const { FFmpeg } = window.FFmpegWASM || {};
let ffmpegInstance = null;
let originalFile = null;
let outputURL = null;
let originalMeta = {};

// ── DOM refs ──────────────────────────────────────────────────
const dropZone   = document.getElementById('dropZone');
const dropInner  = document.getElementById('dropInner');
const fileInput  = document.getElementById('fileInput');
const metaPanel  = document.getElementById('metaPanel');
const metaGrid   = document.getElementById('metaGrid');
const metaCount  = document.getElementById('metaCount');
const optPanel   = document.getElementById('optionsPanel');
const btnProcess = document.getElementById('btnProcess');
const progPanel  = document.getElementById('progressPanel');
const progFill   = document.getElementById('progressFill');
const progLabel  = document.getElementById('progressLabel');
const logBox     = document.getElementById('logBox');
const resultPanel= document.getElementById('resultPanel');
const beforeList = document.getElementById('beforeList');
const dlLink     = document.getElementById('downloadLink');

// ── Drag-and-drop ─────────────────────────────────────────────
dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('video/')) handleFile(file);
  else alert('Por favor, selecione um arquivo de vídeo válido.');
});
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

// ── Handle file selection ─────────────────────────────────────
function handleFile(file) {
  originalFile = file;
  extractBrowserMeta(file);
  show(metaPanel);
  show(optPanel);
}

// ── Extract metadata available in the browser ─────────────────
function extractBrowserMeta(file) {
  originalMeta = {};

  // File system metadata
  addMeta('file.name',          file.name);
  addMeta('file.type',          file.type);
  addMeta('file.size',          formatBytes(file.size));
  addMeta('file.lastModified',  new Date(file.lastModified).toISOString());

  // Read video element metadata
  const url = URL.createObjectURL(file);
  const vid = document.createElement('video');
  vid.preload = 'metadata';
  vid.src = url;
  vid.onloadedmetadata = () => {
    addMeta('video.duration',   vid.duration.toFixed(3) + 's');
    addMeta('video.videoWidth', vid.videoWidth + 'px');
    addMeta('video.videoHeight',vid.videoHeight + 'px');

    // Try to detect tracks
    if (vid.videoTracks && vid.videoTracks.length) {
      addMeta('video.videoTracks', vid.videoTracks.length);
    }
    if (vid.audioTracks && vid.audioTracks.length) {
      addMeta('video.audioTracks', vid.audioTracks.length);
    }

    URL.revokeObjectURL(url);
    renderMeta();
  };
  vid.onerror = () => { URL.revokeObjectURL(url); renderMeta(); };
}

function addMeta(key, val) {
  if (val !== undefined && val !== null && val !== '') {
    originalMeta[key] = String(val);
  }
}

function renderMeta() {
  metaGrid.innerHTML = '';
  const keys = Object.keys(originalMeta);
  metaCount.textContent = keys.length + ' campos';

  keys.forEach(k => {
    const item = document.createElement('div');
    item.className = 'meta-item';
    item.innerHTML = `<div class="meta-key">${k}</div><div class="meta-val" title="${originalMeta[k]}">${originalMeta[k]}</div>`;
    metaGrid.appendChild(item);
  });
}

// ── Process button ────────────────────────────────────────────
btnProcess.addEventListener('click', async () => {
  btnProcess.disabled = true;
  show(progPanel);
  hide(optPanel);
  hide(metaPanel);

  try {
    await processVideo();
  } catch (err) {
    log('❌ Erro: ' + err.message);
    progLabel.textContent = 'Erro ao processar. Tente novamente.';
    btnProcess.disabled = false;
    show(optPanel);
    show(metaPanel);
  }
});

// ── FFmpeg processing ─────────────────────────────────────────
async function processVideo() {
  setProgress(5, 'Carregando FFmpeg…');
  log('Iniciando FFmpeg.wasm…');

  // Load FFmpeg only once
  if (!ffmpegInstance) {
    const { FFmpeg: FF } = window.FFmpegWASM
      || { FFmpeg: (await import('https://unpkg.com/@ffmpeg/ffmpeg@0.12.6/dist/esm/index.js')).FFmpeg };

    ffmpegInstance = new FF();

    ffmpegInstance.on('log', ({ message }) => log(message));
    ffmpegInstance.on('progress', ({ progress }) => {
      const pct = Math.round(progress * 70) + 20; // 20–90%
      setProgress(Math.min(pct, 90), 'Recodificando vídeo…');
    });

    await ffmpegInstance.load({
      coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
    });
  }

  setProgress(15, 'Lendo arquivo…');
  log(`Arquivo: ${originalFile.name} (${formatBytes(originalFile.size)})`);

  const inputExt  = originalFile.name.split('.').pop().toLowerCase();
  const inputName = 'input.' + inputExt;
  const outputName= 'output_clean.mp4';

  // Write input to FFmpeg FS
  const arrayBuf = await originalFile.arrayBuffer();
  const uint8    = new Uint8Array(arrayBuf);
  await ffmpegInstance.writeFile(inputName, uint8);

  setProgress(20, 'Removendo metadados e recodificando…');
  log('Executando remoção de metadados…');

  // Build FFmpeg command
  // -map_metadata -1  → remove ALL global metadata
  // -map_chapters -1  → remove chapter markers
  // -fflags +bitexact → remove encoder fingerprint
  // -c:v libx264 -c:a aac → re-encode to strip embedded tags
  // -movflags +faststart → clean MP4 structure
  // -metadata * → clear all tag fields explicitly

  const randomizeTS = document.getElementById('randomizeTimestamp').checked;

  const cmd = [
    '-i', inputName,
    '-map_metadata', '-1',
    '-map_chapters', '-1',
    '-fflags', '+bitexact',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    // Strip all known metadata tags
    '-metadata', 'title=',
    '-metadata', 'comment=',
    '-metadata', 'description=',
    '-metadata', 'author=',
    '-metadata', 'artist=',
    '-metadata', 'album=',
    '-metadata', 'year=',
    '-metadata', 'date=',
    '-metadata', 'creation_time=',
    '-metadata', 'location=',
    '-metadata', 'make=',
    '-metadata', 'model=',
    '-metadata', 'software=',
    '-metadata', 'encoder=',
    '-metadata', 'encoded_by=',
    '-metadata', 'copyright=',
    '-metadata', 'genre=',
    '-metadata', 'track=',
    '-metadata', 'major_brand=',
    '-metadata', 'minor_version=',
    '-metadata', 'compatible_brands=',
    '-metadata', 'com.android.version=',
    '-metadata', 'handler_name=',
    '-metadata', 'vendor_id=',
    outputName
  ];

  await ffmpegInstance.exec(cmd);

  setProgress(92, 'Finalizando…');
  log('Lendo arquivo de saída…');

  const data = await ffmpegInstance.readFile(outputName);
  const blob = new Blob([data.buffer], { type: 'video/mp4' });

  // Cleanup FS
  await ffmpegInstance.deleteFile(inputName).catch(() => {});
  await ffmpegInstance.deleteFile(outputName).catch(() => {});

  // Revoke old URL
  if (outputURL) URL.revokeObjectURL(outputURL);
  outputURL = URL.createObjectURL(blob);

  // Generate clean filename (strip tracking IDs from name too)
  const cleanName = sanitizeFilename(originalFile.name, inputExt);

  dlLink.href = outputURL;
  dlLink.download = cleanName;

  setProgress(100, 'Concluído!');
  log(`✅ Pronto! Arquivo limpo: ${cleanName} (${formatBytes(blob.size)})`);

  // Populate before list
  buildBeforeList();

  setTimeout(() => {
    hide(progPanel);
    show(resultPanel);
  }, 600);
}

// ── Helpers ───────────────────────────────────────────────────
function setProgress(pct, label) {
  progFill.style.width = pct + '%';
  progLabel.textContent = label;
}

function log(msg) {
  logBox.textContent += msg + '\n';
  logBox.scrollTop = logBox.scrollHeight;
}

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function sanitizeFilename(original, ext) {
  // Remove tracking patterns, UUIDs, timestamps from filename
  const base = original
    .replace(/\.[^/.]+$/, '')           // remove extension
    .replace(/[_-]?\b[0-9a-f]{8,}\b/gi, '') // remove hex IDs
    .replace(/\d{10,}/g, '')            // remove unix timestamps
    .replace(/[^a-zA-Z0-9áéíóúãõâêîôûàèìòùçñÁÉÍÓÚÃÕÂÊÎÔÛÀÈÌÒÙÇÑ\s]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .trim() || 'video';
  return `${base}_clean.mp4`;
}

function buildBeforeList() {
  beforeList.innerHTML = '';
  const keys = Object.keys(originalMeta).slice(0, 8); // show top 8
  keys.forEach(k => {
    const d = document.createElement('div');
    d.className = 'meta-list-item';
    d.textContent = `${k}: ${originalMeta[k].substring(0, 40)}`;
    beforeList.appendChild(d);
  });
  if (Object.keys(originalMeta).length > 8) {
    const d = document.createElement('div');
    d.className = 'meta-list-item';
    d.textContent = `+ ${Object.keys(originalMeta).length - 8} outros campos…`;
    beforeList.appendChild(d);
  }
}

// ── Reset ─────────────────────────────────────────────────────
function resetApp() {
  originalFile = null;
  originalMeta = {};
  if (outputURL) { URL.revokeObjectURL(outputURL); outputURL = null; }

  metaGrid.innerHTML = '';
  logBox.textContent = '';
  progFill.style.width = '0%';
  fileInput.value = '';
  btnProcess.disabled = false;

  hide(metaPanel);
  hide(optPanel);
  hide(progPanel);
  hide(resultPanel);
}

// ── Polyfill: try ESM import if UMD not loaded ────────────────
window.addEventListener('load', async () => {
  if (!window.FFmpegWASM) {
    try {
      window.FFmpegWASM = await import('https://unpkg.com/@ffmpeg/ffmpeg@0.12.6/dist/esm/index.js');
    } catch (e) {
      console.warn('FFmpeg ESM fallback failed:', e);
    }
  }
});
