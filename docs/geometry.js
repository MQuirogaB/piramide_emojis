// Geometría pura (sin dependencias): pirámide truncada + marcos de cada
// cara lateral + malla del "sello" de grabado a partir de un heightmap.
// Es un port directo de la versión Python (src/piramide_emoji/geometry.py
// y engrave.py) — mismas fórmulas, mismo bobinado de triángulos.

export const SIDE_FACE_NAMES = ["front", "right", "back", "left"];

/**
 * Vértices y triángulos (índices) del sólido macizo de la pirámide truncada.
 * Devuelve arrays planos listos para pasar a manifold-3d:
 *   { vertices: Float32Array [x,y,z,...], faces: Uint32Array [i,j,k,...] }
 */
export function frustumMesh({ baseSize, topSize, height }) {
  const hb = baseSize / 2;
  const ht = topSize / 2;
  const bottom = [
    [-hb, -hb, 0], [hb, -hb, 0], [hb, hb, 0], [-hb, hb, 0],
  ];
  const top = [
    [-ht, -ht, height], [ht, -ht, height], [ht, ht, height], [-ht, ht, height],
  ];
  const vertices = [...bottom, ...top].flat();

  const faces = [];
  // tapa inferior (normal -Z)
  faces.push(0, 2, 1, 0, 3, 2);
  // tapa superior (normal +Z)
  faces.push(4, 5, 6, 4, 6, 7);
  // 4 caras laterales
  for (let i = 0; i < 4; i++) {
    const b0 = i, b1 = (i + 1) % 4;
    const t0 = 4 + i, t1 = 4 + ((i + 1) % 4);
    faces.push(b0, b1, t1, b0, t1, t0);
  }

  return { vertices: Float32Array.from(vertices), faces: Uint32Array.from(faces) };
}

/**
 * Marco de referencia (origen + ejes u,v,normal + extensión utilizable) de
 * la cara lateral `index` (0=front/-Y, 1=right/+X, 2=back/+Y, 3=left/-X).
 */
export function faceFrame(spec, index) {
  const hb = spec.baseSize / 2;
  const ht = spec.topSize / 2;
  const h = spec.height;

  const bottomMid = [0, -hb, 0];
  const topMid = [0, -ht, h];
  let uHat0 = [1, 0, 0];
  const vVec0 = sub(topMid, bottomMid);
  const vLen0 = norm(vVec0);
  let vHat0 = scale(vVec0, 1 / vLen0);
  let normal0 = normalize(cross(uHat0, vHat0));
  if (normal0[1] > 0) {
    normal0 = scale(normal0, -1);
    uHat0 = scale(uHat0, -1);
  }

  const angle = (Math.PI / 180) * 90 * index;
  const c = Math.cos(angle), s = Math.sin(angle);
  const rotZ = (v) => [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]];

  const uHat = rotZ(uHat0);
  const vHat = rotZ(vHat0);
  const normal = rotZ(normal0);
  const bottomMidR = rotZ(bottomMid);

  const margin = spec.emojiMarginFraction ?? 0.18;
  const usableWidth = 2 * ht * (1 - margin);
  const usableHeight = vLen0 * (1 - 2 * margin);
  const vOffset = vLen0 * margin;

  const origin = add(bottomMidR, scale(vHat, vOffset));

  return {
    name: SIDE_FACE_NAMES[index % 4],
    origin, uHat, vHat, normal,
    uExtent: usableWidth,
    vExtent: usableHeight,
  };
}

export function allSideFaceFrames(spec) {
  return [0, 1, 2, 3].map((i) => faceFrame(spec, i));
}

/**
 * Construye el sólido del "sello" de grabado/repujado en coordenadas del
 * mundo, listo para restar (engrave) o unir (emboss) con la pirámide.
 *
 * heightmap: Float32Array de tamaño n*n (fila-mayor), valores 0..1
 *   (0 = fondo, 1 = grabado/relieve máximo). La fila 0 debe ser la parte
 *   SUPERIOR del dibujo (igual que un array de imagen).
 *
 * Cara EXTERIOR del sello: plana, ligeramente por fuera (engrave) o por
 * dentro (emboss) de la superficie real, para que la resta booleana
 * atraviese siempre limpiamente todo el contorno. Cara INTERIOR: sigue el
 * heightmap.
 */
export function stampMesh(frame, heightmap, n, { depth, baseSkin, mode, scale: userScale }) {
  const uExtent = frame.uExtent * userScale;
  const vExtent = frame.vExtent * userScale;

  const us = linspace(-uExtent / 2, uExtent / 2, n);
  const vs = linspace(0, vExtent, n);

  // origen desplazado para centrar la franja utilizable (igual que Python)
  const origin = add(frame.origin, scale(frame.vHat, (frame.vExtent - vExtent) / 2));

  const toWorld = (u, v, w) => [
    origin[0] + u * frame.uHat[0] + v * frame.vHat[0] + w * frame.normal[0],
    origin[1] + u * frame.uHat[1] + v * frame.vHat[1] + w * frame.normal[1],
    origin[2] + u * frame.uHat[2] + v * frame.vHat[2] + w * frame.normal[2],
  ];

  // La fila 0 del heightmap es la parte superior del dibujo, pero v=0 es la
  // parte INFERIOR de la cara -> se recorre en orden inverso de filas.
  const nTop = n * n;
  const vertices = new Float32Array(2 * nTop * 3);
  const idx = (i, j, layer) => layer * nTop + i * n + j;

  for (let i = 0; i < n; i++) {
    const imgRow = n - 1 - i; // flip vertical
    for (let j = 0; j < n; j++) {
      const hval = heightmap[imgRow * n + j];
      const d = hval * depth;
      let wOuter, wInner;
      if (mode === "engrave") {
        wOuter = baseSkin;
        wInner = -d;
      } else {
        wOuter = -baseSkin;
        wInner = d;
      }
      const p0 = toWorld(us[j], vs[i], wOuter);
      const p1 = toWorld(us[j], vs[i], wInner);
      const o0 = idx(i, j, 0) * 3, o1 = idx(i, j, 1) * 3;
      vertices[o0] = p0[0]; vertices[o0 + 1] = p0[1]; vertices[o0 + 2] = p0[2];
      vertices[o1] = p1[0]; vertices[o1 + 1] = p1[1]; vertices[o1 + 2] = p1[2];
    }
  }

  const faces = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < n - 1; j++) {
      const a = idx(i, j, 0), b = idx(i, j + 1, 0), c = idx(i + 1, j + 1, 0), d = idx(i + 1, j, 0);
      faces.push(a, b, c, a, c, d);
      const a2 = idx(i, j, 1), b2 = idx(i, j + 1, 1), c2 = idx(i + 1, j + 1, 1), d2 = idx(i + 1, j, 1);
      faces.push(a2, c2, b2, a2, d2, c2);
    }
  }

  // Perímetro en un único bucle (evita inconsistencias de bobinado en las
  // esquinas — ver el comentario detallado en engrave.py).
  const perim = [];
  for (let j = 0; j < n; j++) perim.push([0, j]);
  for (let i = 1; i < n; i++) perim.push([i, n - 1]);
  for (let j = n - 2; j >= 0; j--) perim.push([n - 1, j]);
  for (let i = n - 2; i > 0; i--) perim.push([i, 0]);

  for (let k = 0; k < perim.length; k++) {
    const [i0, j0] = perim[k];
    const [i1, j1] = perim[(k + 1) % perim.length];
    const t0 = idx(i0, j0, 0), t1 = idx(i1, j1, 0);
    const b0 = idx(i0, j0, 1), b1 = idx(i1, j1, 1);
    faces.push(t1, t0, b0, t1, b0, b1);
  }

  return { vertices, faces: Uint32Array.from(faces) };
}

export function cylinderHoles(spec) {
  const holes = [];
  if (!spec.holeEnabled || spec.holeDiameter <= 0) return holes;
  const eps = 1.0;
  holes.push({ radius: spec.holeDiameter / 2, z0: -eps, z1: spec.height + eps });
  if (spec.headDiameter > spec.holeDiameter && spec.headDepth > 0) {
    holes.push({ radius: spec.headDiameter / 2, z0: spec.height - spec.headDepth, z1: spec.height + eps });
  }
  return holes;
}

// --- utilidades vectoriales ---
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function norm(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }
function normalize(a) { const n = norm(a); return [a[0] / n, a[1] / n, a[2] / n]; }
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function linspace(a, b, n) {
  if (n === 1) return [a];
  const out = new Array(n);
  const step = (b - a) / (n - 1);
  for (let i = 0; i < n; i++) out[i] = a + step * i;
  return out;
}
