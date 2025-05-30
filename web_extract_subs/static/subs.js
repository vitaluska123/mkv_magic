// subs.js — работа с субтитрами: парсинг, отображение, выбор дорожки

let parsedSrtBlocks = [];
let lastSrtBlockIdx = -1;
let fadeDuration = 0.4; // сек
let fadeBuffer = 0.45; // за сколько до/после делать fade
let subsPreview, videoElem, wavesurferOriginal, wavesurferUser;

export function setSubsElements({ subsPreviewEl, videoEl, wavesurferOrig, wavesurferUsr }) {
  subsPreview = subsPreviewEl;
  videoElem = videoEl;
  wavesurferOriginal = wavesurferOrig;
  wavesurferUser = wavesurferUsr;
}

export function parseSrt(text) {
  const lines = text.split(/\r?\n/);
  let subs = [], i = 0;
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

export function parseSrtBlocks(srtText) {
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

export function showSubs(text, type) {
  if (!subsPreview) return;
  if (type && type.toLowerCase().includes('srt')) {
    parsedSrtBlocks = parseSrtBlocks(text);
    showCurrentSrtBlock(videoElem ? videoElem.currentTime || 0 : 0);
    enableLiveSrtBlockDisplay();
  } else {
    subsPreview.innerHTML = 'Субтитры не поддерживаются или не SRT.';
    parsedSrtBlocks = [];
  }
  subsPreview.style.display = '';
}

export function showCurrentSrtBlock(currentTime) {
  if (!subsPreview) return;
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
    if (lastSrtBlockIdx !== -1) {
      const block = parsedSrtBlocks[lastSrtBlockIdx];
      const fadeOutStart = block.end - fadeBuffer;
      if (currentTime > block.end) {
        subsPreview.innerHTML = '';
        lastSrtBlockIdx = -1;
      } else if (currentTime >= fadeOutStart && currentTime <= block.end) {
        subsPreview.innerHTML = `<div class='srt-block-animated fading'>${block.html}</div>`;
        setTimeout(() => {
          if (Math.abs((videoElem ? videoElem.currentTime : 0) - currentTime) < 0.1) subsPreview.innerHTML = '';
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

export function enableLiveSrtBlockDisplay() {
  if (!videoElem) return;
  videoElem.addEventListener('timeupdate', () => showCurrentSrtBlock(videoElem.currentTime));
  if (wavesurferOriginal) wavesurferOriginal.on('audioprocess', () => showCurrentSrtBlock(wavesurferOriginal.getCurrentTime()));
  if (wavesurferUser) wavesurferUser.on('audioprocess', () => showCurrentSrtBlock(wavesurferUser.getCurrentTime()));
}
