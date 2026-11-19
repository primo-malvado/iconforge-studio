import fs from "node:fs/promises";
import path from "node:path";

export const DEFAULT_PROJECT = { projectName: "IconForge Project", fontFamily: "IconForge Icons", cssPrefix: "icon", defaultOptimize: true, defaultFormats: ["sprite", "css", "json"] };
export const ALLOWED_FORMATS = new Set(["sprite", "css", "json", "svg", "react", "vue", "angular", "font"]);
let svgoOptimize = null;
try { ({ optimize: svgoOptimize } = await import("svgo")); } catch { /* Optional dependency: conservative fallback remains available. */ }

export function optimizerKind() {
  return svgoOptimize ? "svgo" : "conservative-fallback";
}
export function optimizerName() {
  return svgoOptimize ? "SVGO" : "Conservative fallback";
}
function optimizerDescription() {
  return svgoOptimize ? "SVGO" : "conservative fallback (install dependencies for SVGO)";
}
export function normalizeProjectConfig(raw = {}) {
  const formats = Array.isArray(raw.defaultFormats) ? raw.defaultFormats.filter(f => ALLOWED_FORMATS.has(f)) : DEFAULT_PROJECT.defaultFormats;
  return {
    projectName: String(raw.projectName || DEFAULT_PROJECT.projectName).replace(/[\r\n\0]/g, " ").slice(0, 80),
    fontFamily: String(raw.fontFamily || DEFAULT_PROJECT.fontFamily).replace(/[^a-zA-Z0-9 _-]/g, "").trim().slice(0, 80) || DEFAULT_PROJECT.fontFamily,
    cssPrefix: String(raw.cssPrefix || DEFAULT_PROJECT.cssPrefix).toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || DEFAULT_PROJECT.cssPrefix,
    defaultOptimize: raw.defaultOptimize !== false,
    defaultFormats: formats.length ? [...new Set(formats)] : [...DEFAULT_PROJECT.defaultFormats]
  };
}
export async function readProjectConfig(configPath) {
  return JSON.parse(await fs.readFile(configPath, "utf8"));
}
export async function loadProjectConfig(configPath) {
  let raw = {};
  try {
    raw = await readProjectConfig(configPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error(`Could not read project config ${configPath}: ${error.message}`);
  }
  return normalizeProjectConfig(raw);
}
export function parseSvg(svg) {
  if (!/<svg[\s>]/i.test(svg) || !/<\/svg\s*>/i.test(svg)) throw new Error("Invalid SVG: missing <svg> root.");
  if (/<script\b|on[a-z]+\s*=|javascript:|<foreignObject\b/i.test(svg)) throw new Error("SVG rejected: potentially unsafe active content detected.");
  const root = svg.match(/<svg\b([^>]*)>/i)?.[1] || "";
  const viewBox = root.match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1] || "0 0 24 24";
  return { viewBox, svg };
}
export async function loadIcons(iconDirectory) {
  const files = await fs.readdir(iconDirectory).catch(error => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const items = [];
  for (const filename of files.filter(file => file.toLowerCase().endsWith(".svg")).sort()) {
    try {
      const content = await fs.readFile(path.join(iconDirectory, filename), "utf8");
      const parsed = parseSvg(content);
      items.push({ name: filename.replace(/\.svg$/i, ""), filename, viewBox: parsed.viewBox, content });
    } catch (error) {
      items.push({ name: filename.replace(/\.svg$/i, ""), filename, viewBox: "invalid", content: "", error: error.message });
    }
  }
  return items;
}
export function validIcons(icons) {
  return icons.filter(icon => !icon.error);
}
export function optimizeSvg(svg) {
  if (svgoOptimize) {
    const result = svgoOptimize(String(svg), { multipass: true, plugins: [{ name: "preset-default", params: { overrides: { removeViewBox: false, removeTitle: false } } }] });
    if (result.error) throw new Error(`SVGO optimization failed: ${result.error}`);
    return result.data;
  }
  let out = String(svg).replace(/^\uFEFF/, "").replace(/<\?xml[^?]*\?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "").replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/>\s+</g, "><").replace(/[ \t\r\n]+/g, " ")
    .replace(/\s*=\s*/g, "=").replace(/>\s+/g, ">").replace(/\s+</g, "<").trim();
  out = out.replace(/\s+(?:inkscape|sodipodi):[a-zA-Z0-9_-]+=(["'])[\s\S]*?\1/g, "");
  out = out.replace(/\s+xmlns:(?:inkscape|sodipodi)=["'][^"']*["']/g, "");
  return out;
}
function parseAttributes(raw) {
  const attrs = {};
  for (const match of raw.matchAll(/([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*(["'])([\s\S]*?)\2/g)) attrs[match[1]] = match[3];
  return attrs;
}
function svgNumber(attrs, key, fallback = 0) {
  const value = attrs[key];
  if (value === undefined || value === "") return fallback;
  if (/%/.test(value)) return NaN;
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : NaN;
}
function numberText(number) { return Number(number.toFixed(5)).toString(); }
function shapeToPath(tag, raw) {
  const attrs = parseAttributes(raw);
  let d = "";
  const n = (key, fallback = 0) => svgNumber(attrs, key, fallback);
  if (tag === "rect") {
    const x=n("x"), y=n("y"), w=n("width"), h=n("height");
    let rx=n("rx", n("ry", 0)), ry=n("ry", rx);
    if (![x,y,w,h,rx,ry].every(Number.isFinite) || w < 0 || h < 0) return null;
    rx=Math.max(0, Math.min(rx, w/2)); ry=Math.max(0, Math.min(ry, h/2));
    if (!rx || !ry) d=`M${numberText(x)} ${numberText(y)}h${numberText(w)}v${numberText(h)}h-${numberText(w)}Z`;
    else d=`M${numberText(x+rx)} ${numberText(y)}H${numberText(x+w-rx)}A${numberText(rx)} ${numberText(ry)} 0 0 1 ${numberText(x+w)} ${numberText(y+ry)}V${numberText(y+h-ry)}A${numberText(rx)} ${numberText(ry)} 0 0 1 ${numberText(x+w-rx)} ${numberText(y+h)}H${numberText(x+rx)}A${numberText(rx)} ${numberText(ry)} 0 0 1 ${numberText(x)} ${numberText(y+h-ry)}V${numberText(y+ry)}A${numberText(rx)} ${numberText(ry)} 0 0 1 ${numberText(x+rx)} ${numberText(y)}Z`;
  } else if (tag === "circle") {
    const cx=n("cx"), cy=n("cy"), r=n("r"); if (![cx,cy,r].every(Number.isFinite) || r < 0) return null;
    d=`M${numberText(cx-r)} ${numberText(cy)}a${numberText(r)} ${numberText(r)} 0 1 0 ${numberText(2*r)} 0a${numberText(r)} ${numberText(r)} 0 1 0 -${numberText(2*r)} 0Z`;
  } else if (tag === "ellipse") {
    const cx=n("cx"), cy=n("cy"), rx=n("rx"), ry=n("ry"); if (![cx,cy,rx,ry].every(Number.isFinite) || rx < 0 || ry < 0) return null;
    d=`M${numberText(cx-rx)} ${numberText(cy)}a${numberText(rx)} ${numberText(ry)} 0 1 0 ${numberText(2*rx)} 0a${numberText(rx)} ${numberText(ry)} 0 1 0 -${numberText(2*rx)} 0Z`;
  } else if (tag === "line") {
    const x1=n("x1"), y1=n("y1"), x2=n("x2"), y2=n("y2"); if (![x1,y1,x2,y2].every(Number.isFinite)) return null;
    d=`M${numberText(x1)} ${numberText(y1)}L${numberText(x2)} ${numberText(y2)}`;
  } else if (tag === "polyline" || tag === "polygon") {
    const text=attrs.points || ""; if (/%/.test(text)) return null;
    const values=(text.match(/[+-]?(?:\d*\.)?\d+(?:[eE][+-]?\d+)?/g)||[]).map(Number);
    if (values.length < 4 || values.length % 2 || !values.every(Number.isFinite)) return null;
    d="M"+values.slice(0,2).map(numberText).join(" ")+values.slice(2).reduce((out,value,index)=>out+(index%2===0?"L":" ")+numberText(value),"")+(tag==="polygon"?"Z":"");
  } else return null;
  const remaining = raw.replace(/\s+(?:x|y|width|height|rx|ry|cx|cy|r|x1|y1|x2|y2|points)\s*=\s*(["'])[\s\S]*?\1/gi, "").replace(/\s*\/$/, "").trim();
  return `<path${remaining ? " "+remaining : ""} d="${d}"/>`;
}
export function convertSvgShapes(svg) {
  let converted = 0, unsupported = [];
  const tags = "rect|circle|ellipse|line|polyline|polygon";
  let content = String(svg).replace(new RegExp(`<(${tags})\\b([^>]*?)>\\s*<\\/\\1\\s*>`, "gi"), (whole, rawTag, rawAttrs) => {
    const replacement=shapeToPath(rawTag.toLowerCase(), rawAttrs);
    if (!replacement) { unsupported.push(rawTag.toLowerCase()); return whole; }
    converted++; return replacement;
  });
  content = content.replace(new RegExp(`<(${tags})\\b([^>]*?)\\/\\s*>`, "gi"), (whole, rawTag, rawAttrs) => {
    const replacement=shapeToPath(rawTag.toLowerCase(), rawAttrs);
    if (!replacement) { unsupported.push(rawTag.toLowerCase()); return whole; }
    converted++; return replacement;
  });
  return { content, converted, unsupported: [...new Set(unsupported)] };
}
function cleanSvgForSprite(svg, id) {
  return svg.replace(/<\?xml[^>]*\?>/gi, "").replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<svg\b[^>]*>/i, `<symbol id="${id}" viewBox="${parseSvg(svg).viewBox.replace(/"/g, "")}">`)
    .replace(/<\/svg\s*>/i, "</symbol>");
}
function toReactComponent(icon) {
  const name = icon.name.split(/[^a-zA-Z0-9]+/).filter(Boolean).map(s=>s[0].toUpperCase()+s.slice(1)).join("") || "Icon";
  const inner = icon.content.replace(/^<svg[^>]*>/i,"").replace(/<\/svg\s*>$/i,"")
    .replace(/\bclass=/g,"className=").replace(/\bstroke-width=/g,"strokeWidth=").replace(/\bfill-rule=/g,"fillRule=").replace(/\bclip-rule=/g,"clipRule=").replace(/\bstroke-linecap=/g,"strokeLinecap=").replace(/\bstroke-linejoin=/g,"strokeLinejoin=");
  return {name, source:`import * as React from "react";

export function ${name}({ title, ...props }) {
  return (
    <svg {...props} viewBox="${icon.viewBox || "0 0 24 24"}" aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
      {title ? <title>{title}</title> : null}
      ${inner}
    </svg>
  );
}
`};
}
function frameworkArtifacts(icons) {
  const react = icons.map(toReactComponent);
  const reactIndex = `// Generated by IconForge Studio. Review before production use.
${react.map(x=>`export { ${x.name} } from "./${x.name}";`).join("\n")}
`;
  const vue = icons.map(icon => {
    const name=icon.name.split(/[^a-zA-Z0-9]+/).filter(Boolean).map(s=>s[0].toUpperCase()+s.slice(1)).join("") || "Icon";
    const content=icon.content.replace(/<svg\b[^>]*>/i, `<svg viewBox="${icon.viewBox || "0 0 24 24"}" :aria-hidden="title ? undefined : true" :role="title ? 'img' : undefined">`).replace(/<\/svg\s*>$/i, "");
    return {name,source:`<script setup>
defineProps({ title: { type: String, default: "" } })
</script>
<template>
  ${content}
    <title v-if="title">{{ title }}</title>
  </svg>
</template>
`};
  });
  const angular = icons.map(icon => {
    const name=icon.name.split(/[^a-zA-Z0-9]+/).filter(Boolean).map(s=>s[0].toUpperCase()+s.slice(1)).join("") || "Icon";
    const content=icon.content.replace(/<svg\b[^>]*>/i, `<svg viewBox="${icon.viewBox || "0 0 24 24"}" role="img" aria-hidden="true">`);
    return {name,source:`import { Component, Input } from '@angular/core';

@Component({ selector: 'if-${icon.name.replace(/[^a-zA-Z0-9-]/g,"-").toLowerCase()}', standalone: true, template: \`${content}\` })
export class ${name}Component { @Input() title = ''; }
`};
  });
  return {react,vue,angular,reactIndex};
}

export async function generateLibrary({ icons, outputDirectory, projectConfig, formats, optimize, cssPrefix, fontFamily }) {
  const selectedFormats = new Set((formats || projectConfig.defaultFormats).filter(format => ALLOWED_FORMATS.has(format)));
  const generated = [];
  optimize = optimize === undefined ? projectConfig.defaultOptimize : optimize !== false;
  cssPrefix = String(cssPrefix || projectConfig.cssPrefix).toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "icon";
  fontFamily = String(fontFamily || projectConfig.fontFamily).replace(/[^a-zA-Z0-9 _-]/g, "").trim().slice(0,80) || "IconForge Icons";
  const prepared = icons.map(icon => ({ ...icon, content: optimize ? optimizeSvg(icon.content) : icon.content }));
  await fs.mkdir(outputDirectory, { recursive: true });

  if (selectedFormats.has("sprite")) {
    const symbols = prepared.map(icon => cleanSvgForSprite(icon.content, icon.name)).join("\n");
    const output = `<!-- Generated by IconForge Studio -->\n<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n${symbols}\n</svg>\n`;
    await fs.writeFile(path.join(outputDirectory, "icons-sprite.svg"), output);
    generated.push("icons-sprite.svg");
  }
  if (selectedFormats.has("css")) {
    const css = prepared.map(icon => `.${cssPrefix}-${icon.name.replace(/[^a-zA-Z0-9_-]/g, "-")} { width: 1em; height: 1em; display: inline-block; background: currentColor; mask: url("../icons/${icon.filename}") no-repeat center / contain; -webkit-mask: url("../icons/${icon.filename}") no-repeat center / contain; }`).join("\n");
    await fs.writeFile(path.join(outputDirectory, "icons.css"), `/* Generated by IconForge Studio */\n${css}\n`);
    generated.push("icons.css");
  }
  if (selectedFormats.has("json")) {
    const manifest = prepared.map(icon => ({ name: icon.name, file: icon.filename, viewBox: icon.viewBox }));
    await fs.writeFile(path.join(outputDirectory, "icons.json"), JSON.stringify(manifest, null, 2) + "\n");
    generated.push("icons.json");
  }
  if (selectedFormats.has("svg")) {
    const directory = path.join(outputDirectory, "svg");
    await fs.mkdir(directory, { recursive: true });
    for (const icon of prepared) await fs.writeFile(path.join(directory, icon.filename), icon.content);
    generated.push(`svg/ (${prepared.length} files)`);
  }
  if (selectedFormats.has("font")) {
    if (!prepared.length) throw new Error("Import at least one valid SVG before generating a font.");
    const fontDirectory = path.join(outputDirectory, "fonts");
    await fs.mkdir(fontDirectory, { recursive: true });
    const fontIcons = prepared.map(icon => ({ ...icon, content: convertSvgShapes(icon.content).content }));
    let generateIconFont;
    try { ({ generateIconFont } = await import("./fontgen.js")); }
    catch (error) {
      if (error.code === "ERR_MODULE_NOT_FOUND" || error.code === "MODULE_NOT_FOUND") {
        throw new Error("O gerador de fontes usa dependências JavaScript. Executa `npm install` na pasta do projeto e tenta novamente.");
      }
      throw error;
    }
    const fontResult = await generateIconFont({ outdir: fontDirectory, family: fontFamily, prefix: cssPrefix, icons: fontIcons.map(icon => ({ name: icon.name, content: icon.content })) });
    generated.push(`fonts/ (${fontResult.glyphs} glifos: TTF, WOFF2, CSS e JSON)`);
  }
  if (selectedFormats.has("react") || selectedFormats.has("vue") || selectedFormats.has("angular")) {
    const adapters=frameworkArtifacts(prepared);
    for (const framework of ["react","vue","angular"]) {
      if (!selectedFormats.has(framework)) continue;
      const directory=path.join(outputDirectory,framework);
      await fs.mkdir(directory,{recursive:true});
      if (framework === "react") {
        for (const item of adapters.react) await fs.writeFile(path.join(directory,`${item.name}.jsx`),item.source);
        await fs.writeFile(path.join(directory,"index.js"),adapters.reactIndex);
      } else {
        for (const item of adapters[framework]) await fs.writeFile(path.join(directory,`${item.name}.${framework === "vue" ? "vue" : "component.ts"}`),item.source);
      }
      generated.push(`${framework}/ (${prepared.length} components)`);
    }
  }
  return {
    ok: true,
    iconCount: prepared.length,
    generated,
    optimized: optimize,
    optimizer: optimizerDescription(),
    outputDirectory,
    project: projectConfig
  };
}
