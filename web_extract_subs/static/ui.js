// ui.js — функции для управления интерфейсом: прогресс-бар, изменение размера видео, отображение статусов

import { setSubsElements } from './subs.js';
import { setAudioElements, syncAllTimelines, enableTimelineTimeDisplay } from './audio.js';

let progressBarBlock, progressBar, progressBarLabel, videoPreviewDiv;

export function setUiElements({ progressBarBlockEl, progressBarEl, progressBarLabelEl, videoPreviewDivEl }) {
  progressBarBlock = progressBarBlockEl;
  progressBar = progressBarEl;
  progressBarLabel = progressBarLabelEl;
  videoPreviewDiv = videoPreviewDivEl;
}

export function showProgress(percent, label) {
  progressBarBlock.style.display = '';
  progressBar.style.width = percent + '%';
  progressBarLabel.textContent = label || '';
}

export function hideProgress() {
  progressBarBlock.style.display = 'none';
  progressBar.style.width = '0%';
  progressBarLabel.textContent = '';
}

let videoSize = 1;
export function setVideoSize(mult) {
  videoSize = mult;
  videoPreviewDiv.style.maxWidth = (420 * mult) + 'px';
}
export function getVideoSize() {
  return videoSize;
}

export function showVideoAndAudio(videoUrl, audioUrl) {
  // Показываем блок предпросмотра видео
  if (videoPreviewDiv) {
    videoPreviewDiv.style.display = '';
  }
  // Устанавливаем src для видео
  const videoElem = document.getElementById('video');
  if (videoElem) {
    videoElem.src = videoUrl;
    videoElem.load();
  }
  // Показываем таймлайны
  const timelines = document.getElementById('timelines');
  if (timelines) {
    timelines.style.display = '';
  }
  // wavesurfer для оригинального аудио
  let wavesurferOriginal = window.wavesurferOriginal;
  if (!wavesurferOriginal) {
    const origTimeline = document.getElementById('original-audio-timeline');
    if (origTimeline) {
      origTimeline.innerHTML = '';
      wavesurferOriginal = WaveSurfer.create({
        container: origTimeline,
        waveColor: '#1a7edb',
        progressColor: '#3c4b6e',
        height: 60,
        barWidth: 2,
        barGap: 1,
        cursorColor: '#c00',
        responsive: true
      });
      window.wavesurferOriginal = wavesurferOriginal;
    }
  }
  if (wavesurferOriginal && audioUrl) {
    wavesurferOriginal.load(audioUrl);
  }
  // wavesurfer для пользовательской озвучки
  let wavesurferUser = window.wavesurferUser;
  if (!wavesurferUser) {
    const userTimeline = document.getElementById('user-audio-timeline');
    if (userTimeline) {
      userTimeline.innerHTML = '';
      wavesurferUser = WaveSurfer.create({
        container: userTimeline,
        waveColor: '#aaa',
        progressColor: '#888',
        height: 60,
        barWidth: 2,
        barGap: 1,
        cursorColor: '#c00',
        responsive: true
      });
      window.wavesurferUser = wavesurferUser;
    }
  }
  // Сброс пользовательской озвучки
  if (wavesurferUser) {
    wavesurferUser.empty && wavesurferUser.empty();
  }
  // --- КОРРЕКТНАЯ СВЯЗКА ДЛЯ СИНХРОНИЗАЦИИ И СУБТИТРОВ ---
  setAudioElements({
    wavesurferOrig: wavesurferOriginal,
    wavesurferUsr: wavesurferUser,
    videoEl: videoElem,
    userAudioBuf: window.userAudioBuffer || null
  });
  setSubsElements({
    subsPreviewEl: document.getElementById('subs-preview'),
    videoEl: videoElem,
    wavesurferOrig: wavesurferOriginal,
    wavesurferUsr: wavesurferUser
  });
  syncAllTimelines();
  // Включаем отображение времени на таймлайнах
  enableTimelineTimeDisplay(
    () => {
      const ws = window.wavesurferOriginal;
      const el = document.getElementById('original-audio-time');
      if (ws && el) el.textContent = ws.getCurrentTime ? ws.getCurrentTime().toFixed(1) + ' сек' : '';
    },
    () => {
      const ws = window.wavesurferUser;
      const el = document.getElementById('user-audio-time');
      if (ws && el) el.textContent = ws.getCurrentTime ? ws.getCurrentTime().toFixed(1) + ' сек' : '';
    }
  );
  // Показываем блок субтитров
  const subsPreviewBlock = document.getElementById('subs-preview-block');
  if (subsPreviewBlock) subsPreviewBlock.style.display = '';
}
