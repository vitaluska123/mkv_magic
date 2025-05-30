from flask import Flask, request, render_template, send_file, redirect, url_for, jsonify
import os
import subprocess
import tempfile
import re
import zipfile
import io
import chardet

app = Flask(__name__, static_folder='static')
UPLOAD_FOLDER = tempfile.mkdtemp()

# --- SRT парсер предпросмотра ---
def parse_srt_preview(srt_text):
    blocks = re.split(r'\n\s*\n', srt_text.strip())
    html_blocks = []
    for block in blocks:
        lines = block.strip().splitlines()
        if len(lines) < 2:
            continue
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
        text = re.sub(r'{\\?[^}]+}', '', text)
        text = re.sub(r'<[^>]+>', '', text)
        if len(text) > 180:
            text = text[:180] + '...'
        html_blocks.append(f'<div class="srt-block"><span class="srt-time">{time}</span><span class="srt-text">{text.strip()}</span></div>')
    return '\n'.join(html_blocks)

# --- Извлечение и конвертация ---
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

# --- Веб-маршруты ---
@app.route('/')
def home():
    return render_template('home.html')

@app.route('/subtitles', methods=['GET', 'POST'])
def subtitles():
    subtitles = []
    if request.method == 'POST':
        file = request.files['mkvfile']
        if file:
            mkv_path = os.path.join(UPLOAD_FOLDER, file.filename)
            file.save(mkv_path)
            subtitles = extract_and_convert(mkv_path, UPLOAD_FOLDER)
    return render_template('index.html', subtitles=subtitles)

@app.route('/download/<filename>')
def download(filename):
    path = os.path.join(UPLOAD_FOLDER, filename)
    return send_file(path, as_attachment=True)

@app.route('/audio-extract', methods=['GET', 'POST'])
def audio_extract():
    tracks = []
    audio_file = None
    mkvfile_path = None
    preview_file = None
    error = None
    if request.method == 'POST':
        if 'mkvfile' in request.files:
            file = request.files['mkvfile']
            if file:
                mkvfile_path = os.path.join(UPLOAD_FOLDER, file.filename)
                file.save(mkvfile_path)
                mkvmerge = os.path.join(os.getcwd(), 'mkvmerge.exe')
                if not os.path.exists(mkvmerge):
                    return render_template('audio_extract.html', tracks=[], audio_file=None, mkvfile_path=None, error='mkvmerge.exe не найден!')
                proc = subprocess.run([mkvmerge, '-i', mkvfile_path], capture_output=True, text=True)
                import re
                for line in proc.stdout.splitlines():
                    match = re.match(r'Track ID (\d+): audio \(([^)]+)\)(?: \[(...)\])?', line)
                    if match:
                        track_id, codec, lang = match.groups(default='und')
                        tracks.append({'id': track_id, 'codec': codec, 'lang': lang})
        elif 'track_id' in request.form and 'mkvfile_path' in request.form:
            track_id = request.form['track_id']
            mkvfile_path = request.form['mkvfile_path']
            mkvextract = os.path.join(os.getcwd(), 'mkvextract.exe')
            ffmpeg = os.path.join(os.getcwd(), 'ffmpeg.exe')
            out_file = f'audio_track_{track_id}.mka'
            out_path = os.path.join(UPLOAD_FOLDER, out_file)
            subprocess.run([mkvextract, 'tracks', mkvfile_path, f'{track_id}:{out_path}'], check=True)
            # Конвертируем в mp3 для предпрослушивания
            preview_file = f'audio_track_{track_id}_preview.mp3'
            preview_path = os.path.join(UPLOAD_FOLDER, preview_file)
            try:
                subprocess.run([ffmpeg, '-y', '-i', out_path, '-vn', '-acodec', 'libmp3lame', '-ar', '44100', '-ac', '2', '-b:a', '192k', preview_path], check=True)
            except Exception as e:
                error = f'Ошибка конвертации для предпрослушивания: {e}'
                preview_file = None
            audio_file = out_file
    return render_template('audio_extract.html', tracks=tracks, audio_file=audio_file, mkvfile_path=mkvfile_path, preview_file=preview_file, error=error)

@app.route('/voiceover', methods=['GET'])
def voiceover():
    return render_template('voiceover.html')

@app.route('/voiceover-upload', methods=['POST'])
def voiceover_upload():
    file = request.files.get('mkvfile')
    if not file:
        return {"error": "Файл не получен"}, 400
    mkv_path = os.path.join(UPLOAD_FOLDER, file.filename)
    file.save(mkv_path)
    ffmpeg = os.path.join(os.getcwd(), 'ffmpeg.exe')
    video_out = os.path.join(UPLOAD_FOLDER, file.filename + '_video.mp4')
    audio_out = os.path.join(UPLOAD_FOLDER, file.filename + '_audio.wav')
    # Извлечь видео без аудио
    subprocess.run([ffmpeg, '-y', '-i', mkv_path, '-an', '-c:v', 'libx264', '-preset', 'ultrafast', video_out], check=True)
    # Извлечь первую аудиодорожку
    subprocess.run([ffmpeg, '-y', '-i', mkv_path, '-vn', '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2', audio_out], check=True)
    # Извлекаем все субтитры (srt/ass)
    mkvextract = os.path.join(os.getcwd(), 'mkvextract.exe')
    mkvmerge = os.path.join(os.getcwd(), 'mkvmerge.exe')
    proc = subprocess.run([mkvmerge, '-i', mkv_path], capture_output=True, text=True)
    subs_tracks = []
    for line in proc.stdout.splitlines():
        m = re.match(r'Track ID (\d+): subtitles \(([^)]+)\)(?: \[(.*?)\])?', line)
        if m:
            track_id, subs_type, lang = m.groups()
            ext = 'srt' if 'srt' in subs_type.lower() else 'ass'
            subs_file = os.path.join(UPLOAD_FOLDER, f'subs_{track_id}.{ext}')
            subprocess.run([mkvextract, 'tracks', mkv_path, f'{track_id}:{subs_file}'], check=True)
            # Определяем кодировку и читаем
            with open(subs_file, 'rb') as f:
                raw = f.read()
                enc = chardet.detect(raw)['encoding'] or 'utf-8'
                subs_text = raw.decode(enc, errors='replace')
            label = f"{subs_type.upper()} ({lang})" if lang else subs_type.upper()
            subs_tracks.append({
                "text": subs_text,
                "type": subs_type,
                "label": label
            })
    # Для обратной совместимости (если только одна дорожка)
    subs_text = subs_tracks[0]["text"] if subs_tracks else None
    subs_type = subs_tracks[0]["type"] if subs_tracks else None
    return {
        "video_url": url_for('download', filename=os.path.basename(video_out)),
        "audio_url": url_for('download', filename=os.path.basename(audio_out)),
        "subs_text": subs_text,
        "subs_type": subs_type,
        "subs_tracks": subs_tracks
    }

# --- Архивирование проекта (озвучка) ---
@app.route('/voiceover-save-archive', methods=['POST'])
def voiceover_save_archive():
    """
    Принимает список файлов (имена или содержимое), JSON-настройки,
    формирует zip-архив и отдаёт его пользователю.
    Ожидает: multipart/form-data с файлами (video, audio, subs, user_audio, settings_json)
    """
    mem_zip = io.BytesIO()
    with zipfile.ZipFile(mem_zip, 'w', zipfile.ZIP_DEFLATED) as zf:
        # Сохраняем все переданные файлы в архив
        for key in request.files:
            file = request.files[key]
            zf.writestr(file.filename, file.read())
        # Сохраняем JSON-настройки (если есть)
        if 'settings_json' in request.form:
            zf.writestr('settings.json', request.form['settings_json'])
    mem_zip.seek(0)
    return send_file(mem_zip, mimetype='application/zip', as_attachment=True, download_name='voiceover_project.zip')

@app.route('/voiceover-load-archive', methods=['POST'])
def voiceover_load_archive():
    """
    Принимает zip-архив, распаковывает, возвращает ссылки на восстановленные файлы и настройки.
    Ожидает: файл 'archive' (zip)
    """
    archive = request.files.get('archive')
    if not archive:
        return jsonify({'error': 'Архив не получен'}), 400
    with zipfile.ZipFile(archive) as zf:
        file_urls = {}
        settings_json = None
        for name in zf.namelist():
            data = zf.read(name)
            if name.endswith('.json'):
                settings_json = data.decode('utf-8')
            else:
                # Сохраняем файл во временную папку
                out_path = os.path.join(UPLOAD_FOLDER, name)
                with open(out_path, 'wb') as f:
                    f.write(data)
                file_urls[name] = url_for('download', filename=name)
    return jsonify({'files': file_urls, 'settings': settings_json})
