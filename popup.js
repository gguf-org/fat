/* global parseGGUF, buildGGUF, formatValue, isEditableType, quantizationName,
          GGUFValueType, GGUFValueTypeName */

// ─── State ────────────────────────────────────────────────────────────────────

let parsedData   = null;   // result of parseGGUF()
let fileBuffer   = null;   // original ArrayBuffer
let fileName     = '';
let fileSize     = 0;
const deletedTensors = new Set();
const MAX_ARRAY_ELEMENTS = 30;

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const fileInput      = document.getElementById('file-input');
const fileBtn        = document.getElementById('file-btn');
const landingOpenBtn = document.getElementById('landing-open-btn');
const fileLabel      = document.getElementById('file-label');
const searchInput    = document.getElementById('search-input');
const clearSearchBtn = document.getElementById('clear-search-btn');
const saveBtn        = document.getElementById('save-btn');
const themeBtn       = document.getElementById('theme-btn');
const themeSun       = document.getElementById('theme-icon-sun');
const themeMoon      = document.getElementById('theme-icon-moon');
const errorBanner    = document.getElementById('error-banner');
const errorText      = document.getElementById('error-text');
const landing        = document.getElementById('landing');
const loading        = document.getElementById('loading');
const dataView       = document.getElementById('data-view');
const metaBody       = document.getElementById('meta-body');
const tensorBody     = document.getElementById('tensor-body');
const metaCount      = document.getElementById('meta-count');
const tensorCount    = document.getElementById('tensor-count');
const metaEmpty      = document.getElementById('meta-empty');
const tensorEmpty    = document.getElementById('tensor-empty');
const saveToast      = document.getElementById('save-toast');

const statVersion    = document.getElementById('stat-version');
const statMeta       = document.getElementById('stat-meta');
const statTensors    = document.getElementById('stat-tensors');
const statSize       = document.getElementById('stat-size');
const statGgufVer    = document.getElementById('stat-gguf-ver');

// ─── Theme ────────────────────────────────────────────────────────────────────

function initTheme() {
  const saved = localStorage.getItem('gguf-editor-theme') ?? 'light';
  applyTheme(saved);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeSun.style.display  = theme === 'dark' ? 'block' : 'none';
  themeMoon.style.display = theme === 'dark' ? 'none'  : 'block';
  localStorage.setItem('gguf-editor-theme', theme);
}

themeBtn.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') ?? 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

// ─── File picking ─────────────────────────────────────────────────────────────

function openFilePicker() { fileInput.click(); }

fileBtn.addEventListener('click', openFilePicker);
landingOpenBtn.addEventListener('click', openFilePicker);

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  loadFile(file);
  // reset input so the same file can be re-opened
  fileInput.value = '';
});

async function loadFile(file) {
  if (!file.name.endsWith('.gguf')) {
    showError('Please select a .gguf file.');
    return;
  }

  // Show loading state
  hideError();
  showView('loading');
  deletedTensors.clear();
  fileName = file.name;
  fileSize = file.size;

  try {
    fileBuffer = await file.arrayBuffer();
    parsedData = parseGGUF(fileBuffer);
    renderAll();
    showView('data');
    fileLabel.textContent = file.name;
    saveBtn.disabled = false;
  } catch (err) {
    showError(`Failed to parse GGUF file: ${err.message}`);
    showView('landing');
    saveBtn.disabled = true;
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderAll(filter = '') {
  renderStats();
  renderMetadata(filter);
  renderTensors(filter);
}

function renderStats() {
  const { version, metadata, tensorInfos } = parsedData;
  statVersion.textContent  = version;
  statGgufVer.textContent  = `GGUF v${version}`;
  statMeta.textContent     = Object.keys(metadata).length;
  statTensors.textContent  = tensorInfos.length;
  statSize.textContent     = formatBytes(fileSize);
}

function renderMetadata(filter = '') {
  metaBody.innerHTML = '';
  const lc = filter.toLowerCase();
  let shown = 0;

  for (const [key, { type, value }] of Object.entries(parsedData.metadata)) {
    const displayVal = formatValue(type, value, MAX_ARRAY_ELEMENTS);
    if (lc && !key.toLowerCase().includes(lc) && !displayVal.toLowerCase().includes(lc)) continue;

    const editable = isEditableType(type);
    const row = document.createElement('tr');
    row.dataset.key = key;

    // Key cell
    const keyTd = document.createElement('td');
    keyTd.className = 'key';
    keyTd.title = key;
    keyTd.textContent = key;

    // Value cell
    const valTd = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'value-input';
    input.value = displayVal;
    if (!editable) {
      input.readOnly = true;
      input.title = 'Array values cannot be edited directly';
    }
    valTd.appendChild(input);

    // Type cell
    const typeTd = document.createElement('td');
    typeTd.style.cssText = 'text-align:center';
    const typeTag = document.createElement('span');
    typeTag.className = 'dtype-tag';
    typeTag.textContent = GGUFValueTypeName[type] ?? type;
    typeTd.appendChild(typeTag);

    row.appendChild(keyTd);
    row.appendChild(valTd);
    row.appendChild(typeTd);
    metaBody.appendChild(row);
    shown++;
  }

  metaCount.textContent = shown;
  metaEmpty.style.display = shown === 0 ? 'block' : 'none';
}

function renderTensors(filter = '') {
  tensorBody.innerHTML = '';
  const lc = filter.toLowerCase();
  let shown = 0;

  parsedData.tensorInfos.forEach((tensor, idx) => {
    const dtype = quantizationName(tensor.dtype);
    const shape = tensor.shape.join(' × ') || '(scalar)';

    if (lc &&
        !tensor.name.toLowerCase().includes(lc) &&
        !dtype.toLowerCase().includes(lc) &&
        !shape.toLowerCase().includes(lc)) return;

    const row = document.createElement('tr');
    row.dataset.tensorIdx = idx;
    if (deletedTensors.has(idx)) row.classList.add('deleted');

    // Name cell
    const nameTd = document.createElement('td');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'name-input';
    nameInput.value = tensor.name;
    nameInput.dataset.originalName = tensor.name;
    if (deletedTensors.has(idx)) nameInput.disabled = true;
    nameTd.appendChild(nameInput);

    // Shape cell
    const shapeTd = document.createElement('td');
    const shapeTag = document.createElement('span');
    shapeTag.className = 'shape-tag';
    shapeTag.textContent = shape;
    shapeTd.appendChild(shapeTag);

    // Precision cell
    const dtypeTd = document.createElement('td');
    const dtypeTag = document.createElement('span');
    dtypeTag.className = 'dtype-tag';
    dtypeTag.textContent = dtype;
    dtypeTd.appendChild(dtypeTag);

    // Actions cell
    const actionsTd = document.createElement('td');
    actionsTd.className = 'actions-cell';
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-danger';
    delBtn.textContent = deletedTensors.has(idx) ? 'Restore' : 'Delete';
    delBtn.title = deletedTensors.has(idx) ? 'Restore tensor' : 'Mark tensor for deletion';
    delBtn.addEventListener('click', () => toggleDeleteTensor(idx));
    actionsTd.appendChild(delBtn);

    row.appendChild(nameTd);
    row.appendChild(shapeTd);
    row.appendChild(dtypeTd);
    row.appendChild(actionsTd);
    tensorBody.appendChild(row);
    shown++;
  });

  tensorCount.textContent = shown;
  tensorEmpty.style.display = shown === 0 ? 'block' : 'none';
}

// ─── Tensor delete toggle ────────────────────────────────────────────────────

function toggleDeleteTensor(idx) {
  if (deletedTensors.has(idx)) {
    deletedTensors.delete(idx);
  } else {
    deletedTensors.add(idx);
  }
  // Re-render only the tensor table to avoid losing metadata edits
  renderTensors(searchInput.value.trim());
}

// ─── Search ───────────────────────────────────────────────────────────────────

let searchDebounce = null;
searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    if (!parsedData) return;
    renderAll(searchInput.value.trim());
  }, 200);
});

clearSearchBtn.addEventListener('click', () => {
  searchInput.value = '';
  if (parsedData) renderAll('');
});

// ─── Save ─────────────────────────────────────────────────────────────────────

saveBtn.addEventListener('click', saveFile);

async function saveFile() {
  if (!parsedData || !fileBuffer) return;

  // Collect edited metadata from input fields
  const editedMetadata = {};
  for (const row of metaBody.querySelectorAll('tr')) {
    const key = row.dataset.key;
    const input = row.querySelector('.value-input');
    if (key && input && !input.readOnly) {
      editedMetadata[key] = input.value;
    }
  }

  // Collect edited tensor names
  const editedTensorNames = [...parsedData.tensorInfos.map(t => t.name)];
  for (const row of tensorBody.querySelectorAll('tr')) {
    const idx = parseInt(row.dataset.tensorIdx, 10);
    const nameInput = row.querySelector('.name-input');
    if (!isNaN(idx) && nameInput) {
      editedTensorNames[idx] = nameInput.value;
    }
  }

  let newBytes;
  try {
    newBytes = buildGGUF(fileBuffer, parsedData, editedMetadata, editedTensorNames, deletedTensors);
  } catch (err) {
    showError(`Failed to build GGUF: ${err.message}`);
    return;
  }

  // Try File System Access API first, fall back to download
  const suggestedName = fileName.replace(/\.gguf$/, '_edited.gguf');

  if (typeof showSaveFilePicker === 'function') {
    try {
      const handle = await showSaveFilePicker({
        suggestedName,
        types: [{ description: 'GGUF Model File', accept: { 'application/octet-stream': ['.gguf'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(newBytes);
      await writable.close();
      showToast('File saved successfully!');
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // user cancelled
      // fall through to download fallback
    }
  }

  // Fallback: browser download
  const blob = new Blob([newBytes], { type: 'application/octet-stream' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Download started!');
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function showView(view) {
  landing.style.display  = view === 'landing'  ? 'flex'  : 'none';
  loading.style.display  = view === 'loading'  ? 'flex'  : 'none';
  dataView.style.display = view === 'data'     ? 'block' : 'none';
}

function showError(msg) {
  errorText.textContent = msg;
  errorBanner.style.display = 'flex';
}

function hideError() {
  errorBanner.style.display = 'none';
}

function showToast(msg) {
  saveToast.textContent = msg;
  saveToast.classList.add('show');
  setTimeout(() => saveToast.classList.remove('show'), 2500);
}

function formatBytes(bytes) {
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1048576)    return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

initTheme();
showView('landing');
