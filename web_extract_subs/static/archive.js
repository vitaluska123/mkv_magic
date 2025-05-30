// archive.js — сохранение и загрузка архива проекта
import { showVideoAndAudio } from './ui.js';

let statusDiv, showProgress, hideProgress, encodeWAV, showSubs;
let userAudioBuffer, userAudioDuration, subsType, mkvFile, videoElem, wavesurferOriginal, wavesurferUser;

export function setArchiveElements({
  statusDivEl, showProgressFn, hideProgressFn, encodeWAVFn, showSubsFn,
  userAudioBufferRef, userAudioDurationRef, subsTypeRef, mkvFileRef,
  videoElemRef, wavesurferOriginalRef, wavesurferUserRef
}) {
  statusDiv = statusDivEl;
  showProgress = showProgressFn;
  hideProgress = hideProgressFn;
  encodeWAV = encodeWAVFn;
  showSubs = showSubsFn;
  userAudioBuffer = userAudioBufferRef;
  userAudioDuration = userAudioDurationRef;
  subsType = subsTypeRef;
  mkvFile = mkvFileRef;
  videoElem = videoElemRef;
  wavesurferOriginal = wavesurferOriginalRef;
  wavesurferUser = wavesurferUserRef;
}

export async function saveArchive() {
  statusDiv.textContent = 'Формируем архив проекта...';
  showProgress(10, 'Подготовка файлов...');
  const formData = new FormData();
  // --- Сохраняем пользовательскую озвучку ---
  if (userAudioBuffer && userAudioBuffer.length > 0) {
    const wavBlob = encodeWAV(userAudioBuffer, 44100, 1);
    formData.append('user_audio.wav', wavBlob, 'user_audio.wav');
  }
  // --- Сохраняем субтитры ---
  if (window.subsText && window.subsText.length > 0) {
    const subsBlob = new Blob([window.subsText], {type:'text/plain'});
    formData.append('subtitles.srt', subsBlob, 'subtitles.srt');
  }
  // --- Сохраняем оригинальное видео ---
  if (videoElem && videoElem.src && !videoElem.src.startsWith('blob:')) {
    try {
      showProgress(20, 'Загрузка видео...');
      const videoResp = await fetch(videoElem.src);
      const videoBlob = await videoResp.blob();
      formData.append('video.mp4', videoBlob, 'video.mp4');
    } catch(e) {}
  }
  // --- Сохраняем оригинальное аудио ---
  let audioSaved = false;
  if (wavesurferOriginal && wavesurferOriginal.backend && wavesurferOriginal.backend.buffer) {
    try {
      showProgress(30, 'Загрузка аудио...');
      const audioBuffer = wavesurferOriginal.backend.buffer.getChannelData(0);
      const wavBlob = encodeWAV(audioBuffer, 44100, 1);
      formData.append('original_audio.wav', wavBlob, 'original_audio.wav');
      audioSaved = true;
    } catch(e) {}
  }
  // Fallback: если не удалось — пробуем найти audio_url в window или в ссылках
  if (!audioSaved && window.audioUrl) {
    try {
      const audioResp = await fetch(window.audioUrl);
      const audioBlob = await audioResp.blob();
      formData.append('original_audio.wav', audioBlob, 'original_audio.wav');
      audioSaved = true;
    } catch(e) {}
  }
  if (!audioSaved) {
    // Пробуем найти <audio> или <source> с .wav
    const audioLinks = document.querySelectorAll('audio, audio source');
    for (const el of audioLinks) {
      if (el.src && el.src.endsWith('.wav')) {
        try {
          const audioResp = await fetch(el.src);
          const audioBlob = await audioResp.blob();
          formData.append('original_audio.wav', audioBlob, 'original_audio.wav');
          audioSaved = true;
          break;
        } catch(e) {}
      }
    }
  }
  // --- Сохраняем все аудиодорожки, если есть ---
  const audioLinks = document.querySelectorAll('a[href*="audio_track_"]');
  for (const link of audioLinks) {
    const href = link.getAttribute('href');
    if (href && !href.startsWith('blob:')) {
      try {
        const resp = await fetch(href);
        const blob = await resp.blob();
        const fname = href.split('/').pop();
        formData.append(fname, blob, fname);
      } catch(e) {}
    }
  }
  // --- Сохраняем настройки ---
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
}

export function loadArchive(file) {
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
      let videoUrl = data.files && data.files['video.mp4'] ? data.files['video.mp4'] : null;
      let audioUrl = data.files && data.files['original_audio.wav'] ? data.files['original_audio.wav'] : null;
      window.videoUrl = videoUrl;
      window.audioUrl = audioUrl;
      // Показываем хотя бы видео или хотя бы аудио, если есть
      if (videoUrl || audioUrl) {
        showVideoAndAudio(videoUrl || '', audioUrl || '');
        const videoPreviewDiv = document.getElementById('video-preview');
        if (videoPreviewDiv) videoPreviewDiv.style.display = '';
        const timelines = document.getElementById('timelines');
        if (timelines) timelines.style.display = '';
        const subsPreviewBlock = document.getElementById('subs-preview-block');
        if (subsPreviewBlock) subsPreviewBlock.style.display = '';
        import('./audio.js').then(({ setAudioElements }) => {
          setAudioElements({
            wavesurferOrig: window.wavesurferOriginal,
            wavesurferUsr: window.wavesurferUser,
            videoEl: document.getElementById('video'),
            userAudioBuf: window.userAudioBuffer || null
          });
        });
        import('./subs.js').then(({ setSubsElements }) => {
          setSubsElements({
            subsPreviewEl: document.getElementById('subs-preview'),
            videoEl: document.getElementById('video'),
            wavesurferOrig: window.wavesurferOriginal,
            wavesurferUsr: window.wavesurferUser
          });
        });
      }
      if (data.settings) {
        try {
          const settings = JSON.parse(data.settings);
          window.userAudioDuration = settings.userAudioDuration;
          window.subsType = settings.subsType;
          window.mkvFile = {name: settings.mkvFileName};
        } catch(e) {}
      }
      if (data.files && data.files['user_audio.wav']) {
        fetch(data.files['user_audio.wav'])
          .then(r => r.arrayBuffer())
          .then(buf => {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            audioCtx.decodeAudioData(buf, decoded => {
              window.userAudioBuffer = decoded.getChannelData(0).slice();
              if (typeof window.createEmptyUserAudio === 'function') window.createEmptyUserAudio(window.userAudioDuration);
              const wavBlob = encodeWAV(window.userAudioBuffer, 44100, 1);
              if (window.wavesurferUser) window.wavesurferUser.loadBlob(wavBlob);
            });
          });
      }
      if (data.files && data.files['subtitles.srt']) {
        fetch(data.files['subtitles.srt'])
          .then(r => r.text())
          .then(text => {
            showSubs(text, 'srt');
            const subsPreviewBlock = document.getElementById('subs-preview-block');
            if (subsPreviewBlock) subsPreviewBlock.style.display = '';
          });
      }
      statusDiv.textContent = 'Архив проекта загружен!';
    })
    .catch(e => {
      hideProgress();
      statusDiv.textContent = 'Ошибка загрузки архива: ' + e;
    });
}
