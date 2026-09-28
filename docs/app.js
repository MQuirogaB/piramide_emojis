import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import ManifoldModule from "manifold-3d";

import { frustumMesh, allSideFaceFrames, stampMesh, cylinderHoles, SIDE_FACE_NAMES } from "./geometry.js";
import { emojiHeightmap } from "./emoji.js";

// ---------------------------------------------------------------------
// Estado / elementos de UI
// ---------------------------------------------------------------------

const el = (id) => document.getElementById(id);
const statusEl = el("status");
const generateBtn = el("generate-btn");
const downloadBtn = el("download-btn");
const statsEl = el("stats");

const FACE_LABELS = { front: "frontal", right: "derecha", back: "trasera", left: "izquierda" };
const DEFAULT_FACES = {
  front: { emoji: "😐", depth: 0.8, scale: 0.9 },
  right: { emoji: "😀", depth: 0.8, scale: 0.9 },
  back: { emoji: "😎", depth: 0.8, scale: 0.9 },
  left: { emoji: "😉", depth: 0.8, scale: 0.9 },
};

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", isError);
}

// --- construir el panel de caras dinámicamente ---
const facesContainer = el("faces");
for (const name of SIDE_FACE_NAMES) {
  const d = DEFAULT_FACES[name];
  const card = document.createElement("div");
  card.className = "face-card";
  card.innerHTML = `
    <p class="face-name">${FACE_LABELS[name]}</p>
    <input class="emoji-input" type="text" id="emoji-${name}" value="${d.emoji}" maxlength="8">
    <div class="mini-row">
      <div><label for="depth-${name}">Profundidad (mm)</label>
        <input type="number" id="depth-${name}" min="0" max="4" step="0.1" value="${d.depth}"></div>
      <div><label for="scale-${name}">Escala (0-1)</label>
        <input type="number" id="scale-${name}" min="0.1" max="1" step="0.05" value="${d.scale}"></div>
    </div>
  `;
  facesContainer.appendChild(card);
}

// --- sincronizar cada par slider<->número ---
function linkRangeNumber(rangeId, numId) {
  const r = el(rangeId), n = el(numId);
  if (!r || !n) return;
  r.addEventListener("input", () => { n.value = r.value; });
  n.addEventListener("input", () => { r.value = n.value; });
}
["baseSize", "topSize", "height", "holeDia", "headDia", "headDepth", "resolution"].forEach((id) =>
  linkRangeNumber(id, id + "Num")
);

function readSpec() {
  return {
    baseSize: Number(el("baseSizeNum").value),
    topSize: Number(el("topSizeNum").value),
    height: Number(el("heightNum").value),
    holeEnabled: el("holeEnabled").checked,
    holeDiameter: Number(el("holeDiaNum").value),
    headDiameter: Number(el("headDiaNum").value),
    headDepth: Number(el("headDepthNum").value),
  };
}

function readFaces() {
  const faces = {};
  for (const name of SIDE_FACE_NAMES) {
    const emoji = el(`emoji-${name}`).value.trim();
    if (!emoji) continue;
    faces[name] = {
      emoji,
      depth: Number(el(`depth-${name}`).value),
      scale: Number(el(`scale-${name}`).value),
    };
  }
  return faces;
}

// ---------------------------------------------------------------------
// Three.js: escena / render / preview
// ---------------------------------------------------------------------

const holder = el("canvas-holder");
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f1115);

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
camera.position.set(70, 55, 90);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
holder.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 12, 0);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x30302a, 0.9));
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(60, 90, 40);
scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.5);
fill.position.set(-60, 30, -40);
scene.add(fill);

const material = new THREE.MeshStandardMaterial({
  color: 0xf2c94c, roughness: 0.55, metalness: 0.05, flatShading: false,
});

// El modelo se construye en Z-up (igual que el STL); se envuelve en un grupo
// rotado para mostrarlo Y-up en pantalla sin tocar los datos exportados.
const displayGroup = new THREE.Group();
displayGroup.rotation.x = -Math.PI / 2;
scene.add(displayGroup);

let currentMesh = null;

function resizeRenderer() {
  const w = holder.clientWidth, h = holder.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resizeRenderer);
resizeRenderer();

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

function showPreview(vertProperties, triVerts) {
  if (currentMesh) {
    displayGroup.remove(currentMesh);
    currentMesh.geometry.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertProperties, 3));
  geometry.setIndex(new THREE.BufferAttribute(triVerts, 1));
  geometry.computeVertexNormals();
  currentMesh = new THREE.Mesh(geometry, material);
  displayGroup.add(currentMesh);

  geometry.computeBoundingSphere();
  const r = geometry.boundingSphere.radius;
  const c = geometry.boundingSphere.center;
  controls.target.set(c.x, -c.z, c.y); // (el grupo ya está rotado -90º en X)
}

// ---------------------------------------------------------------------
// STL binario a partir del triángulo suelto (vertProperties/triVerts)
// ---------------------------------------------------------------------

function buildBinarySTL(vertProperties, triVerts) {
  const triCount = triVerts.length / 3;
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buffer);
  // cabecera de 80 bytes (se deja a cero) + nº de triángulos
  view.setUint32(80, triCount, true);

  const gv = (i) => [
    vertProperties[i * 3], vertProperties[i * 3 + 1], vertProperties[i * 3 + 2],
  ];

  let offset = 84;
  for (let t = 0; t < triCount; t++) {
    const ia = triVerts[t * 3], ib = triVerts[t * 3 + 1], ic = triVerts[t * 3 + 2];
    const a = gv(ia), b = gv(ib), c = gv(ic);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;

    view.setFloat32(offset, nx, true); view.setFloat32(offset + 4, ny, true); view.setFloat32(offset + 8, nz, true);
    offset += 12;
    for (const p of [a, b, c]) {
      view.setFloat32(offset, p[0], true); view.setFloat32(offset + 4, p[1], true); view.setFloat32(offset + 8, p[2], true);
      offset += 12;
    }
    view.setUint16(offset, 0, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "model/stl" });
}

let lastSTLBlob = null;

downloadBtn.addEventListener("click", () => {
  if (!lastSTLBlob) return;
  const url = URL.createObjectURL(lastSTLBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "piramide-emoji.stl";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
});

// ---------------------------------------------------------------------
// Motor booleano (manifold-3d / WASM)
// ---------------------------------------------------------------------

let wasm = null;
let ManifoldCls = null;
let MeshCls = null;

async function initManifold() {
  wasm = await ManifoldModule();
  wasm.setup();
  ManifoldCls = wasm.Manifold;
  MeshCls = wasm.Mesh;
}

function manifoldFromArrays(vertices, faces) {
  const mesh = new MeshCls({ numProp: 3, vertProperties: vertices, triVerts: faces });
  return new ManifoldCls(mesh);
}

function yieldToUI() {
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
}

async function generate() {
  const spec = readSpec();
  const faces = readFaces();
  const mode = el("mode").value;
  const resolution = Number(el("resolutionNum").value);

  if (spec.topSize >= spec.baseSize) {
    setStatus("La cara superior debe ser menor que la base (pirámide truncada).", true);
    return;
  }

  generateBtn.disabled = true;
  const toDelete = [];
  const track = (m) => { toDelete.push(m); return m; };

  try {
    setStatus("Construyendo el sólido de la pirámide…");
    await yieldToUI();

    const { vertices, faces: idxs } = frustumMesh(spec);
    let solid = track(manifoldFromArrays(vertices, idxs));

    for (const hole of cylinderHoles(spec)) {
      setStatus("Taladrando el agujero del tornillo…");
      await yieldToUI();
      const h = hole.z1 - hole.z0;
      const cyl = track(ManifoldCls.cylinder(h, hole.radius, hole.radius, 72, false).translate([0, 0, hole.z0]));
      solid = track(solid.subtract(cyl));
    }

    const frames = Object.fromEntries(allSideFaceFrames(spec).map((f) => [f.name, f]));

    for (const [name, faceSpec] of Object.entries(faces)) {
      setStatus(`Grabando ${faceSpec.emoji} en la cara ${FACE_LABELS[name]}…`);
      await yieldToUI();

      const heightmap = emojiHeightmap(faceSpec.emoji, resolution);
      const frame = frames[name];
      const { vertices: sv, faces: sf } = stampMesh(frame, heightmap, resolution, {
        depth: faceSpec.depth,
        baseSkin: 0.05,
        mode,
        scale: faceSpec.scale,
      });
      const stamp = track(manifoldFromArrays(sv, sf));
      solid = track(mode === "engrave" ? solid.subtract(stamp) : solid.add(stamp));
      await yieldToUI();
    }

    setStatus("Extrayendo la malla final…");
    await yieldToUI();

    const outMesh = solid.getMesh();
    const vertProperties = outMesh.vertProperties;
    const triVerts = outMesh.triVerts;

    showPreview(vertProperties, triVerts);
    lastSTLBlob = buildBinarySTL(vertProperties, triVerts);
    downloadBtn.disabled = false;

    statsEl.textContent = `${(triVerts.length / 3).toLocaleString("es-ES")} triángulos`;
    setStatus("Listo. Puedes rotar la vista y descargar el STL.");
  } catch (err) {
    console.error(err);
    setStatus("Error al generar: " + (err?.message || err), true);
  } finally {
    for (const m of toDelete) {
      try { m.delete(); } catch (_) { /* ya liberado */ }
    }
    generateBtn.disabled = false;
  }
}

generateBtn.addEventListener("click", generate);

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------

(async () => {
  try {
    setStatus("Cargando el motor 3D (WASM)…");
    await initManifold();
    setStatus("Listo. Pulsa «Generar pirámide».");
    generateBtn.disabled = false;
    // Genera un ejemplo automáticamente al cargar la página.
    generate();
  } catch (err) {
    console.error(err);
    setStatus("No se pudo cargar el motor 3D: " + (err?.message || err), true);
  }
})();
