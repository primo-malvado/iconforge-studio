# ✨ IconForge Studio

> **The easiest way to manage and generate SVG icon libraries for your projects.**

Create beautiful, optimized icon fonts and components without leaving your code editor. Manage icons locally, generate in multiple formats, and ship to production with confidence.

---

## 🚀 Quick Start

```bash
# 1. Install into your project
npm install --save-dev iconforge-studio

# 2. Initialize workspace
npx iconforge init

# 3. Open the editor
npm run iconforge
```

Then visit **http://127.0.0.1:4173** to start building your icon library.

---

## 💡 What IconForge Does

- **🎨 Manage SVGs** — Import, rename, organize, and edit icons in a beautiful web UI
- **⚙️ Optimize** — Automatically clean up SVG markup with SVGO
- **📦 Generate** — Export as sprites, fonts (TTF/WOFF2), React/Vue/Angular components, or JSON
- **🔤 Font Generation** — Create icon fonts without external tools
- **⚡ CI/CD Ready** — Generate fonts and components in your build pipeline with `npm run iconforge generate`
- **🔄 Persistent** — All settings, undo/redo history, and redo history survive restarts
- **🌐 Zero Cloud** — Everything runs locally; no accounts, no telemetry

---

## 📋 Requirements

- **Node.js** 20+
- **npm** (or yarn/pnpm)

Font generation uses pure JavaScript and WebAssembly.

---

## 📖 Usage

### Open the Web UI

```bash
npm run iconforge
```

This starts a local server at **http://127.0.0.1:4173**. Drag and drop SVGs to import them.

### Generate for Production

```bash
npx iconforge generate
```

Generates optimized outputs in `.iconforge/generated/`:
- **SVG Sprite** with CSS classes
- **Icon Fonts** (TTF, WOFF2) with glyph manifest
- **React Components** (JSX)
- **Vue Components** (SFC)
- **Angular Components** (standalone)
- **JSON Manifest** for custom usage


### CLI Commands

```bash
npx iconforge init                      # Initialize in a new project
npm run iconforge                       # Start the web UI
npm run iconforge generate                           # Generate using saved settings (for CI/CD)
npm run iconforge -- --port 4180        # Use a different port
npm run iconforge -- --help             # Show all options
```

---

## 🎯 Features in v1.0.0

- **Project-local** — Installed as a dev dependency; no global setup
- **Web UI** — Import, search, rename, delete, and preview icons
- **Shape Conversion** — Automatically convert `rect`, `circle`, `polygon`, etc. to paths
- **SVG Optimization** — SVGO multipass or conservative fallback
- **Multiple Export Formats** — Sprite, CSS, fonts, React, Vue, Angular, JSON
- **Stroke Expansion** — Convert SVG strokes to filled outlines for fonts
- **Font Generation** — TTF and WOFF2 using JavaScript and WebAssembly only
- **Persistent History** — Full undo/redo with 30 snapshots and 25 MB budget
- **Side-by-Side Comparison** — Visual inspection of original vs. optimized
- **ZIP Export** — Download everything including history
- **No Cloud, No Telemetry** — Completely private and local-first

---

## 📂 Git & Deployment

**`.gitignore` for projects using IconForge:**

```
.iconforge/generated/     # don't commit artifacts
```

**What to commit:**
- ✅ `.iconforge/icons/` — your source SVGs
- ✅ `.iconforge/project.json` — settings and history

**What to ignore:**
- ❌ `.iconforge/generated/` — regenerate with `npx iconforge generate`

**CI/CD workflow:**
```bash
npx iconforge generate     # regenerate outputs
```

---

## 🔧 Development

Working on IconForge itself? The start scripts compile the standalone Angular frontend into `public/build/` before launching the local server.

```bash
npm install
npm test
npm start
```

---

## ⚠️ Important Limitations

- **MVP Quality** — This is a stable first release, not a hardened production tool. Do not expose the server to untrusted networks.
- **SVG Validation** — Basic checks only; always inspect untrusted SVGs before shipping.
- **Font Support** — Fonts support filled paths and expanded strokes. Dashed strokes, text nodes, `<use>` references, filters, masks, and advanced effects are not rendered.
- **Font Capacity** — Up to 6,400 icons per font using the Unicode private-use area.
- **Shape Conversion** — Percentage-based geometry and complex SVG constructs may need manual adjustment.

---

## 🎓 Examples

### Use as SVG Sprite

```html
<img src=".iconforge/generated/sprite.svg#icon-search" alt="Search" />
```

### React Component

```jsx
import { Search } from './.iconforge/generated/react'

export default function App() {
  return <Search size={24} />
}
```

### Icon Font

```html
<link rel="stylesheet" href=".iconforge/generated/fonts/icons.css" />
<i class="icon icon-search"></i>
```

---

## 📄 License

MIT — Use freely in personal and commercial projects.

---

## 🤝 Contributing

Found a bug or have a feature request? Let us know!
