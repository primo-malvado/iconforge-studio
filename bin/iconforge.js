#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ALLOWED_FORMATS, DEFAULT_PROJECT, generateLibrary, loadIcons, loadProjectConfig, validIcons } from "../core.js";

const BIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(BIN_DIR, "..");
const SERVER_PATH = path.join(PACKAGE_ROOT, "server.js");
const PACKAGE = JSON.parse(await fs.readFile(path.join(PACKAGE_ROOT, "package.json"), "utf8"));
const FORMAT_LIST = [...ALLOWED_FORMATS].join(",");
const HELP = `IconForge Studio ${PACKAGE.version}

Usage:
  iconforge [--port <number>] [--workspace <path>]
  iconforge generate [--workspace <path>] [--formats <list>] [--optimize | --no-optimize]
  iconforge init
  iconforge --help
  iconforge --version

Commands:
  generate          Generate the configured icon library without opening the UI.
  init              Add an "iconforge" script to this project's package.json
                    and create the local .iconforge workspace.

Options:
  --formats <list>  Comma-separated formats: ${FORMAT_LIST}
                    Defaults to the formats saved in project settings.
  --optimize        Optimize SVG markup (default: project setting).
  --no-optimize     Skip SVG markup optimization.
  --port <number>   Local web server port (default: 4173, or $PORT)
  --workspace <path>
                    Workspace directory (default: <project>/.iconforge)
  -h, --help        Show this help
  -v, --version     Show package version

After initialization, run the app with: npm run iconforge
`;

function parseArgs(args) {
  const result = { command: null, port: process.env.PORT || "4173", workspace: process.env.ICONFORGE_WORKSPACE || path.join(process.cwd(), ".iconforge") };
  const rest = [...args];
  if (rest[0] && !rest[0].startsWith("-")) result.command = rest.shift();
  while (rest.length) {
    const arg = rest.shift();
    if (arg === "--port") result.port = rest.shift();
    else if (arg === "--workspace") result.workspace = rest.shift();
    else if (arg === "--formats") {
      result.formats = rest.shift();
      if (!result.formats) throw new Error("--formats requires a comma-separated list.");
    } else if (arg === "--optimize") result.optimize = true;
    else if (arg === "--no-optimize") result.optimize = false;
    else if (arg === "-h" || arg === "--help") result.help = true;
    else if (arg === "-v" || arg === "--version") result.version = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!result.port || !/^\d+$/.test(String(result.port)) || Number(result.port) < 1 || Number(result.port) > 65535) {
    throw new Error("Port must be an integer between 1 and 65535.");
  }
  if (result.formats !== undefined && !String(result.formats).trim()) throw new Error("--formats requires a comma-separated list.");
  result.port = String(Number(result.port));
  result.workspace = path.resolve(process.cwd(), result.workspace);
  return result;
}

async function generateProject(workspace, formats, optimize) {
  const projectConfig = await loadProjectConfig(path.join(workspace, "project.json"));
  const icons = validIcons(await loadIcons(path.join(workspace, "icons")));
  if (!icons.length) throw new Error(`No valid SVG icons found in ${path.join(workspace, "icons")}.`);
  const result = await generateLibrary({
    icons,
    outputDirectory: path.join(workspace, "generated"),
    projectConfig,
    formats,
    optimize
  });
  console.log(`Generated ${result.iconCount} icons with ${result.optimizer}.`);
  console.log(`Output: ${result.outputDirectory}`);
  for (const file of result.generated) console.log(`  ${file}`);
}

async function initProject(workspace) {
  const packagePath = path.join(process.cwd(), "package.json");
  let project;
  try { project = JSON.parse(await fs.readFile(packagePath, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") throw new Error("No package.json found. Run this command from the root of an npm project (or run npm init first).");
    throw new Error(`Could not read package.json: ${error.message}`);
  }
  if (!project || typeof project !== "object" || Array.isArray(project)) throw new Error("package.json must contain a JSON object.");
  project.scripts ||= {};
  if (project.scripts.iconforge && project.scripts.iconforge !== "iconforge") {
    throw new Error(`This project already defines scripts.iconforge as: ${project.scripts.iconforge}\nRename that script before running iconforge init; no existing script was overwritten.`);
  }
  project.scripts.iconforge = "iconforge";
  const temp = `${packagePath}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(project, null, 2)}\n`, "utf8");
  await fs.rename(temp, packagePath);
  await fs.mkdir(path.join(workspace, "icons"), { recursive: true });
  await fs.mkdir(path.join(workspace, "generated"), { recursive: true });
  const projectConfigPath = path.join(workspace, "project.json");
  try {
    await fs.stat(projectConfigPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.writeFile(projectConfigPath, `${JSON.stringify(DEFAULT_PROJECT, null, 2)}\n`, "utf8");
    }
  }
  console.log("IconForge configured for this project.");
  console.log(`Workspace: ${workspace}`);
  console.log("Start the UI with: npm run iconforge");
}

function startServer(port, workspace) {
  const env = { ...process.env, PORT: port, ICONFORGE_WORKSPACE: workspace };
  const child = spawn(process.execPath, [SERVER_PATH], { cwd: process.cwd(), env, stdio: "inherit" });
  let receivedSignal = false;
  const forwardSignal = signal => {
    if (!receivedSignal) {
      receivedSignal = true;
      if (child.exitCode === null && !child.killed) child.kill(signal);
    }
  };
  const onSigint = () => forwardSignal("SIGINT");
  const onSigterm = () => forwardSignal("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  child.once("error", error => {
    console.error(`Could not start IconForge: ${error.message}`);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || options.command === "help") {
    console.log(HELP);
  } else if (options.version) {
    console.log(PACKAGE.version);
  } else if (options.command === "generate") {
    const formats = options.formats?.split(",").map(format => format.trim()).filter(Boolean);
    if (options.formats !== undefined && !formats.length) throw new Error("--formats requires at least one supported format.");
    const invalidFormats = formats?.filter(format => !ALLOWED_FORMATS.has(format));
    if (invalidFormats?.length) throw new Error(`Unknown format(s): ${invalidFormats.join(", ")}.`);
    await generateProject(options.workspace, formats, options.optimize);
  } else if (options.command === "init") {
    await initProject(options.workspace);
  } else if (options.command) {
    throw new Error(`Unknown command: ${options.command}\n\n${HELP}`);
  } else {
    await fs.mkdir(options.workspace, { recursive: true });
    console.log(`Opening IconForge for project: ${process.cwd()}`);
    startServer(options.port, options.workspace);
  }
} catch (error) {
  console.error(`iconforge: ${error.message}`);
  process.exitCode = 1;
}
