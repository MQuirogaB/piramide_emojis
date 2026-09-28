// Rasteriza un emoji (usando la fuente de emoji del sistema, vía Canvas 2D)
// y lo convierte en un heightmap 0..1 por luminancia — mismo criterio que
// la versión Python (que parte de los SVG de Twemoji): los trazos oscuros
// quedan como la zona "activa" del grabado.

export function rasterizeEmoji(emoji, resolution) {
  const canvas = document.createElement("canvas");
  canvas.width = resolution;
  canvas.height = resolution;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, resolution, resolution);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.round(resolution * 0.82)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.fillText(emoji, resolution / 2, resolution / 2 + resolution * 0.03);
  return ctx.getImageData(0, 0, resolution, resolution);
}

export function heightmapFromImageData(imageData, { invert = false } = {}) {
  const { data, width, height } = imageData;
  const n = width * height;
  const value = new Float32Array(n);
  let vmax = 1e-6;
  for (let p = 0; p < n; p++) {
    const o = p * 4;
    const r = data[o] / 255, g = data[o + 1] / 255, b = data[o + 2] / 255;
    const a = data[o + 3] / 255;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let v = (1 - luminance) * a;
    if (invert) v = Math.max(0, a - v);
    value[p] = v;
    if (v > vmax) vmax = v;
  }
  for (let p = 0; p < n; p++) value[p] /= vmax;
  return value;
}

export function emojiHeightmap(emoji, resolution, opts) {
  const imgData = rasterizeEmoji(emoji, resolution);
  return heightmapFromImageData(imgData, opts);
}
