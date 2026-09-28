// Geometría pura (sin dependencias): pirámide truncada de base poligonal
// regular (triangular) construida como una pila de troncos (permite un
// pequeño "reborde" en la base antes del cuerpo principal, calcado del
// STL de referencia) + marcos de cada cara lateral + malla del "sello" de
// grabado a partir de un heightmap.

/**
 * Anillo de vértices de un polígono regular de `numSides` lados y lado
 * `sideLength`, centrado en el origen, a la altura `z`. Los vértices están
 * en sentido antihorario visto desde +Z, con una arista (no un vértice)
 * centrada hacia -Y (para que la "cara 0" quede mirando al frente).
 */
function ngonRing(numSides, sideLength, z) {
  const R = sideLength / (2 * Math.sin(Math.PI / numSides));
  const start = -Math.PI / 2 - Math.PI / numSides;
  const pts = [];
  for (let k = 0; k < numSides; k++) {
    const a = start + k * ((2 * Math.PI) / numSides);
    pts.push([R * Math.cos(a), R * Math.sin(a), z]);
  }
  return pts;
}

export function faceNames(numSides) {
  return Array.from({ length: numSides }, (_, i) => `cara${i + 1}`);
}

/**
 * Vértices y triángulos (índices) del sólido macizo: una pila de troncos
 * de pirámide definida por `spec.rings` (lista ordenada de
 * `{ size, z }`, tamaño = lado del polígono en esa altura). Con 2 anillos
 * es un tronco simple; con 3 (base, "pico" del reborde, cara superior) se
 * obtiene el perfil con reborde en la base.
 */
export function frustumMesh({ numSides, rings }) {
  const ringPts = rings.map((r) => ngonRing(numSides, r.size, r.z));
  const nRings = ringPts.length;

  const vertices = Float32Array.from(ringPts.flat().flat());
  const faces = [];

  // tapa inferior (normal -Z): fan invertido desde el vértice 0 del primer anillo
  for (let i = 1; i < numSides - 1; i++) faces.push(0, i + 1, i);
  // tapa superior (normal +Z): fan directo desde el vértice 0 del último anillo
  const topBase = (nRings - 1) * numSides;
  for (let i = 1; i < numSides - 1; i++) faces.push(topBase, topBase + i, topBase + i + 1);

  // caras laterales de cada segmento (entre anillos consecutivos)
  for (let seg = 0; seg < nRings - 1; seg++) {
    const baseIdx = seg * numSides;
    const nextIdx = (seg + 1) * numSides;
    for (let k = 0; k < numSides; k++) {
      const b0 = baseIdx + k, b1 = baseIdx + ((k + 1) % numSides);
      const t0 = nextIdx + k, t1 = nextIdx + ((k + 1) % numSides);
      faces.push(b0, b1, t1, b0, t1, t0);
    }
  }

  return { vertices, faces: Uint32Array.from(faces) };
}

/**
 * Marco de referencia (origen + ejes u,v,normal + extensión utilizable) de
 * la cara lateral `index` del segmento `segmentIndex` (por defecto, el
 * último segmento = el cuerpo principal, donde va el emoji).
 */
export function faceFrame(spec, index, segmentIndex = spec.rings.length - 2) {
  const n = spec.numSides;
  const r0 = spec.rings[segmentIndex];
  const r1 = spec.rings[segmentIndex + 1];
  const bottom = ngonRing(n, r0.size, r0.z);
  const top = ngonRing(n, r1.size, r1.z);

  const b0 = bottom[index], b1 = bottom[(index + 1) % n];
  const t0 = top[index], t1 = top[(index + 1) % n];

  const bottomMid = midpoint(b0, b1);
  const topMid = midpoint(t0, t1);

  let uHat = normalize(sub(b1, b0));
  const vVec = sub(topMid, bottomMid);
  const vLen = norm(vVec);
  const vHat = scale(vVec, 1 / vLen);

  let normal = normalize(cross(uHat, vHat));
  const outward = [bottomMid[0], bottomMid[1], 0];
  if (dot(normal, outward) < 0) {
    normal = scale(normal, -1);
    uHat = scale(uHat, -1);
  }

  const topEdgeLen = norm(sub(t1, t0));
  const margin = spec.emojiMarginFraction ?? 0.18;
  const usableWidth = topEdgeLen * (1 - margin);
  const usableHeight = vLen * (1 - 2 * margin);
  const vOffset = vLen * margin;

  const origin = add(bottomMid, scale(vHat, vOffset));

  return {
    name: faceNames(n)[index],
    origin, uHat, vHat, normal,
    uExtent: usableWidth,
    vExtent: usableHeight,
  };
}

export function allSideFaceFrames(spec, segmentIndex) {
  return Array.from({ length: spec.numSides }, (_, i) => faceFrame(spec, i, segmentIndex));
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

  const origin = add(frame.origin, scale(frame.vHat, (frame.vExtent - vExtent) / 2));

  const toWorld = (u, v, w) => [
    origin[0] + u * frame.uHat[0] + v * frame.vHat[0] + w * frame.normal[0],
    origin[1] + u * frame.uHat[1] + v * frame.vHat[1] + w * frame.normal[1],
    origin[2] + u * frame.uHat[2] + v * frame.vHat[2] + w * frame.normal[2],
  ];

  const nTop = n * n;
  const vertices = new Float32Array(2 * nTop * 3);
  const idx = (i, j, layer) => layer * nTop + i * n + j;

  for (let i = 0; i < n; i++) {
    const imgRow = n - 1 - i; // fila 0 = arriba del dibujo, v=0 = abajo de la cara
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

/**
 * Agujero escalonado para el tornillo: un tramo ancho (holeDiameter, desde
 * la cara superior hasta `stopDepth` mm de profundidad) y, a partir de ahí,
 * un tramo estrecho (stopDiameter) que hace de tope, hasta el final de la
 * pieza.
 */
export function cylinderHoles(spec) {
  if (!spec.holeEnabled) return [];
  const height = spec.rings[spec.rings.length - 1].z;
  const eps = 1.0;
  return [
    { radius: spec.stopDiameter / 2, z0: -eps, z1: height + eps },
    { radius: spec.holeDiameter / 2, z0: height - spec.stopDepth, z1: height + eps },
  ];
}

// --- utilidades vectoriales ---
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function midpoint(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
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
