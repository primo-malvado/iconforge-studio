import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { SVGPathData } from "svg-pathdata";
import svg2ttf from "svg2ttf";

const require = createRequire(import.meta.url);
const IDENTITY = [1, 0, 0, 1, 0, 0];
const EXCLUDED_TAGS = new Set(["defs", "clippath", "mask", "pattern", "marker", "symbol", "metadata", "title", "desc", "style", "lineargradient", "radialgradient", "filter"]);
let woff2EncoderPromise;

function multiply(m, n) {
  const [a, b, c, d, e, f] = m;
  const [A, B, C, D, E, F] = n;
  return [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f];
}

function transformMatrix(value) {
  let matrix = [...IDENTITY];
  for (const match of String(value || "").matchAll(/([A-Za-z]+)\s*\(([^)]*)\)/g)) {
    const name = match[1].toLowerCase();
    const nums = (match[2].match(/[+-]?(?:\d*\.)?\d+(?:[eE][+-]?\d+)?/g) || []).map(Number);
    let item = [...IDENTITY];
    if (name === "matrix" && nums.length === 6) item = nums;
    else if (name === "translate" && nums.length >= 1 && nums.length <= 2) item = [1, 0, 0, 1, nums[0], nums[1] || 0];
    else if (name === "scale" && nums.length >= 1 && nums.length <= 2) item = [nums[0], 0, 0, nums.length === 2 ? nums[1] : nums[0], 0, 0];
    else if (name === "rotate" && (nums.length === 1 || nums.length === 3)) {
      const angle = nums[0] * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
      const rotation = [cos, sin, -sin, cos, 0, 0];
      item = nums.length === 3
        ? multiply(multiply([1, 0, 0, 1, nums[1], nums[2]], rotation), [1, 0, 0, 1, -nums[1], -nums[2]])
        : rotation;
    } else if (name === "skewx" && nums.length === 1) item = [1, 0, Math.tan(nums[0] * Math.PI / 180), 1, 0, 0];
    else if (name === "skewy" && nums.length === 1) item = [1, Math.tan(nums[0] * Math.PI / 180), 0, 1, 0, 0];
    else throw new Error(`Transformação SVG não suportada: ${match[0]}`);
    matrix = multiply(matrix, item);
  }
  return matrix;
}

function parseAttributes(raw) {
  const attrs = {};
  for (const match of String(raw).matchAll(/([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*(["'])([\s\S]*?)\2/g)) attrs[match[1].toLowerCase()] = match[3];
  return attrs;
}
function attr(attrs, name, fallback = "") { return attrs[name.toLowerCase()] ?? fallback; }
function safeSlug(value, fallback) { return String(value || "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || fallback; }
function escapeXml(value) { return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function numbersFromViewBox(value) { return (String(value || "").match(/[+-]?(?:\d*\.)?\d+(?:[eE][+-]?\d+)?/g) || []).map(Number); }

function pointLineDistance(point, start, end) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  return length ? Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / length : Math.hypot(point.x - start.x, point.y - start.y);
}
function flattenCurve(start, control1, control2, end, output, depth = 0) {
  if (depth >= 12 || Math.max(pointLineDistance(control1, start, end), pointLineDistance(control2, start, end)) <= 0.04) {
    output.push(end);
    return;
  }
  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const a = midpoint(start, control1), b = midpoint(control1, control2), c = midpoint(control2, end);
  const d = midpoint(a, b), e = midpoint(b, c), middle = midpoint(d, e);
  flattenCurve(start, a, d, middle, output, depth + 1);
  flattenCurve(middle, e, c, end, output, depth + 1);
}
function polygonPath(points) {
  if (points.length < 3) return "";
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const next = points[(i + 1) % points.length];
    area += points[i].x * next.y - next.x * points[i].y;
  }
  const ordered = area < 0 ? [...points].reverse() : points;
  const number = value => String(Number(value.toFixed(4)));
  return `M${number(ordered[0].x)} ${number(ordered[0].y)}${ordered.slice(1).map(point => `L${number(point.x)} ${number(point.y)}`).join("")}Z`;
}
function circlePolygon(center, radius) {
  return Array.from({ length: 16 }, (_, index) => {
    const angle = index * Math.PI / 8;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  });
}
function cross(a, b) { return a.x * b.y - a.y * b.x; }
export function strokePathToOutline(d, width, linecap = "butt", linejoin = "miter", miterlimit = 4) {
  const radius = width / 2;
  if (!Number.isFinite(radius) || radius <= 0) return "";
  if (!["butt", "round", "square"].includes(linecap)) throw new Error(`Unsupported SVG stroke-linecap: ${linecap}`);
  if (!["miter", "miter-clip", "round", "bevel"].includes(linejoin)) throw new Error(`Unsupported SVG stroke-linejoin: ${linejoin}`);
  const commands = new SVGPathData(d).toAbs().normalizeHVZ(false).normalizeST().qtToC().aToC().commands;
  const subpaths = [];
  let points = [], closed = false, current;
  const save = () => {
    if (points.length) subpaths.push({ points, closed });
    points = []; closed = false;
  };
  for (const command of commands) {
    if (command.type === SVGPathData.MOVE_TO) {
      save();
      current = { x: command.x, y: command.y };
      points = [current];
    } else if (command.type === SVGPathData.LINE_TO) {
      current = { x: command.x, y: command.y };
      points.push(current);
    } else if (command.type === SVGPathData.CURVE_TO) {
      const end = { x: command.x, y: command.y };
      flattenCurve(current, { x: command.x1, y: command.y1 }, { x: command.x2, y: command.y2 }, end, points);
      current = end;
    } else if (command.type === SVGPathData.CLOSE_PATH) {
      const start = points[0];
      closed = true;
      save();
      current = start;
    }
  }
  save();

  const outlines = [];
  for (const subpath of subpaths) {
    const pathPoints = subpath.points.filter((point, index, list) => index === 0 || Math.hypot(point.x - list[index - 1].x, point.y - list[index - 1].y) > 1e-8);
    const isClosed = subpath.closed && pathPoints.length > 2;
    if (isClosed && Math.hypot(pathPoints[0].x - pathPoints.at(-1).x, pathPoints[0].y - pathPoints.at(-1).y) <= 1e-8) pathPoints.pop();
    if (pathPoints.length === 1) {
      if (linecap === "round") outlines.push(polygonPath(circlePolygon(pathPoints[0], radius)));
      continue;
    }

    const segmentCount = isClosed ? pathPoints.length : pathPoints.length - 1;
    const segments = [];
    for (let index = 0; index < segmentCount; index++) {
      const start = pathPoints[index], end = pathPoints[(index + 1) % pathPoints.length];
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      if (length <= 1e-8) continue;
      const direction = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
      segments.push({ start, end, direction, length });
    }
    if (!segments.length) continue;

    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index], normal = { x: -segment.direction.y, y: segment.direction.x };
      const startExtension = !isClosed && index === 0 && linecap === "square" ? radius : 0;
      const endExtension = !isClosed && index === segments.length - 1 && linecap === "square" ? radius : 0;
      const start = { x: segment.start.x - segment.direction.x * startExtension, y: segment.start.y - segment.direction.y * startExtension };
      const end = { x: segment.end.x + segment.direction.x * endExtension, y: segment.end.y + segment.direction.y * endExtension };
      outlines.push(polygonPath([
        { x: start.x + normal.x * radius, y: start.y + normal.y * radius },
        { x: end.x + normal.x * radius, y: end.y + normal.y * radius },
        { x: end.x - normal.x * radius, y: end.y - normal.y * radius },
        { x: start.x - normal.x * radius, y: start.y - normal.y * radius }
      ]));
    }

    if (linecap === "round" && !isClosed) {
      outlines.push(polygonPath(circlePolygon(segments[0].start, radius)));
      outlines.push(polygonPath(circlePolygon(segments.at(-1).end, radius)));
    }
    const firstJoin = isClosed ? 0 : 1, lastJoin = isClosed ? pathPoints.length : pathPoints.length - 1;
    for (let index = firstJoin; index < lastJoin; index++) {
      const previous = segments[(index - 1 + segments.length) % segments.length];
      const next = segments[index % segments.length];
      const turn = cross(previous.direction, next.direction);
      if (Math.abs(turn) <= 1e-8) continue;
      if (linejoin === "round") {
        const side = turn > 0 ? -1 : 1;
        const startAngle = Math.atan2(previous.direction.x * side, -previous.direction.y * side);
        const sweep = Math.atan2(turn, previous.direction.x * next.direction.x + previous.direction.y * next.direction.y);
        const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 12)));
        const center = previous.end;
        const arc = Array.from({ length: steps + 1 }, (_, step) => {
          const angle = startAngle + sweep * step / steps;
          return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
        });
        outlines.push(polygonPath([center, ...arc]));
        continue;
      }

      const side = turn > 0 ? -1 : 1;
      const start = { x: previous.end.x - previous.direction.y * radius * side, y: previous.end.y + previous.direction.x * radius * side };
      const end = { x: previous.end.x - next.direction.y * radius * side, y: previous.end.y + next.direction.x * radius * side };
      const joinPoints = [previous.end, start];
      const denominator = cross(previous.direction, next.direction);
      const offset = { x: end.x - start.x, y: end.y - start.y };
      const distance = cross(offset, next.direction) / denominator;
      const miter = { x: start.x + previous.direction.x * distance, y: start.y + previous.direction.y * distance };
      if ((linejoin === "miter" || linejoin === "miter-clip") && Math.hypot(miter.x - previous.end.x, miter.y - previous.end.y) <= radius * miterlimit) joinPoints.push(miter);
      joinPoints.push(end);
      outlines.push(polygonPath(joinPoints));
    }
  }
  return outlines.join("");
}
function styleAttributes(attrs, inherited = {}) {
  const styles = { ...inherited };
  for (const name of ["fill", "fill-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "vector-effect", "display", "visibility", "opacity", "fill-opacity", "stroke-opacity"]) {
    if (attrs[name] !== undefined) styles[name] = attrs[name];
  }
  for (const declaration of String(attrs.style || "").split(";")) {
    const separator = declaration.indexOf(":");
    if (separator > 0) styles[declaration.slice(0, separator).trim().toLowerCase()] = declaration.slice(separator + 1).trim();
  }
  return styles;
}

export function collectPaths(svg) {
  const found = [];
  const stack = [];
  const tokens = String(svg).replace(/<!--[\s\S]*?-->/g, "").match(/<[^>]+>/g) || [];
  for (const token of tokens) {
    if (/^<\s*[!?]/.test(token)) continue;
    const closing = token.match(/^<\s*\/\s*([a-zA-Z][\w:.-]*)/);
    if (closing) {
      const name = closing[1].toLowerCase();
      for (let i = stack.length - 1; i >= 0; i--) {
        const entry = stack.pop();
        if (entry.tag === name) break;
      }
      continue;
    }
    const opening = token.match(/^<\s*([a-zA-Z][\w:.-]*)\b([\s\S]*?)\/?\s*>$/);
    if (!opening) continue;
    const tag = opening[1].toLowerCase();
    const attrs = parseAttributes(opening[2]);
    const parent = stack.at(-1);
    const parentMatrix = parent?.matrix || [...IDENTITY];
    const rawTransform = attr(attrs, "transform");
    const matrix = rawTransform ? multiply(parentMatrix, transformMatrix(rawTransform)) : [...parentMatrix];
    const styles = styleAttributes(attrs, parent?.styles);
    const hidden = Boolean(parent?.hidden) || styles.display?.toLowerCase() === "none" || ["hidden", "collapse"].includes(styles.visibility?.toLowerCase());
    const excluded = Boolean(parent?.excluded) || EXCLUDED_TAGS.has(tag);
    if (tag === "path" && !hidden && !excluded && Number(styles.opacity) !== 0) {
      const d = attr(attrs, "d").trim();
      if (d) found.push({ d, matrix, styles });
    }
    if (!/\/\s*>$/.test(token)) stack.push({ tag, matrix, hidden, excluded, styles });
  }
  return found;
}
function svgLength(value, label) {
  const match = String(value).trim().match(/^([+-]?(?:\d*\.)?\d+(?:[eE][+-]?\d+)?)(px|pt|pc|mm|cm|in)?$/i);
  if (!match) throw new Error(`${label} has an unsupported SVG stroke-width: ${value}`);
  const factors = { px: 1, pt: 96 / 72, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };
  return Number(match[1]) * factors[(match[2] || "px").toLowerCase()];
}

function transformedPathData(d, matrix, label) {
  try {
    return new SVGPathData(d)
      .toAbs()
      .normalizeHVZ(false)
      .normalizeST()
      .aToC()
      .matrix(...matrix)
      .encode();
  } catch (error) {
    throw new Error(`Não foi possível interpretar o path de ${label}: ${error.message}`);
  }
}

function getWoff2Encoder() {
  if (!woff2EncoderPromise) {
    woff2EncoderPromise = (async () => {
      const { init, encode } = await import("woff2-encode-wasm");
      const wasmPath = require.resolve("woff2-encode-wasm/encoder.wasm");
      await init(await fs.readFile(wasmPath));
      return encode;
    })();
  }
  return woff2EncoderPromise;
}

export async function generateIconFont({ outdir, family = "IconForge Icons", prefix = "ifi", icons = [] }) {
  if (!Array.isArray(icons) || !icons.length) throw new Error("Importa pelo menos um SVG válido antes de gerar a fonte.");
  if (icons.length > 6400) throw new Error("O gerador suporta até 6.400 ícones na área Unicode privada.");

  family = String(family).replace(/[^a-zA-Z0-9 _-]/g, "").trim().slice(0, 80) || "IconForge Icons";
  prefix = String(prefix).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "ifi";
  const manifestIcons = [];
  const fontFace = `<font-face font-family="${escapeXml(family)}" units-per-em="1000" ascent="900" descent="-100"/>`;
  const svgGlyphs = [];

  for (let index = 0; index < icons.length; index++) {
    const icon = icons[index];
    const label = String(icon.name || `icon-${index + 1}`);
    const rootTag = String(icon.content || "").match(/<svg\b([^>]*)>/i)?.[1] || "";
    const rootAttrs = parseAttributes(rootTag);
    const viewBox = numbersFromViewBox(attr(rootAttrs, "viewbox", "0 0 24 24"));
    let [x, y, width, height] = viewBox.length === 4 ? viewBox : [0, 0, 24, 24];
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) [x, y, width, height] = [0, 0, 24, 24];

    const paths = collectPaths(icon.content);
    if (!paths.length) throw new Error(`${label} não contém geometria de path utilizável. Converte as formas ou transforma o texto em contornos antes de exportar.`);
    const scale = 800 / Math.max(width, height);
    const viewMatrix = [scale, 0, 0, -scale, (1000 - width * scale) / 2 - x * scale, (1000 - height * scale) / 2 + (y + height) * scale];
    const dParts = [];
    for (const item of paths) {
      const { styles } = item;
      const fill = String(styles.fill || "black").trim().toLowerCase();
      const stroke = String(styles.stroke || "none").trim().toLowerCase();
      const matrix = multiply(viewMatrix, item.matrix);
      if (fill !== "none" && fill !== "transparent" && Number(styles["fill-opacity"]) !== 0) {
        dParts.push(transformedPathData(item.d, matrix, label));
      }
      if (stroke !== "none" && stroke !== "transparent" && Number(styles["stroke-opacity"]) !== 0) {
        if (styles["stroke-dasharray"] && styles["stroke-dasharray"].toLowerCase() !== "none") {
          throw new Error(`${label} uses a dashed stroke, which is not supported in icon fonts.`);
        }
        if (styles["vector-effect"]?.toLowerCase() === "non-scaling-stroke") {
          throw new Error(`${label} uses non-scaling-stroke, which is not supported in icon fonts.`);
        }
        const outline = strokePathToOutline(
          item.d,
          svgLength(styles["stroke-width"] || "1", label),
          (styles["stroke-linecap"] || "butt").toLowerCase(),
          (styles["stroke-linejoin"] || "miter").toLowerCase(),
          Number(styles["stroke-miterlimit"] || 4)
        );
        if (outline) dParts.push(transformedPathData(outline, matrix, label));
      }
    }
    if (!dParts.length) throw new Error(`${label} does not contain visible fill or stroke geometry for a font glyph.`);
    const d = dParts.join("");

    const codepoint = 0xE000 + index;
    const slug = safeSlug(label, `icon-${index + 1}`);
    const glyphName = safeSlug(`icon-${index + 1}-${label}`, `icon-${index + 1}`).slice(0, 60);
    manifestIcons.push({ name: label, className: `${prefix}-${slug}`, codepoint, hex: codepoint.toString(16).toUpperCase().padStart(4, "0"), glyph: String.fromCodePoint(codepoint) });
    svgGlyphs.push(`<glyph glyph-name="${escapeXml(glyphName)}" unicode="&#x${codepoint.toString(16)};" horiz-adv-x="1000" d="${escapeXml(d)}"/>`);
  }

  const svgFont = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"><defs><font id="${escapeXml(prefix)}" horiz-adv-x="1000">${fontFace}<missing-glyph horiz-adv-x="1000"/>${svgGlyphs.join("")}</font></defs></svg>`;
  const ttfResult = svg2ttf(svgFont, { description: "IconForge Studio generated icon font", version: "1.0" });
  const ttfBytes = Buffer.from(ttfResult.buffer);
  if (ttfBytes.toString("hex", 0, 4) !== "00010000") throw new Error("O gerador não produziu uma fonte TrueType válida.");
  const encode = await getWoff2Encoder();
  const woff2Bytes = Buffer.from(await encode(new Uint8Array(ttfBytes)));
  if (woff2Bytes.toString("ascii", 0, 4) !== "wOF2") throw new Error("O codificador não produziu uma fonte WOFF2 válida.");

  await fs.mkdir(outdir, { recursive: true });
  await fs.writeFile(path.join(outdir, "iconforge-icons.ttf"), ttfBytes);
  await fs.writeFile(path.join(outdir, "iconforge-icons.woff2"), woff2Bytes);
  const css = [`@font-face { font-family: "${family}"; src: url("iconforge-icons.woff2") format("woff2"), url("iconforge-icons.ttf") format("truetype"); font-display: block; }`, ...manifestIcons.map(icon => `.${icon.className}::before { font-family: "${family}"; content: "\\${icon.hex}"; font-style: normal; }`)].join("\n") + "\n";
  await fs.writeFile(path.join(outdir, "iconforge-icons.css"), css, "utf8");
  await fs.writeFile(path.join(outdir, "iconforge-icons.json"), JSON.stringify({ family, prefix, icons: manifestIcons }, null, 2) + "\n", "utf8");
  return { files: ["iconforge-icons.ttf", "iconforge-icons.woff2", "iconforge-icons.css", "iconforge-icons.json"], glyphs: icons.length };
}
