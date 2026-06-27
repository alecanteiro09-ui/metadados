// ============================================================
// VideoClean — app.js  (v2 — corrigido CORS/Worker)
// ============================================================

let ffmpegInstance = null;
let originalFile   = null;
let outputURL      = null;
let originalMeta   = {};

// ── DOM refs ─────────────────────────────────────────────────
const dropZone    = document.getElementById('dropZone');
const fileInput   = document.getElementById('fileInput');
const metaPanel   = document.getElementById('metaPanel');
const metaGrid    = document.getElementById('metaGrid');
const metaCount   = document.getElementById('metaCount');
const optPanel    = document.getElementById('optionsPanel');
const btnProcess  = document.getElementById('btnProcess');
const progPanel   = document.getElementById('progressPanel');
const progFill    = document.getElementById('progressFill');
const progLabel   = document.getElementById('progressLabel');
const logBox      = document.getElementById('logBox');
const resultPanel = document.getElementById('resultPanel');
const beforeList  = document.getElementById('beforeList');
const dlLink      = document.getElementById('downloadLink');

// ── Drag-and-drop ────────────────────────────────────────────
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
  else alert('Selecione um arquivo de vídeo válido.');
});
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

// ── Handle file ───────────────────────────────────────────────
function handleFile(file) {
  originalFile = file;
  extractBrowserMeta(file);
  show(metaPanel);
  show(optPanel);
}

// ── Metadata extraction ───────────────────────────────────────
function extractBrowserMeta(file) {
  originalMeta = {};
  addMeta('file.name',         file.name);
  addMeta('file.type',         file.type);
  addMeta('file.size',         formatBytes(file.size));
  addMeta('file.lastModified', new Date(file.lastModified).toISOString());

  const url = URL.createObjectURL(file);
  const vid = document.createElement('video');
  vid.preload = 'metadata';
  vid.src = url;
  vid.onloadedmetadata = () => {
    addMeta('video.duration',    vid.duration.toFixed(3) + 's');
    addMeta('video.width',       vid.videoWidth + 'px');
    addMeta('video.height',      vid.videoHeight + 'px');
    URL.revokeObjectURL(url);
    renderMeta();
  };
  vid.onerror = () => { URL.revokeObjectURL(url); renderMeta(); };
}

function addMeta(key, val) {
  if (val !== undefined && val !== null && val !== '')
    originalMeta[key] = String(val);
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
    log('❌ Erro: ' + (err.message || err));
    progLabel.textContent = 'Erro ao processar. Tente novamente.';
    btnProcess.disabled = false;
    show(optPanel);
    show(metaPanel);
  }
});

// ── FFmpeg load (CORS-safe via toBlobURL) ─────────────────────
const FFMPEG_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.6/dist/umd';
const CORE_BASE   = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';

async function toBlobURL(url, mimeType) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Falha ao baixar: ${url}`);
  const blob = new Blob([await resp.arrayBuffer()], { type: mimeType });
  return URL.createObjectURL(blob);
}

async function loadFFmpeg() {
  if (ffmpegInstance) return ffmpegInstance;

  log('Baixando FFmpeg.wasm… (pode demorar alguns segundos)');
  setProgress(8, 'Baixando FFmpeg…');

  // Dynamically import the UMD bundle as a blob to avoid CORS on workers
  const ffmpegBlobURL = await toBlobURL(`${FFMPEG_BASE}/ffmpeg.js`, 'text/javascript');

  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = ffmpegBlobURL;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });

  const { FFmpeg } = window.FFmpegWASM;
  const ff = new FFmpeg();

  ff.on('log', ({ message }) => log(message));
  ff.on('progress', ({ progress }) => {
    const pct = Math.round(progress * 65) + 22;
    setProgress(Math.min(pct, 90), 'Recodificando vídeo…');
  });

  setProgress(12, 'Carregando core WASM…');
  log('Carregando core WASM…');

  const coreURL  = await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`,   'text/javascript');
  const wasmURL  = await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm');
  const workerURL= await toBlobURL(`${CORE_BASE}/ffmpeg-core.worker.js`, 'text/javascript');

  await ff.load({ coreURL, wasmURL, workerURL });

  ffmpegInstance = ff;
  log('FFmpeg pronto!');
  return ff;
}

// ── Main processing ───────────────────────────────────────────
async function processVideo() {
  setProgress(5, 'Iniciando…');
  log(`Arquivo: ${originalFile.name} (${formatBytes(originalFile.size)})`);

  const ff = await loadFFmpeg();

  setProgress(18, 'Lendo arquivo…');

  const inputExt  = (originalFile.name.split('.').pop() || 'mp4').toLowerCase();
  const inputName = 'input.' + inputExt;
  const outName   = 'output_clean.mp4';

  const buf  = await originalFile.arrayBuffer();
  await ff.writeFile(inputName, new Uint8Array(buf));

  setProgress(22, 'Removendo metadados e recodificando…');
  log('Executando limpeza de metadados…');

  const cmd = [
    '-i', inputName,
    '-map_metadata', '-1',
    '-map_chapters', '-1',
    '-fflags', '+bitexact',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    '-metadata', 'title=',
    '-metadata', 'comment=',
    '-metadata', 'description=',
    '-metadata', 'author=',
    '-metadata', 'artist=',
    '-metadata', 'album=',
    '-metadata', 'date=',
    '-metadata', 'creation_time=',
    '-metadata', 'location=',
    '-metadata', 'make=',
    '-metadata', 'model=',
    '-metadata', 'software=',
    '-metadata', 'encoder=',
    '-metadata', 'encoded_by=',
    '-metadata', 'copyright=',
    '-metadata', 'handler_name=',
    '-metadata', 'vendor_id=',
    outName
  ];

  await ff.exec(cmd);

  setProgress(92, 'Finalizando…');
  log('Lendo arquivo de saída…');

  const data = await ff.readFile(outName);
  const blob = new Blob([data.buffer], { type: 'video/mp4' });

  await ff.deleteFile(inputName).catch(() => {});
  await ff.deleteFile(outName).catch(() => {});

  if (outputURL) URL.revokeObjectURL(outputURL);
  outputURL = URL.createObjectURL(blob);

  const cleanName = sanitizeFilename(originalFile.name);
  dlLink.href = outputURL;
  dlLink.download = cleanName;

  setProgress(100, 'Concluído!');
  log(`✅ Pronto! ${cleanName} (${formatBytes(blob.size)})`);

  buildBeforeList();
  setTimeout(() => { hide(progPanel); show(resultPanel); }, 500);
}

// ── Utilities ─────────────────────────────────────────────────
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

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(2) + ' MB';
}

function sanitizeFilename(original) {
  const base = original
    .replace(/\.[^/.]+$/, '')
    .replace(/[_-]?\b[0-9a-f]{8,}\b/gi, '')
    .replace(/\d{10,}/g, '')
    .replace(/[^a-zA-ZÀ-ÿ0-9\s]/g, '_')
    .replace(/\s+|_+/g, '_')
    .replace(/^_|_$/g, '')
    .trim() || 'video';
  return `${base}_clean.mp4`;
}

function buildBeforeList() {
  beforeList.innerHTML = '';
  const keys = Object.keys(originalMeta).slice(0, 8);
  keys.forEach(k => {
    const d = document.createElement('div');
    d.className = 'meta-list-item';
    d.textContent = `${k}: ${originalMeta[k].substring(0, 40)}`;
    beforeList.appendChild(d);
  });
  const total = Object.keys(originalMeta).length;
  if (total > 8) {
    const d = document.createElement('div');
    d.className = 'meta-list-item';
    d.textContent = `+ ${total - 8} outros campos…`;
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
  hide(metaPanel); hide(optPanel); hide(progPanel); hide(resultPanel);
}
