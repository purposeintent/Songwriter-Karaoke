(() => {
  'use strict';
  const STORAGE_KEY = 'songwriter-karaoke-projects-v1';
  const DB_NAME = 'songwriter-karaoke-audio-v1';
  const audio = document.getElementById('audio');
  const $ = (id) => document.getElementById(id);
  const state = { projects: [], activeId: null, nextSync: 0, peaks: [], duration: 0, audioUrl: null, db: null, toastTimer: null, saveTimer: null, source: null, audioCtx: null, splitter: null, leftGain: null, rightGain: null, merger: null, bypass: null, reduced: null };
  const palette = ['#ef5da8', '#69d5ec', '#b69cff', '#76d6af'];

  function uid() { return globalThis.crypto?.randomUUID?.() || `song-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`; }
  function escapeText(text) { return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
  function activeProject() { return state.projects.find((project) => project.id === state.activeId) || null; }
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.projects)); }
    catch (error) { notify('Could not save project data in this browser.'); }
  }
  function notify(message) {
    const toast = $('toast'); toast.textContent = message; toast.classList.add('show');
    clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }
  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('tracks')) request.result.createObjectStore('tracks'); };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  }
  function storeTrack(id, blob) {
    if (!state.db) return Promise.reject(new Error('Local audio storage unavailable'));
    return new Promise((resolve, reject) => { const tx = state.db.transaction('tracks', 'readwrite'); tx.objectStore('tracks').put(blob, id); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  }
  function getTrack(id) {
    if (!state.db || !id) return Promise.resolve(null);
    return new Promise((resolve) => { const request = state.db.transaction('tracks', 'readonly').objectStore('tracks').get(id); request.onsuccess = () => resolve(request.result || null); request.onerror = () => resolve(null); });
  }
  function removeTrack(id) {
    if (!state.db || !id) return;
    const tx = state.db.transaction('tracks', 'readwrite'); tx.objectStore('tracks').delete(id);
  }
  function loadProjects() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (Array.isArray(saved) && saved.length) return saved.map((item) => ({ ...item, lyrics: Array.isArray(item.lyrics) ? item.lyrics : [] }));
    } catch (error) { /* Start with sample projects when stored data is invalid. */ }
    const now = Date.now();
    return [
      { id: uid(), name: 'Midnight City', artist: 'M83', lyrics: [{ time: null, text: 'Waiting in the car' }, { time: null, text: 'Waiting for the ride in the dark' }, { time: null, text: 'At night the city grows' }], audioId: null, updatedAt: now, demo: true },
      { id: uid(), name: 'Dreams', artist: 'Fleetwood Mac', lyrics: [{ time: null, text: 'Now here you go again' }, { time: null, text: 'You say you want your freedom' }], audioId: null, updatedAt: now - 1, demo: true },
      { id: uid(), name: 'Untitled Song', artist: '', lyrics: [], audioId: null, updatedAt: now - 2, demo: true }
    ];
  }
  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
    const minutes = Math.floor(seconds / 60); const secs = Math.floor(seconds % 60);
    return `${minutes}:${String(secs).padStart(2, '0')}`;
  }
  function renderLibrary() {
    const grid = $('project-grid');
    if (!state.projects.length) { grid.innerHTML = '<div class="empty-library">Your library is empty. Create a project to get started.</div>'; return; }
    grid.innerHTML = state.projects.map((project, index) => {
      const timed = (project.lyrics || []).filter((line) => Number.isFinite(line.time)).length;
      const hue = palette[index % palette.length];
      return `<article class="project-card" data-open-project="${escapeText(project.id)}" tabindex="0" role="button" aria-label="Open ${escapeText(project.name)}"><div class="project-art" style="color:${hue}">♫</div><h3>${escapeText(project.name)}</h3><p class="project-meta">${escapeText(project.artist || 'Local project')} · ${(project.lyrics || []).length} lyric lines</p><div class="project-card-bottom"><span class="status-pill">${project.audioId ? 'Audio added' : 'Add a track'} · ${timed} synced</span><span class="card-arrow">→</span></div></article>`;
    }).join('');
    grid.querySelectorAll('[data-open-project]').forEach((card) => {
      const open = () => selectProject(card.dataset.openProject, 'editor');
      card.addEventListener('click', open); card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
    });
  }
  function selectProject(id, tab = 'editor') {
    if (!state.projects.some((project) => project.id === id)) return;
    state.activeId = id; state.nextSync = 0;
    const project = activeProject();
    $('editor-project-name').textContent = project.name;
    $('player-project-name').textContent = project.name;
    $('stage-song').textContent = project.name;
    $('import-lyrics').value = project.lyrics.map((line) => line.text).join('\n');
    $('editor-lyrics').value = project.lyrics.map((line) => line.text).join('\n');
    renderLyrics(); renderPlayerLyrics(); updateProgress();
    loadProjectAudio(project).then(() => { renderWaveforms(); updateTimes(); }).catch(() => notify('Could not load the saved audio track.'));
    switchTab(tab);
  }
  function createProject(name) {
    const project = { id: uid(), name: name.trim(), artist: '', lyrics: [], audioId: null, updatedAt: Date.now() };
    state.projects.unshift(project); state.activeId = project.id; persist(); renderLibrary(); selectProject(project.id, 'import');
  }
  function switchTab(tab) {
    document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === `view-${tab}`));
    document.querySelectorAll('.tab').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
    if (tab === 'library') renderLibrary();
    if (tab === 'editor') renderLyrics();
    if (tab === 'player') { renderPlayerLyrics(); requestAnimationFrame(scrollActiveLine); }
  }
  document.querySelectorAll('.tab').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.tab)));
  function showNewProjectDialog() { $('project-name').value = ''; $('project-dialog').showModal(); $('project-name').focus(); }
  $('new-project').addEventListener('click', showNewProjectDialog); $('new-project-top').addEventListener('click', showNewProjectDialog);
  $('project-form').addEventListener('submit', (event) => {
    event.preventDefault(); const name = $('project-name').value.trim(); if (!name) return;
    $('project-dialog').close(); createProject(name);
  });
  $('project-form').addEventListener('click', (event) => { if (event.target === $('project-form')) $('project-dialog').close(); });

  async function loadProjectAudio(project) {
    if (state.audioUrl) { URL.revokeObjectURL(state.audioUrl); state.audioUrl = null; }
    audio.pause(); audio.removeAttribute('src'); audio.load(); state.peaks = []; state.duration = 0;
    if (!project?.audioId) { setWaveEmpty(true); updateTimes(); return; }
    const blob = await getTrack(project.audioId);
    if (!blob) { project.audioId = null; persist(); setWaveEmpty(true); return; }
    state.audioUrl = URL.createObjectURL(blob); audio.src = state.audioUrl; audio.load();
    await decodeWave(blob);
  }
  async function handleAudioFile(file) {
    if (!file) return;
    let project = activeProject();
    if (!project) { createProject(file.name.replace(/\.[^.]+$/, '') || 'Untitled Song'); project = activeProject(); }
    $('import-file-status').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
    try {
      const audioId = project.audioId || project.id;
      await storeTrack(audioId, file);
      project.audioId = audioId; project.updatedAt = Date.now(); project.demo = false; persist();
      await loadProjectAudio(project); renderWaveforms(); renderLibrary(); updateTimes(); notify('Audio added to this project.');
    } catch (error) { notify('Audio could not be saved locally. Check browser storage permissions.'); }
  }
  $('import-audio').addEventListener('change', (event) => handleAudioFile(event.target.files[0]));
  $('editor-audio').addEventListener('change', (event) => handleAudioFile(event.target.files[0]));

  async function decodeWave(blob) {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('Web Audio unavailable');
      const context = new AudioContextClass(); const buffer = await context.decodeAudioData(await blob.arrayBuffer());
      const channel = buffer.getChannelData(0); const count = 900; const block = Math.max(1, Math.floor(channel.length / count));
      state.peaks = Array.from({ length: count }, (_, i) => { let peak = 0; const end = Math.min(channel.length, (i + 1) * block); for (let j = i * block; j < end; j++) peak = Math.max(peak, Math.abs(channel[j])); return peak; });
      state.duration = buffer.duration; await context.close(); setWaveEmpty(false); renderWaveforms(); updateTimes();
    } catch (error) { state.peaks = []; setWaveEmpty(true); notify('This browser could not decode a waveform for that audio format. Playback may still work.'); }
  }
  function setWaveEmpty(empty) { $('import-wave-empty').classList.toggle('hidden', !empty); $('editor-wave-empty').classList.toggle('hidden', !empty); }
  function renderCanvas(canvas) {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    const ratio = window.devicePixelRatio || 1; canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio);
    const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio); ctx.clearRect(0, 0, rect.width, rect.height);
    const mid = rect.height / 2; const bars = Math.max(1, Math.floor(rect.width / 4));
    for (let i = 0; i < bars; i++) {
      const x = (i / bars) * rect.width; const peakIndex = state.peaks.length ? Math.min(state.peaks.length - 1, Math.floor((i / bars) * state.peaks.length)) : -1;
      const peak = peakIndex < 0 ? 0 : state.peaks[peakIndex]; const barHeight = state.peaks.length ? Math.max(2, peak * (rect.height * .82)) : 3;
      const fraction = state.duration ? audio.currentTime / state.duration : 0;
      ctx.fillStyle = x / rect.width < fraction ? 'rgba(239,93,168,.95)' : `rgba(105,213,236,${state.peaks.length ? .30 + peak * .65 : .24})`;
      ctx.fillRect(x, mid - barHeight / 2, Math.max(1, rect.width / bars - 1), barHeight);
    }
    if (state.duration) { const x = (audio.currentTime / state.duration) * rect.width; ctx.fillStyle = '#fff'; ctx.fillRect(x, 0, 1, rect.height); }
  }
  function renderWaveforms() { renderCanvas($('import-waveform')); renderCanvas($('editor-waveform')); }
  function seekFromWaveform(event) {
    if (!state.duration) return;
    const rect = event.currentTarget.getBoundingClientRect(); audio.currentTime = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * state.duration; updateTimes(); renderWaveforms();
  }
  $('import-waveform').addEventListener('click', seekFromWaveform); $('editor-waveform').addEventListener('click', seekFromWaveform);
  window.addEventListener('resize', renderWaveforms);
  $('save-import').addEventListener('click', () => {
    let project = activeProject(); if (!project) { createProject('Untitled Song'); project = activeProject(); }
    const lines = $('import-lyrics').value.split(/\r?\n/).map((text) => text.trim()).filter(Boolean);
    project.lyrics = lines.map((text) => ({ time: null, text })); project.updatedAt = Date.now(); project.demo = false;
    $('editor-lyrics').value = lines.join('\n'); persist(); renderLyrics(); renderPlayerLyrics(); updateProgress(); switchTab('editor'); notify('Lyrics saved to the editor.');
  });
  $('lrc-file').addEventListener('change', async (event) => {
    const file = event.target.files[0]; if (!file) return;
    try { const text = await file.text(); const parsed = parseLrc(text); $('import-lyrics').value = parsed.map((line) => line.text).join('\n'); let project = activeProject(); if (!project) { createProject(file.name.replace(/\.[^.]+$/, '')); project = activeProject(); } project.lyrics = parsed; project.updatedAt = Date.now(); persist(); $('editor-lyrics').value = parsed.map((line) => line.text).join('\n'); renderLyrics(); renderPlayerLyrics(); updateProgress(); notify(`Imported ${parsed.length} lyric lines.`); }
    catch (error) { notify('Could not read that LRC file.'); }
    event.target.value = '';
  });
  function parseLrc(text) {
    const lines = [];
    text.split(/\r?\n/).forEach((raw) => {
      const matches = [...raw.matchAll(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
      const lyric = raw.replace(/\[[^\]]+\]/g, '').trim(); if (!lyric) return;
      if (!matches.length) { lines.push({ time: null, text: lyric }); return; }
      matches.forEach((match) => { const fraction = match[3] ? Number(`0.${match[3]}`) : 0; lines.push({ time: Number(match[1]) * 60 + Number(match[2]) + fraction, text: lyric }); });
    });
    return lines;
  }
  $('editor-lyrics').addEventListener('input', () => {
    const project = activeProject(); if (!project) return;
    const previous = project.lyrics; const texts = $('editor-lyrics').value.split(/\r?\n/).map((text) => text.trim());
    project.lyrics = texts.map((text, index) => ({ text, time: text && previous[index]?.text === text ? previous[index].time : null })).filter((line) => line.text);
    state.nextSync = Math.min(state.nextSync, project.lyrics.length); project.updatedAt = Date.now();
    clearTimeout(state.saveTimer); state.saveTimer = setTimeout(() => { persist(); renderLyrics(); renderPlayerLyrics(); renderLibrary(); updateProgress(); }, 180);
  });
  function renderLyrics() {
    const project = activeProject(); const list = $('lyrics-list'); if (!project) { list.innerHTML = ''; return; }
    const lines = project.lyrics || [];
    list.innerHTML = lines.map((line, index) => `<div class="lyric-row${index === state.nextSync ? ' current' : ''}" data-line="${index}" tabindex="0"><span class="lyric-time">${Number.isFinite(line.time) ? formatTime(line.time) : '--:--'}</span><span class="lyric-text">${escapeText(line.text)}</span><input class="lyric-edit-time" type="number" min="0" step="0.01" value="${Number.isFinite(line.time) ? line.time.toFixed(2) : ''}" placeholder="time" aria-label="Timestamp for line ${index + 1}"></div>`).join('');
    list.querySelectorAll('.lyric-row').forEach((row) => {
      const index = Number(row.dataset.line); row.addEventListener('click', (event) => { if (event.target.matches('input')) return; const time = project.lyrics[index]?.time; if (Number.isFinite(time)) { audio.currentTime = time; updateTimes(); renderWaveforms(); } else state.nextSync = index; renderLyrics(); });
      row.addEventListener('keydown', (event) => { if (event.key === 'Enter') row.click(); });
      row.querySelector('input').addEventListener('change', (event) => { const value = event.target.value; project.lyrics[index].time = value === '' ? null : Math.max(0, Number(value)); persist(); renderLyrics(); renderPlayerLyrics(); updateProgress(); });
    });
    updateProgress();
  }
  function updateProgress() {
    const project = activeProject(); const lines = project?.lyrics || []; const timed = lines.filter((line) => Number.isFinite(line.time)).length;
    $('sync-progress-text').textContent = `${timed} of ${lines.length} lines timed`; $('sync-progress-bar').style.width = `${lines.length ? timed / lines.length * 100 : 0}%`;
  }
  function findNextUntimed() { const project = activeProject(); if (!project) return -1; for (let i = state.nextSync; i < project.lyrics.length; i++) if (!Number.isFinite(project.lyrics[i].time)) return i; return project.lyrics.findIndex((line) => !Number.isFinite(line.time)); }
  function stampNextLine() {
    const project = activeProject(); if (!project || !project.lyrics.length) { notify('Add lyric lines before syncing.'); return; }
    const index = findNextUntimed(); if (index < 0) { notify('Every lyric line already has a timestamp.'); return; }
    project.lyrics[index].time = Number(audio.currentTime.toFixed(2)); state.nextSync = index + 1; project.updatedAt = Date.now(); persist(); renderLyrics(); renderPlayerLyrics(); updateProgress(); renderLibrary();
    const row = $('lyrics-list').querySelector(`[data-line="${index}"]`); row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  $('stamp-next').addEventListener('click', stampNextLine);
  $('reset-sync').addEventListener('click', () => { state.nextSync = 0; renderLyrics(); notify('Sync target reset to the first line.'); });
  document.addEventListener('keydown', (event) => {
    const tag = event.target?.tagName?.toLowerCase();
    if (event.code === 'Space' && $('view-editor').classList.contains('active') && tag !== 'textarea' && tag !== 'input' && tag !== 'button' && !event.target?.isContentEditable) {
      event.preventDefault(); if (!audio.paused) stampNextLine(); else togglePlayback();
    }
  });
  function renderPlayerLyrics() {
    const project = activeProject(); const stage = $('stage-lyrics');
    if (!project?.lyrics?.length) { stage.innerHTML = '<p class="stage-empty">Add lyrics in the editor to see them here.</p>'; return; }
    stage.innerHTML = project.lyrics.map((line, index) => `<p class="stage-line" data-stage-line="${index}">${escapeText(line.text)}</p>`).join(''); updateActiveLine();
  }
  function updateActiveLine() {
    const project = activeProject(); if (!project) return;
    let active = -1; project.lyrics.forEach((line, index) => { if (Number.isFinite(line.time) && line.time <= audio.currentTime) active = index; });
    $('stage-lyrics').querySelectorAll('.stage-line').forEach((line, index) => line.classList.toggle('active', index === active));
    if (active >= 0) { const current = $('stage-lyrics').querySelector(`[data-stage-line="${active}"]`); if (current && $('view-player').classList.contains('active')) current.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    $('lyrics-list').querySelectorAll('.lyric-row').forEach((row, index) => row.classList.toggle('current', index === active));
  }
  function scrollActiveLine() { const active = $('stage-lyrics').querySelector('.stage-line.active'); active?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  function togglePlayback() {
    if (!audio.src) { notify('Import an audio track to play.'); return; }
    if (audio.paused) audio.play().catch(() => notify('Playback could not start. Tap play again to allow audio.')); else audio.pause();
  }
  $('editor-play').addEventListener('click', togglePlayback); $('player-play').addEventListener('click', togglePlayback);
  audio.addEventListener('play', () => { $('editor-play').textContent = 'Ⅱ'; $('player-play').textContent = 'Ⅱ'; });
  audio.addEventListener('pause', () => { $('editor-play').textContent = '▶'; $('player-play').textContent = '▶'; });
  audio.addEventListener('timeupdate', () => { updateTimes(); updateActiveLine(); renderWaveforms(); });
  audio.addEventListener('loadedmetadata', updateTimes); audio.addEventListener('ended', () => updateActiveLine());
  function updateTimes() {
    const current = audio.currentTime || 0; const duration = Number.isFinite(audio.duration) ? audio.duration : state.duration;
    const label = `${formatTime(current)} / ${formatTime(duration)}`; $('editor-time').textContent = label; $('player-time').textContent = label;
    $('seek-slider').value = duration ? Math.round(current / duration * 1000) : 0;
  }
  $('seek-slider').addEventListener('input', () => { const duration = Number.isFinite(audio.duration) ? audio.duration : state.duration; if (duration) { audio.currentTime = Number($('seek-slider').value) / 1000 * duration; updateTimes(); renderWaveforms(); } });

  function initVocalReducer() {
    if (state.audioCtx) return true;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass || !audio.src) { notify('Load audio before enabling vocal reduction.'); return false; }
    try {
      state.audioCtx = new AudioContextClass(); state.source = state.audioCtx.createMediaElementSource(audio);
      state.bypass = state.audioCtx.createGain(); state.reduced = state.audioCtx.createGain(); state.splitter = state.audioCtx.createChannelSplitter(2); state.leftGain = state.audioCtx.createGain(); state.rightGain = state.audioCtx.createGain(); state.merger = state.audioCtx.createChannelMerger(2);
      state.rightGain.gain.value = -1;
      state.source.connect(state.bypass); state.bypass.connect(state.audioCtx.destination);
      state.source.connect(state.splitter); state.splitter.connect(state.leftGain, 0); state.splitter.connect(state.rightGain, 1);
      state.leftGain.connect(state.merger, 0, 0); state.leftGain.connect(state.merger, 0, 1); state.rightGain.connect(state.merger, 0, 0); state.rightGain.connect(state.merger, 0, 1);
      state.merger.connect(state.reduced); state.reduced.connect(state.audioCtx.destination); return true;
    } catch (error) { state.audioCtx = null; notify('Vocal reduction is not supported for this audio setup.'); return false; }
  }
  async function setVocalReduction(enabled) {
    if (enabled && !initVocalReducer()) { $('vocal-cut').checked = false; $('player-vocal-cut').checked = false; return; }
    if (!state.audioCtx) return;
    if (state.audioCtx.state === 'suspended') await state.audioCtx.resume();
    state.bypass.gain.setTargetAtTime(enabled ? 0 : 1, state.audioCtx.currentTime, .02); state.reduced.gain.setTargetAtTime(enabled ? 1 : 0, state.audioCtx.currentTime, .02);
    $('vocal-cut').checked = enabled; $('player-vocal-cut').checked = enabled;
    if (enabled) notify('Center-channel reduction on. Results vary by mix; original stereo is bypassed.');
  }
  $('vocal-cut').addEventListener('change', (event) => setVocalReduction(event.target.checked)); $('player-vocal-cut').addEventListener('change', (event) => setVocalReduction(event.target.checked));
  $('font-size').addEventListener('input', (event) => { const size = Number(event.target.value); $('font-size-value').value = `${size}px`; document.querySelectorAll('.stage-line').forEach((line) => line.style.fontSize = `${size}px`); });
  $('backdrop').addEventListener('change', (event) => { const stage = $('karaoke-stage'); stage.classList.remove('midnight', 'violet', 'ocean', 'plain'); stage.classList.add(event.target.value); });
  $('export-lrc').addEventListener('click', () => {
    const project = activeProject(); if (!project?.lyrics?.length) { notify('There are no lyrics to export.'); return; }
    const content = project.lyrics.map((line) => { const time = Number.isFinite(line.time) ? line.time : 0; const mins = Math.floor(time / 60); const secs = (time % 60).toFixed(2).padStart(5, '0'); return `[${String(mins).padStart(2, '0')}:${secs}]${line.text}`; }).join('\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = `${project.name.replace(/[^\w -]/g, '').trim() || 'lyrics'}.lrc`; link.click(); URL.revokeObjectURL(url);
  });

  async function init() {
    state.projects = loadProjects(); persist(); renderLibrary();
    try { state.db = await openDatabase(); } catch (error) { notify('Local audio storage is unavailable; audio will not persist after closing this tab.'); }
    if (state.projects.length) selectProject(state.projects[0].id, 'library');
    else switchTab('library');
    updateTimes();
  }
  init();
})();
