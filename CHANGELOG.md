# Changelog

## [1.0.0] - 2026-11-19

### Features
- **Project-local CLI** — Install as an npm dev dependency; no global installation required
- **Web UI for icon management** — Import, organize, rename, delete, and preview SVG icons
- **SVG shape conversion** — Convert common shapes (`rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`) to paths while retaining attributes and transforms
- **SVGO optimization** — Multipass SVG optimization when installed; conservative fallback otherwise
- **Multiple export formats**:
  - SVG Sprite with CSS classes
  - React JSX components
  - Vue single-file components
  - Angular standalone components
  - JSON manifest
  - TTF and WOFF2 icon fonts with JavaScript and WebAssembly only
- **Stroke expansion for fonts** — SVG strokes are expanded into filled outlines, supporting width, caps, joins, and inherited styles
- **Persistent undo/redo** — Full revision history survives server restarts (30 snapshots, 25 MB budget)
- **CLI-based generation** — Use `npx iconforge generate` to build libraries in CI/CD without starting the web server
- **Configuration persistence** — Project settings, default formats, and optimization preferences are saved and reused
- **ZIP export** — Download source icons, generated outputs, project settings, and history
- **Framework adapters** — Starter code for React, Vue, and Angular
- **No dependencies on Python or external binaries** — Pure JavaScript and WebAssembly
- **MIT License** — Open source and freely usable

### CLI Commands
```bash
npx iconforge init                 # Initialize workspace and npm script
npx iconforge                      # Start the web UI
npx iconforge generate             # Build using saved project settings
npm run build                      # Validate and test before publishing
npm run lint                       # Check syntax of core modules
```

### Important Notes
- This is a stable MVP, not a fully hardened production tool. Do not expose the local server to untrusted networks.
- SVG validation is a basic guardrail, not a complete sanitizer.
- Icon fonts support filled paths and expanded strokes. Dashed strokes, text nodes, `<use>` references, filters, masks, and advanced effects are not rendered.
- Font glyphs use the Unicode private-use area and support up to 6,400 icons per font.
- Requires Node.js 20+

### Limitations
- No plugin system yet
- No automatic pixel-diff regression testing
- Advanced OpenType features not supported
- Some SVG constructs (percentage-based geometry, complex transforms) may need manual adjustment

### Getting Started
```bash
npm install --save-dev iconforge-studio
npx iconforge init
npm run iconforge
```

Then open http://127.0.0.1:4173 and import your SVGs.
