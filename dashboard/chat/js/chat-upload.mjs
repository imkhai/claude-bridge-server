/**
 * Chat Upload — drag-drop, click-to-upload, clipboard paste, file preview.
 */

import * as api from './chat-api.mjs';

let pendingFiles = [];
let onFilesChanged = null;

const IMAGE_EXTS = /\.(png|jpg|jpeg|gif|webp)$/i;
const CODE_EXTS = /\.(js|mjs|ts|tsx|jsx|py|go|rs|java|c|cpp|h|css|html|json|yaml|yml|sh)$/i;

/**
 * Initialize upload module.
 * @param {Object} opts - { chatMain, dropOverlay, fileInput, attachBtn, filePreviewBar, filePreviews, onFilesChanged }
 */
export function init(opts) {
  const { chatMain, dropOverlay, fileInput, attachBtn, filePreviewBar, filePreviews } = opts;
  onFilesChanged = opts.onFilesChanged || (() => {});

  // Click to upload
  attachBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    addFiles(Array.from(fileInput.files));
    fileInput.value = '';
  });

  // Drag and drop
  let dragCounter = 0;

  chatMain.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    dropOverlay.classList.add('visible');
  });

  chatMain.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      dropOverlay.classList.remove('visible');
    }
  });

  chatMain.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  chatMain.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.classList.remove('visible');
    if (e.dataTransfer.files.length > 0) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  });

  // Paste from clipboard
  document.addEventListener('paste', (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter(i => i.type.startsWith('image/'));
    if (imageItems.length > 0) {
      e.preventDefault();
      const files = imageItems.map(item => item.getAsFile()).filter(Boolean);
      addFiles(files);
    }
  });
}

/**
 * Add files to pending list and render previews.
 */
function addFiles(files) {
  for (const file of files) {
    pendingFiles.push(file);
  }
  renderPreviews();
  onFilesChanged(pendingFiles);
}

/**
 * Render file preview thumbnails.
 */
function renderPreviews() {
  const bar = document.getElementById('filePreviewBar');
  const container = document.getElementById('filePreviews');
  container.innerHTML = '';

  if (pendingFiles.length === 0) {
    bar.classList.add('hidden');
    return;
  }

  bar.classList.remove('hidden');

  pendingFiles.forEach((file, idx) => {
    const item = document.createElement('div');
    item.className = 'file-preview-item';

    if (file.type.startsWith('image/')) {
      const img = document.createElement('img');
      img.className = 'file-preview-image';
      img.src = URL.createObjectURL(file);
      img.onload = () => URL.revokeObjectURL(img.src);
      item.appendChild(img);
    } else {
      const doc = document.createElement('div');
      doc.className = 'file-preview-doc';
      const ext = file.name.split('.').pop().toUpperCase();
      doc.innerHTML = `
        <span class="file-preview-doc-icon">${getFileEmoji(file.name)}</span>
        <span class="file-preview-doc-name" title="${file.name}">${file.name}</span>
      `;
      item.appendChild(doc);
    }

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'file-preview-remove';
    removeBtn.innerHTML = '&times;';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      pendingFiles.splice(idx, 1);
      renderPreviews();
      onFilesChanged(pendingFiles);
    });
    item.appendChild(removeBtn);

    container.appendChild(item);
  });
}

function getFileEmoji(filename) {
  if (IMAGE_EXTS.test(filename)) return '\u{1F5BC}';
  if (CODE_EXTS.test(filename)) return '\u{1F4C4}';
  if (/\.(md|txt)$/i.test(filename)) return '\u{1F4DD}';
  if (/\.pdf$/i.test(filename)) return '\u{1F4D1}';
  return '\u{1F4CE}';
}

/**
 * Upload pending files and return server file info.
 * Shows progress via a callback.
 */
export async function uploadPendingFiles(onProgress) {
  if (pendingFiles.length === 0) return [];

  const formData = new FormData();
  for (const file of pendingFiles) {
    formData.append('files', file);
  }

  if (onProgress) onProgress(0);

  try {
    const result = await api.uploadFiles(formData);
    if (onProgress) onProgress(100);
    clearPending();
    return result.files || [];
  } catch (err) {
    console.error('Upload error:', err);
    throw err;
  }
}

/**
 * Clear pending files.
 */
export function clearPending() {
  pendingFiles = [];
  renderPreviews();
  onFilesChanged(pendingFiles);
}

/**
 * Get current pending files count.
 */
export function getPendingCount() {
  return pendingFiles.length;
}

/**
 * Get file type category.
 */
export function getFileCategory(filename) {
  if (IMAGE_EXTS.test(filename)) return 'image';
  if (CODE_EXTS.test(filename)) return 'code';
  if (/\.(md|txt|pdf)$/i.test(filename)) return 'doc';
  return 'other';
}
