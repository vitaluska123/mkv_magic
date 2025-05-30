// archive.js — сохранение и загрузка архива проекта

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
  // Добавляем пользовательскую озвучку
  if (userAudioBuffer) {
    const wavBlob = encodeWAV(userAudioBuffer, 44100, 1);
    formData.append('user_audio.wav', wavBlob, 'user_audio.wav');
  }
  // Добавляем субтитры
  if (window.subsText) {
    const subsBlob = new Blob([window.subsText], {type:'text/plain'});
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
          .then(text => showSubs(text, 'srt'));
      }
      if (data.files && data.files['video.mp4']) {
        if (window.videoElem) window.videoElem.src = data.files['video.mp4'];
      }
      if (data.files && data.files['original_audio.wav']) {
        if (window.wavesurferOriginal) window.wavesurferOriginal.load(data.files['original_audio.wav']);
      }
      statusDiv.textContent = 'Архив проекта загружен!';
    })
    .catch(e => {
      hideProgress();
      statusDiv.textContent = 'Ошибка загрузки архива: ' + e;
    });
}
