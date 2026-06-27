// ============================================================
// VideoClean — app.js  (v4 — sem FFmpeg, remoção direta de bytes)
// Remove metadados MP4/MOV zerando atoms de metadata (udta/meta/moov)
// Funciona em milissegundos, sem downloads pesados
// ============================================================

let originalFile = null;
let outputURL    = null;
let originalMeta = {};

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
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
  else alert('Selecione um arquivo de vídeo válido.');
});
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });

// ── Handle file ───────────────────────────────────────────────
function handleFile(file) {
  originalFile = file;
  extractBrowserMeta(file);
  show(metaPanel);
  show(optPanel);
}

// ── Metadata extraction (browser-level) ──────────────────────
function extractBrowserMeta(file) {
  originalMeta = {};
  addMeta('file.name',         file.name);
  addMeta('file.type',         file.type || 'video/mp4');
  addMeta('file.size',         formatBytes(file.size));
  addMeta('file.lastModified', new Date(file.lastModified).toISOString());

  const url = URL.createObjectURL(file);
  const vid = document.createElement('video');
  vid.preload = 'metadata';
  vid.src = url;
  vid.onloadedmetadata = () => {
    addMeta('video.duration', vid.duration.toFixed(3) + 's');
    addMeta('video.width',    vid.videoWidth + 'px');
    addMeta('video.height',   vid.videoHeight + 'px');
    URL.revokeObjectURL(url);

    // Also parse MP4 atoms for metadata
    readMP4Meta(file).then(mp4meta => {
      Object.assign(originalMeta, mp4meta);
      renderMeta();
    });
  };
  vid.onerror = () => {
    URL.revokeObjectURL(url);
    readMP4Meta(file).then(mp4meta => {
      Object.assign(originalMeta, mp4meta);
      renderMeta();
    });
  };
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
    item.innerHTML = `<div class="meta-key">${escHtml(k)}</div><div class="meta-val" title="${escHtml(originalMeta[k])}">${escHtml(originalMeta[k])}</div>`;
    metaGrid.appendChild(item);
  });
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ── MP4 atom parser (reads first 512KB to find metadata) ─────
async function readMP4Meta(file) {
  const meta = {};
  try {
    const slice = file.slice(0, Math.min(file.size, 1024 * 512));
    const buf   = await slice.arrayBuffer();
    const view  = new DataView(buf);
    const bytes = new Uint8Array(buf);

    // Walk top-level atoms
    let offset = 0;
    while (offset + 8 <= bytes.length) {
      const size = view.getUint32(offset);
      const type = readFourCC(bytes, offset + 4);
      if (size < 8 || size > buf.byteLength) break;

      if (type === 'ftyp') {
        meta['mp4.brand'] = readFourCC(bytes, offset + 8);
      }

      if (type === 'moov') {
        parseMoov(bytes, view, offset + 8, offset + size, meta);
      }

      offset += size;
    }
  } catch (e) { /* ignore parse errors */ }
  return meta;
}

function parseMoov(bytes, view, start, end, meta) {
  let o = start;
  while (o + 8 <= end && o < bytes.length) {
    const size = view.getUint32(o);
    const type = readFourCC(bytes, o + 4);
    if (size < 8) break;

    if (type === 'udta') parseUdta(bytes, view, o + 8, o + size, meta);
    if (type === 'mvhd') parseMvhd(bytes, view, o + 8, meta);

    o += size;
  }
}

function parseUdta(bytes, view, start, end, meta) {
  let o = start;
  while (o + 8 <= end && o < bytes.length) {
    const size = view.getUint32(o);
    const type = readFourCC(bytes, o + 4);
    if (size < 8) break;

    if (type === 'meta') parseMeta(bytes, view, o + 8, o + size, meta);
    if (type === '\xA9nam') meta['udta.title']   = readUtf8(bytes, o + 8, o + size);
    if (type === '\xA9cmt') meta['udta.comment'] = readUtf8(bytes, o + 8, o + size);
    if (type === '\xA9day') meta['udta.date']    = readUtf8(bytes, o + 8, o + size);
    if (type === '\xA9enc') meta['udta.encoder'] = readUtf8(bytes, o + 8, o + size);
    if (type === '\xA9too') meta['udta.tool']    = readUtf8(bytes, o + 8, o + size);
    if (type === 'loci')    meta['udta.location']= 'presente';
    if (type === 'auth')    meta['udta.author']  = readUtf8(bytes, o + 8, o + size);
    if (type === 'titl')    meta['udta.titl']    = readUtf8(bytes, o + 8, o + size);

    o += size;
  }
}

function parseMeta(bytes, view, start, end, meta) {
  // meta atom has 4-byte version/flags before children
  let o = start + 4;
  while (o + 8 <= end && o < bytes.length) {
    const size = view.getUint32(o);
    const type = readFourCC(bytes, o + 4);
    if (size < 8) break;
    if (type === 'ilst') parseIlst(bytes, view, o + 8, o + size, meta);
    o += size;
  }
}

function parseIlst(bytes, view, start, end, meta) {
  const tagMap = {
    '\xA9nam': 'ilst.title',    '\xA9ART': 'ilst.artist',
    '\xA9alb': 'ilst.album',    '\xA9day': 'ilst.date',
    '\xA9cmt': 'ilst.comment',  '\xA9enc': 'ilst.encoder',
    '\xA9too': 'ilst.tool',     'cprt':    'ilst.copyright',
    'desc':    'ilst.desc',     'ldes':    'ilst.longdesc',
    'auth':    'ilst.author',   'gnre':    'ilst.genre',
    'keyw':    'ilst.keywords', 'catg':    'ilst.category',
  };
  let o = start;
  while (o + 8 <= end && o < bytes.length) {
    const size = view.getUint32(o);
    const type = readFourCC(bytes, o + 4);
    if (size < 8) break;
    const key = tagMap[type];
    if (key) {
      // data atom inside
      const val = readIlstData(bytes, view, o + 8, o + size);
      if (val) meta[key] = val;
    }
    o += size;
  }
}

function readIlstData(bytes, view, start, end) {
  let o = start;
  while (o + 8 <= end && o < bytes.length) {
    const size = view.getUint32(o);
    const type = readFourCC(bytes, o + 4);
    if (size < 8) break;
    if (type === 'data' && size > 16) {
      return readUtf8(bytes, o + 16, Math.min(o + size, end));
    }
    o += size;
  }
  return null;
}

function parseMvhd(bytes, view, offset, meta) {
  try {
    const version = bytes[offset];
    let creationTime;
    if (version === 1) {
      // 64-bit timestamps
      const hi = view.getUint32(offset + 4);
      const lo = view.getUint32(offset + 8);
      creationTime = hi * 4294967296 + lo;
    } else {
      creationTime = view.getUint32(offset + 4);
    }
    // MP4 epoch is Jan 1 1904
    if (creationTime > 0) {
      const epoch1904 = new Date('1904-01-01T00:00:00Z').getTime();
      const ms = epoch1904 + creationTime * 1000;
      meta['mvhd.creation_time'] = new Date(ms).toISOString();
    }
  } catch(e) {}
}

function readFourCC(bytes, offset) {
  return String.fromCharCode(bytes[offset], bytes[offset+1], bytes[offset+2], bytes[offset+3]);
}

function readUtf8(bytes, start, end) {
  try {
    const slice = bytes.slice(start, Math.min(end, start + 200));
    return new TextDecoder('utf-8', { fatal: false }).decode(slice).replace(/\0/g, '').trim().substring(0, 80);
  } catch(e) { return ''; }
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
    console.error(err);
    log('❌ Erro: ' + (err.message || String(err)));
    progLabel.textContent = 'Erro. Tente novamente.';
    btnProcess.disabled = false;
    show(optPanel);
    show(metaPanel);
  }
});

// ── Core: MP4 metadata removal (pure JS, zero downloads) ─────
//
// Estratégia:
// 1. Lê o arquivo como ArrayBuffer
// 2. Percorre os atoms do container MP4/MOV
// 3. Remove / zera os atoms: udta, meta, uuid (XMP), free
// 4. Dentro do moov, zera os campos de string do mvhd (timestamps → epoch)
// 5. Reconstrói o arquivo sem os atoms removidos
// 6. Gera novo Blob para download
//
// Isso remove TODOS os metadados sem re-encodar o vídeo (mantém qualidade original)
// e é instantâneo mesmo para arquivos de GB.

async function processVideo() {
  setProgress(5, 'Lendo arquivo…');
  log(`Arquivo: ${originalFile.name} (${formatBytes(originalFile.size)})`);

  const buf   = await originalFile.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const view  = new DataView(buf);

  setProgress(20, 'Analisando estrutura MP4…');
  log('Analisando atoms MP4…');

  const atoms = parseTopAtoms(bytes, view);
  log(`Atoms encontrados: ${atoms.map(a => a.type).join(', ')}`);

  setProgress(40, 'Removendo metadados…');
  log('Removendo udta / meta / uuid (XMP)…');

  // Atoms de metadata a remover completamente
  const REMOVE_ATOMS = new Set(['udta', 'uuid', 'free', 'skip', 'wide']);

  // Atoms a manter mas limpar internamente
  const CLEAN_ATOMS  = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts']);

  const chunks = [];
  let removed = 0;

  for (const atom of atoms) {
    if (REMOVE_ATOMS.has(atom.type)) {
      log(`  ✂ Removido: ${atom.type} (${formatBytes(atom.size)})`);
      removed++;
      continue;
    }

    if (atom.type === 'moov') {
      const cleaned = cleanMoov(bytes, view, atom);
      chunks.push(cleaned);
      log(`  ✓ moov limpo (timestamps zerados, udta removido)`);
    } else {
      // Copia atom sem alteração (ftyp, mdat, etc.)
      chunks.push(bytes.slice(atom.offset, atom.offset + atom.size));
    }
  }

  setProgress(75, 'Montando novo arquivo…');
  log(`Reconstruindo arquivo (${removed} atoms removidos)…`);

  // Monta novo arquivo
  const totalSize = chunks.reduce((s, c) => s + c.length, 0);
  const output    = new Uint8Array(totalSize);
  let pos = 0;
  for (const chunk of chunks) {
    output.set(chunk, pos);
    pos += chunk.length;
  }

  setProgress(90, 'Gerando arquivo limpo…');

  const mimeType = originalFile.type || 'video/mp4';
  const blob     = new Blob([output], { type: mimeType });

  if (outputURL) URL.revokeObjectURL(outputURL);
  outputURL = URL.createObjectURL(blob);

  const cleanName = sanitizeFilename(originalFile.name);
  dlLink.href     = outputURL;
  dlLink.download = cleanName;

  setProgress(100, 'Concluído!');
  log(`✅ Pronto! ${cleanName} (${formatBytes(blob.size)})`);
  log(`   Original: ${formatBytes(originalFile.size)} → Limpo: ${formatBytes(blob.size)}`);

  buildBeforeList();
  setTimeout(() => { hide(progPanel); show(resultPanel); }, 400);
}

// ── Parse top-level atoms ────────────────────────────────────
function parseTopAtoms(bytes, view) {
  const atoms = [];
  let offset = 0;

  while (offset + 8 <= bytes.length) {
    let size = view.getUint32(offset);
    const type = readFourCC(bytes, offset + 4);

    // Extended size (64-bit)
    if (size === 1) {
      if (offset + 16 > bytes.length) break;
      const hi = view.getUint32(offset + 8);
      const lo = view.getUint32(offset + 12);
      size = hi * 4294967296 + lo;
    }
    // Atom extends to EOF
    if (size === 0) size = bytes.length - offset;

    if (size < 8 || offset + size > bytes.length + 1) break;

    atoms.push({ offset, size: Math.min(size, bytes.length - offset), type });
    offset += Math.min(size, bytes.length - offset);
  }

  return atoms;
}

// ── Clean moov atom: remove udta, zero mvhd timestamps ───────
function cleanMoov(bytes, view, moovAtom) {
  const moovData = bytes.slice(moovAtom.offset, moovAtom.offset + moovAtom.size);
  const moovView = new DataView(moovData.buffer);
  const out      = [];

  // Keep 8-byte moov header, then process children
  // We'll re-read children and filter/clean them
  let offset = 8; // skip moov size + type

  while (offset + 8 <= moovData.length) {
    let size = moovView.getUint32(offset);
    const type = readFourCC(moovData, offset + 4);

    if (size === 1 && offset + 16 <= moovData.length) {
      const hi = moovView.getUint32(offset + 8);
      const lo = moovView.getUint32(offset + 12);
      size = hi * 4294967296 + lo;
    }
    if (size === 0) size = moovData.length - offset;
    if (size < 8 || offset + size > moovData.length + 1) break;

    const actualSize = Math.min(size, moovData.length - offset);

    // Remove metadata atoms inside moov
    if (type === 'udta' || type === 'meta' || type === 'uuid' || type === 'free') {
      offset += actualSize;
      continue;
    }

    // Clean mvhd: zero creation_time and modification_time
    if (type === 'mvhd') {
      const mvhd = moovData.slice(offset, offset + actualSize).slice(); // copy
      zeroMvhdTimestamps(mvhd);
      out.push(mvhd);
      offset += actualSize;
      continue;
    }

    // Recursively clean trak atoms (they can contain udta too)
    if (type === 'trak') {
      out.push(cleanTrak(moovData, moovView, offset, offset + actualSize));
      offset += actualSize;
      continue;
    }

    out.push(moovData.slice(offset, offset + actualSize));
    offset += actualSize;
  }

  // Recalculate moov size
  const childrenSize = out.reduce((s, c) => s + c.length, 0);
  const newMoovSize  = 8 + childrenSize;
  const newMoov      = new Uint8Array(newMoovSize);
  const newView      = new DataView(newMoov.buffer);
  newView.setUint32(0, newMoovSize);
  newMoov[4] = 0x6D; newMoov[5] = 0x6F; newMoov[6] = 0x6F; newMoov[7] = 0x76; // 'moov'

  let pos = 8;
  for (const chunk of out) { newMoov.set(chunk, pos); pos += chunk.length; }

  return newMoov;
}

// ── Clean trak: remove udta inside track ─────────────────────
function cleanTrak(parentData, parentView, start, end) {
  const trakData = parentData.slice(start, end);
  const trakView = new DataView(trakData.buffer);
  const out      = [];
  let offset     = 8;

  while (offset + 8 <= trakData.length) {
    let size = trakView.getUint32(offset);
    const type = readFourCC(trakData, offset + 4);
    if (size < 8) break;
    const actualSize = Math.min(size, trakData.length - offset);

    if (type === 'udta' || type === 'meta' || type === 'uuid') {
      offset += actualSize;
      continue;
    }

    if (type === 'tkhd') {
      const tkhd = trakData.slice(offset, offset + actualSize).slice();
      zeroTkhdTimestamps(tkhd);
      out.push(tkhd);
      offset += actualSize;
      continue;
    }

    out.push(trakData.slice(offset, offset + actualSize));
    offset += actualSize;
  }

  const childrenSize = out.reduce((s, c) => s + c.length, 0);
  const newSize      = 8 + childrenSize;
  const newTrak      = new Uint8Array(newSize);
  const newView      = new DataView(newTrak.buffer);
  newView.setUint32(0, newSize);
  newTrak[4] = 0x74; newTrak[5] = 0x72; newTrak[6] = 0x61; newTrak[7] = 0x6B; // 'trak'

  let pos = 8;
  for (const chunk of out) { newTrak.set(chunk, pos); pos += chunk.length; }
  return newTrak;
}

// ── Zero timestamps in mvhd ───────────────────────────────────
function zeroMvhdTimestamps(mvhd) {
  // mvhd layout after 8-byte header:
  // version(1) + flags(3) + creation_time(4 or 8) + modification_time(4 or 8)
  const version = mvhd[8];
  if (version === 1) {
    // 64-bit: bytes 9-24 = creation + modification
    for (let i = 9; i < 25; i++) mvhd[i] = 0;
  } else {
    // 32-bit: bytes 9-16 = creation + modification
    for (let i = 9; i < 17; i++) mvhd[i] = 0;
  }
}

// ── Zero timestamps in tkhd ───────────────────────────────────
function zeroTkhdTimestamps(tkhd) {
  const version = tkhd[8];
  if (version === 1) {
    for (let i = 9; i < 25; i++) tkhd[i] = 0;
  } else {
    for (let i = 9; i < 17; i++) tkhd[i] = 0;
  }
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
  if (b < 1073741824) return (b / 1048576).toFixed(2) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
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
  const ext = original.split('.').pop() || 'mp4';
  return `${base}_clean.${ext}`;
}
function buildBeforeList() {
  beforeList.innerHTML = '';
  const keys = Object.keys(originalMeta).slice(0, 8);
  keys.forEach(k => {
    const d = document.createElement('div');
    d.className = 'meta-list-item';
    d.textContent = `${k}: ${String(originalMeta[k]).substring(0, 40)}`;
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
