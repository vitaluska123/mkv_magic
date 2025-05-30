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

// --- ПРОГРЕСС-БАР ---
const progressBarBlock = document.getElementById('progress-bar-block');
const progressBar = document.getElementById('progress-bar');
const progressBarLabel = document.getElementById('progress-bar-label');
function showProgress(percent, label) {
  progressBarBlock.style.display = '';
  progressBar.style.width = percent + '%';
  progressBarLabel.textContent = label || '';
}
function hideProgress() {
  progressBarBlock.style.display = 'none';
  progressBar.style.width = '0%';
  progressBarLabel.textContent = '';
}

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
      // --- ИСПРАВЛЕНИЕ: ищем первую валидную (непустую) дорожку ---
      let firstValidIdx = data.subs_tracks.findIndex(t => t.text && t.text.trim());
      if (firstValidIdx !== -1) {
        subsTrackSelect.value = firstValidIdx;
        showSubs(data.subs_tracks[firstValidIdx].text, data.subs_tracks[firstValidIdx].type);
      } else {
        // Если есть ошибка в первой дорожке — показываем её
        const firstError = data.subs_tracks.find(t => t.error);
        if (firstError) {
          subsPreview.innerHTML = firstError.error;
        } else {
          subsPreview.innerHTML = 'Субтитры не найдены или не поддерживаются.';
        }
        subsPreviewBlock.style.display = '';
        subsUploadBlock.style.display = 'none';
      }
      subsTrackSelect.onchange = function() {
        const idx = parseInt(this.value);
        if (allExtractedSubs[idx] && allExtractedSubs[idx].text && allExtractedSubs[idx].text.trim()) {
          showSubs(allExtractedSubs[idx].text, allExtractedSubs[idx].type);
        } else if (allExtractedSubs[idx] && allExtractedSubs[idx].error) {
          subsPreview.innerHTML = allExtractedSubs[idx].error;
          subsPreviewBlock.style.display = '';
          subsUploadBlock.style.display = 'none';
        } else {
          subsPreview.innerHTML = 'Субтитры не найдены или не поддерживаются.';
          subsPreviewBlock.style.display = '';
          subsUploadBlock.style.display = 'none';
        }
      };
    } else if (data.subs_text) {
      subsTrackSelect.style.display = 'none';
      showSubs(data.subs_text, data.subs_type);
    } else {
      subsTrackSelect.style.display = 'none';
      showSubsUpload();
    }
  })
  .catch(e => {
    hideProgress();
    statusDiv.textContent = 'Ошибка загрузки: ' + e;
  });
}

// --- Синхронизация таймлайна и видео ---
function syncTimelineToVideo(wavesurfer, videoElem) {
  // При перемотке таймлайна — перематываем видео
  wavesurfer.on('seek', progress => {
    if (videoElem.duration) {
      videoElem.currentTime = progress * videoElem.duration;
    }
  });
  // При перемотке видео — перематываем таймлайн
  videoElem.addEventListener('timeupdate', () => {
    if (wavesurfer.isPlaying()) return; // не мешаем ручному проигрыванию
    if (videoElem.duration) {
      const progress = videoElem.currentTime / videoElem.duration;
      wavesurfer.seekTo(progress);
    }
  });
}

// --- СИНХРОНИЗАЦИЯ ВСЕХ ТАЙМЛАЙНОВ И ВИДЕО ---
function syncAllTimelines() {
  if (!wavesurferOriginal || !wavesurferUser || !videoElem) return;
  // Синхронизация: видео → оба таймлайна
  videoElem.addEventListener('timeupdate', () => {
    if (!videoElem.duration) return;
    const progress = videoElem.currentTime / videoElem.duration;
    if (!wavesurferOriginal.isPlaying()) wavesurferOriginal.seekTo(progress);
    if (!wavesurferUser.isPlaying()) wavesurferUser.seekTo(progress);
  });
  // Синхронизация: оригинальный таймлайн → видео и пользовательский
  wavesurferOriginal.on('seek', progress => {
    if (videoElem.duration) videoElem.currentTime = progress * videoElem.duration;
    if (!wavesurferUser.isPlaying()) wavesurferUser.seekTo(progress);
  });
  // Синхронизация: пользовательский таймлайн → видео и оригинальный
  wavesurferUser.on('seek', progress => {
    if (videoElem.duration) videoElem.currentTime = progress * videoElem.duration;
    if (!wavesurferOriginal.isPlaying()) wavesurferOriginal.seekTo(progress);
  });
}

// --- СИНХРОНИЗАЦИЯ ВСЕХ ТАЙМЛАЙНОВ И ВИДЕО С КУРСОРОМ ---
let isSyncing = false;
function syncAllTimelinesWithCursors() {
  if (!wavesurferOriginal || !wavesurferUser || !videoElem) return;
  // Видео → оба таймлайна
  videoElem.addEventListener('timeupdate', () => {
    if (isSyncing) return;
    isSyncing = true;
    const progress = videoElem.currentTime / videoElem.duration;
    if (!wavesurferOriginal.isPlaying()) wavesurferOriginal.seekTo(progress);
    if (!wavesurferUser.isPlaying()) wavesurferUser.seekTo(progress);
    isSyncing = false;
  });
  // Оригинальный таймлайн → видео и пользовательский
  wavesurferOriginal.on('seek', progress => {
    if (isSyncing) return;
    isSyncing = true;
    if (videoElem.duration) videoElem.currentTime = progress * videoElem.duration;
    if (!wavesurferUser.isPlaying()) wavesurferUser.seekTo(progress);
    isSyncing = false;
  });
  // Пользовательский таймлайн → видео и оригинальный
  wavesurferUser.on('seek', progress => {
    if (isSyncing) return;
    isSyncing = true;
    if (videoElem.duration) videoElem.currentTime = progress * videoElem.duration;
    if (!wavesurferOriginal.isPlaying()) wavesurferOriginal.seekTo(progress);
    isSyncing = false;
  });
}

// --- ОТОБРАЖЕНИЕ ВРЕМЕНИ НАД ТАЙМЛАЙНАМИ ---
const originalAudioTime = document.getElementById('original-audio-time');
const userAudioTime = document.getElementById('user-audio-time');
function formatTime(sec) {
  if (isNaN(sec) || sec == null) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return (m<10?'0':'')+m+':' + (s<10?'0':'')+s;
}
function updateOriginalAudioTime() {
  if (!wavesurferOriginal) return;
  const cur = wavesurferOriginal.getCurrentTime ? wavesurferOriginal.getCurrentTime() : 0;
  const dur = wavesurferOriginal.getDuration ? wavesurferOriginal.getDuration() : 0;
  originalAudioTime.textContent = formatTime(cur) + ' / ' + formatTime(dur);
}
function updateUserAudioTime() {
  if (!wavesurferUser) return;
  const cur = wavesurferUser.getCurrentTime ? wavesurferUser.getCurrentTime() : 0;
  const dur = wavesurferUser.getDuration ? wavesurferUser.getDuration() : 0;
  userAudioTime.textContent = formatTime(cur) + ' / ' + formatTime(dur);
}
// Подписка на обновление времени
function enableTimelineTimeDisplay() {
  if (wavesurferOriginal) {
    wavesurferOriginal.on('audioprocess', updateOriginalAudioTime);
    wavesurferOriginal.on('seek', updateOriginalAudioTime);
    wavesurferOriginal.on('ready', updateOriginalAudioTime);
  }
  if (wavesurferUser) {
    wavesurferUser.on('audioprocess', updateUserAudioTime);
    wavesurferUser.on('seek', updateUserAudioTime);
    wavesurferUser.on('ready', updateUserAudioTime);
  }
}

// Вызов синхронизации после создания обоих таймлайнов
function showVideoAndAudio(videoUrl, audioUrl) {
  videoPreview.style.display = '';
  timelines.style.display = '';
  videoElem.src = videoUrl;
  // wavesurfer для оригинального аудио
  if (wavesurferOriginal) wavesurferOriginal.destroy();
  wavesurferOriginal = WaveSurfer.create({
    container: '#original-audio-timeline',
    waveColor: '#1a7edb',
    progressColor: '#3c4b6e',
    height: 64
  });
  wavesurferOriginal.load(audioUrl);
  wavesurferOriginal.on('ready', () => {
    syncTimelineToVideo(wavesurferOriginal, videoElem);
    // Создаём пустой буфер для пользовательской озвучки
    userAudioDuration = wavesurferOriginal.getDuration();
    createEmptyUserAudio(userAudioDuration);
    // Синхронизация всех таймлайнов
    if (wavesurferUser) syncAllTimelinesWithCursors();
    enableTimelineTimeDisplay();
  });
  // wavesurfer для пользовательской озвучки
  if (wavesurferUser) wavesurferUser.destroy();
  wavesurferUser = WaveSurfer.create({
    container: '#user-audio-timeline',
    waveColor: '#aaa',
    progressColor: '#2a3a5a',
    height: 64
  });
  wavesurferUser.on('ready', () => {
    // Синхронизация всех таймлайнов
    if (wavesurferOriginal) syncAllTimelinesWithCursors();
    enableTimelineTimeDisplay();
  });
}

function createEmptyUserAudio(duration) {
  // Создаём пустой WAV-файл нужной длины (44100Hz, 2ch, 16bit)
  const sampleRate = 44100;
  const numChannels = 1;
  const numSamples = Math.floor(duration * sampleRate);
  const buffer = new Float32Array(numSamples);
  userAudioBuffer = buffer;
  // Генерируем WAV Blob
  const wavBlob = encodeWAV(buffer, sampleRate, numChannels);
  wavesurferUser.loadBlob(wavBlob);
}

function encodeWAV(samples, sampleRate, numChannels) {
  // Простой WAV encoder для Float32Array (моно)
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);
  // PCM samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return new Blob([buffer], {type: 'audio/wav'});
}

// --- Запись с микрофона с заменой куска ---
recordBtn.onclick = async function() {
  userAudioChunks = [];
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({audio:true});
  } catch(e) {
    statusDiv.textContent = 'Нет доступа к микрофону!';
    return;
  }
  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = e => userAudioChunks.push(e.data);
  mediaRecorder.onstop = () => {
    // Вставляем записанный кусок в userAudioBuffer
    const startTime = videoElem.currentTime;
    const reader = new FileReader();
    reader.onload = function(ev) {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtx.decodeAudioData(ev.target.result, decoded => {
        const sampleRate = 44100;
        const startSample = Math.floor(startTime * sampleRate);
        const recSamples = decoded.getChannelData(0);
        for (let i = 0; i < recSamples.length; i++) {
          if (startSample + i < userAudioBuffer.length) {
            userAudioBuffer[startSample + i] = recSamples[i];
          }
        }
        const wavBlob = encodeWAV(userAudioBuffer, sampleRate, 1);
        wavesurferUser.loadBlob(wavBlob);
        playMixBtn.disabled = false;
        downloadBtn.disabled = false;
      });
    };
    const blob = new Blob(userAudioChunks, {type:'audio/webm'});
    reader.readAsArrayBuffer(blob);
  };
  // старт записи с текущей позиции видео
  const startTime = videoElem.currentTime;
  mediaRecorder.start();
  recordBtn.disabled = true;
  stopBtn.disabled = false;
  videoElem.currentTime = startTime;
  videoElem.play();
  videoElem.onended = () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    recordBtn.disabled = false;
    stopBtn.disabled = true;
  };
};
stopBtn.onclick = function() {
  if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
  videoElem.pause();
  recordBtn.disabled = false;
  stopBtn.disabled = true;
};
playMixBtn.onclick = function() {
  // Одновременное воспроизведение видео и пользовательской озвучки
  if (!userAudioBlob) return;
  const audio = new Audio(URL.createObjectURL(userAudioBlob));
  videoElem.currentTime = 0;
  audio.currentTime = 0;
  videoElem.play();
  audio.play();
  audio.onended = () => videoElem.pause();
};
downloadBtn.onclick = function() {
  if (!userAudioBuffer) return;
  const wavBlob = encodeWAV(userAudioBuffer, 44100, 1);
  const url = URL.createObjectURL(wavBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'voiceover.wav';
  a.click();
};

// --- СУБТИТРЫ: ПАРСИНГ И ОТОБРАЖЕНИЕ АКТУАЛЬНОЙ РЕПЛИКИ ---
let parsedSubs = [];
function parseSrt(text) {
  // Простой парсер SRT (возвращает массив {start, end, text})
  const lines = text.split(/\r?\n/);
  let subs = [], i = 0;
  while (i < lines.length) {
    if (/^\d+$/.test(lines[i])) i++; // skip index
    if (i >= lines.length) break;
    const timeMatch = lines[i].match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);
    if (timeMatch) {
      const start = srtTimeToSec(timeMatch[1]);
      const end = srtTimeToSec(timeMatch[2]);
      i++;
      let textLines = [];
      while (i < lines.length && lines[i].trim() && !/^\d+$/.test(lines[i])) {
        textLines.push(lines[i]);
        i++;
      }
      subs.push({start, end, text: textLines.join(' ')});
    } else {
      i++;
    }
  }
  return subs;
}
function srtTimeToSec(t) {
  const m = t.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
  if (!m) return 0;
  return parseInt(m[1])*3600 + parseInt(m[2])*60 + parseInt(m[3]) + parseInt(m[4])/1000;
}

// --- SRT ПАРСЕР И РЕНДЕР ДЛЯ ПРИВЯЗКИ КО ВРЕМЕНИ ---
function parseSrtBlocks(srtText) {
  // Возвращает массив {start, end, html} для каждого блока
  const lines = srtText.split(/\r?\n/);
  let blocks = [], i = 0;
  while (i < lines.length) {
    if (/^\d+$/.test(lines[i])) i++;
    if (i >= lines.length) break;
    const timeMatch = lines[i].match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);
    if (timeMatch) {
      const start = srtTimeToSec(timeMatch[1]);
      const end = srtTimeToSec(timeMatch[2]);
      i++;
      let textLines = [];
      while (i < lines.length && lines[i].trim() && !/^\d+$/.test(lines[i])) {
        textLines.push(lines[i]);
        i++;
      }
      let text = textLines.join(' ');
      text = text.replace(/\{\\?[^}]+}/g, '');
      text = text.replace(/<[^>]+>/g, '');
      if (text.length > 180) text = text.slice(0, 180) + '...';
      const html = `<div class="srt-block"><span class="srt-time">${timeMatch[1]} - ${timeMatch[2]}</span><span class="srt-text">${text.trim()}</span></div>`;
      blocks.push({start, end, html});
    } else {
      i++;
    }
  }
  return blocks;
}

let parsedSrtBlocks = [];
let lastSrtBlockIdx = -1;
let fadeDuration = 0.4; // сек
let fadeBuffer = 0.45; // за сколько до/после делать fade
function showCurrentSrtBlock(currentTime) {
  if (!parsedSrtBlocks.length) {
    subsPreview.innerHTML = `<div class="subs-placeholder">
      <svg viewBox='0 0 24 24' fill='none'><rect x='3' y='7' width='18' height='10' rx='2' stroke='#b0b4c0' stroke-width='1.5'/><rect x='7' y='11' width='10' height='2' rx='1' fill='#b0b4c0'/></svg>
      <div>Субтитры не выбраны</div>
    </div>`;
    subsPreview.style.background = '#f2f4fa';
    subsPreview.style.fontWeight = '';
    subsPreview.style.fontSize = '';
    subsPreview.style.color = '';
    subsPreview.style.textAlign = '';
    subsPreview.style.padding = '12px 14px';
    lastSrtBlockIdx = -1;
    return;
  }
  let idx = parsedSrtBlocks.findIndex(s => currentTime >= s.start && currentTime <= s.end);
  if (idx === -1) {
    // fade out если был блок
    if (lastSrtBlockIdx !== -1) {
      const block = parsedSrtBlocks[lastSrtBlockIdx];
      const fadeOutStart = block.end - fadeBuffer;
      if (currentTime > block.end) {
        subsPreview.innerHTML = '';
        lastSrtBlockIdx = -1;
      } else if (currentTime >= fadeOutStart && currentTime <= block.end) {
        subsPreview.innerHTML = `<div class='srt-block-animated fading'>${block.html}</div>`;
        setTimeout(() => {
          if (Math.abs(videoElem.currentTime - currentTime) < 0.1) subsPreview.innerHTML = '';
        }, fadeDuration * 1000);
      } else {
        subsPreview.innerHTML = '';
        lastSrtBlockIdx = -1;
      }
    } else {
      subsPreview.innerHTML = '';
    }
    return;
  }
  const block = parsedSrtBlocks[idx];
  const fadeInEnd = block.start + fadeBuffer;
  const fadeOutStart = block.end - fadeBuffer;
  let className = 'srt-block-animated';
  if (currentTime >= block.start && currentTime < fadeInEnd) {
    className += ' visible';
  } else if (currentTime >= fadeInEnd && currentTime < fadeOutStart) {
    className += ' visible';
  } else if (currentTime >= fadeOutStart && currentTime <= block.end) {
    className += ' fading';
  } else {
    className += '';
  }
  // Если следующий блок идёт сразу — не анимируем, просто показываем
  const nextBlock = parsedSrtBlocks[idx+1];
  if (nextBlock && Math.abs(nextBlock.start - block.end) < fadeBuffer*1.1) {
    className = 'srt-block-animated visible';
  }
  subsPreview.innerHTML = `<div class='${className}'>${block.html}</div>`;
  subsPreview.style.background = '#fffbe6';
  subsPreview.style.fontWeight = 'bold';
  subsPreview.style.fontSize = '1.25em';
  subsPreview.style.color = '#222';
  subsPreview.style.textAlign = 'center';
  subsPreview.style.padding = '18px 14px';
  lastSrtBlockIdx = idx;
}

function enableLiveSrtBlockDisplay() {
  videoElem.addEventListener('timeupdate', () => showCurrentSrtBlock(videoElem.currentTime));
  if (wavesurferOriginal) wavesurferOriginal.on('audioprocess', () => showCurrentSrtBlock(wavesurferOriginal.getCurrentTime()));
  if (wavesurferUser) wavesurferUser.on('audioprocess', () => showCurrentSrtBlock(wavesurferUser.getCurrentTime()));
}

// Модифицируем showSubs для srt
function showSubs(text, type) {
  subsText = text;
  subsType = type;
  if (type && type.toLowerCase().includes('srt')) {
    parsedSrtBlocks = parseSrtBlocks(text);
    showCurrentSrtBlock(videoElem.currentTime || 0);
    enableLiveSrtBlockDisplay();
  } else {
    subsPreview.innerHTML = 'Субтитры не поддерживаются или не SRT.';
    parsedSrtBlocks = [];
  }
  subsPreviewBlock.style.display = '';
  subsUploadBlock.style.display = 'none';
}

// --- ИЗМЕНЕНИЕ РАЗМЕРА ПРЕДПРОСМОТРА ВИДЕО ---
const videoPreviewDiv = document.getElementById('video-preview');
let videoSize = 1; // 1 = 420px, 2 = 600px, 0.7 = 300px
function setVideoSize(mult) {
  videoSize = mult;
  videoPreviewDiv.style.maxWidth = (420 * mult) + 'px';
}
// Кнопки +/- для изменения размера
const videoResizeBar = document.createElement('div');
videoResizeBar.style.textAlign = 'right';
videoResizeBar.style.marginBottom = '4px';
videoResizeBar.innerHTML = '<button id="video-size-dec" style="font-size:1.2em;">–</button> <button id="video-size-inc" style="font-size:1.2em;">+</button>';
videoPreviewDiv.parentNode.insertBefore(videoResizeBar, videoPreviewDiv);
document.getElementById('video-size-dec').onclick = () => setVideoSize(Math.max(0.5, videoSize-0.2));
document.getElementById('video-size-inc').onclick = () => setVideoSize(Math.min(2, videoSize+0.2));
setVideoSize(1);

// --- Сохранение и загрузка архива проекта (сервер) ---
const saveArchiveBtn = document.getElementById('save-archive-btn');
const loadArchiveBtn = document.getElementById('load-archive-btn');
const loadArchiveInput = document.getElementById('load-archive-input');

saveArchiveBtn.onclick = async function() {
  statusDiv.textContent = 'Формируем архив проекта...';
  showProgress(10, 'Подготовка файлов...');
  const formData = new FormData();
  // Добавляем пользовательскую озвучку
  if (userAudioBuffer) {
    const wavBlob = encodeWAV(userAudioBuffer, 44100, 1);
    formData.append('user_audio.wav', wavBlob, 'user_audio.wav');
  }
  if (subsText) {
    const subsBlob = new Blob([subsText], {type:'text/plain'});
    formData.append('subtitles.srt', subsBlob, 'subtitles.srt');
  }
  // Добавляем оригинальное видео и аудио, если были загружены
  if (videoElem && videoElem.src && videoElem.src.startsWith('blob:') === false) {
    try {
      showProgress(20, 'Загрузка видео...');
      const videoResp = await fetch(videoElem.src);
      const videoBlob = await videoResp.blob();
      formData.append('video.mp4', videoBlob, 'video.mp4');
    } catch(e) {}
  }
  if (wavesurferOriginal && wavesurferOriginal.backend && wavesurferOriginal.backend.buffer) {
    try {
      showProgress(30, 'Загрузка аудио...');
      const audioBuffer = wavesurferOriginal.backend.buffer.getChannelData(0);
      const wavBlob = encodeWAV(audioBuffer, 44100, 1);
      formData.append('original_audio.wav', wavBlob, 'original_audio.wav');
    } catch(e) {}
  }
  // Добавляем все аудиодорожки, если они есть в папке (например, audio_track_*.mka/mp3)
  // Для этого попробуем найти их по ссылкам скачивания (если были загружены)
  const audioLinks = document.querySelectorAll('a[href*="audio_track_"]');
  for (const link of audioLinks) {
    const href = link.getAttribute('href');
    if (href && !href.startsWith('blob:')) {
      try {
        const resp = await fetch(href);
        const blob = await resp.blob();
        // Имя файла из ссылки
        const fname = href.split('/').pop();
        formData.append(fname, blob, fname);
      } catch(e) {}
    }
  }
  // Сохраняем настройки
  const settings = JSON.stringify({
    userAudioDuration,
    subsType,
    mkvFileName: mkvFile ? mkvFile.name : null
  });
  formData.append('settings_json', settings);
  showProgress(50, 'Архивирование...');
  fetch('/voiceover-save-archive', {method:'POST', body:formData})
    .then(r => {
      showProgress(80, 'Скачивание архива...');
      if (!r.ok) throw new Error('Ошибка архивации');
      return r.blob();
    })
    .then(blob => {
      showProgress(100, 'Готово!');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (mkvFile ? mkvFile.name.replace(/\.[^.]+$/, '') : 'project') + '.voiceover.zip';
      a.click();
      setTimeout(hideProgress, 800);
      statusDiv.textContent = 'Архив проекта сохранён!';
    })
    .catch(e => {
      hideProgress();
      statusDiv.textContent = 'Ошибка архивации: ' + e;
    });
};

loadArchiveBtn.onclick = () => loadArchiveInput.click();
loadArchiveInput.onchange = function(e) {
  if (!e.target.files.length) return;
  const file = e.target.files[0];
  showProgress(10, 'Загрузка архива...');
  statusDiv.textContent = 'Загружаем архив проекта...';
  const formData = new FormData();
  formData.append('archive', file);
  fetch('/voiceover-load-archive', {method:'POST', body:formData})
    .then(r => { showProgress(60, 'Распаковка архива...'); return r.json(); })
    .then(data => {
      showProgress(100, 'Готово!');
      setTimeout(hideProgress, 800);
      if (data.error) {
        statusDiv.textContent = data.error;
        return;
      }
      // Восстанавливаем субтитры, озвучку и т.д. из ответа
      if (data.settings) {
        try {
          const settings = JSON.parse(data.settings);
          userAudioDuration = settings.userAudioDuration;
          subsType = settings.subsType;
          mkvFile = {name: settings.mkvFileName};
        } catch(e) {}
      }
      if (data.files && data.files['user_audio.wav']) {
        fetch(data.files['user_audio.wav'])
          .then(r => r.arrayBuffer())
          .then(buf => {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            audioCtx.decodeAudioData(buf, decoded => {
              userAudioBuffer = decoded.getChannelData(0).slice();
              createEmptyUserAudio(userAudioDuration);
              const wavBlob = encodeWAV(userAudioBuffer, 44100, 1);
              wavesurferUser.loadBlob(wavBlob);
            });
          });
      }
      if (data.files && data.files['subtitles.srt']) {
        fetch(data.files['subtitles.srt'])
          .then(r => r.text())
          .then(text => showSubs(text, 'srt'));
      }
      // Восстанавливаем оригинальное видео и аудио
      if (data.files && data.files['video.mp4']) {
        videoElem.src = data.files['video.mp4'];
      }
      if (data.files && data.files['original_audio.wav']) {
        wavesurferOriginal.load(data.files['original_audio.wav']);
      }
      statusDiv.textContent = 'Архив проекта загружен!';
    })
    .catch(e => {
      hideProgress();
      statusDiv.textContent = 'Ошибка загрузки архива: ' + e;
    });
};

// --- ВЫБОР ДОРОЖКИ СУБТИТРОВ ---
const subsTrackSelect = document.getElementById('subs-track-select');
let allExtractedSubs = [];

// Модифицируем uploadAndExtract для поддержки нескольких субтитров
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
      // --- ИСПРАВЛЕНИЕ: ищем первую валидную (непустую) дорожку ---
      let firstValidIdx = data.subs_tracks.findIndex(t => t.text && t.text.trim());
      if (firstValidIdx !== -1) {
        subsTrackSelect.value = firstValidIdx;
        showSubs(data.subs_tracks[firstValidIdx].text, data.subs_tracks[firstValidIdx].type);
      } else {
        // Если есть ошибка в первой дорожке — показываем её
        const firstError = data.subs_tracks.find(t => t.error);
        if (firstError) {
          subsPreview.innerHTML = firstError.error;
        } else {
          subsPreview.innerHTML = 'Субтитры не найдены или не поддерживаются.';
        }
        subsPreviewBlock.style.display = '';
        subsUploadBlock.style.display = 'none';
      }
      subsTrackSelect.onchange = function() {
        const idx = parseInt(this.value);
        if (allExtractedSubs[idx] && allExtractedSubs[idx].text && allExtractedSubs[idx].text.trim()) {
          showSubs(allExtractedSubs[idx].text, allExtractedSubs[idx].type);
        } else if (allExtractedSubs[idx] && allExtractedSubs[idx].error) {
          subsPreview.innerHTML = allExtractedSubs[idx].error;
          subsPreviewBlock.style.display = '';
          subsUploadBlock.style.display = 'none';
        } else {
          subsPreview.innerHTML = 'Субтитры не найдены или не поддерживаются.';
          subsPreviewBlock.style.display = '';
          subsUploadBlock.style.display = 'none';
        }
      };
    } else if (data.subs_text) {
      subsTrackSelect.style.display = 'none';
      showSubs(data.subs_text, data.subs_type);
    } else {
      subsTrackSelect.style.display = 'none';
      showSubsUpload();
    }
  })
  .catch(e => {
    hideProgress();
    statusDiv.textContent = 'Ошибка загрузки: ' + e;
  });
}
