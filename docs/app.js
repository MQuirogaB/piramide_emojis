import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import ManifoldModule from "manifold-3d";

import { frustumMesh, allSideFaceFrames, stampMesh, cylinderHoles, faceNames } from "./geometry.js";
import { emojiHeightmap } from "./emoji.js";
import { EMOJI_PALETTE } from "./emoji-palette.js";

// ---------------------------------------------------------------------
// Especificación fija de la pirámide (calcada del STL de referencia del
// usuario). No es editable desde la UI a propósito.
// ---------------------------------------------------------------------

const NUM_SIDES = 3;
const RINGS = [
  { size: 33.6, z: 0 },     // base (con el pequeño reborde)
  { size: 40.7, z: 3.92 },  // punto más ancho del reborde
  { size: 11.9, z: 27.51 }, // cara superior truncada
];
const HEIGHT = RINGS[RINGS.length - 1].z;
const STOP_DIAMETER = 3;   // mm, tramo estrecho fijo ("tope")
const STOP_DEPTH = 25.5;   // mm, profundidad a la que empieza el tope

const FACE_NAMES = faceNames(NUM_SIDES);
const DEFAULT_EMOJI = "😐";

// ---------------------------------------------------------------------
// Estado / elementos de UI
// ---------------------------------------------------------------------

const el = (id) => document.getElementById(id);
const statusEl = el("status");
const generateBtn = el("generate-btn");
const downloadBtn = el("download-btn");
const statsEl = el("stats");

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", isError);
}

// --- estado de los emojis por cara ---
const faceState = {}; // { [faceName]: { emoji, depth, scale } }
for (const name of FACE_NAMES) {
  faceState[name] = { emoji: DEFAULT_EMOJI, depth: 0.8, scale: 0.85 };
}

function buildEmojiGrid(onPick) {
  const grid = document.createElement("div");
  grid.className = "emoji-grid";
  for (const em of EMOJI_PALETTE) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = em;
    b.addEventListener("click", () => onPick(em, grid));
    grid.appendChild(b);
  }
  return grid;
}

function buildFaceCard(label, state, onChange) {
  const card = document.createElement("div");
  card.className = "face-card";

  const title = document.createElement("p");
  title.className = "face-name";
  title.textContent = label;
  card.appendChild(title);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "emoji-picker-btn";
  const emojiSpan = document.createElement("span");
  emojiSpan.textContent = state.emoji;
  const hintSpan = document.createElement("span");
  hintSpan.className = "hint";
  hintSpan.textContent = "cambiar";
  btn.appendChild(emojiSpan);
  btn.appendChild(hintSpan);
  card.appendChild(btn);

  const grid = buildEmojiGrid((emoji, gridEl) => {
    state.emoji = emoji;
    emojiSpan.textContent = emoji;
    gridEl.classList.remove("open");
    onChange();
  });
  card.appendChild(grid);

  btn.addEventListener("click", () => grid.classList.toggle("open"));

  const miniRow = document.createElement("div");
  miniRow.className = "mini-row";
  miniRow.innerHTML = `
    <div><label>Profundidad (mm)</label><input type="number" min="0" max="4" step="0.1" value="${state.depth}"></div>
    <div><label>Escala (0-1)</label><input type="number" min="0.1" max="1" step="0.05" value="${state.scale}"></div>
  `;
  const [depthInput, scaleInput] = miniRow.querySelectorAll("input");
  depthInput.addEventListener("input", () => { state.depth = Number(depthInput.value); onChange(); });
  scaleInput.addEventListener("input", () => { state.scale = Number(scaleInput.value); onChange(); });
  card.appendChild(miniRow);

  return card;
}

const facesContainer = el("faces");
const emojiModeSelect = el("emojiMode");

function renderFaceCards() {
  facesContainer.innerHTML = "";
  const mode = emojiModeSelect.value;
  if (mode === "same") {
    // Un único selector cuyo valor se copia a las 3 caras.
    const shared = faceState[FACE_NAMES[0]];
    const card = buildFaceCard("Emoji (las 3 caras)", shared, () => {
      for (const name of FACE_NAMES) faceState[name] = { ...shared };
    });
    facesContainer.appendChild(card);
  } else {
    for (const name of FACE_NAMES) {
      const card = buildFaceCard(name, faceState[name], () => {});
      facesContainer.appendChild(card);
    }
  }
}
emojiModeSelect.addEventListener("change", renderFaceCards);
renderFaceCards();

function readActiveFaces() {
  if (emojiModeSelect.value === "same") {
    const shared = faceState[FACE_NAMES[0]];
    const out = {};
    for (const name of FACE_NAMES) out[name] = { ...shared };
    return out;
  }
  return { ...faceState };
}

// --- sincronizar slider<->número del agujero ---
function linkRangeNumber(rangeId, numId) {
  const r = el(rangeId), n = el(numId);
  r.addEventListener("input", () => { n.value = r.value; });
  n.addEventListener("input", () => { r.value = n.value; });
}
linkRangeNumber("holeDia", "holeDiaNum");
linkRangeNumber("resolution", "resolutionNum");

function readSpec() {
  return {
    numSides: NUM_SIDES,
    rings: RINGS,
    emojiMarginFraction: 0.18,
    holeEnabled: el("holeEnabled").checked,
    holeDiameter: Number(el("holeDiaNum").value),
    stopDiameter: STOP_DIAMETER,
    stopDepth: STOP_DEPTH,
  };
}

// ---------------------------------------------------------------------
// Three.js: escena / render / preview
// ---------------------------------------------------------------------

const holder = el("canvas-holder");
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f1115);

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
camera.position.set(60, 45, 75);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
holder.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 10, 0);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x30302a, 0.9));
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(60, 90, 40);
scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.5);
fill.position.set(-60, 30, -40);
scene.add(fill);

const material = new THREE.MeshStandardMaterial({
  color: 0xf2c94c, roughness: 0.55, metalness: 0.05,
});

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
}

// ---------------------------------------------------------------------
// STL binario a partir del triángulo suelto (vertProperties/triVerts)
// ---------------------------------------------------------------------

function buildBinarySTL(vertProperties, triVerts) {
  const triCount = triVerts.length / 3;
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triCount, true);

  const gv = (i) => [vertProperties[i * 3], vertProperties[i * 3 + 1], vertProperties[i * 3 + 2]];

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

let ManifoldCls = null;
let MeshCls = null;

async function initManifold() {
  const wasm = await ManifoldModule();
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
  const faces = readActiveFaces();
  const mode = el("mode").value;
  const resolution = Number(el("resolutionNum").value);

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
      setStatus(`Grabando ${faceSpec.emoji} en la ${name}…`);
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
    generate();
  } catch (err) {
    console.error(err);
    setStatus("No se pudo cargar el motor 3D: " + (err?.message || err), true);
  }
})();
