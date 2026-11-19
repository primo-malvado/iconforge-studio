import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_FORMATS, DEFAULT_PROJECT, convertSvgShapes, generateLibrary, loadIcons,
  normalizeProjectConfig, optimizeSvg, optimizerKind, optimizerName, parseSvg, readProjectConfig, validIcons
} from "./core.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const DATA = path.resolve(process.env.ICONFORGE_WORKSPACE || path.join(process.cwd(), ".iconforge"));
const ICONS = path.join(DATA, "icons");
const OUTPUT = path.join(DATA, "generated");
const CONFIG = path.join(DATA, "project.json");
const PORT = Number(process.env.PORT || 4173);
const HISTORY_LIMIT = 30;
const HISTORY_MAX_BYTES = 25 * 1024 * 1024;
let undoStack = [], redoStack = [];
let projectConfig = { ...DEFAULT_PROJECT, defaultFormats: [...DEFAULT_PROJECT.defaultFormats] };
let projectWriteQueue = Promise.resolve();
await fs.mkdir(ICONS, { recursive: true });
await fs.mkdir(OUTPUT, { recursive: true });

let iconCache = new Map();
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zipStore(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/\\/g, "/"), "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}
async function collectFiles(dir, prefix) {
  const entries = [];
  for (const item of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, item.name), rel = `${prefix}/${item.name}`;
    if (item.isDirectory()) entries.push(...await collectFiles(full, rel));
    else if (item.isFile()) entries.push({ name: rel, data: await fs.readFile(full) });
  }
  return entries;
}
function cloneProjectConfig() {
  return { ...projectConfig, defaultFormats: [...projectConfig.defaultFormats] };
}
function sanitizeSnapshot(snapshot) {
  if (!Array.isArray(snapshot)) return null;
  const safe = [];
  const seen = new Set();
  for (const item of snapshot) {
    if (!item || typeof item.filename !== "string" || typeof item.content !== "string") continue;
    const filename = safeName(item.filename);
    if (!filename.toLowerCase().endsWith(".svg") || filename !== item.filename || seen.has(filename)) continue;
    seen.add(filename);
    safe.push({ filename, content: item.content });
  }
  return safe.sort((a, b) => a.filename.localeCompare(b.filename));
}
function sanitizeHistory(value) {
  if (!value || typeof value !== "object" || value.version !== 1) return { undo: [], redo: [] };
  const undo = (Array.isArray(value.undo) ? value.undo : []).slice(-HISTORY_LIMIT).map(sanitizeSnapshot).filter(s => s !== null);
  const redo = (Array.isArray(value.redo) ? value.redo : []).slice(-HISTORY_LIMIT).map(sanitizeSnapshot).filter(s => s !== null);
  return { undo, redo };
}
function trimHistory() {
  if (undoStack.length > HISTORY_LIMIT) undoStack = undoStack.slice(-HISTORY_LIMIT);
  if (redoStack.length > HISTORY_LIMIT) redoStack = redoStack.slice(-HISTORY_LIMIT);
  const bytes = () => Buffer.byteLength(JSON.stringify({ undo: undoStack, redo: redoStack }));
  while (bytes() > HISTORY_MAX_BYTES && (redoStack.length || undoStack.length)) {
    // Keep recent undo states preferentially; redo history is the first to be discarded.
    if (redoStack.length) redoStack.shift();
    else undoStack.shift();
  }
}
async function writeProjectState() {
  const task = async () => {
    trimHistory();
    const fileState = {
      ...projectConfig,
      _history: { version: 1, undo: undoStack, redo: redoStack }
    };
    const temp = `${CONFIG}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(fileState, null, 2) + "\n", "utf8");
    await fs.rename(temp, CONFIG);
  };
  const next = projectWriteQueue.then(task, task);
  projectWriteQueue = next.catch(() => {});
  return next;
}
async function loadProjectState() {
  let raw = {};
  try {
    raw = await readProjectConfig(CONFIG);
  } catch (error) {
    if (error.code !== "ENOENT") {
      // Preserve a broken manual edit instead of silently destroying it.
      await fs.copyFile(CONFIG, `${CONFIG}.corrupt-${Date.now()}`).catch(() => {});
      console.warn(`Could not read project config; defaults loaded. A backup was attempted: ${error.message}`);
    }
  }
  projectConfig = normalizeProjectConfig(raw);
  const history = sanitizeHistory(raw._history);
  undoStack = history.undo;
  redoStack = history.redo;
  await writeProjectState();
}
async function getProjectConfig() {
  return cloneProjectConfig();
}
async function saveProjectConfig(input) {
  const old = projectConfig;
  const formats = Array.isArray(input.defaultFormats) ? [...new Set(input.defaultFormats.filter(f => ALLOWED_FORMATS.has(f)))] : old.defaultFormats;
  projectConfig = normalizeProjectConfig({
    projectName: input.projectName ?? old.projectName,
    fontFamily: input.fontFamily ?? old.fontFamily,
    cssPrefix: input.cssPrefix ?? old.cssPrefix,
    defaultOptimize: input.defaultOptimize === undefined ? old.defaultOptimize : Boolean(input.defaultOptimize),
    defaultFormats: formats.length ? formats : old.defaultFormats
  });
  try { await writeProjectState(); }
  catch (error) { projectConfig = old; throw error; }
  return cloneProjectConfig();
}
async function snapshotWorkspace() {
  const files = await fs.readdir(ICONS).catch(() => []);
  const snapshot = [];
  for (const filename of files.filter(f => f.toLowerCase().endsWith(".svg")).sort()) {
    snapshot.push({ filename, content: await fs.readFile(path.join(ICONS, filename), "utf8") });
  }
  return snapshot;
}
async function beginMutation() {
  const oldUndo = undoStack, oldRedo = redoStack;
  undoStack = [...undoStack, await snapshotWorkspace()].slice(-HISTORY_LIMIT);
  redoStack = [];
  try { await writeProjectState(); }
  catch (error) { undoStack = oldUndo; redoStack = oldRedo; throw error; }
}
async function restoreWorkspace(snapshot) {
  const files = await fs.readdir(ICONS).catch(() => []);
  for (const filename of files.filter(f => f.toLowerCase().endsWith(".svg"))) await fs.rm(path.join(ICONS, filename), { force: true });
  for (const item of snapshot) await fs.writeFile(path.join(ICONS, safeName(item.filename)), item.content, "utf8");
  return refreshIcons();
}
function historyStatus() {
  return { canUndo: undoStack.length > 0, canRedo: redoStack.length > 0, undoDepth: undoStack.length, redoDepth: redoStack.length, persistent: true, storage: path.basename(CONFIG) };
}

// The project config is loaded before the HTTP server starts, including persisted undo/redo stacks.
await loadProjectState();

function auditSvg(icon) {
  const issues = [];
  if (icon.error) return [{ severity: "error", message: icon.error }];
  const svg = icon.content;
  if (!/\bviewBox\s*=/.test(svg.match(/<svg\b[^>]*>/i)?.[0] || "")) issues.push({ severity: "warning", message: "Missing viewBox; scaling may be unreliable." });
  if (!/<title\b/i.test(svg) && !/\baria-label\s*=|\baria-labelledby\s*=/i.test(svg)) issues.push({ severity: "info", message: "No title or ARIA label found. Add one if this SVG will be used as a standalone image; decorative icons can remain unlabeled." });
  if (/\b(width|height)\s*=\s*["'](?:0|1px|[0-9]+px)["']/i.test(svg)) issues.push({ severity: "warning", message: "Fixed pixel dimensions detected; consider using viewBox with CSS sizing." });
  if (/<image\b/i.test(svg)) issues.push({ severity: "info", message: "Embedded image element found; check portability and file size." });
  return issues;
}

function send(res, status, data, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(type.startsWith("application/json") ? JSON.stringify(data) : data);
}
function safeName(name) {
  return path.basename(String(name || "icon.svg")).replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
}
async function refreshIcons() {
  const items = await loadIcons(ICONS);
  iconCache = new Map(items.map(i => [i.filename, i]));
  return items;
}
async function body(req) {
  let chunks = [], size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 20 * 1024 * 1024) throw new Error("Request too large (20 MB limit).");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && url.pathname === "/api/health") return send(res, 200, { ok: true, app: "IconForge Studio", version: "0.9.0", optimizer: optimizerKind() });
    if (req.method === "GET" && url.pathname === "/api/quality") {
      const items = await refreshIcons();
      const findings = items.flatMap(icon => auditSvg(icon).map(issue => ({ filename: icon.filename, name: icon.name, ...issue })));
      return send(res, 200, { count: items.length, findings, summary: { errors: findings.filter(x => x.severity === "error").length, warnings: findings.filter(x => x.severity === "warning").length, info: findings.filter(x => x.severity === "info").length } });
    }
    if (req.method === "GET" && url.pathname === "/api/project") return send(res, 200, await getProjectConfig());
    if ((req.method === "PUT" || req.method === "POST") && url.pathname === "/api/project") {
      const data = JSON.parse(await body(req));
      return send(res, 200, await saveProjectConfig(data));
    }
    if (req.method === "GET" && url.pathname === "/api/history") return send(res, 200, historyStatus());
    if (req.method === "POST" && url.pathname === "/api/undo") {
      if (!undoStack.length) return send(res, 409, { error: "Nothing to undo." });
      const previousUndo = [...undoStack], previousRedo = [...redoStack];
      const current = await snapshotWorkspace();
      const target = undoStack.pop();
      redoStack.push(current);
      trimHistory();
      let items;
      try {
        items = await restoreWorkspace(target);
        await writeProjectState();
      } catch (error) {
        undoStack = previousUndo; redoStack = previousRedo;
        await restoreWorkspace(current).catch(() => {});
        throw error;
      }
      return send(res, 200, { action: "undo", icons: items.map(({content,...meta})=>meta), history: historyStatus() });
    }
    if (req.method === "POST" && url.pathname === "/api/redo") {
      if (!redoStack.length) return send(res, 409, { error: "Nothing to redo." });
      const previousUndo = [...undoStack], previousRedo = [...redoStack];
      const current = await snapshotWorkspace();
      const target = redoStack.pop();
      undoStack.push(current);
      trimHistory();
      let items;
      try {
        items = await restoreWorkspace(target);
        await writeProjectState();
      } catch (error) {
        undoStack = previousUndo; redoStack = previousRedo;
        await restoreWorkspace(current).catch(() => {});
        throw error;
      }
      return send(res, 200, { action: "redo", icons: items.map(({content,...meta})=>meta), history: historyStatus() });
    }
    if (req.method === "GET" && url.pathname === "/api/export.zip") {
      const projectConfig = await getProjectConfig();
      const entries = [
        ...await collectFiles(ICONS, "icons"),
        ...await collectFiles(OUTPUT, "generated"),
        { name: "project.json", data: await fs.readFile(CONFIG, "utf8") },
        { name: "README.txt", data: "IconForge Studio export\n\nicons/: source SVG files\ngenerated/: generated library outputs (if built)\nproject.json: saved project settings and persistent undo/redo history\n" }
      ];
      const archive = zipStore(entries);
      res.writeHead(200, { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="iconforge-export.zip"', "Content-Length": archive.length, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      return res.end(archive);
    }
    if (req.method === "GET" && url.pathname === "/api/icons") {
      const icons = await refreshIcons();
      return send(res, 200, { icons, count: icons.length });
    }
    if (req.method === "POST" && url.pathname === "/api/convert-shapes") {
      const data = JSON.parse(await body(req));
      const requested = Array.isArray(data.filenames) && data.filenames.length ? new Set(data.filenames.map(safeName)) : null;
      const all = await refreshIcons();
      const candidates = all.filter(i => !i.error && (!requested || requested.has(i.filename)));
      const conversions = candidates.map(icon => ({ ...icon, result: convertSvgShapes(icon.content) }));
      const converted = conversions.filter(i => i.result.converted > 0);
      if (converted.length) await beginMutation();
      for (const item of converted) await fs.writeFile(path.join(ICONS, item.filename), item.result.content, "utf8");
      if (converted.length) await writeProjectState();
      const unsupported = [...new Set(conversions.flatMap(i => i.result.unsupported))];
      const items = await refreshIcons();
      return send(res, 200, { convertedIcons: converted.length, convertedShapes: converted.reduce((n,i)=>n+i.result.converted,0), unsupported, icons: items.map(({content,...meta})=>meta), history: historyStatus() });
    }
    if (req.method === "POST" && url.pathname === "/api/compare") {
      const data = JSON.parse(await body(req));
      const filename = safeName(data.filename);
      const icon = (await refreshIcons()).find(i => i.filename === filename && !i.error);
      if (!icon) return send(res, 404, { error: "Icon not found or invalid." });
      const optimized = optimizeSvg(icon.content);
      const originalBytes = Buffer.byteLength(icon.content), optimizedBytes = Buffer.byteLength(optimized);
      return send(res, 200, { filename, original: icon.content, optimized, originalBytes, optimizedBytes, bytesSaved: originalBytes-optimizedBytes, percentSaved: originalBytes ? Number(((originalBytes-optimizedBytes)/originalBytes*100).toFixed(1)) : 0, optimizer: optimizerName() });
    }
    if (req.method === "GET" && url.pathname === "/api/font-preview") {
      try {
        const manifest = JSON.parse(await fs.readFile(path.join(OUTPUT, "fonts", "iconforge-icons.json"), "utf8"));
        const fontPath = path.join(OUTPUT, "fonts", "iconforge-icons.woff2");
        const stat = await fs.stat(fontPath);
        return send(res, 200, { available: true, family: manifest.family, icons: manifest.icons, version: stat.mtimeMs });
      } catch { return send(res, 200, { available: false, icons: [] }); }
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/font-file/")) {
      const filename = path.basename(decodeURIComponent(url.pathname.slice("/api/font-file/".length)));
      const allowed = { "iconforge-icons.woff2": "font/woff2", "iconforge-icons.ttf": "font/ttf" };
      if (!allowed[filename]) return send(res, 404, { error: "Font file not found." });
      const font = await fs.readFile(path.join(OUTPUT, "fonts", filename));
      res.writeHead(200, { "Content-Type": allowed[filename], "Content-Length": font.length, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      return res.end(font);
    }
    if (req.method === "POST" && url.pathname === "/api/import") {
      const data = JSON.parse(await body(req));
      if (!Array.isArray(data.files)) return send(res, 400, { error: "Expected a files array." });
      let imported = 0, skipped = [], capturedHistory = false;
      for (const file of data.files) {
        const filename = safeName(file.name);
        if (!filename.toLowerCase().endsWith(".svg")) { skipped.push({ name: filename, reason: "Only SVG files are supported in this MVP." }); continue; }
        try {
          parseSvg(String(file.content || ""));
          if (!capturedHistory) { await beginMutation(); capturedHistory = true; }
          await fs.writeFile(path.join(ICONS, filename), String(file.content), "utf8");
          imported++;
        } catch (e) { skipped.push({ name: filename, reason: e.message }); }
      }
      if (imported) await writeProjectState();
      const icons = await refreshIcons();
      return send(res, 200, { imported, skipped, count: icons.length, history: historyStatus() });
    }
    if (req.method === "POST" && url.pathname === "/api/delete") {
      const data = JSON.parse(await body(req));
      const deleted = [];
      const toDelete = [...new Set((data.filenames || []).map(safeName).filter(name => name.toLowerCase().endsWith(".svg")))];
      const existing = [];
      for (const name of toDelete) if ((await fs.stat(path.join(ICONS, name)).catch(()=>null))?.isFile()) existing.push(name);
      if (existing.length) await beginMutation();
      for (const filename of toDelete) {
        const safe = safeName(filename);
        if (!safe.toLowerCase().endsWith(".svg")) continue;
        await fs.rm(path.join(ICONS, safe), { force: true });
        deleted.push(safe);
      }
      if (deleted.length) await writeProjectState();
      return send(res, 200, { deleted, count: (await refreshIcons()).length, history: historyStatus() });
    }
    if (req.method === "POST" && url.pathname === "/api/rename") {
      const data = JSON.parse(await body(req));
      const oldName = safeName(data.filename);
      const newBase = safeName(data.name).replace(/\.svg$/i, "");
      if (!oldName.toLowerCase().endsWith(".svg") || !newBase) return send(res, 400, { error: "Invalid name." });
      const newName = newBase + ".svg";
      if (oldName !== newName && await fs.stat(path.join(ICONS, newName)).then(()=>true).catch(()=>false)) return send(res, 409, { error: "An icon with that filename already exists." });
      if (!(await fs.stat(path.join(ICONS, oldName)).then(()=>true).catch(()=>false))) return send(res, 404, { error: "Icon not found." });
      if (oldName !== newName) await beginMutation();
      await fs.rename(path.join(ICONS, oldName), path.join(ICONS, newName));
      if (oldName !== newName) await writeProjectState();
      return send(res, 200, { filename: newName, icons: (await refreshIcons()).map(({ content, ...meta }) => meta), history: historyStatus() });
    }
    if (req.method === "POST" && url.pathname === "/api/build") {
      const data = JSON.parse(await body(req));
      const all = await refreshIcons();
      const projectConfig = await getProjectConfig();
      const requested = Array.isArray(data.filenames) && data.filenames.length ? new Set(data.filenames.map(safeName)) : null;
      const icons = validIcons(all).filter(i => !requested || requested.has(i.filename));
      const result = await generateLibrary({
        icons,
        outputDirectory: OUTPUT,
        projectConfig,
        formats: data.formats,
        optimize: data.optimize,
        cssPrefix: data.cssPrefix,
        fontFamily: data.fontFamily
      });
      return send(res, 200, result);
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/file/")) {
      const filename = safeName(decodeURIComponent(url.pathname.slice("/api/file/".length)));
      const filePath = path.join(OUTPUT, filename);
      const content = await fs.readFile(filePath, "utf8");
      return send(res, 200, content, "text/plain; charset=utf-8");
    }
    if (req.method === "GET") {
      const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
      const target = path.resolve(PUBLIC, "." + pathname);
      if (!target.startsWith(PUBLIC + path.sep) && target !== PUBLIC) return send(res, 403, { error: "Forbidden" });
      const content = await fs.readFile(target);
      const ext = path.extname(target);
      const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };
      return send(res, 200, content, types[ext] || "application/octet-stream");
    }
    return send(res, 404, { error: "Not found" });
  } catch (error) {
    return send(res, 400, { error: error.message || "Request failed." });
  }
});
server.listen(PORT, "127.0.0.1", () => {
  console.log(`IconForge Studio running at http://127.0.0.1:${PORT}`);
  console.log(`Local workspace: ${DATA}`);
});
