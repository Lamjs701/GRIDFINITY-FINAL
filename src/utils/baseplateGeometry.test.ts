import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASEPLATE_PITCH,
  BASEPLATE_PROFILE_HEIGHT,
  BASEPLATE_MAGNET_PAD,
  BASEPLATE_SOLID_PLAIN_PAD,
  buildBaseplateTriangles,
  createDefaultBaseplateConfig,
  generateBaseplateStl,
  getBaseplateDimensions,
  getBaseplateHardwarePositions,
} from './baseplateGeometry';
import { getMagnetPositions, GRID_TOLERANCE } from './geometry';

function computeSignedMeshVolume(tris: { v1: number[]; v2: number[]; v3: number[] }[]): number {
  let vol6 = 0;
  for (const t of tris) {
    const [ax, ay, az] = t.v1;
    const [bx, by, bz] = t.v2;
    const [cx, cy, cz] = t.v3;
    vol6 +=
      ax * (by * cz - bz * cy) -
      ay * (bx * cz - bz * cx) +
      az * (bx * cy - by * cx);
  }
  return vol6 / 6;
}

function verifyClosedOrientedManifold(tris: { v1: number[]; v2: number[]; v3: number[] }[]) {
  const key = (p: number[]) =>
    `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)},${Math.round(p[2] * 1000)}`;
  const halfEdges = new Map<string, number>();

  for (const t of tris) {
    const verts = [t.v1, t.v2, t.v3];
    for (let i = 0; i < 3; i++) {
      const a = key(verts[i]);
      const b = key(verts[(i + 1) % 3]);
      const edgeKey = `${a}->${b}`;
      halfEdges.set(edgeKey, (halfEdges.get(edgeKey) ?? 0) + 1);
    }
  }

  let unmatched = 0;
  for (const [edge, count] of halfEdges.entries()) {
    const [a, b] = edge.split('->');
    const reverseCount = halfEdges.get(`${b}->${a}`) ?? 0;
    if (count !== reverseCount) {
      unmatched++;
    }
  }
  return unmatched;
}

test('baseplate dimensions follow 42mm pitch and 4.65mm v5 socket profile height', () => {
  const base = createDefaultBaseplateConfig();
  const skelNone = getBaseplateDimensions({ ...base, gridX: 3, gridY: 2, style: 'skeleton', magnetMode: 'none' });
  assert.equal(skelNone.width, 3 * BASEPLATE_PITCH);
  assert.equal(skelNone.length, 2 * BASEPLATE_PITCH);
  assert.equal(skelNone.padHeight, 0);
  assert.equal(skelNone.totalHeight, BASEPLATE_PROFILE_HEIGHT);
  assert.equal(skelNone.magnetCount, 0);

  const skelCorners = getBaseplateDimensions({ ...base, gridX: 3, gridY: 2, style: 'skeleton', magnetMode: 'corners' });
  assert.equal(skelCorners.padHeight, BASEPLATE_MAGNET_PAD);
  assert.equal(skelCorners.totalHeight, BASEPLATE_MAGNET_PAD + BASEPLATE_PROFILE_HEIGHT);
  assert.equal(skelCorners.magnetCount, 4);

  const solidFull = getBaseplateDimensions({ ...base, gridX: 3, gridY: 2, style: 'solid', magnetMode: 'full' });
  assert.equal(solidFull.magnetCount, 3 * 2 * 4);
  assert.equal(solidFull.padHeight, BASEPLATE_MAGNET_PAD);

  const solidNone = getBaseplateDimensions({ ...base, gridX: 1, gridY: 1, style: 'solid', magnetMode: 'none' });
  assert.equal(solidNone.padHeight, BASEPLATE_SOLID_PLAIN_PAD);
  assert.ok(Math.abs(solidNone.totalHeight - (BASEPLATE_SOLID_PLAIN_PAD + BASEPLATE_PROFILE_HEIGHT)) < 1e-6);
});

test('baseplate magnet centers align concentrically with Gridfinity bin foot magnets (+0.25mm bin clearance)', () => {
  const gridX = 4;
  const gridY = 2;
  for (const mode of ['corners', 'full'] as const) {
    const bpPts = getBaseplateHardwarePositions(gridX, gridY, mode, false);
    const binPts = getMagnetPositions(gridX, gridY, mode);
    assert.equal(bpPts.length, binPts.length);

    for (let i = 0; i < bpPts.length; i++) {
      // Bin sits centered inside baseplate shifted by +GRID_TOLERANCE/2 (+0.25mm) on X and Y
      const shiftedBinX = binPts[i].x + GRID_TOLERANCE / 2;
      const shiftedBinY = binPts[i].y + GRID_TOLERANCE / 2;
      assert.ok(Math.abs(bpPts[i].x - shiftedBinX) < 1e-6);
      assert.ok(Math.abs(bpPts[i].y - shiftedBinY) < 1e-6);
    }
  }
});

test('all baseplate style & magnet variants generate closed watertight 2-manifold positive-volume meshes', () => {
  const base = createDefaultBaseplateConfig();
  const variants = [
    { gridX: 2, gridY: 2, style: 'skeleton' as const, magnetMode: 'none' as const, hasScrews: false },
    { gridX: 2, gridY: 2, style: 'skeleton' as const, magnetMode: 'corners' as const, hasScrews: false },
    { gridX: 2, gridY: 2, style: 'skeleton' as const, magnetMode: 'full' as const, hasScrews: false },
    { gridX: 2, gridY: 2, style: 'skeleton' as const, magnetMode: 'none' as const, hasScrews: true },
    { gridX: 2, gridY: 2, style: 'solid' as const, magnetMode: 'none' as const, hasScrews: false },
    { gridX: 2, gridY: 2, style: 'solid' as const, magnetMode: 'corners' as const, hasScrews: false },
    { gridX: 2, gridY: 2, style: 'solid' as const, magnetMode: 'full' as const, hasScrews: false },
    { gridX: 2, gridY: 2, style: 'solid' as const, magnetMode: 'none' as const, hasScrews: true },
  ];

  for (const v of variants) {
    const cfg = { ...base, ...v };
    const tris = buildBaseplateTriangles(cfg);
    assert.ok(tris.length > 50, `Expected non-trivial triangle count for ${v.style}/${v.magnetMode}`);

    const volume = computeSignedMeshVolume(tris);
    assert.ok(volume > 0, `Expected positive signed volume for ${v.style}/${v.magnetMode}, got ${volume}`);

    const unmatched = verifyClosedOrientedManifold(tris);
    assert.equal(unmatched, 0, `Expected 0 unmatched half-edges (watertight manifold) for ${v.style}/${v.magnetMode}`);

    const stl = generateBaseplateStl(cfg);
    const view = new DataView(stl);
    assert.equal(view.getUint32(80, true), tris.length);
    assert.equal(stl.byteLength, 84 + tris.length * 50);
  }
});

test('custom magnet diameter and depth dynamically adjust pocket geometry, pad height, and stay watertight manifold', () => {
  const base = createDefaultBaseplateConfig();
  const customCases = [
    { style: 'skeleton' as const, magnetMode: 'full' as const, magnetDiameter: 8.4, magnetDepth: 3.4 },
    { style: 'solid' as const, magnetMode: 'corners' as const, magnetDiameter: 4.5, magnetDepth: 1.5 },
  ];

  for (const c of customCases) {
    const cfg = { ...base, gridX: 2, gridY: 2, ...c };
    const dims = getBaseplateDimensions(cfg);
    assert.ok(Math.abs(dims.padHeight - (c.magnetDepth + 0.4)) < 1e-6);

    const tris = buildBaseplateTriangles(cfg);
    const unmatched = verifyClosedOrientedManifold(tris);
    assert.equal(unmatched, 0, `Expected 0 unmatched half-edges for custom magnet ${c.magnetDiameter}x${c.magnetDepth}`);

    // Verify downward pocket cap sits at exact requested magnetDepth
    const pocketCapCenterTris = tris.filter(
      (t) =>
        t.normal &&
        t.normal[2] === -1 &&
        Math.abs(t.v1[2] - c.magnetDepth) < 1e-4 &&
        Math.abs(t.v2[2] - c.magnetDepth) < 1e-4 &&
        Math.abs(t.v3[2] - c.magnetDepth) < 1e-4
    );
    assert.ok(pocketCapCenterTris.length > 0, 'Expected downward pocket ceiling triangles at custom magnetDepth');
  }
});
