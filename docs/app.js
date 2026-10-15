import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import ManifoldModule from "manifold-3d";

import {
  frustumMesh, allSideFaceFrames, stampMesh, cylinderHoles, faceNames,
  roundedHullPoints, maxCornerRadius,
} from "./geometry.js";
import { emojiHeightmap } from "./emoji.js";
import { EMOJI_PALETTE } from "./emoji-palette.js";

// ---------------------------------------------------------------------
// Medidas de la pirámide. Los valores por defecto están calcados del STL
// de referencia; se pueden editar con el botón «Editar medidas».
// ---------------------------------------------------------------------

const NUM_SIDES = 3;
const DEFAULT_DIMS = {
  base: 33.6,     // lado del triángulo en la base
  ridge: 40.7,    // lado en el punto más ancho del reborde
  ridgeZ: 3.92,   // altura a la que está el reborde
  top: 11.9,      // lado de la cara superior truncada
  height: 27.51,  // altura total
  round: 1.5,     // radio de redondeo de aristas y vértices (mm)
};
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
  faceState[name] = { emoji: DEFAULT_EMOJI, depth: 1.5, scale: 0.7 };
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

// --- medidas de la pirámide (resumen + modo edición) ---
const DIM_INPUTS = {
  base: el("dimBase"),
  ridge: el("dimRidge"),
  ridgeZ: el("dimRidgeZ"),
  top: el("dimTop"),
  height: el("dimHeight"),
  round: el("dimRound"),
};
const dimsEditBox = el("dims-edit");
const dimsEditBtn = el("dims-edit-btn");
const dimsResetBtn = el("dims-reset-btn");

const fmt = (x) => String(Math.round(x * 100) / 100);

function setDimInputs(dims) {
  for (const [key, input] of Object.entries(DIM_INPUTS)) input.value = dims[key];
}

function currentDimsRaw() {
  const out = {};
  for (const [key, input] of Object.entries(DIM_INPUTS)) out[key] = Number(input.value);
  return out;
}

function renderDimsSummary() {
  const d = currentDimsRaw();
  el("sum-base").textContent = `${fmt(d.base)} mm`;
  el("sum-ridge").textContent = `${fmt(d.ridge)} mm (a ${fmt(d.ridgeZ)} mm)`;
  el("sum-top").textContent = `${fmt(d.top)} mm`;
  el("sum-height").textContent = `${fmt(d.height)} mm`;
  el("sum-round").textContent = d.round > 0 ? `${fmt(d.round)} mm` : "sin redondear";
}

setDimInputs(DEFAULT_DIMS);
renderDimsSummary();
for (const input of Object.values(DIM_INPUTS)) input.addEventListener("input", renderDimsSummary);

dimsEditBtn.addEventListener("click", () => {
  const editing = dimsEditBox.hidden;
  dimsEditBox.hidden = !editing;
  dimsResetBtn.hidden = !editing;
  dimsEditBtn.textContent = editing ? "Listo" : "Editar medidas";
});
dimsResetBtn.addEventListener("click", () => {
  setDimInputs(DEFAULT_DIMS);
  renderDimsSummary();
});

/** Lee y valida las medidas; devuelve { spec } o { error }. */
function readSpec() {
  const d = currentDimsRaw();
  for (const [key, v] of Object.entries(d)) {
    if (!Number.isFinite(v)) return { error: "Hay una medida vacía o no válida. Revisa los campos de «Editar medidas»." };
    if (v < 0 || (key !== "round" && v === 0)) return { error: "Las medidas tienen que ser positivas." };
  }
  if (d.height < 8) return { error: "La altura total tiene que ser de al menos 8 mm." };
  if (d.ridgeZ < 0.5 || d.ridgeZ > d.height - 1) {
    return { error: "La altura del reborde tiene que estar entre 0,5 mm y 1 mm por debajo de la altura total." };
  }
  if (d.ridge < d.base || d.ridge < d.top) {
    return { error: "El reborde tiene que ser la parte más ancha (mayor o igual que la base y la cara superior)." };
  }

  const spec = {
    numSides: NUM_SIDES,
    rings: [
      { size: d.base, z: 0 },
      { size: d.ridge, z: d.ridgeZ },
      { size: d.top, z: d.height },
    ],
    emojiMarginFraction: 0.05,
    cornerRadius: d.round,
    holeEnabled: el("holeEnabled").checked,
    holeDiameter: Number(el("holeDiaNum").value),
    stopDiameter: STOP_DIAMETER,
    stopDepth: Math.min(STOP_DEPTH, d.height - 2),
  };

  if (d.round > 0) {
    const maxR = maxCornerRadius({ ...spec, cornerRadius: 0 });
    if (d.round > maxR * 0.95) {
      return { error: `El radio de redondeo es demasiado grande para estas medidas (máximo ${fmt(maxR * 0.95)} mm).` };
    }
  }
  return { spec };
}

// ---------------------------------------------------------------------
// Three.js: escena / render / preview
// ---------------------------------------------------------------------

const holder = el("canvas-holder");
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
camera.position.set(60, 45, 75);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0); // el degradado lo pone el CSS
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
  color: 0x9a6bb4, roughness: 0.6, metalness: 0.03,
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
  const { spec, error } = readSpec();
  if (error) {
    setStatus(error, true);
    return;
  }
  const faces = readActiveFaces();
  const mode = el("mode").value;
  const resolution = Number(el("resolutionNum").value);

  generateBtn.disabled = true;
  const toDelete = [];
  const track = (m) => { toDelete.push(m); return m; };

  try {
    setStatus("Construyendo el sólido de la pirámide…");
    await yieldToUI();

    let solid;
    if (spec.cornerRadius > 0) {
      // aristas y vértices redondeados: envolvente convexa de esferas
      solid = track(ManifoldCls.hull(roundedHullPoints(spec, spec.cornerRadius)));
    } else {
      const { vertices, faces: idxs } = frustumMesh(spec);
      solid = track(manifoldFromArrays(vertices, idxs));
    }

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
