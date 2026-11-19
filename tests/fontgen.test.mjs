import test from "node:test";
import assert from "node:assert/strict";
import { SVGPathData } from "svg-pathdata";
import { collectPaths, strokePathToOutline } from "../fontgen.js";

test("stroke paths are expanded with round caps before font conversion", () => {
  const outline = strokePathToOutline("M0 0 L10 0", 2, "round");
  const commands = new SVGPathData(outline).toAbs().commands;
  const points = commands.filter(command => Number.isFinite(command.x) && Number.isFinite(command.y));

  assert.equal(commands.filter(command => command.type === SVGPathData.CLOSE_PATH).length, 3);
  assert.ok(Math.min(...points.map(point => point.x)) <= -1);
  assert.ok(Math.max(...points.map(point => point.x)) >= 11);
  assert.ok(Math.min(...points.map(point => point.y)) <= -1);
  assert.ok(Math.max(...points.map(point => point.y)) >= 1);
});

test("font paths inherit SVG stroke styles and group transforms", () => {
  const svg = '<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><g transform="translate(2 3)"><path d="M0 0h10" style="stroke-width: 1.5"/></g></svg>';
  const [path] = collectPaths(svg);

  assert.equal(path.styles.fill, "none");
  assert.equal(path.styles.stroke, "currentColor");
  assert.equal(path.styles["stroke-width"], "1.5");
  assert.deepEqual(path.matrix, [1, 0, 0, 1, 2, 3]);
});

test("invisible fill does not suppress a visible stroke", () => {
  const [path] = collectPaths('<svg fill="none" stroke="currentColor"><path d="M0 0L10 0" fill-opacity="0"/></svg>');
  assert.equal(path.styles.fill, "none");
  assert.equal(path.styles.stroke, "currentColor");
});
