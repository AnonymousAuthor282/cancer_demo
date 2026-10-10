import * as THREE from './vendor/three/build/three.module.js';
import { OrbitControls } from './vendor/three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from './vendor/three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from './vendor/three/examples/jsm/environments/RoomEnvironment.js';

export class SceneViewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.setClearColor(0xf6f6f2);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.canvas = this.renderer.domElement;
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', 'Interactive 3D scene. Drag to rotate, scroll to zoom, or use arrow keys to rotate.');
    container.replaceChildren(this.canvas);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.001, 1000);
    if (container.clientWidth && container.clientHeight) this.camera.aspect = container.clientWidth / container.clientHeight;
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = false;
    this.controls.maxPolarAngle = Math.PI * 0.94;
    this.controls.addEventListener('change', () => this.render());
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const environment = new RoomEnvironment();
    this.environment = pmrem.fromScene(environment, 0.04);
    environment.dispose();
    pmrem.dispose();
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.60;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xc1c7bb, 0.40));
    const light = new THREE.DirectionalLight(0xffffff, 1.5);
    light.position.set(3, 5, 4);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    light.shadow.bias = -0.0001;
    light.shadow.normalBias = 0.001;
    this.keyLight = light;
    this.scene.add(light, light.target);
    this.loader = new GLTFLoader();
    this.request = 0;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.canvas.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '0'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === '0') { this.reset(); return; }
      if (['+', '=', '-'].includes(event.key)) { this.zoom(event.key === '-' ? 1.2 : 1 / 1.2); return; }
      const spherical = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
      if (event.key === 'ArrowLeft') spherical.theta += 0.12;
      if (event.key === 'ArrowRight') spherical.theta -= 0.12;
      if (event.key === 'ArrowUp') spherical.phi -= 0.1;
      if (event.key === 'ArrowDown') spherical.phi += 0.1;
      spherical.makeSafe();
      this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
      this.controls.update();
    });
    this.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.container.dispatchEvent(new CustomEvent('scene-context-lost'));
    });
    this.resize();
  }
  resize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) return;
    const previousAspect = this.camera.aspect;
    this.camera.aspect = width / height;
    if (this.model && previousAspect !== this.camera.aspect) {
      this.calculateDistance();
      this.controls.minDistance = this.distance * 0.12;
      this.controls.maxDistance = this.distance * 4;
    }
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.render();
  }
  render() {
    if (!this.model) return;
    this.renderer.render(this.scene, this.camera);
    this.canvas.dataset.camera = this.camera.position.toArray().map((x) => x.toFixed(5)).join(',');
    this.canvas.dataset.radius = this.camera.position.distanceTo(this.controls.target).toFixed(5);
  }
  disposeModel(model) {
    const geometries = new Set(), materials = new Set(), textures = new Set();
    model.traverse((node) => {
      if (node.geometry) geometries.add(node.geometry);
      for (const material of (Array.isArray(node.material) ? node.material : node.material ? [node.material] : [])) {
        materials.add(material);
        Object.values(material).forEach((value) => { if (value?.isTexture) textures.add(value); });
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    const bitmaps = new Set();
    textures.forEach((texture) => {
      const data = texture.source?.data;
      if (typeof ImageBitmap !== 'undefined' && data instanceof ImageBitmap) bitmaps.add(data);
      texture.dispose();
    });
    bitmaps.forEach((bitmap) => bitmap.close());
  }
  async load(src) {
    const request = ++this.request;
    this.abort?.abort();
    this.abort = new AbortController();
    const response = await fetch(src, { signal: this.abort.signal });
    if (!response.ok) throw new Error('Scene model could not be downloaded.');
    const data = await response.arrayBuffer();
    if (request !== this.request) return false;
    const gltf = await this.loader.parseAsync(data, '');
    if (request !== this.request) { this.disposeModel(gltf.scene); return false; }
    if (this.model) { this.scene.remove(this.model); this.disposeModel(this.model); }
    this.model = gltf.scene;
    this.model.traverse((node) => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; } });
    this.model.updateMatrixWorld(true);
    this.scene.add(this.model);
    const box = new THREE.Box3().setFromObject(this.model, true);
    if (box.isEmpty()) throw new Error('This model has no visible geometry.');
    this.center = box.getCenter(new THREE.Vector3());
    this.size = box.getSize(new THREE.Vector3());
    this.bounds = box;
    const span = Math.max(this.size.x, this.size.y, this.size.z);
    this.keyLight.position.copy(this.center).add(new THREE.Vector3(1, 2, 1.5).multiplyScalar(span));
    this.keyLight.target.position.copy(this.center);
    const shadow = this.keyLight.shadow.camera;
    shadow.left = -span; shadow.right = span; shadow.top = span; shadow.bottom = -span;
    shadow.near = span * 0.05; shadow.far = span * 6;
    shadow.updateProjectionMatrix();
    this.keyLight.shadow.normalBias = span * 0.0008;
    this.renderer.shadowMap.needsUpdate = true;
    this.calculateDistance();
    this.camera.near = Math.max(0.0001, this.distance / 1000);
    this.camera.far = this.distance * 100;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = this.distance * 0.12;
    this.controls.maxDistance = this.distance * 4;
    this.reset();
    this.canvas.dataset.model = src;
    return true;
  }
  calculateDistance() {
    const direction = new THREE.Vector3(0.65, 0.72, 1).normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    const tanY = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const tanX = tanY * this.camera.aspect;
    let distance = 0;
    for (const x of [this.bounds.min.x, this.bounds.max.x]) {
      for (const y of [this.bounds.min.y, this.bounds.max.y]) {
        for (const z of [this.bounds.min.z, this.bounds.max.z]) {
          const point = new THREE.Vector3(x, y, z).sub(this.center);
          const depth = point.dot(direction);
          distance = Math.max(distance, Math.abs(point.dot(right)) / tanX + depth, Math.abs(point.dot(up)) / tanY + depth);
        }
      }
    }
    this.distance = distance * 1.07;
    this.direction = direction;
  }
  reset() {
    if (!this.model) return;
    this.controls.target.copy(this.center);
    this.camera.position.copy(this.center).add(this.direction.clone().multiplyScalar(this.distance));
    this.camera.lookAt(this.controls.target);
    this.camera.updateMatrixWorld();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    this.model.traverse((node) => {
      if (!node.isMesh) return;
      const positions = node.geometry.attributes.position;
      const point = new THREE.Vector3();
      for (let index = 0; index < positions.count; index += 1) {
        point.fromBufferAttribute(positions, index).applyMatrix4(node.matrixWorld).project(this.camera);
        minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
      }
    });
    const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
    const tanY = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    const shift = right.multiplyScalar(centerX * this.distance * tanY * this.camera.aspect).add(up.multiplyScalar(centerY * this.distance * tanY));
    this.controls.target.add(shift);
    this.camera.position.add(shift);
    this.controls.update();
    this.render();
  }
  zoom(factor) {
    if (!this.model) return;
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, this.controls.minDistance, this.controls.maxDistance));
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
    this.render();
  }
  clear() {
    this.cancel();
    if (this.model) { this.scene.remove(this.model); this.disposeModel(this.model); this.model = null; }
  }
  cancel() { this.request += 1; this.abort?.abort(); }
}
