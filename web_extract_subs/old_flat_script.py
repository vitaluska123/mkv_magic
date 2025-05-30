from flask import Flask, request, render_template_string, send_file, redirect, url_for
import os
import subprocess
import tempfile
import shutil
import re

app = Flask(__name__)
UPLOAD_FOLDER = tempfile.mkdtemp()

def parse_srt_preview(srt_text):
    # Разбиваем на блоки субтитров
    blocks = re.split(r'\n\s*\n', srt_text.strip())
    html_blocks = []
    for block in blocks:
        lines = block.strip().splitlines()
        if len(lines) < 2:
            continue
        # Ищем временные метки
        if re.match(r'\d+$', lines[0]):
            idx = 1
        else:
            idx = 0
        if '-->' in lines[idx]:
            time = lines[idx]
            text = '\n'.join(lines[idx+1:])
        else:
            time = ''
            text = '\n'.join(lines[idx:])
        # Удаляем управляющие коды типа {\an8} и html-теги
        import re as _re
        text = _re.sub(r'{\\?[^}]+}', '', text)
        text = _re.sub(r'<[^>]+>', '', text)
        # Обрезаем слишком длинный текст
        if len(text) > 180:
            text = text[:180] + '...'
        html_blocks.append(f'<div class="srt-block"><span class="srt-time">{time}</span><span class="srt-text">{text.strip()}</span></div>')
    return '\n'.join(html_blocks)

def extract_and_convert(mkv_path, workdir):
    mkvmerge = os.path.join(os.getcwd(), 'mkvmerge.exe')
    mkvextract = os.path.join(os.getcwd(), 'mkvextract.exe')
    ffmpeg = os.path.join(os.getcwd(), 'ffmpeg.exe')
    result = []
    try:
        proc = subprocess.run([mkvmerge, '-i', mkv_path], capture_output=True, text=True)
        tracks = proc.stdout
    except Exception as e:
        result.append({'filename': 'Ошибка', 'preview': f'[Ошибка запуска mkvmerge: {e}]'})
        return result
    subtitle_tracks = []
    for line in tracks.splitlines():
        # DEBUG: выводим строки для анализа
        print('MKVMERGE:', line)
        # Исправленный паттерн для поиска дорожек субтитров
        match = re.match(r'Track ID (\d+): subtitles \(([^)]+)\)', line)
        if match:
            track_id, codec = match.groups()
            subtitle_tracks.append((track_id, codec))
    if not subtitle_tracks:
        result.append({'filename': 'Нет субтитров', 'preview': '[В MKV не найдено дорожек субтитров]'})
        return result
    for track_id, codec in subtitle_tracks:
        ext = 'srt' if 'srt' in codec.lower() else codec.lower()
        out_file = os.path.join(workdir, f'subtitle_{track_id}.{ext}')
        try:
            subprocess.run([mkvextract, 'tracks', mkv_path, f'{track_id}:{out_file}'], check=True)
        except Exception as e:
            result.append({'filename': f'Ошибка извлечения {track_id}', 'preview': f'[Ошибка mkvextract: {e}]'})
            continue
        srt_file = out_file
        if ext != 'srt':
            srt_file = os.path.splitext(out_file)[0] + '.srt'
            try:
                subprocess.run([ffmpeg, '-y', '-i', out_file, srt_file], check=True)
            except Exception as e:
                result.append({'filename': f'Ошибка конвертации {track_id}', 'preview': f'[Ошибка ffmpeg: {e}]'})
                continue
        # Читаем первые 30 строк для предпросмотра
        preview = ''
        try:
            with open(srt_file, encoding='utf-8') as f:
                preview_text = ''
                for i, line in enumerate(f):
                    if i > 30:
                        preview_text += '...\n'
                        break
                    preview_text += line
                preview = parse_srt_preview(preview_text)
        except Exception as e:
            preview = f'[Ошибка чтения файла: {e}]'
        result.append({'filename': os.path.basename(srt_file), 'preview': preview})
    return result

@app.route('/', methods=['GET', 'POST'])
def index():
    subtitles = []
    if request.method == 'POST':
        file = request.files['mkvfile']
        if file:
            mkv_path = os.path.join(UPLOAD_FOLDER, file.filename)
            file.save(mkv_path)
            subtitles = extract_and_convert(mkv_path, UPLOAD_FOLDER)
    return render_template_string(HTML, subtitles=subtitles)

@app.route('/download/<filename>')
def download(filename):
    path = os.path.join(UPLOAD_FOLDER, filename)
    return send_file(path, as_attachment=True)

HTML = '''
<!doctype html>
<html>
<head>
<title>Извлечение субтитров из MKV</title>
<style>
body {
    font-family: Arial, sans-serif;
    background: #f7f7fa;
    margin: 0;
    padding: 0;
}
.container {
    max-width: 700px;
    margin: 40px auto;
    background: #fff;
    border-radius: 10px;
    box-shadow: 0 2px 10px #0001;
    padding: 32px 36px 24px 36px;
}
h2 {
    margin-top: 0;
    color: #2a3a5a;
}
form {
    margin-bottom: 30px;
}
input[type="file"] {
    margin-right: 10px;
}
input[type="submit"] {
    background: #2a3a5a;
    color: #fff;
    border: none;
    padding: 8px 18px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 1em;
    transition: background 0.2s;
}
input[type="submit"]:hover {
    background: #3c4b6e;
}
.subtitle-block {
    margin-bottom: 28px;
    background: #f2f4fa;
    border-radius: 6px;
    padding: 14px 18px;
    box-shadow: 0 1px 4px #0001;
}
.subtitle-block b {
    color: #2a3a5a;
}
.subtitle-block a {
    color: #1a7edb;
    text-decoration: none;
    margin-left: 10px;
}
.subtitle-block a:hover {
    text-decoration: underline;
}
.srt-block {
    position: relative;
    margin-bottom: 18px;
    padding: 38px 16px 18px 140px;
    background: #e9eaf0;
    border-radius: 6px;
    min-height: 38px;
    box-shadow: 0 1px 4px #0001;
    font-size: 1.04em;
    display: flex;
    align-items: flex-start;
    overflow: hidden;
}
.srt-time {
    position: absolute;
    left: 16px;
    top: 16px;
    background: rgba(44, 62, 80, 0.18);
    color: #2a3a5a;
    font-size: 0.98em;
    padding: 2px 10px 2px 8px;
    border-radius: 4px;
    opacity: 0.7;
    font-family: monospace;
    z-index: 2;
}
.srt-text {
    white-space: pre-line;
    color: #222;
    font-family: inherit;
    font-size: 1.08em;
    z-index: 1;
    width: 100%;
    word-break: break-word;
}
</style>
</head>
<body>
<div class="container">
<h2>Загрузка MKV-файла</h2>
<form method=post enctype=multipart/form-data>
  <input type=file name=mkvfile required>
  <input type=submit value=Загрузить>
</form>
{% if subtitles %}
  <h3>Субтитры:</h3>
  {% for sub in subtitles %}
    <div class="subtitle-block">
      <b>{{sub['filename']}}</b> <a href="{{ url_for('download', filename=sub['filename']) }}">Скачать</a><br>
      {{sub['preview']|safe}}
    </div>
  {% endfor %}
{% endif %}
</div>
</body>
</html>
'''

if __name__ == '__main__':
    app.run(debug=True)
