// JS для voiceover.html: drag&drop, предпросмотр видео, таймлайны, запись
let mkvFile = null;
let videoBlob = null;
let originalAudioBlob = null;
let userAudioBlob = null;
let wavesurferOriginal = null;
let wavesurferUser = null;
let mediaRecorder = null;
let userAudioChunks = [];
let userAudioBuffer = null;
let userAudioDuration = 0;

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const videoPreview = document.getElementById('video-preview');
const videoElem = document.getElementById('video');
const timelines = document.getElementById('timelines');
const statusDiv = document.getElementById('status');
const recordBtn = document.getElementById('record-btn');
const stopBtn = document.getElementById('stop-btn');
const playMixBtn = document.getElementById('play-mix-btn');
const downloadBtn = document.getElementById('download-btn');
let subsText = null;
let subsType = null;
const subsPreviewBlock = document.getElementById('subs-preview-block');
const subsPreview = document.getElementById('subs-preview');
const subsUploadBlock = document.getElementById('subs-upload-block');
const subsInput = document.getElementById('subs-input');
const progressBarBlock = document.getElementById('progress-bar-block');
const progressBar = document.getElementById('progress-bar');
const progressBarLabel = document.getElementById('progress-bar-label');
const originalAudioTime = document.getElementById('original-audio-time');
const userAudioTime = document.getElementById('user-audio-time');
const videoPreviewDiv = document.getElementById('video-preview');
const saveArchiveBtn = document.getElementById('save-archive-btn');
const loadArchiveBtn = document.getElementById('load-archive-btn');
const loadArchiveInput = document.getElementById('load-archive-input');
const subsTrackSelect = document.getElementById('subs-track-select');
let allExtractedSubs = [];

// Импортируем модули
import { setSubsElements, showSubs } from './subs.js';
import { setAudioElements, encodeWAV, createEmptyUserAudio, syncTimelineToVideo, syncAllTimelines, syncAllTimelinesWithCursors, enableTimelineTimeDisplay } from './audio.js';
import { showProgress, hideProgress, setVideoSize, setUiElements, showVideoAndAudio } from './ui.js';
import { saveArchive, loadArchive, setArchiveElements } from './archive.js';
import { debugLog } from './debug.js';

// Инициализация UI-модуля
setUiElements({
  progressBarBlockEl: progressBarBlock,
  progressBarEl: progressBar,
  progressBarLabelEl: progressBarLabel,
  videoPreviewDivEl: videoPreviewDiv
});

// Инициализация archive-модуля
setArchiveElements({
  statusDivEl: statusDiv,
  showProgressFn: showProgress,
  hideProgressFn: hideProgress,
  encodeWAVFn: encodeWAV,
  showSubsFn: showSubs,
  userAudioBufferRef: userAudioBuffer,
  userAudioDurationRef: userAudioDuration,
  subsTypeRef: subsType,
  mkvFileRef: mkvFile,
  videoElemRef: videoElem,
  wavesurferOriginalRef: wavesurferOriginal,
  wavesurferUserRef: wavesurferUser
});

// Инициализация subs-модуля
setSubsElements({
  subsPreviewEl: subsPreview,
  videoEl: videoElem,
  wavesurferOrig: wavesurferOriginal,
  wavesurferUsr: wavesurferUser
});

// === МОДАЛКА ПРОГРЕССА ===
const modalProgress = document.getElementById('modal-progress');
const modalProgressBar = document.getElementById('modal-progress-bar');
const modalProgressLabel = document.getElementById('modal-progress-label');

function showModalProgress(label) {
  debugLog('Показ модалки прогресса', label);
  if (modalProgress) modalProgress.style.display = 'flex';
  if (modalProgressLabel) modalProgressLabel.textContent = label || 'Подождите, идёт обработка файла';
  if (modalProgressBar) modalProgressBar.style.width = '0%';
}
function updateModalProgress(percent, label) {
  debugLog('Обновление прогресса', percent, label);
  if (modalProgressBar) modalProgressBar.style.width = percent + '%';
  if (modalProgressLabel && label) modalProgressLabel.textContent = label;
}
function hideModalProgress() {
  debugLog('Скрытие модалки прогресса');
  if (modalProgress) modalProgress.style.display = 'none';
}

// --- ВЫБОР ДОРОЖКИ СУБТИТРОВ ---
function uploadAndExtract(file) {
  debugLog('Начало загрузки MKV', file);
  showModalProgress('Загрузка файла...');
  const formData = new FormData();
  formData.append('mkvfile', file);
  updateModalProgress(10, 'Загрузка файла...');
  fetch('/voiceover-upload', {
    method:'POST',
    body:formData,
  }).then(async r => {
    updateModalProgress(30, 'Обработка видео [1/3]');
    // эмулируем этапы для UX (реально сервер работает атомарно, но UX будет лучше)
    await new Promise(res => setTimeout(res, 200));
    updateModalProgress(60, 'Обработка звуковой дорожки [2/3]');
    await new Promise(res => setTimeout(res, 200));
    updateModalProgress(80, 'Обработка субтитров [3/3]');
    await new Promise(res => setTimeout(res, 200));
    return r.json();
  })
  .then(async data => {
    debugLog('Ответ от /voiceover-upload', data);
    // --- Динамический прогресс по дорожкам ---
    let progress = 30;
    let step = 0;
    // Видео
    const videoCount = data.video_tracks ? data.video_tracks.length : (data.video_url ? 1 : 0);
    for (let i = 0; i < videoCount; ++i) {
      updateModalProgress(progress, `Обработка видео [${i+1}/${videoCount}]`);
      await new Promise(res => setTimeout(res, 200));
      progress += 10;
    }
    // Аудио
    const audioCount = data.audio_tracks ? data.audio_tracks.length : (data.audio_url ? 1 : 0);
    for (let i = 0; i < audioCount; ++i) {
      updateModalProgress(progress, `Обработка звуковой дорожки [${i+1}/${audioCount}]`);
      await new Promise(res => setTimeout(res, 200));
      progress += 10;
    }
    // Субтитры
    const subsCount = data.subs_tracks ? data.subs_tracks.length : (data.subs_text ? 1 : 0);
    for (let i = 0; i < subsCount; ++i) {
      updateModalProgress(progress, `Обработка субтитров [${i+1}/${subsCount}]`);
      await new Promise(res => setTimeout(res, 200));
      progress += 10;
    }
    updateModalProgress(100, 'Готово!');
    setTimeout(hideModalProgress, 600);
    if (data.error) {
      debugLog('Ошибка загрузки', data.error);
      statusDiv.textContent = data.error;
      return;
    }
    showMainWorkspace();
    showVideoAndAudio(data.video_url, data.audio_url);
    setAudioElements({
      wavesurferOrig: window.wavesurferOriginal,
      wavesurferUsr: window.wavesurferUser,
      videoEl: videoElem,
      userAudioBuf: window.userAudioBuffer || null
    });
    setSubsElements({
      subsPreviewEl: subsPreview,
      videoEl: videoElem,
      wavesurferOrig: window.wavesurferOriginal,
      wavesurferUsr: window.wavesurferUser
    });
    // --- поддержка нескольких субтитров ---
    if (data.subs_tracks && Array.isArray(data.subs_tracks) && data.subs_tracks.length > 0) {
      allExtractedSubs = data.subs_tracks;
      subsTrackSelect.innerHTML = '';
      data.subs_tracks.forEach((track, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = track.label || `Субтитры ${idx+1}`;
        subsTrackSelect.appendChild(opt);
      });
      subsTrackSelect.style.display = '';
      let firstValidIdx = data.subs_tracks.findIndex(t => t.text && t.text.trim());
      if (firstValidIdx !== -1) {
        subsTrackSelect.value = firstValidIdx;
        showSubs(data.subs_tracks[firstValidIdx].text, data.subs_tracks[firstValidIdx].type);
        window.subsText = data.subs_tracks[firstValidIdx].text;
        window.subsType = data.subs_tracks[firstValidIdx].type;
      } else {
        const firstError = data.subs_tracks.find(t => t.error);
        if (firstError) {
          subsPreview.innerHTML = firstError.error;
        } else {
          subsPreview.innerHTML = 'Субтитры не найдены или не поддерживаются.';
        }
        subsPreviewBlock.style.display = '';
        subsUploadBlock.style.display = 'none';
        window.subsText = '';
        window.subsType = '';
      }
      subsTrackSelect.onchange = function() {
        const idx = parseInt(this.value);
        if (allExtractedSubs[idx] && allExtractedSubs[idx].text && allExtractedSubs[idx].text.trim()) {
          showSubs(allExtractedSubs[idx].text, allExtractedSubs[idx].type);
          window.subsText = allExtractedSubs[idx].text;
          window.subsType = allExtractedSubs[idx].type;
        } else if (allExtractedSubs[idx] && allExtractedSubs[idx].error) {
          subsPreview.innerHTML = allExtractedSubs[idx].error;
          subsPreviewBlock.style.display = '';
          subsUploadBlock.style.display = 'none';
          window.subsText = '';
          window.subsType = '';
        } else {
          subsPreview.innerHTML = 'Субтитры не найдены или не поддерживаются.';
          subsPreviewBlock.style.display = '';
          subsUploadBlock.style.display = 'none';
          window.subsText = '';
          window.subsType = '';
        }
      };
      subsPreviewBlock.style.display = '';
    } else if (data.subs_text) {
      subsTrackSelect.style.display = 'none';
      showSubs(data.subs_text, data.subs_type);
      subsPreviewBlock.style.display = '';
      window.subsText = data.subs_text;
      window.subsType = data.subs_type;
    } else {
      subsTrackSelect.style.display = 'none';
      showSubsUpload();
      window.subsText = '';
      window.subsType = '';
    }
  })
  .catch(e => {
    debugLog('Ошибка fetch', e);
    hideModalProgress();
    statusDiv.textContent = 'Ошибка загрузки: ' + e;
  });
}


// === МОДАЛКА ЗАГРУЗКИ ===
const modalUpload = document.getElementById('modal-upload');
const modalDropZone = document.getElementById('modal-drop-zone');
const modalMkvBtn = document.getElementById('modal-mkv-btn');
const modalMkvInput = document.getElementById('modal-mkv-input');
const modalArchiveBtn = document.getElementById('modal-archive-btn');
const modalArchiveInput = document.getElementById('modal-archive-input');
const mainWorkspace = document.getElementById('main-workspace');

function showMainWorkspace() {
  debugLog('Показ main-workspace');
  if (modalUpload) modalUpload.style.display = 'none';
  if (mainWorkspace) mainWorkspace.style.display = '';
}
function showModalUpload() {
  debugLog('Показ модалки загрузки');
  if (modalUpload) modalUpload.style.display = 'flex';
  if (mainWorkspace) mainWorkspace.style.display = 'none';
}

if (modalDropZone && modalMkvBtn && modalMkvInput && modalArchiveBtn && modalArchiveInput) {
  // Drag&Drop для модалки
  ['dragenter','dragover'].forEach(eventName => {
    modalDropZone.addEventListener(eventName, e => {
      e.preventDefault();
      modalDropZone.style.background = '#e9f3ff';
      modalDropZone.style.borderColor = '#1a7edb';
    });
  });
  ['dragleave','drop'].forEach(eventName => {
    modalDropZone.addEventListener(eventName, e => {
      e.preventDefault();
      modalDropZone.style.background = '';
      modalDropZone.style.borderColor = '#1a7edb';
    });
  });
  modalDropZone.addEventListener('drop', e => {
    const files = e.dataTransfer.files;
    if (!files.length) return;
    const file = files[0];
    handleModalFile(file);
  });

  modalMkvBtn.addEventListener('click', () => modalMkvInput.click());
  modalArchiveBtn.addEventListener('click', () => modalArchiveInput.click());
  modalMkvInput.addEventListener('change', e => {
    if (e.target.files.length) handleModalFile(e.target.files[0]);
  });
  modalArchiveInput.addEventListener('change', e => {
    if (e.target.files.length) handleModalFile(e.target.files[0]);
  });
}

function handleModalFile(file) {
  debugLog('handleModalFile', file);
  if (!file) return;
  if (file.name.match(/\.mkv$/i)) {
    handleFile(file);
  } else if (file.name.match(/\.zip$/i)) {
    debugLog('Начало загрузки архива', file);
    showModalProgress('Загрузка архива...');
    loadArchive(file);
  } else {
    debugLog('Неподдерживаемый тип файла', file);
    if (modalDropZone) {
      modalDropZone.style.background = '#ffeaea';
      modalDropZone.style.borderColor = '#c00';
    }
    const hint = document.getElementById('modal-upload-hint');
    if (hint) {
      hint.textContent = 'Поддерживаются только MKV-файлы и архивы проекта (.zip)';
      hint.style.color = '#c00';
    }
    setTimeout(() => {
      if (modalDropZone) {
        modalDropZone.style.background = '';
        modalDropZone.style.borderColor = '#1a7edb';
      }
      if (hint) {
        hint.textContent = 'Поддерживаются MKV-файлы и архивы проекта (.zip)';
        hint.style.color = '#888';
      }
    }, 1800);
  }
}

function handleFile(file) {
  debugLog('handleFile', file);
  if (!file.name.match(/\.mkv$/i)) {
    statusDiv.textContent = 'Пожалуйста, выберите MKV-файл.';
    return;
  }
  mkvFile = file;
  statusDiv.textContent = 'Загружаем и извлекаем дорожки...';
  uploadAndExtract(file);
}
window.handleFile = handleFile;

// Показываем модалку при старте, скрываем рабочую область
showModalUpload();
