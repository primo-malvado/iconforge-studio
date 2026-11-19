# IconForge Studio

A project-local, local-first web app for importing, organizing, validating, converting and generating SVG icon libraries. IconForge is installed as an npm development dependency in the project that owns the icon library, then started with `npm run iconforge`.

## Requirements

- Node.js 20+
- npm

**Python is not required.** TTF generation is performed by `svg2ttf` in JavaScript, SVG path normalization uses `svg-pathdata`, and WOFF2 compression uses WebAssembly through `woff2-encode-wasm`.

## Install into an existing npm project

**Recommended: install the provided `.tgz` package locally.** Put `iconforge-studio-0.9.0.tgz` in the root of your project and run:

```bash
npm install --save-dev ./iconforge-studio-0.9.0.tgz
npx iconforge init
npm run iconforge
```

Then open http://127.0.0.1:4173. No global installation or published IconForge package is needed; npm installs it as a development dependency in the current project.

If you only have the source ZIP, extract its `iconforge-studio/` folder into your project, for example at `tools/iconforge-studio/`, then install it from that local path instead:

```bash
npm install --save-dev ./tools/iconforge-studio
npx iconforge init
npm run iconforge
```

Keep the package source (for example, `tools/iconforge-studio/`) separate from `.iconforge/`, which is the project's icon workspace. `npx iconforge init` adds the `"iconforge": "iconforge"` npm script to the consuming project's `package.json` without overwriting existing scripts, and creates the workspace folders.

To change the port, run `npm run iconforge -- --port 4180`. To choose a different workspace, run `npm run iconforge -- --workspace ./assets/iconforge-data`. The default is `<project-root>/.iconforge/`.

## Workspace layout

```text
your-project/
├── package.json                 # scripts.iconforge = "iconforge"
├── node_modules/
│   └── .bin/iconforge           # local executable installed by npm
├── tools/iconforge-studio/      # the local package source
└── .iconforge/                  # project data, created by IconForge
    ├── icons/                   # source SVG files
    ├── generated/               # built artifacts
    └── project.json             # project settings + persistent undo/redo
```

The library loads `.iconforge/project.json` when the server starts. Undo/redo history survives restarts and is limited to 30 snapshots and a 25 MB history budget. Config writes use an atomic temporary-file replacement. If the config is missing, a new one is created; if JSON is invalid, a backup is attempted and safe defaults are loaded.

## CLI

```bash
npx iconforge init                  # add npm script + create workspace
npm run iconforge                   # start in this project
npx iconforge generate              # use the last settings saved in IconForge Studio
npm run iconforge -- --port 4180    # use a different port
npm run iconforge -- --help         # display CLI options
```

`iconforge generate` needs no options: it reads the saved formats and optimization preference from `.iconforge/project.json`, then writes artifacts under `.iconforge/generated/`. Optional format and optimization flags can override those settings for a one-off build. The CLI and web UI use the same generator directly; CI does not need to start the web server.

The server binds to `127.0.0.1` only. If the default port is busy, choose a different port with `--port`.

## Features in v0.9.0

- Project-local npm package and CLI; starts via `npm run iconforge`
- Workspace and project settings stored under the consuming project's `.iconforge/` directory by default
- Import multiple SVGs by file picker or drag and drop
- Search, sort, select, rename and delete icons
- Persistent undo/redo for source-library changes, recovered at server startup
- Basic SVG parsing and rejection of obvious active-content patterns
- Convert common SVG shapes (`rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`) to path elements while retaining presentation attributes and transforms
- SVGO multipass optimization when installed; conservative fallback otherwise
- Compare source and optimized SVGs side by side with byte counts
- Generate SVG Sprite, CSS classes, JSON manifest and optimized SVG copies
- Generate React JSX, Vue single-file component and Angular standalone component starter code
- Generate TTF and WOFF2 icon fonts plus CSS and a JSON glyph manifest using JavaScript and WebAssembly only
- Expand SVG strokes into filled font outlines, retaining stroke width, caps, joins and supported path/group transforms
- Preview generated font glyphs in the UI and copy their Unicode characters
- Persist project name, font family, CSS class prefix, default build formats and optimization preference
- ZIP export includes source icons, generated outputs, project settings and persistent history
- Basic quality report, responsive UI and API test suite
- No cloud account or telemetry

## Development and tests

When working inside this package directory:

```bash
npm install
npm test
npm start
```

`npm install` installs the JavaScript dependencies, including SVGO. If SVGO is unavailable, the app uses a conservative markup cleanup fallback and reports that mode. Font generation requires the JavaScript dependencies to be installed.

## Important limitations

- This is an MVP, not a fully hardened production tool. Do not expose the local server to a network.
- The SVG checks are a basic guardrail, not a complete sanitizer or accessibility audit. Inspect untrusted SVGs before publishing.
- The converter supports common shape tags with numeric coordinates. Percentage-based geometry and more advanced SVG constructs are left unchanged.
- Icon fonts support filled paths and expanded solid strokes. Dashed strokes, text nodes, `<use>` references, filters, masks, clipping and some SVG effects are not rendered into font glyphs. Review generated fonts visually before shipping.
- Font glyphs use the Unicode private-use area (`U+E000` onward) and currently support up to 6,400 icons per font.
- TTF generation supports basic icon fonts; kerning and advanced OpenType layout features are outside scope.
- SVGO optimizes path geometry only when the SVGO dependency is installed. Without it, the fallback removes some markup overhead but does not optimize path geometry.
- Side-by-side comparison is a visual inspection aid, not an automatic pixel-difference or regression test.
- Framework adapters are starter points. Review and test output in your own framework/build configuration before shipping.
- CSS output references source files in `.iconforge/icons/` through a relative path; preserve that folder relationship when copying generated CSS.
- Persistent undo/redo is stored with the project config and limited to 30 snapshots and a 25 MB history budget. For large libraries, older snapshots may be trimmed.
- A general third-party plugin system, automatic pixel-diff testing and advanced font outline expansion are not included yet.
