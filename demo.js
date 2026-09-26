const cases = {
  desk: {
    title: 'Computer desk',
    description: 'A desktop supports a monitor riser, a drawer unit, and a small shelf. These structures provide additional surfaces for everyday objects.',
    alt: 'A computer desk with a raised monitor, desktop shelves, and a drawer unit.',
  },
  workbench: {
    title: 'Parts workbench',
    description: 'A workbench combines a tool tray, fastener compartments, storage drawers, and a vertical tool rack. Small parts occupy distinct nested regions.',
    alt: 'A workbench with a tool rack, organizer drawers, a tool tray, and fastener compartments.',
  },
  laboratory: {
    title: 'Laboratory rack',
    description: 'A laboratory table supports an elevated reagent rack, a test-tube stand, and a nested tray. Objects are arranged across the table and shelf levels.',
    alt: 'A laboratory table with an elevated reagent rack, test tubes, glassware, and a tray.',
  },
};
const $ = id => document.getElementById(id);
const state = { case: 'desk', mode: 'render', request: 0, abort: null, viewer: null, boot: null, auto: false };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

function announce(message) { $('status').textContent = message; }
function setLoading(loading, message = 'Loading 3D scene…', failed = false) {
  $('load-overlay').hidden = !loading;
  $('load-message').textContent = message;
  $('retry').hidden = !failed;
  $('load-overlay').querySelector('.loader').hidden = failed;
  $('viewport').setAttribute('aria-busy', String(loading && !failed));
  $('view-controls').hidden = loading || state.mode !== '3d';
}
function disposeModel(model) {
  if (!model) return;
  const geometries = new Set(), materials = new Set(), textures = new Set();
  model.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    const list = Array.isArray(object.material) ? object.material : [object.material];
    list.filter(Boolean).forEach(material => {
      materials.add(material);
      Object.values(material).filter(value => value?.isTexture).forEach(texture => textures.add(texture));
    });
  });
  geometries.forEach(value => value.dispose());
  textures.forEach(value => { value.source?.data?.close?.(); value.dispose(); });
  materials.forEach(value => value.dispose());
}

async function createViewer() {
  const [THREE, { GLTFLoader }, { OrbitControls }, { RoomEnvironment }] = await Promise.all([
    import('three'),
    import('./vendor/three/examples/jsm/loaders/GLTFLoader.js'),
    import('./vendor/three/examples/jsm/controls/OrbitControls.js'),
    import('./vendor/three/examples/jsm/environments/RoomEnvironment.js'),
  ]);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Interactive 3D scene. Drag or use arrow keys to orbit. Use plus and minus to zoom.');
  canvas.setAttribute('role', 'img');
  $('canvas-wrap').replaceChildren(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, .01, 1000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = .08;
  controls.autoRotateSpeed = .8;
  controls.maxPolarAngle = Math.PI * .94;
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x6c7d96, 2.2);
  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.position.set(4, 7, 5);
  scene.add(hemisphere, light);
  const room = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(room, .04);
  scene.environment = environment.texture;
  room.dispose();
  pmrem.dispose();
  const viewer = { THREE, renderer, scene, camera, controls, loader: new GLTFLoader(), model: null, radius: 1, distance: 4, center: new THREE.Vector3(), aspect: 1 };
  function resize() {
    const { width, height } = $('viewport').getBoundingClientRect();
    const next = width / Math.max(height, 1);
    if (viewer.model) {
      const oldFit = Math.max(1, 1 / viewer.aspect), newFit = Math.max(1, 1 / next);
      camera.position.sub(controls.target).multiplyScalar(newFit / oldFit).add(controls.target);
    }
    viewer.aspect = next;
    camera.aspect = next;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }
  viewer.resize = resize;
  viewer.observer = new ResizeObserver(resize);
  viewer.observer.observe($('viewport'));
  resize();
  renderer.setAnimationLoop(() => {
    if (state.mode !== '3d' || document.hidden) return;
    controls.autoRotate = state.auto && !reducedMotion.matches;
    controls.update();
    renderer.render(scene, camera);
  });
  canvas.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_'].includes(event.key)) return;
    event.preventDefault();
    const delta = camera.position.clone().sub(controls.target);
    const spherical = new THREE.Spherical().setFromVector3(delta);
    if (event.key === 'ArrowLeft') spherical.theta -= .1;
    if (event.key === 'ArrowRight') spherical.theta += .1;
    if (event.key === 'ArrowUp') spherical.phi -= .1;
    if (event.key === 'ArrowDown') spherical.phi += .1;
    if (['+', '='].includes(event.key)) spherical.radius *= .9;
    if (['-', '_'].includes(event.key)) spherical.radius *= 1.1;
    spherical.radius = THREE.MathUtils.clamp(spherical.radius, controls.minDistance, controls.maxDistance);
    spherical.phi = THREE.MathUtils.clamp(spherical.phi, .01, controls.maxPolarAngle);
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
    controls.update();
  });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    setMode('render');
    announce('3D rendering was interrupted. The scene render is still available. Reload the page to restore 3D.');
  });
  return viewer;
}

function resetView(top = false) {
  const v = state.viewer;
  if (!v?.model) return;
  const fit = Math.max(1, 1 / v.aspect);
  const direction = top ? new v.THREE.Vector3(0, 1, .001) : new v.THREE.Vector3(1.2, .8, 1.7);
  v.camera.position.copy(v.center).add(direction.normalize().multiplyScalar(v.distance * fit));
  v.controls.target.copy(v.center);
  v.controls.update();
}

async function loadScene() {
  const request = ++state.request;
  state.abort?.abort();
  const controller = new AbortController();
  state.abort = controller;
  setLoading(true);
  announce(`Loading ${cases[state.case].title}.`);
  try {
    if (!state.boot) state.boot = createViewer().catch(error => { state.boot = null; throw error; });
    const v = await state.boot;
    state.viewer = v;
    if (request !== state.request) return;
    if (v.model) { v.scene.remove(v.model); disposeModel(v.model); v.model = null; }
    const response = await fetch(`assets/${state.case}.glb`, { signal: controller.signal });
    if (!response.ok) throw new Error('Scene unavailable');
    const buffer = await response.arrayBuffer();
    if (request !== state.request) return;
    const gltf = await v.loader.parseAsync(buffer, '');
    if (request !== state.request) { disposeModel(gltf.scene); return; }
    v.model = gltf.scene;
    v.scene.add(v.model);
    const bounds = new v.THREE.Box3().setFromObject(v.model);
    const sphere = bounds.getBoundingSphere(new v.THREE.Sphere());
    v.radius = sphere.radius;
    v.center.copy(sphere.center);
    v.distance = sphere.radius / Math.sin(v.THREE.MathUtils.degToRad(v.camera.fov / 2)) * 1.15;
    v.controls.minDistance = sphere.radius * .45;
    v.controls.maxDistance = sphere.radius * 16;
    v.camera.near = Math.max(sphere.radius / 1000, .001);
    v.camera.far = sphere.radius * 100;
    v.camera.updateProjectionMatrix();
    resetView();
    setLoading(false);
    announce(`${cases[state.case].title} loaded. Drag to orbit and scroll to zoom.`);
  } catch (error) {
    if (request !== state.request || error.name === 'AbortError') return;
    setLoading(true, 'The 3D view could not load. Try again or switch to Render.', true);
    announce('3D view unavailable. A scene render remains available.');
  }
}

function setMode(mode) {
  state.mode = mode;
  $('mode-preview').setAttribute('aria-pressed', String(mode === 'render'));
  $('mode-3d').setAttribute('aria-pressed', String(mode === '3d'));
  $('scene-preview').hidden = mode !== 'render';
  $('canvas-wrap').hidden = mode !== '3d';
  $('viewport-label').textContent = mode === '3d' ? 'Stored 3D scene' : 'Rendered scene';
  $('interaction-hint').textContent = mode === '3d' ? 'Drag to orbit · Scroll to zoom · Arrow keys also rotate the view.' : 'Switch to 3D to inspect the scene.';
  if (mode === '3d') loadScene();
  else { ++state.request; state.abort?.abort(); setLoading(false); }
}

function selectCase(key) {
  if (!(key in cases)) return;
  state.case = key;
  const item = cases[key];
  document.querySelectorAll('[data-case]').forEach(button => {
    button.classList.toggle('active', button.dataset.case === key);
    button.setAttribute('aria-pressed', String(button.dataset.case === key));
  });
  $('scene-title').textContent = item.title;
  $('scene-description').textContent = item.description;
  $('scene-preview').src = `assets/${key}.webp`;
  $('scene-preview').alt = item.alt;
  state.auto = false;
  $('rotate').setAttribute('aria-pressed', 'false');
  announce(`${item.title} selected.`);
  if (state.mode === '3d') loadScene();
}
document.querySelectorAll('[data-case]').forEach(button => button.addEventListener('click', () => selectCase(button.dataset.case)));
$('mode-preview').addEventListener('click', () => setMode('render'));
$('mode-3d').addEventListener('click', () => setMode('3d'));
$('retry').addEventListener('click', loadScene);
$('reset-view').addEventListener('click', () => resetView());
$('top-view').addEventListener('click', () => { state.auto = false; $('rotate').setAttribute('aria-pressed', 'false'); resetView(true); });
$('rotate').addEventListener('click', () => {
  if (reducedMotion.matches) { announce('Automatic rotation is disabled by your reduced-motion preference.'); return; }
  state.auto = !state.auto;
  $('rotate').setAttribute('aria-pressed', String(state.auto));
});
