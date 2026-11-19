import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = path.join(ROOT, "bin", "iconforge.js");
const PACKAGE = JSON.parse(await fs.readFile(path.join(ROOT, "package.json"), "utf8"));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function waitForHealth(port, child) {
  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return response.json();
    } catch { /* Starting the local server can take a moment. */ }
    if (child.exitCode !== null) throw new Error("npm run iconforge exited before the server was ready.");
    await delay(100);
  }
  throw new Error("IconForge did not become ready in time.");
}
async function killProcessGroup(child) {
  if (!child || child.exitCode !== null) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
  await Promise.race([
    new Promise(resolve => child.once("exit", resolve)),
    delay(2500)
  ]);
  try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already exited. */ }
}

test("npm package exposes a project-local CLI without requiring a global install", async () => {
  assert.equal(PACKAGE.name, "iconforge-studio");
  assert.match(PACKAGE.version, /^\d+\.\d+\.\d+/);
  assert.equal(PACKAGE.private, undefined);
  assert.equal(PACKAGE.bin.iconforge, "./bin/iconforge.js");
  assert.ok(PACKAGE.files.includes("bin/"));
  assert.ok(PACKAGE.files.includes("core.js"));
  const syntax = spawnSync(process.execPath, ["--check", CLI], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
});

test("iconforge init adds the npm script and creates a project workspace", async t => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "iconforge-cli-init-"));
  t.after(() => fs.rm(project, { recursive: true, force: true }));
  await fs.writeFile(path.join(project, "package.json"), JSON.stringify({ name: "fixture-app", version: "1.0.0", scripts: { build: "node build.js" } }, null, 2));
  const result = spawnSync(process.execPath, [CLI, "init"], { cwd: project, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const pkg = JSON.parse(await fs.readFile(path.join(project, "package.json"), "utf8"));
  assert.equal(pkg.scripts.iconforge, "iconforge");
  assert.equal(pkg.scripts.build, "node build.js");
  await fs.access(path.join(project, ".iconforge", "icons"));
  await fs.access(path.join(project, ".iconforge", "generated"));
  assert.match(result.stdout, /npm run iconforge/);
});

test("iconforge generate builds selected formats from the command line", async t => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "iconforge-cli-generate-"));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  await fs.mkdir(path.join(workspace, "icons"), { recursive: true });
  await fs.writeFile(path.join(workspace, "icons", "check.svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><!-- keep source comment --><path d="M2 12l7 7L22 4"/></svg>');

  const result = spawnSync(process.execPath, [CLI, "generate", "--workspace", workspace, "--formats", "svg,json", "--no-optimize"], {
    cwd: ROOT, encoding: "utf8", timeout: 15000
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Generated 1 icons/);
  assert.match(await fs.readFile(path.join(workspace, "generated", "svg", "check.svg"), "utf8"), /keep source comment/);
  assert.ok((await fs.readdir(path.join(workspace, "generated"))).includes("icons.json"));
  assert.ok(!(await fs.readdir(path.join(workspace, "generated"))).includes("icons-sprite.svg"));

  const invalidFormat = spawnSync(process.execPath, [CLI, "generate", "--workspace", workspace, "--formats", "png"], {
    cwd: ROOT, encoding: "utf8", timeout: 5000
  });
  assert.equal(invalidFormat.status, 1);
  assert.match(invalidFormat.stderr, /Unknown format.*png/);
});

test("iconforge generate with no arguments uses the last saved Studio settings", async t => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "iconforge-cli-defaults-"));
  const workspace = path.join(project, ".iconforge");
  t.after(() => fs.rm(project, { recursive: true, force: true }));
  await fs.mkdir(path.join(workspace, "icons"), { recursive: true });
  await fs.writeFile(path.join(workspace, "icons", "check.svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><!-- saved config --><path d="M2 12l7 7L22 4"/></svg>');
  await fs.writeFile(path.join(workspace, "project.json"), JSON.stringify({
    projectName: "Saved Studio Project",
    defaultFormats: ["svg"],
    defaultOptimize: false
  }));

  const result = spawnSync(process.execPath, [CLI, "generate"], { cwd: project, encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(await fs.readFile(path.join(workspace, "generated", "svg", "check.svg"), "utf8"), /saved config/);
  assert.ok(!(await fs.readdir(path.join(workspace, "generated"))).includes("icons.json"));
});

test("npm run iconforge starts the installed CLI and writes project-local config", async t => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "iconforge-cli-run-"));
  let child;
  t.after(async () => {
    await killProcessGroup(child);
    await fs.rm(project, { recursive: true, force: true });
  });
  const pkg = { name: "fixture-app", version: "1.0.0", scripts: { iconforge: "iconforge" } };
  await fs.writeFile(path.join(project, "package.json"), JSON.stringify(pkg, null, 2));
  const binDir = path.join(project, "node_modules", ".bin");
  await fs.mkdir(binDir, { recursive: true });
  await fs.symlink(CLI, path.join(binDir, "iconforge"));
  const port = await freePort();
  child = spawn("npm", ["run", "iconforge", "--", "--port", String(port)], {
    cwd: project,
    env: { ...process.env, PORT: "" },
    detached: true,
    stdio: "ignore"
  });
  const health = await waitForHealth(port, child);
  assert.equal(health.ok, true);
  assert.equal(health.version, "0.9.0");
  const projectState = JSON.parse(await fs.readFile(path.join(project, ".iconforge", "project.json"), "utf8"));
  assert.equal(projectState.projectName, "IconForge Project");
});
