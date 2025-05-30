// audio.js — работа с аудио: запись, обработка, синхронизация таймлайнов, кодирование WAV

let wavesurferOriginal, wavesurferUser, videoElem, userAudioBuffer;

export function setAudioElements({ wavesurferOrig, wavesurferUsr, videoEl, userAudioBuf }) {
  wavesurferOriginal = wavesurferOrig;
  wavesurferUser = wavesurferUsr;
  videoElem = videoEl;
  userAudioBuffer = userAudioBuf;
}

export function encodeWAV(samples, sampleRate, numChannels) {
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
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return new Blob([buffer], {type: 'audio/wav'});
}

export function createEmptyUserAudio(duration) {
  const sampleRate = 44100;
  const numChannels = 1;
  const numSamples = Math.floor(duration * sampleRate);
  const buffer = new Float32Array(numSamples);
  userAudioBuffer = buffer;
  return encodeWAV(buffer, sampleRate, numChannels);
}

export function syncTimelineToVideo(wavesurfer, videoElem) {
  wavesurfer.on('seek', progress => {
    if (videoElem.duration) {
      videoElem.currentTime = progress * videoElem.duration;
    }
  });
  videoElem.addEventListener('timeupdate', () => {
    if (wavesurfer.isPlaying()) return;
    if (videoElem.duration) {
      const progress = videoElem.currentTime / videoElem.duration;
      wavesurfer.seekTo(progress);
    }
  });
}

export function syncAllTimelines() {
  if (!wavesurferOriginal || !wavesurferUser || !videoElem) return;
  videoElem.addEventListener('timeupdate', () => {
    if (!videoElem.duration) return;
    const progress = videoElem.currentTime / videoElem.duration;
    if (!wavesurferOriginal.isPlaying()) wavesurferOriginal.seekTo(progress);
    if (!wavesurferUser.isPlaying()) wavesurferUser.seekTo(progress);
  });
  wavesurferOriginal.on('seek', progress => {
    if (videoElem.duration) videoElem.currentTime = progress * videoElem.duration;
    if (!wavesurferUser.isPlaying()) wavesurferUser.seekTo(progress);
  });
  wavesurferUser.on('seek', progress => {
    if (videoElem.duration) videoElem.currentTime = progress * videoElem.duration;
    if (!wavesurferOriginal.isPlaying()) wavesurferOriginal.seekTo(progress);
  });
}

let isSyncing = false;
export function syncAllTimelinesWithCursors() {
  if (!wavesurferOriginal || !wavesurferUser || !videoElem) return;
  videoElem.addEventListener('timeupdate', () => {
    if (isSyncing) return;
    isSyncing = true;
    const progress = videoElem.currentTime / videoElem.duration;
    if (!wavesurferOriginal.isPlaying()) wavesurferOriginal.seekTo(progress);
    if (!wavesurferUser.isPlaying()) wavesurferUser.seekTo(progress);
    isSyncing = false;
  });
  wavesurferOriginal.on('seek', progress => {
    if (isSyncing) return;
    isSyncing = true;
    if (videoElem.duration) videoElem.currentTime = progress * videoElem.duration;
    if (!wavesurferUser.isPlaying()) wavesurferUser.seekTo(progress);
    isSyncing = false;
  });
  wavesurferUser.on('seek', progress => {
    if (isSyncing) return;
    isSyncing = true;
    if (videoElem.duration) videoElem.currentTime = progress * videoElem.duration;
    if (!wavesurferOriginal.isPlaying()) wavesurferOriginal.seekTo(progress);
    isSyncing = false;
  });
}

export function enableTimelineTimeDisplay(updateOriginalAudioTime, updateUserAudioTime) {
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
