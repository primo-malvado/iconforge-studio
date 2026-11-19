import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const port = 4197;
const origin = `http://127.0.0.1:${port}`;
let server, testWorkspace;
async function request(route, method = "GET", data) {
  const response = await fetch(origin + route, {
    method,
    headers: { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function spawnServer() {
  return spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), ICONFORGE_WORKSPACE: testWorkspace },
    stdio: "ignore"
  });
}
async function waitForServer() {
  for (let i = 0; i < 70; i++) {
    try { return await request("/api/health"); }
    catch {
      if (server?.exitCode !== null && server?.exitCode !== undefined) throw new Error("IconForge server exited before becoming ready.");
      await delay(100);
    }
  }
  throw new Error("IconForge server did not become ready in time.");
}
async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise(resolve => {
    child.once("exit", resolve);
    child.kill("SIGTERM");
  });
}

test("local API imports, converts, builds, previews, compares and restores icons", async t => {
  testWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "iconforge-history-test-"));
  server = spawnServer();
  const pathName = `test-icon-${process.pid}.svg`;
  const shapeName = `test-shape-${process.pid}.svg`;
  t.after(async () => {
    await stopServer(server);
    await fs.rm(testWorkspace, { recursive: true, force: true });
  });

  const initialHealth = await waitForServer();
  assert.equal(initialHealth.version, "0.9.0");
  const hasFontDependencies = await Promise.all(["svg2ttf", "svg-pathdata", "woff2-encode-wasm"].map(async name => {
    try { await fs.access(path.join(ROOT, "node_modules", name, "package.json")); return true; }
    catch { return false; }
  })).then(values => values.every(Boolean));
  const serverSource = await fs.readFile(path.join(ROOT, "server.js"), "utf8");
  const coreSource = await fs.readFile(path.join(ROOT, "core.js"), "utf8");
  assert.doesNotMatch(serverSource, /spawnSync|tools-fontgen\.py|process\.env\.PYTHON/);
  const fontGeneratorSource = await fs.readFile(path.join(ROOT, "fontgen.js"), "utf8");
  assert.doesNotMatch(fontGeneratorSource, /opentype\.js|python|fonttools|brotli/i);
  assert.match(fontGeneratorSource, /svg2ttf/);
  assert.match(fontGeneratorSource, /svg-pathdata/);
  const packageJson = JSON.parse(await fs.readFile(path.join(ROOT, "package.json"), "utf8"));
  assert.ok(packageJson.dependencies["svg2ttf"]);
  assert.ok(packageJson.dependencies["svg-pathdata"]);
  assert.ok(packageJson.dependencies["woff2-encode-wasm"]);
  assert.equal(packageJson.dependencies["opentype.js"], undefined);
  assert.doesNotMatch(JSON.stringify(packageJson.dependencies), /fonttools|python/i);
  assert.match(coreSource, /generateIconFont/);
  const page = await fetch(origin + "/");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /app-root/);
  const mainScript = await fetch(origin + "/build/browser/main.js");
  assert.equal(mainScript.status, 200);
  assert.ok(mainScript.headers.get("content-type").includes("javascript"));

  const savedProject = await request("/api/project", "PUT", {
    projectName: "API Test Project", fontFamily: "API Test Icons", cssPrefix: "qa",
    defaultOptimize: true, defaultFormats: ["sprite", "css", "json"]
  });
  assert.equal(savedProject.projectName, "API Test Project");
  assert.equal(savedProject.cssPrefix, "qa");
  assert.equal((await request("/api/project")).fontFamily, "API Test Icons");

  const imported = await request("/api/import", "POST", {
    files: [
      { name: pathName, content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><!-- remove me --><path d="M2 2h20a2 2 0 0 1 2 2V20c0 1-1 2-2 2H4s-2 0-2-2q0-1 0-2t0-2Z"/></svg>' },
      { name: shapeName, content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="2" y="3" width="10" height="8" rx="1" fill="currentColor" transform="translate(1 0)"/><circle cx="18" cy="5" r="2"></circle><ellipse cx="17" cy="17" rx="3" ry="2"/><line x1="1" y1="1" x2="8" y2="8" stroke="currentColor"/><polyline points="1,10 4,12 8,10" fill="none" stroke="currentColor"/><polygon points="12,10 14,14 10,14"/></svg>' },
      { name: "unsafe.svg", content: '<svg viewBox="0 0 24 24"><script>alert(1)</script></svg>' }
    ]
  });
  assert.equal(imported.imported, 2);
  assert.equal(imported.skipped.length, 1);
  const listedIcons = await request("/api/icons");
  assert.equal(listedIcons.count, 2);
  assert.match(listedIcons.icons.find(icon => icon.filename === pathName).content, /<path\b/i);

  const quality = await request("/api/quality");
  assert.ok(quality.findings.some(f => f.filename === pathName && f.severity === "info"));

  const compareBefore = await request("/api/compare", "POST", { filename: shapeName });
  assert.match(compareBefore.original, /<rect\b/i);
  assert.equal(compareBefore.originalBytes, Buffer.byteLength(compareBefore.original));

  const buildFormats = ["sprite", "css", "json", "svg", "react", "vue", "angular", ...(hasFontDependencies ? ["font"] : [])];
  const build = await request("/api/build", "POST", {
    formats: buildFormats,
    optimize: true, fontFamily: "API Test Icons", cssPrefix: "qa"
  });
  assert.equal(build.ok, true);
  assert.ok(build.generated.includes("icons-sprite.svg"));
  assert.ok(build.generated.some(x => x.startsWith("react/")));
  if (hasFontDependencies) assert.ok(build.generated.some(x => x.startsWith("fonts/")));
  else assert.ok(!build.generated.some(x => x.startsWith("fonts/")));

  const css = await fs.readFile(path.join(testWorkspace, "generated", "icons.css"), "utf8");
  assert.match(css, /\.qa-test-icon-/);
  if (hasFontDependencies) {
    const ttf = await fs.readFile(path.join(testWorkspace, "generated", "fonts", "iconforge-icons.ttf"));
    const woff2 = await fs.readFile(path.join(testWorkspace, "generated", "fonts", "iconforge-icons.woff2"));
    assert.equal(ttf.toString("hex", 0, 4), "00010000");
    assert.equal(woff2.toString("ascii", 0, 4), "wOF2");
    const preview = await request("/api/font-preview");
    assert.equal(preview.available, true);
    assert.equal(preview.family, "API Test Icons");
    assert.equal(preview.icons.length, 2);
    assert.ok(preview.icons.some(i => i.name === `test-shape-${process.pid}`));
    const fontResponse = await fetch(origin + "/api/font-file/iconforge-icons.woff2");
    assert.equal(fontResponse.status, 200);
    assert.match(fontResponse.headers.get("content-type"), /font\/woff2/);
  } else {
    assert.equal((await request("/api/font-preview")).available, false);
  }

  const conversion = await request("/api/convert-shapes", "POST", { filenames: [shapeName] });
  assert.equal(conversion.convertedIcons, 1);
  assert.equal(conversion.convertedShapes, 6);
  const compareAfter = await request("/api/compare", "POST", { filename: shapeName });
  assert.match(compareAfter.original, /<path\b/i);
  assert.match(compareAfter.original, /transform="translate\(1 0\)"/i);

  const undo = await request("/api/undo", "POST");
  assert.equal(undo.action, "undo");
  assert.equal(undo.history.canRedo, true);
  assert.match((await request("/api/compare", "POST", { filename: shapeName })).original, /<rect\b/i);
  const redo = await request("/api/redo", "POST");
  assert.equal(redo.action, "redo");
  assert.match((await request("/api/compare", "POST", { filename: shapeName })).original, /<path\b/i);

  const history = await request("/api/history");
  assert.equal(history.canUndo, true);
  assert.equal(history.persistent, true);
  assert.equal(history.storage, "project.json");
  const savedProjectFile = JSON.parse(await fs.readFile(path.join(testWorkspace, "project.json"), "utf8"));
  assert.ok(savedProjectFile._history.undo.length > 0, "project config should store persistent undo history");
  assert.equal(savedProjectFile._history.version, 1);

  // Restart the process against the same project directory and prove undo/redo survives.
  await stopServer(server);
  server = spawnServer();
  const restartedHealth = await waitForServer();
  assert.equal(restartedHealth.version, "0.9.0");
  const restartedHistory = await request("/api/history");
  assert.equal(restartedHistory.canUndo, true);
  assert.equal(restartedHistory.canRedo, false);
  const undoAfterRestart = await request("/api/undo", "POST");
  assert.equal(undoAfterRestart.action, "undo");
  assert.match((await request("/api/compare", "POST", { filename: shapeName })).original, /<rect\b/i);
  const redoAfterRestart = await request("/api/redo", "POST");
  assert.equal(redoAfterRestart.action, "redo");
  assert.match((await request("/api/compare", "POST", { filename: shapeName })).original, /<path\b/i);

  const zipResponse = await fetch(origin + "/api/export.zip");
  assert.equal(zipResponse.status, 200);
  assert.match(zipResponse.headers.get("content-type"), /application\/zip/);
  const zip = Buffer.from(await zipResponse.arrayBuffer());
  assert.equal(zip.readUInt32LE(0), 0x04034b50, "export should be a valid ZIP local-file header");
  assert.ok(zip.includes(Buffer.from("project.json")), "ZIP export should include project settings");
  assert.ok(zip.includes(Buffer.from("_history")), "ZIP project config should include persistent history");
});
