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

// Drag&Drop
['dragenter','dragover','dragleave','drop'].forEach(eventName => {
  dropZone.addEventListener(eventName, e => e.preventDefault());
});
dropZone.addEventListener('drop', e => {
  const files = e.dataTransfer.files;
  if (files.length) handleFile(files[0]);
});
fileInput.addEventListener('change', e => {
  if (e.target.files.length) handleFile(e.target.files[0]);
});

function handleFile(file) {
  if (!file.name.match(/\.mkv$/i)) {
    statusDiv.textContent = 'Пожалуйста, выберите MKV-файл.';
    return;
  }
  mkvFile = file;
  statusDiv.textContent = 'Загружаем и извлекаем дорожки...';
  uploadAndExtract(file);
}
window.handleFile = handleFile;

// --- Кнопки изменения размера видео ---
const videoResizeBar = document.createElement('div');
videoResizeBar.style.textAlign = 'right';
videoResizeBar.style.marginBottom = '4px';
videoResizeBar.innerHTML = '<button id="video-size-dec" style="font-size:1.2em;">–</button> <button id="video-size-inc" style="font-size:1.2em;">+</button>';
videoPreviewDiv.parentNode.insertBefore(videoResizeBar, videoPreviewDiv);
document.getElementById('video-size-dec').onclick = () => setVideoSize(Math.max(0.5, 1-0.2));
document.getElementById('video-size-inc').onclick = () => setVideoSize(Math.min(2, 1+0.2));
setVideoSize(1);

// --- Сохранение и загрузка архива проекта ---
saveArchiveBtn.onclick = async function() {
  await saveArchive();
};
loadArchiveBtn.onclick = () => loadArchiveInput.click();
loadArchiveInput.onchange = function(e) {
  if (!e.target.files.length) return;
  loadArchive(e.target.files[0]);
};

// --- ВЫБОР ДОРОЖКИ СУБТИТРОВ ---
// uploadAndExtract, showVideoAndAudio, запись, timeline и прочее теперь делегируются в модули
function uploadAndExtract(file) {
  const formData = new FormData();
  formData.append('mkvfile', file);
  showProgress(10, 'Загрузка файла...');
  fetch('/voiceover-upload', {
    method:'POST',
    body:formData,
  }).then(r => {
    showProgress(60, 'Извлечение дорожек...');
    return r.json();
  })
  .then(data => {
    showProgress(100, 'Готово!');
    setTimeout(hideProgress, 800);
    if (data.error) {
      statusDiv.textContent = data.error;
      return;
    }
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
    hideProgress();
    statusDiv.textContent = 'Ошибка загрузки: ' + e;
  });
}
