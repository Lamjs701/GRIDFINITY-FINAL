import test from 'node:test';
import assert from 'node:assert/strict';
import {
  smoothContourTangent,
  computeMaxTurningAngleDeg,
  getEffectiveToolContour,
} from './curveSmoothing';
import { buildTopDeckAndCutouts } from './cutoutGeometry';
import { Point2D, PlacedTool } from '../types';

test('smoothContourTangent returns original points unchanged when smoothness is 0', () => {
  const pts: Point2D[] = [
    { x: -20, y: -10 },
    { x: 20, y: -10 },
    { x: 20, y: 10 },
    { x: -20, y: 10 },
  ];
  const res = smoothContourTangent(pts, 0);
  assert.deepEqual(res, pts);
});

test('smoothContourTangent converts sharp rectangle corners into tangent arcs while keeping straight walls straight', () => {
  const rect: Point2D[] = [
    { x: -40, y: -20 },
    { x: 40, y: -20 },
    { x: 40, y: 20 },
    { x: -40, y: 20 },
  ];
  const maxTurnBefore = computeMaxTurningAngleDeg(rect);
  assert.equal(maxTurnBefore, 90);

  const smoothed = smoothContourTangent(rect, 70);
  const maxTurnAfter = computeMaxTurningAngleDeg(smoothed);

  assert.ok(smoothed.length > 16, 'Expected subdivided tangent corner vertices');
  assert.ok(
    maxTurnAfter < 25,
    `Expected tangent curve corners with low turning angle, got ${maxTurnAfter}°`
  );

  // Bounding box should closely preserve the straight walls without collapsing
  const xs = smoothed.map((p) => p.x);
  const ys = smoothed.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  assert.ok(w > 78 && w <= 80.1, `Width preserved closely: ${w}`);
  assert.ok(h > 38 && h <= 40.1, `Height preserved closely: ${h}`);
});

test('smoothContourTangent removes jagged staircase kinks on circular/scanned shapes without shrinkage', () => {
  const jagged: Point2D[] = [];
  const n = 36;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const jitter = i % 2 === 0 ? 1.1 : -1.1;
    const r = 18 + jitter;
    jagged.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }

  const maxTurnBefore = computeMaxTurningAngleDeg(jagged);
  assert.ok(maxTurnBefore > 40, `Expected jagged input turning angle > 40°, got ${maxTurnBefore}°`);

  const smoothed = smoothContourTangent(jagged, 75);
  const maxTurnAfter = computeMaxTurningAngleDeg(smoothed);

  assert.ok(
    maxTurnAfter < 22,
    `Expected tangent-smooth circle turning angle < 22°, got ${maxTurnAfter}°`
  );

  // Mean radius should stay very close to 18mm (zero Taubin shrinkage)
  const avgR =
    smoothed.reduce((acc, p) => acc + Math.hypot(p.x, p.y), 0) / smoothed.length;
  assert.ok(Math.abs(avgR - 18) < 0.8, `Expected avg radius ~18mm, got ${avgR}`);
});

test('getEffectiveToolContour + buildTopDeckAndCutouts produce valid 3D mesh with smooth wall vertexNormals', () => {
  const placed: PlacedTool = {
    instanceId: 'smooth-wrench',
    toolId: 'smooth-wrench-def',
    x: 62.75,
    y: 41.75,
    rotation: 0,
    fingerPockets: [],
    tool: {
      id: 'smooth-wrench-def',
      name: 'Jagged Wrench',
      category: 'Wrench',
      contour: [
        { x: -35, y: -12 },
        { x: -24, y: -14 },
        { x: -16, y: -5 },
        { x: 16, y: -5 },
        { x: 24, y: -14 },
        { x: 35, y: -12 },
        { x: 35, y: 12 },
        { x: 24, y: 14 },
        { x: 16, y: 5 },
        { x: -16, y: 5 },
        { x: -24, y: 14 },
        { x: -35, y: 12 },
      ],
      curveSmoothing: 75,
      depth: 10,
      clearance: 0.6,
      fingerPockets: [],
    },
  };

  const eff = getEffectiveToolContour(placed.tool);
  assert.ok(eff.length > placed.tool.contour.length);

  const tris = buildTopDeckAndCutouts({
    topDeckBoundary: [
      { x: 0, y: 0 },
      { x: 125.5, y: 0 },
      { x: 125.5, y: 83.5 },
      { x: 0, y: 83.5 },
    ],
    safeCutoutBoundary: [
      { x: 4, y: 4 },
      { x: 121.5, y: 4 },
      { x: 121.5, y: 79.5 },
      { x: 4, y: 79.5 },
    ],
    tools: [placed],
    topDeckZ: 28,
    chamferSize: 1.0,
  });

  assert.ok(tris.length > 80, 'Expected valid triangulated top deck, chamfer, and smooth cavity walls');
  for (const t of tris) {
    assert.ok(
      Number.isFinite(t.v1[0]) && Number.isFinite(t.v1[2]) && Number.isFinite(t.v2[0]) && Number.isFinite(t.v3[0]),
      'All vertices must be finite'
    );
  }
});
