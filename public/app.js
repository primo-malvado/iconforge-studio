const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let icons = [], selected = new Set(), lastOutputs = [], toastTimer;
const state = { lastBuild: null, checksRun: false, projectConfig: null, fontPreview: null };

async function api(url, options={}) {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
function notify(message, error=false) {
  const t=$("#toast"); t.textContent=message; t.className=`toast show${error?" error":""}`;
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.className="toast",3400);
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function safePreview(svg) {
  try {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    if (doc.querySelector("parsererror")) return "";
    doc.querySelectorAll("script,style,link,foreignObject,iframe,object,embed,audio,video").forEach(n=>n.remove());
    doc.querySelectorAll("*").forEach(el=>[...el.attributes].forEach(a=>{
      if (/^on/i.test(a.name) || (["href","xlink:href"].includes(a.name.toLowerCase()) && !a.value.startsWith("#")) || /javascript:/i.test(a.value) || /url\s*\(\s*["']?(?!#)/i.test(a.value)) el.removeAttribute(a.name);
    }));
    const root=doc.documentElement;
    root.removeAttribute("width"); root.removeAttribute("height");
    return new XMLSerializer().serializeToString(root);
  } catch { return ""; }
}
function iconSvg(icon) {
  if (!icon.content) return '<span class="bad-svg">!</span>';
  return safePreview(icon.content).replace("<svg", '<svg aria-hidden="true" focusable="false');
}
async function loadIcons() {
  const data=await api("/api/icons"); icons=data.icons;
  selected = new Set([...selected].filter(f=>icons.some(i=>i.filename===f)));
  render();
  renderCompareOptions();
  await loadHistoryState().catch(()=>{});
}
async function loadHistoryState() {
  const history=await api("/api/history");
  $("#undoBtn").disabled=!history.canUndo;
  $("#redoBtn").disabled=!history.canRedo;
  const storedInProject=history.persistent?`Saved in ${history.storage||"project.json"}`:"Session only";
  $("#undoBtn").title=`${history.canUndo?`Undo last change (${history.undoDepth} available)`:"Nothing to undo"} · ${storedInProject}`;
  $("#redoBtn").title=`${history.canRedo?`Redo last change (${history.redoDepth} available)`:"Nothing to redo"} · ${storedInProject}`;
}
async function loadProjectSettings() {
  const config=await api("/api/project"); state.projectConfig=config;
  $("#projectNameInput").value=config.projectName;
  $("#fontFamilyInput").value=config.fontFamily;
  $("#cssPrefixInput").value=config.cssPrefix;
  $("#defaultOptimizeInput").checked=config.defaultOptimize;
  $$('.format-option input[value]').forEach(input=>{if(input.value!=="")input.checked=config.defaultFormats.includes(input.value);});
  $("#optimizeToggle").checked=config.defaultOptimize;
  document.title=`${config.projectName} · IconForge Studio`;
}
async function saveProjectSettings() {
  const formats=$$('.format-option input[value]:checked').map(i=>i.value).filter(v=>v!=="");
  const config=await api("/api/project",{method:"PUT",body:JSON.stringify({
    projectName:$("#projectNameInput").value,
    fontFamily:$("#fontFamilyInput").value,
    cssPrefix:$("#cssPrefixInput").value,
    defaultOptimize:$("#defaultOptimizeInput").checked,
    defaultFormats:formats.length?formats:(state.projectConfig?.defaultFormats||["sprite","css","json"])
  })});
  state.projectConfig=config;
  $("#projectNameInput").value=config.projectName;
  $("#fontFamilyInput").value=config.fontFamily;
  $("#cssPrefixInput").value=config.cssPrefix;
  $("#optimizeToggle").checked=config.defaultOptimize;
  document.title=`${config.projectName} · IconForge Studio`;
  notify("Project settings saved locally.");
}
async function changeHistory(action) {
  try {
    await api(`/api/${action}`,{method:"POST"});
    selected.clear();
    await loadIcons();
    notify(action==="undo"?"Last library change undone.":"Last change restored.");
  } catch(e) { notify(e.message,true); }
}
async function convertSelectedShapes() {
  if(!selected.size)return;
  if(!confirm(`Convert basic SVG shapes to paths in ${selected.size} selected file(s)? The source files will change, but this action can be undone.`))return;
  try {
    const result=await api("/api/convert-shapes",{method:"POST",body:JSON.stringify({filenames:[...selected]})});
    selected.clear(); await loadIcons();
    if(!result.convertedShapes) notify("No convertible basic shapes found in the selection.");
    else notify(`Converted ${result.convertedShapes} shape(s) across ${result.convertedIcons} icon(s).`);
    if(result.unsupported?.length) console.warn("Some SVG shapes could not be converted",result.unsupported);
  } catch(e){notify(e.message,true);}
}
function renderCompareOptions() {
  const select=$("#compareIconSelect"); if(!select)return;
  const previous=select.value;
  select.innerHTML='<option value="">Select an icon</option>'+icons.filter(i=>!i.error).map(i=>`<option value="${escapeHtml(i.filename)}">${escapeHtml(i.name)}</option>`).join("");
  if(icons.some(i=>i.filename===previous))select.value=previous;
}
async function compareSelectedIcon() {
  const filename=$("#compareIconSelect").value;
  if(!filename){notify("Choose an icon to compare.",true);return;}
  const button=$("#compareBtn"); button.disabled=true;
  try {
    const result=await api("/api/compare",{method:"POST",body:JSON.stringify({filename})});
    const saved=result.bytesSaved>=0?`${result.bytesSaved} bytes (${result.percentSaved}% smaller)`:`${Math.abs(result.bytesSaved)} bytes larger (${Math.abs(result.percentSaved)}% increase)`;
    $("#compareSummary").innerHTML=`<strong>${escapeHtml(result.filename)}</strong>: ${result.originalBytes.toLocaleString()} bytes original → ${result.optimizedBytes.toLocaleString()} bytes optimized. ${escapeHtml(saved)}. Optimizer: ${escapeHtml(result.optimizer)}.`;
    $("#compareSummary").classList.remove("hidden");
    $("#compareGrid").innerHTML=`<article class="compare-side"><h3>Original SVG</h3><div class="compare-art">${safePreview(result.original)}</div><div class="compare-size">Source · <strong>${result.originalBytes.toLocaleString()} B</strong></div></article><article class="compare-side"><h3>Optimized SVG</h3><div class="compare-art">${safePreview(result.optimized)}</div><div class="compare-size">Result · <strong>${result.optimizedBytes.toLocaleString()} B</strong></div></article>`;
    $("#compareGrid").classList.remove("hidden");
  } catch(e){notify(e.message,true);}
  finally{button.disabled=false;}
}
async function loadFontPreview() {
  try {
    const data=await api("/api/font-preview");
    if(!data.available){$("#fontPreviewPanel").classList.add("hidden");return;}
    state.fontPreview=data;
    const family=String(data.family||"IconForge Icons").replace(/["\\]/g,"");
    let style=$("#iconForgeFontStyle");
    if(!style){style=document.createElement("style");style.id="iconForgeFontStyle";document.head.appendChild(style);}
    style.textContent=`@font-face{font-family:"${family}";src:url("/api/font-file/iconforge-icons.woff2?v=${encodeURIComponent(data.version)}") format("woff2");font-display:block}`;
    $("#fontFamilyBadge").textContent=data.family;
    $("#fontPreviewSubtitle").textContent=`${data.icons.length} glyph(s) · Unicode private-use area · Click a tile's code point to copy it.`;
    $("#fontPreviewGrid").innerHTML=data.icons.map(icon=>`<div class="font-glyph-card" title="${escapeHtml(icon.name)}"><span class="font-glyph" style="font-family:&quot;${escapeHtml(family)}&quot;">${String.fromCodePoint(icon.codepoint)}</span><span class="font-glyph-name">${escapeHtml(icon.name)}</span><button type="button" class="text-btn font-copy-code" data-code="${icon.codepoint}" title="Copy Unicode code point">U+${escapeHtml(icon.hex)}</button></div>`).join("");
    $$(".font-copy-code").forEach(button=>button.addEventListener("click",()=>{const point=Number(button.dataset.code);const code=`U+${point.toString(16).toUpperCase().padStart(4,"0")}`;navigator.clipboard?.writeText(String.fromCodePoint(point)).then(()=>notify(`Copied ${code}.`)).catch(()=>notify(code));}));
    $("#fontPreviewPanel").classList.remove("hidden");
  } catch(e) { console.warn("Font preview unavailable",e); }
}
function render() {
  $("#navCount").textContent=icons.length;
  $("#statIcons").textContent=icons.length;
  $("#statIssues").textContent=icons.filter(i=>i.error).length;
  $("#statOutputs").textContent=lastOutputs.length;
  $("#step2").classList.toggle("done",icons.length>0);
  $("#step3").classList.toggle("done",lastOutputs.length>0);
  const recent=icons.slice(-4).reverse();
  $("#recentList").innerHTML=recent.length?recent.map(i=>`<div class="recent-item"><div class="recent-preview">${iconSvg(i)}</div><div><strong>${escapeHtml(i.name)}</strong><small>${escapeHtml(i.filename)}</small></div></div>`).join(""):`<div class="empty-state small"><div class="empty-icon">▦</div><strong>No icons yet</strong><p>Import SVGs to see them here.</p></div>`;
  renderExplorer();
  renderQuality();
}
function filteredIcons() {
  const q=$("#searchInput").value.trim().toLowerCase();
  const result=icons.filter(i=>i.name.toLowerCase().includes(q)||i.filename.toLowerCase().includes(q));
  result.sort((a,b)=>$("#sortSelect").value==="name-desc"?b.name.localeCompare(a.name):a.name.localeCompare(b.name));
  return result;
}
function renderExplorer() {
  const list=filteredIcons();
  $("#explorerCount").textContent=`${list.length} ${list.length===1?"icon":"icons"}`;
  $("#selectedCount").textContent=selected.size?`${selected.size} selected`:"Nothing selected";
  $("#selectAllBtn").textContent=list.length&&list.every(i=>selected.has(i.filename))?"Clear selection":"Select all";
  $("#deleteBtn").classList.toggle("hidden",selected.size===0);
  $("#convertShapesBtn").classList.toggle("hidden",selected.size===0);
  $("#iconGrid").innerHTML=list.map(i=>`<article class="icon-card ${selected.has(i.filename)?"selected":""}" data-file="${escapeHtml(i.filename)}" tabindex="0" role="checkbox" aria-checked="${selected.has(i.filename)}">
    <span class="icon-check">${selected.has(i.filename)?"✓":""}</span>
    <div class="icon-preview">${iconSvg(i)}</div><span class="icon-name" title="${escapeHtml(i.name)}">${escapeHtml(i.name)}</span><span class="icon-sub">${i.error?"Needs attention":escapeHtml(i.viewBox)}</span></article>`).join("");
  $("#explorerEmpty").classList.toggle("hidden",list.length!==0);
  $("#iconGrid").classList.toggle("hidden",list.length===0);
  $$("#iconGrid .icon-card").forEach(card=>{
    const toggle=()=>{const f=card.dataset.file;selected.has(f)?selected.delete(f):selected.add(f);renderExplorer();};
    card.addEventListener("click",toggle);
    card.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();toggle();}});
    card.addEventListener("contextmenu",e=>{e.preventDefault();renameIcon(card.dataset.file);});
  });
}
async function importFiles(fileList) {
  const files=[...fileList].filter(f=>f.name.toLowerCase().endsWith(".svg"));
  if(!files.length){notify("Choose one or more .svg files.",true);return;}
  const parsed=await Promise.all(files.map(async f=>({name:f.name,content:await f.text()})));
  try {
    const result=await api("/api/import",{method:"POST",body:JSON.stringify({files:parsed})});
    await loadIcons();
    const skipped=result.skipped?.length?` ${result.skipped.length} skipped.`:"";
    notify(`${result.imported} SVG file(s) imported.${skipped}`);
    if(result.skipped?.length) console.warn("Skipped imports",result.skipped);
  } catch(e){notify(e.message,true);}
}
async function renameIcon(filename) {
  const icon=icons.find(i=>i.filename===filename); if(!icon)return;
  const name=prompt("New icon name (without .svg):",icon.name);
  if(name===null)return;
  if(!name.trim()){notify("Name cannot be empty.",true);return;}
  try{await api("/api/rename",{method:"POST",body:JSON.stringify({filename,name:name.trim()})});await loadIcons();notify("Icon renamed.");}
  catch(e){notify(e.message,true);}
}
async function deleteSelected() {
  if(!selected.size)return;
  if(!confirm(`Delete ${selected.size} selected SVG file(s) from the local workspace? You can undo this change.`))return;
  try{const result=await api("/api/delete",{method:"POST",body:JSON.stringify({filenames:[...selected]})});selected.clear();await loadIcons();notify(`${result.deleted.length} file(s) deleted.`);}
  catch(e){notify(e.message,true);}
}
function showView(name) {
  $$(".view").forEach(v=>v.classList.toggle("active",v.id===`view-${name}`));
  $$(".nav").forEach(n=>n.classList.toggle("active",n.dataset.view===name));
  $("#crumbTitle").textContent=({overview:"Overview",explorer:"Icon Explorer",build:"Build Studio",quality:"Quality Center"})[name]||name;
  if(name==="explorer")renderExplorer();
  if(name==="quality")renderQuality();
  window.scrollTo({top:0,behavior:"smooth"});
}
async function build() {
  const formats=$$('.format-option input:checked').map(i=>i.value).filter(v=>v!=="");
  const optimize=$("#optimizeToggle").checked;
  const outputFormats=formats.filter(v=>["sprite","css","json","svg","react","vue","angular","font"].includes(v));
  if(!outputFormats.length){notify("Select at least one output format.",true);return;}
  $("#buildBtn").disabled=true;$("#buildBtn").textContent="Generating…";
  const message=$("#buildMessage");message.className="build-message hidden";
  try{
    const result=await api("/api/build",{method:"POST",body:JSON.stringify({formats:outputFormats,optimize,fontFamily:$("#fontFamilyInput").value,cssPrefix:$("#cssPrefixInput").value})});
    lastOutputs=result.generated;state.lastBuild=result;
    $("#buildIconCount").textContent=result.iconCount;
    $("#buildFileCount").textContent=result.generated.length;
    $("#buildStatusDot").classList.add("success");
    $("#outputList").innerHTML=result.generated.map(f=>`<div class="output-item"><span class="file-badge">${escapeHtml(f.split(".").pop().toUpperCase().slice(0,4))}</span><span>${escapeHtml(f)}</span></div>`).join("");
    message.textContent=`Build completed. ${result.iconCount} valid icon(s) processed using ${result.optimizer}. Files saved to ${result.outputDirectory}.`;
    message.className="build-message";
    render();
    if(outputFormats.includes("font")) await loadFontPreview();
    notify("Library generated successfully.");
  }catch(e){message.textContent=e.message;message.className="build-message error";notify(e.message,true);}
  finally{$("#buildBtn").disabled=false;$("#buildBtn").innerHTML="⚡ Generate library";}
}
function renderQuality() {
  const invalid=icons.filter(i=>i.error);
  const empty=icons.length===0;
  $("#qualityHeadline").textContent=empty?"Ready to inspect your collection":invalid.length?`${invalid.length} issue(s) need attention`:"Your collection looks healthy";
  $("#qualitySubhead").textContent=empty?"Import SVG files, then run checks to inspect your collection.":invalid.length?"Some SVG files could not be parsed or failed basic safety checks.":"Basic SVG structure and safety checks found no obvious issues.";
  $("#qualityCards").innerHTML=[
    ["Total icons",icons.length,"SVG files in workspace"],
    ["Valid SVGs",icons.length-invalid.length,"Passed basic validation"],
    ["Issues",invalid.length,"Invalid or rejected files"]
  ].map(c=>`<article class="quality-card"><span>${c[0]}</span><strong>${c[1]}</strong><small>${c[2]}</small></article>`).join("");
  $("#findingsList").innerHTML=invalid.length?invalid.map(i=>`<div class="finding"><span class="finding-symbol">!</span><div><strong>${escapeHtml(i.filename)}</strong><p>${escapeHtml(i.error||"Validation issue")}</p></div></div>`).join(""):empty?`<div class="empty-state small"><strong>No icons to inspect</strong><p>Import SVG files to begin.</p></div>`:`<div class="finding"><span class="finding-symbol" style="background:#1e392a;color:#8ce2b2">✓</span><div><strong>No basic validation issues found</strong><p>All imported files passed the current checks. More advanced visual and accessibility checks are planned.</p></div></div>`;
}
function setup() {
  $$(".nav").forEach(n=>n.addEventListener("click",()=>showView(n.dataset.view)));
  $$("[data-goto]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.goto)));
  $("#importTop").onclick=$("#importStep").onclick=$("#importExplorer").onclick=$("#emptyImport").onclick=()=>$("#fileInput").click();
  $("#browseBtn").onclick=()=>$("#fileInput").click();
  $("#fileInput").addEventListener("change",e=>{importFiles(e.target.files);e.target.value="";});
  $("#refreshBtn").onclick=()=>loadIcons().then(()=>notify("Workspace refreshed.")).catch(e=>notify(e.message,true));
  $("#searchInput").addEventListener("input",renderExplorer);
  $("#sortSelect").addEventListener("change",renderExplorer);
  $("#selectAllBtn").onclick=()=>{const list=filteredIcons();if(list.length&&list.every(i=>selected.has(i.filename)))list.forEach(i=>selected.delete(i.filename));else list.forEach(i=>selected.add(i.filename));renderExplorer();};
  $("#deleteBtn").onclick=deleteSelected;
  $("#convertShapesBtn").onclick=convertSelectedShapes;
  $("#undoBtn").onclick=()=>changeHistory("undo");
  $("#redoBtn").onclick=()=>changeHistory("redo");
  $("#saveProjectBtn").onclick=()=>saveProjectSettings().catch(e=>notify(e.message,true));
  $("#compareBtn").onclick=compareSelectedIcon;
  $("#buildBtn").onclick=build;
  $("#buildPreset").addEventListener("change",e=>{
    const presets={web:["sprite","css","json"],react:["sprite","css","json","react"],vue:["sprite","css","json","vue"],angular:["sprite","css","json","angular"],everything:["sprite","css","json","svg","react","vue","angular","font"]};
    if(e.target.value==="custom")return;
    $$('.format-option input[value]').forEach(input=>{if(input.value!=="")input.checked=(presets[e.target.value]||[]).includes(input.value);});
    $("#optimizeToggle").checked=true;
  });
  $$('.format-option input[value]').forEach(input=>input.addEventListener("change",()=>{$("#buildPreset").value="custom";}));
  $("#runChecksBtn").onclick=async()=>{try{const result=await api("/api/quality");state.qualityFindings=result.findings.filter(f=>f.severity!=="error");state.checksRun=true;renderQuality();$("#qualitySubhead").textContent=`${result.summary.errors} errors, ${result.summary.warnings} warnings and ${result.summary.info} recommendations across ${result.count} icons.`;notify("SVG quality checks completed.");}catch(e){notify(e.message,true);}};
  $("#exportZipBtn").onclick=async()=>{try{const response=await fetch("/api/export.zip");if(!response.ok)throw new Error("Could not create ZIP export.");const blob=await response.blob();const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download="iconforge-export.zip";link.click();URL.revokeObjectURL(link.href);notify("ZIP export ready.");}catch(e){notify(e.message,true);}};
  const drop=$("#dropZone");
  ["dragenter","dragover"].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add("dragging");}));
  ["dragleave","drop"].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove("dragging");}));
  drop.addEventListener("drop",e=>importFiles(e.dataTransfer.files));
  document.addEventListener("keydown",e=>{
    const typing=e.target instanceof HTMLElement && (e.target.matches("input,textarea,select") || e.target.isContentEditable);
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();showView("explorer");$("#searchInput").focus();}
    else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"&&!typing){e.preventDefault();changeHistory(e.shiftKey?"redo":"undo");}
    else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="y"&&!typing){e.preventDefault();changeHistory("redo");}
  });
}
setup();
api("/api/health").then(async()=>{
  await loadProjectSettings();
  await Promise.all([loadIcons(),loadFontPreview()]);
}).catch(()=>notify("Cannot connect to local server.",true));
