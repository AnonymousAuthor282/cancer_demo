const $ = (id) => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let media = null;
let currentTask = 'pick';
let taskVersion = 0;

function announce(message) { $('status').textContent = message; }
function safeAsset(path) {
  if (typeof path !== 'string' || !/^assets\/[a-zA-Z0-9_./-]+$/.test(path) || path.includes('..')) throw new Error('Invalid media asset path');
  return path;
}
function makeVideo(asset, poster, label, { loop = false } = {}) {
  const video = document.createElement('video');
  video.controls = true;
  video.preload = 'none';
  video.playsInline = true;
  video.muted = true;
  video.loop = loop;
  video.poster = safeAsset(poster);
  video.dataset.src = safeAsset(asset.src);
  video.setAttribute('aria-label', label);
  video.addEventListener('error', () => announce(`${label} could not be loaded. Please try again.`));
  video.addEventListener('play', () => {
    if (video.closest('#film-media')) {
      document.querySelectorAll('video').forEach((other) => { if (other !== video) other.pause(); });
    }
  });
  return video;
}
function videoCover(video, posterPath, label, title) {
  video.tabIndex = -1;
  const cover = document.createElement('button');
  cover.type = 'button';
  cover.className = 'task-video-cover feature-video-cover';
  cover.setAttribute('aria-label', `Play ${label}`);
  const poster = document.createElement('img');
  poster.src = safeAsset(posterPath);
  poster.alt = '';
  const play = document.createElement('span');
  play.className = 'play-chip';
  play.textContent = `${title} ▶`;
  cover.append(poster, play);
  cover.addEventListener('click', () => {
    loadVideo(video);
    video.play().catch(() => announce(`${label} could not start. Please retry.`));
  });
  video.addEventListener('play', () => { cover.hidden = true; video.removeAttribute('tabindex'); });
  return cover;
}
function loadVideo(video) {
  if (video.dataset.src) {
    video.preload = 'metadata';
    video.src = video.dataset.src;
    delete video.dataset.src;
    video.load();
  }
}
const loadObserver = new IntersectionObserver((entries) => {
  entries.forEach(({ target, isIntersecting }) => {
    if (isIntersecting) { loadVideo(target); loadObserver.unobserve(target); }
  });
}, { rootMargin: '200px 0px' });
let viewer = null;
let viewerBoot = null;
let selectedScene = 0;
let sceneRequest = 0;
let sceneMode = '3d';
function setModelStatus(message, retry = false) {
  $('scene-model-status').hidden = !message;
  $('scene-model-message').textContent = message;
  $('scene-model-retry').hidden = !retry;
}
async function showSceneModel() {
  const scene = media.scenes[selectedScene];
  const request = ++sceneRequest;
  $('scene-mode-3d').setAttribute('aria-pressed', 'true');
  $('scene-mode-render').setAttribute('aria-pressed', 'false');
  sceneMode = '3d';
  $('scene-detail-image').hidden = false;
  $('scene-canvas-wrap').hidden = true;
  $('scene-interaction-hint').textContent = 'Drag to rotate · Scroll or pinch to zoom · Right-drag to pan';
  if (!scene.model) { setModelStatus('The reference render is available while the 3D model is being prepared.'); return; }
  setModelStatus('Loading 3D scene…');
  try {
    if (!viewerBoot) viewerBoot = import('./scene-viewer.js');
    const module = await viewerBoot;
    if (request !== sceneRequest || !$('scene-dialog').open) return;
    if (!viewer) {
      $('scene-canvas-wrap').hidden = false;
      viewer = new module.SceneViewer($('scene-canvas-wrap'));
      $('scene-canvas-wrap').hidden = true;
    }
    const loaded = await viewer.load(safeAsset(scene.model.src));
    if (!loaded || request !== sceneRequest || !$('scene-dialog').open) return;
    $('scene-canvas-wrap').hidden = false;
    $('scene-detail-image').hidden = true;
    viewer.resize();
    viewer.reset();
    setModelStatus('');
    announce(`${scene.title} 3D scene is ready. Drag to rotate and scroll to zoom.`);
  } catch (error) {
    if (request !== sceneRequest) return;
    console.error('Scene viewer could not load:', error);
    $('scene-canvas-wrap').hidden = true;
    $('scene-detail-image').hidden = false;
    setModelStatus('3D view could not load. The reference render remains available.', true);
  }
}
function showSceneReference() {
  sceneRequest += 1;
  viewer?.cancel();
  sceneMode = 'render';
  $('scene-mode-3d').setAttribute('aria-pressed', 'false');
  $('scene-mode-render').setAttribute('aria-pressed', 'true');
  $('scene-canvas-wrap').hidden = true;
  $('scene-detail-image').hidden = false;
  $('scene-interaction-hint').textContent = 'Approved front-view reference render';
  setModelStatus('');
}
function selectScene(index) {
  selectedScene = (index + media.scenes.length) % media.scenes.length;
  const scene = media.scenes[selectedScene];
  $('scene-dialog-title').textContent = scene.title;
  $('scene-dialog-description').textContent = scene.description;
  $('scene-dialog-count').textContent = `${String(selectedScene + 1).padStart(2, '0')} / 08 · Scene explorer`;
  $('scene-detail-image').src = safeAsset(scene.image.src);
  $('scene-detail-image').alt = `${scene.title}, approved front-view render.`;
  $('scene-original').href = safeAsset(scene.image.src);
  if (sceneMode === '3d') showSceneModel(); else showSceneReference();
}
function openScene(scene) {
  document.querySelectorAll('video').forEach((video) => video.pause());
  $('scene-dialog').showModal();
  document.body.classList.add('dialog-open');
  sceneMode = '3d';
  selectScene(media.scenes.indexOf(scene));
}
$('scene-dialog-close').addEventListener('click', () => $('scene-dialog').close());
$('scene-dialog').addEventListener('close', () => {
  sceneRequest += 1;
  viewer?.clear();
  document.body.classList.remove('dialog-open');
});
$('scene-dialog').addEventListener('click', (event) => {
  const box = $('scene-dialog').getBoundingClientRect();
  if (event.target === $('scene-dialog') && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) $('scene-dialog').close();
});
$('scene-prev').addEventListener('click', () => selectScene(selectedScene - 1));
$('scene-next').addEventListener('click', () => selectScene(selectedScene + 1));
$('scene-mode-3d').addEventListener('click', showSceneModel);
$('scene-mode-render').addEventListener('click', showSceneReference);
$('scene-model-retry').addEventListener('click', showSceneModel);
$('scene-fit').addEventListener('click', () => viewer?.reset());
$('scene-zoom-in').addEventListener('click', () => viewer?.zoom(1 / 1.2));
$('scene-zoom-out').addEventListener('click', () => viewer?.zoom(1.2));
$('scene-canvas-wrap').addEventListener('scene-context-lost', () => {
  showSceneReference();
  setModelStatus('The 3D view was interrupted. Reopen the scene to retry.', true);
  viewer = null;
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) document.querySelectorAll('video').forEach((video) => video.pause());
});

const descriptions = {
  pick: 'Grasp and lift the target object.',
  'place-into': 'Place an object into a container.',
  'place-onto': 'Place an object onto a support surface.',
  rotate: 'Rotate the target joint.',
  slide: 'Move a sliding component.',
  open: 'Open an articulated object.',
  press: 'Press an interactive component.',
};
function showTask(id, report = true) {
  const task = media.interactions.find((item) => item.id === id);
  if (!task) return;
  currentTask = id;
  taskVersion += 1;
  document.querySelectorAll('[data-task]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.task === id)));
  for (const side of ['ours', 'other']) {
    const container = $(`task-${side}`);
    container.querySelector('video')?.pause();
    const asset = task[side];
    const label = `${side === 'ours' ? 'TACER' : 'Other method'} · ${task.title}`;
    if (asset.video) {
      const video = makeVideo(asset.video, asset.poster, label);
      video.tabIndex = -1;
      const cover = document.createElement('button');
      cover.className = 'task-video-cover';
      cover.type = 'button';
      cover.setAttribute('aria-label', `Play ${label} clip`);
      const poster = document.createElement('img');
      poster.src = safeAsset(asset.poster);
      poster.alt = '';
      const play = document.createElement('span');
      play.className = 'play-chip';
      play.textContent = 'Play clip ▶';
      cover.append(poster, play);
      cover.addEventListener('click', () => {
        loadVideo(video);
        video.play().catch(() => announce(`${label} could not start. Please retry.`));
      });
      video.addEventListener('play', () => { cover.hidden = true; video.removeAttribute('tabindex'); });
      container.replaceChildren(video, cover);
      loadObserver.observe(video);
    } else {
      const image = document.createElement('img');
      image.src = safeAsset(asset.poster);
      image.alt = `${label} · selected video frame`;
      image.width = 960;
      image.height = 540;
      container.replaceChildren(image);
    }
  }
  $('task-description').textContent = `${task.title} · ${descriptions[id]}`;
  $('replay-pair').hidden = !(task.ours.video && task.other.video);
  $('replay-pair').disabled = false;
  if (report) announce(`${task.title} examples selected.`);
}
document.querySelectorAll('[data-task]').forEach((button) => button.addEventListener('click', () => {
  if (media) showTask(button.dataset.task);
}));
function readyToPlay(video) {
  loadVideo(video);
  if (video.readyState >= 3) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => done(new Error('Video loading timed out')), 20000);
    function done(error) {
      clearTimeout(timeout);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('error', onError);
      if (error) reject(error); else resolve();
    }
    function onReady() { done(); }
    function onError() { done(new Error('Video could not load')); }
    video.addEventListener('canplay', onReady, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.preload = 'auto';
    video.load();
  });
}
$('replay-pair').addEventListener('click', async () => {
  const version = taskVersion;
  const videos = [...document.querySelectorAll('.task-media video')];
  $('replay-pair').disabled = true;
  try {
    await Promise.all(videos.map(readyToPlay));
    if (version !== taskVersion) return;
    videos.forEach((video) => { video.currentTime = 0; });
    await Promise.all(videos.map((video) => video.play()));
    announce('Both clips are playing from their start. Their action timing and duration can differ.');
  } catch (_) { announce('Unable to start both clips. Use the individual video controls to retry.'); }
  finally { if (version === taskVersion) $('replay-pair').disabled = false; }
});

async function installMedia() {
  const response = await fetch('media.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error('Media manifest unavailable');
  media = await response.json();
  if (media.film.video) {
    const film = makeVideo(media.film.video, media.film.poster, 'TACER overview film');
    film.muted = false;
    $('film-media').replaceChildren(film, videoCover(film, media.film.poster, 'TACER overview film', `Watch the ${Math.round(media.film.video.duration)}-second film`));
    loadObserver.observe(film);
    $('film-duration').textContent = `${Math.round(media.film.video.duration)} second film · sound available`;
  }
  media.scenes.forEach((scene) => {
    const link = document.querySelector(`[data-scene="${scene.id}"]`);
    if (!link) return;
    link.addEventListener('click', (event) => { event.preventDefault(); openScene(scene); });
  });
  showTask(currentTask, false);
  if (media.scale.video && media.scale.poster) {
    const scale = makeVideo(media.scale.video, media.scale.poster, 'TACER scene collection grows across environments');
    $('scale-media').replaceChildren(scale, videoCover(scale, media.scale.poster, 'the scene collection reveal', 'Explore the collection'));
    $('scale-media').hidden = false;
    loadObserver.observe(scale);
  } else if (media.scale.poster) {
    const poster = document.createElement('img');
    poster.src = safeAsset(media.scale.poster);
    poster.alt = 'A collection of generated TACER tabletop scenes.';
    poster.loading = 'lazy';
    $('scale-media').replaceChildren(poster);
    $('scale-media').hidden = false;
  }
}
function bar(label, value, baseline = false) {
  const row = document.createElement('div');
  row.className = `bar-row${baseline ? ' baseline-bar' : ''}`;
  const name = document.createElement('span'); name.textContent = label;
  const track = document.createElement('div'); track.className = 'bar-track'; track.setAttribute('aria-hidden', 'true');
  const fill = document.createElement('div'); fill.className = 'bar-fill'; fill.style.width = `${Math.max(0, Math.min(100, Number(value)))}%`;
  track.append(fill);
  const number = document.createElement('b'); number.textContent = `${Number(value).toFixed(2)}%`;
  row.append(name, track, number);
  return row;
}
async function enhanceResults() {
  const response = await fetch('metrics.json', { cache: 'no-cache' });
  if (!response.ok) return;
  const metrics = await response.json();
  ['rigid_task','articulated_task'].forEach((id, index) => {
    const metric = metrics.highlights.find((item) => item.id === id);
    const card = document.querySelectorAll('.result-highlights article')[index];
    if (!metric || !card) return;
    const bars = document.createElement('div'); bars.className = 'comparison-bars';
    bars.setAttribute('aria-label', `${metric.title}: TACER ${metric.display}, ${metric.baseline.method} ${metric.baseline.display}`);
    bars.append(bar('TACER', metric.value), bar('Baseline', metric.baseline.value, true));
    card.append(bars);
  });
  const lpips = metrics.highlights.find((item) => item.id === 'image_lpips');
  if (lpips) {
    const callout = document.createElement('p'); callout.className = 'image-highlight';
    const strong = document.createElement('strong'); strong.textContent = `Image LPIPS · ${lpips.display}`;
    callout.append(strong, document.createTextNode(` for TACER, compared with ${lpips.baseline.display} for ${lpips.baseline.method}. Lower is better. See the full Image-track table for all methods.`));
    document.querySelector('.construction-results').before(callout);
  }
}
installMedia().catch(() => announce('The scene stills and reported results remain available. Video information could not be loaded.'));
enhanceResults().catch(() => {});
