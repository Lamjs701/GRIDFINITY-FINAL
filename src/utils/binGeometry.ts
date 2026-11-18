import * as THREE from 'three';
import earcut from 'earcut';
import { GridfinityConfig, PlacedTool, Point2D } from '../types';
import {
  BASE_BOTTOM_CORNER_RADIUS,
  BASE_FOOT_BOTTOM_SIZE,
  BASE_FOOT_MID_SIZE,
  BASE_FOOT_TOP_SIZE,
  BASE_LOWER_CHAMFER,
  BASE_MID_CORNER_RADIUS,
  BASE_PROFILE_HEIGHT,
  BASE_VERTICAL_STEP,
  CORNER_RADIUS,
  STACKING_LIP_HEIGHT,
  getBinDimensions,
  getMagnetPositions,
  getStackingLipProfile,
  getUnitFootCenters,
} from './geometry';
import { MeshTriangle, buildTopDeckAndCutouts } from './cutoutGeometry';

export interface BuildBinOptions {
  /** If true, shifts X/Y by (-width/2, -length/2) so bin sits centered on the XY origin. */
  centered?: boolean;
}

/**
 * Generates watertight 3D triangles for a parametric Gridfinity v5 bin,
 * including stepped base feet, optional magnet/screw recesses, stackable lip,
 * 45° top-deck model cutout chamfers, tool cavities, finger pockets, and vector text relief.
 */
export function buildBinTriangles(
  config: GridfinityConfig,
  tools: PlacedTool[],
  options: BuildBinOptions = {}
): MeshTriangle[] {
  const { width, length, height } = getBinDimensions(
    config.gridX,
    config.gridY,
    config.gridZ,
    config.customHeightMm
  );

  const shiftX = options.centered ? -width / 2 : 0;
  const shiftY = options.centered ? -length / 2 : 0;
  const triangles: MeshTriangle[] = [];
  const chamfer = Math.max(0, Math.min(3.0, config.chamferSize));

  const createRoundedRectCentered = (
    cx: number,
    cy: number,
    w: number,
    l: number,
    radius: number,
    segments: number = 6
  ): Point2D[] => {
    const pts: Point2D[] = [];
    const r = Math.min(radius, w / 2, l / 2);
    const minX = cx - w / 2;
    const maxX = cx + w / 2;
    const minY = cy - l / 2;
    const maxY = cy + l / 2;

    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * (Math.PI / 2);
      pts.push({ x: maxX - r + r * Math.sin(a), y: maxY - r + r * Math.cos(a) });
    }
    for (let i = 0; i <= segments; i++) {
      const a = Math.PI / 2 + (i / segments) * (Math.PI / 2);
      pts.push({ x: maxX - r + r * Math.sin(a), y: minY + r + r * Math.cos(a) });
    }
    for (let i = 0; i <= segments; i++) {
      const a = Math.PI + (i / segments) * (Math.PI / 2);
      pts.push({ x: minX + r + r * Math.sin(a), y: minY + r + r * Math.cos(a) });
    }
    for (let i = 0; i <= segments; i++) {
      const a = (3 * Math.PI) / 2 + (i / segments) * (Math.PI / 2);
      pts.push({ x: minX + r + r * Math.sin(a), y: maxY - r + r * Math.cos(a) });
    }
    return pts;
  };

  const pushRingStrip = (ringA: Point2D[], zA: number, ringB: Point2D[], zB: number) => {
    for (let i = 0; i < ringA.length; i++) {
      const next = (i + 1) % ringA.length;
      const a1 = ringA[i];
      const a2 = ringA[next];
      const b1 = ringB[i];
      const b2 = ringB[next];

      triangles.push({
        v1: [a1.x, a1.y, zA],
        v2: [b2.x, b2.y, zB],
        v3: [a2.x, a2.y, zA],
      });
      triangles.push({
        v1: [a1.x, a1.y, zA],
        v2: [b1.x, b1.y, zB],
        v3: [b2.x, b2.y, zB],
      });
    }
  };

  // 1. Per-unit Gridfinity v5 Stepped Base Feet (Z = 0 -> 4.75mm)
  const z0 = 0;
  const z1 = BASE_LOWER_CHAMFER;
  const z2 = BASE_LOWER_CHAMFER + BASE_VERTICAL_STEP;
  const z3 = BASE_PROFILE_HEIGHT;

  const footCenters = getUnitFootCenters(config.gridX, config.gridY);
  const magnetMode = config.magnetMode ?? (config.hasMagnets ? 'corners' : 'none');
  const hasHoleRecesses = magnetMode !== 'none' || config.hasScrews;
  const magnetPositions = hasHoleRecesses
    ? getMagnetPositions(config.gridX, config.gridY, magnetMode !== 'none' ? magnetMode : 'corners').map(
        (m) => ({
          x: m.x + shiftX,
          y: m.y + shiftY,
        })
      )
    : [];
  const safeMagnetDiameter = Math.max(3.0, Math.min(8.6, config.magnetDiameter || 6.5));
  const safeMagnetDepth = Math.max(0.8, Math.min(4.2, config.magnetDepth || 2.4));
  const holeRadius = magnetMode !== 'none' ? safeMagnetDiameter / 2 : config.screwDiameter / 2;
  const holeDepth = magnetMode !== 'none' ? safeMagnetDepth : BASE_PROFILE_HEIGHT;

  for (const unit of footCenters) {
    const ucx = unit.cx + shiftX;
    const ucy = unit.cy + shiftY;

    const r0 = createRoundedRectCentered(
      ucx,
      ucy,
      BASE_FOOT_BOTTOM_SIZE,
      BASE_FOOT_BOTTOM_SIZE,
      BASE_BOTTOM_CORNER_RADIUS,
      5
    );
    const r1 = createRoundedRectCentered(
      ucx,
      ucy,
      BASE_FOOT_MID_SIZE,
      BASE_FOOT_MID_SIZE,
      BASE_MID_CORNER_RADIUS,
      5
    );
    const r2 = r1;
    const r3 = createRoundedRectCentered(
      ucx,
      ucy,
      BASE_FOOT_TOP_SIZE,
      BASE_FOOT_TOP_SIZE,
      CORNER_RADIUS,
      5
    );

    pushRingStrip(r0, z0, r1, z1);
    pushRingStrip(r1, z1, r2, z2);
    pushRingStrip(r2, z2, r3, z3);

    const footCoords: number[] = [];
    for (const p of r0) footCoords.push(p.x, p.y);
    const footHoles: number[] = [];

    if (hasHoleRecesses) {
      const halfFoot = BASE_FOOT_BOTTOM_SIZE / 2;
      for (const pos of magnetPositions) {
        if (Math.abs(pos.x - ucx) < halfFoot && Math.abs(pos.y - ucy) < halfFoot) {
          footHoles.push(footCoords.length / 2);
          const segs = 16;
          for (let s = 0; s < segs; s++) {
            const a = (s / segs) * Math.PI * 2;
            footCoords.push(pos.x + holeRadius * Math.cos(a), pos.y + holeRadius * Math.sin(a));
          }
        }
      }
    }

    const bottomIndices = earcut(footCoords, footHoles.length > 0 ? footHoles : undefined);
    for (let i = 0; i < bottomIndices.length; i += 3) {
      const idx1 = bottomIndices[i] * 2;
      const idx2 = bottomIndices[i + 1] * 2;
      const idx3 = bottomIndices[i + 2] * 2;
      triangles.push({
        v1: [footCoords[idx1], footCoords[idx1 + 1], 0],
        v2: [footCoords[idx3], footCoords[idx3 + 1], 0],
        v3: [footCoords[idx2], footCoords[idx2 + 1], 0],
        normal: [0, 0, -1],
      });
    }
  }

  // Magnet or Screw cylinder recesses
  if (hasHoleRecesses) {
    for (const pos of magnetPositions) {
      const segs = 16;
      for (let s = 0; s < segs; s++) {
        const a1 = (s / segs) * Math.PI * 2;
        const a2 = ((s + 1) / segs) * Math.PI * 2;
        const x1 = pos.x + holeRadius * Math.cos(a1);
        const y1 = pos.y + holeRadius * Math.sin(a1);
        const x2 = pos.x + holeRadius * Math.cos(a2);
        const y2 = pos.y + holeRadius * Math.sin(a2);

        triangles.push({ v1: [x1, y1, 0], v2: [x2, y2, 0], v3: [x1, y1, holeDepth] });
        triangles.push({ v1: [x2, y2, 0], v2: [x2, y2, holeDepth], v3: [x1, y1, holeDepth] });
        triangles.push({
          v1: [pos.x, pos.y, holeDepth],
          v2: [x2, y2, holeDepth],
          v3: [x1, y1, holeDepth],
          normal: [0, 0, 1],
        });
      }
    }
  }

  // Continuous bin body from Z = 4.75mm upward
  const bodyCenterX = width / 2 + shiftX;
  const bodyCenterY = length / 2 + shiftY;
  const baseOuterPts = createRoundedRectCentered(bodyCenterX, bodyCenterY, width, length, CORNER_RADIUS, 8);
  const bridgeCoords: number[] = [];
  for (const p of baseOuterPts) bridgeCoords.push(p.x, p.y);
  const bridgeIdx = earcut(bridgeCoords);
  for (let i = 0; i < bridgeIdx.length; i += 3) {
    const i1 = bridgeIdx[i];
    const i2 = bridgeIdx[i + 1];
    const i3 = bridgeIdx[i + 2];
    triangles.push({
      v1: [baseOuterPts[i1].x, baseOuterPts[i1].y, z3],
      v2: [baseOuterPts[i3].x, baseOuterPts[i3].y, z3],
      v3: [baseOuterPts[i2].x, baseOuterPts[i2].y, z3],
      normal: [0, 0, -1],
    });
  }

  // 2. Main bin outer walls + Adjustable Stackable Lip
  const topDeckZ = Math.max(z3 + 1.5, height);
  const requestedLipHeight =
    config.lipHeight ?? (config.hasStackingLip !== false ? STACKING_LIP_HEIGHT : 0);
  const lipProfile = getStackingLipProfile(requestedLipHeight);
  const outerWallTopZ = lipProfile.enabled ? topDeckZ + lipProfile.height : topDeckZ;
  pushRingStrip(baseOuterPts, z3, baseOuterPts, outerWallTopZ);

  let deckBoundaryPts = baseOuterPts;
  let safeCutoutPts = createRoundedRectCentered(
    bodyCenterX,
    bodyCenterY,
    Math.max(10, width - 2 * config.wallThickness),
    Math.max(10, length - 2 * config.wallThickness),
    Math.max(0.5, CORNER_RADIUS - config.wallThickness),
    8
  );

  if (lipProfile.enabled) {
    const zLipTop = topDeckZ + lipProfile.height;
    const zMidBot = topDeckZ + lipProfile.lowerBevelH;
    const zMidTop = zMidBot + lipProfile.verticalWallH;

    const makeInsetRing = (inset: number) =>
      createRoundedRectCentered(
        bodyCenterX,
        bodyCenterY,
        Math.max(4, width - inset * 2),
        Math.max(4, length - inset * 2),
        Math.max(0.5, CORNER_RADIUS - inset),
        8
      );

    const lipTopLand = makeInsetRing(lipProfile.topInset);
    const lipMidTop = makeInsetRing(lipProfile.midInset);
    const lipMidBot = lipMidTop;
    const lipInnerBot = makeInsetRing(lipProfile.bottomInset);

    pushRingStrip(baseOuterPts, zLipTop, lipTopLand, zLipTop);
    pushRingStrip(lipTopLand, zLipTop, lipMidTop, zMidTop);
    if (lipProfile.verticalWallH > 1e-4) {
      pushRingStrip(lipMidTop, zMidTop, lipMidBot, zMidBot);
    }
    pushRingStrip(lipMidBot, zMidBot, lipInnerBot, topDeckZ);

    deckBoundaryPts = lipInnerBot;
    safeCutoutPts = makeInsetRing(lipProfile.bottomInset + 0.6);
  }

  // 3. Top Deck, 45° Model Cutout Chamfer, Tool Cavities, Finger Slots & Text Relief
  const cutoutTris = buildTopDeckAndCutouts({
    topDeckBoundary: deckBoundaryPts,
    safeCutoutBoundary: safeCutoutPts,
    tools,
    topDeckZ,
    chamferSize: chamfer,
    textLabel: config.textLabel,
    shiftX,
    shiftY,
  });

  for (const tri of cutoutTris) {
    triangles.push(tri);
  }

  return triangles;
}

/**
 * Converts an array of MeshTriangles into a Three.js BufferGeometry
 * supporting flat normals or per-vertex smooth normals.
 */
export function trianglesToBufferGeometry(triangles: MeshTriangle[]): THREE.BufferGeometry {
  const vertices = new Float32Array(triangles.length * 9);
  const normals = new Float32Array(triangles.length * 9);

  for (let i = 0; i < triangles.length; i++) {
    const tri = triangles[i];
    const base = i * 9;
    vertices[base] = tri.v1[0];
    vertices[base + 1] = tri.v1[1];
    vertices[base + 2] = tri.v1[2];
    vertices[base + 3] = tri.v2[0];
    vertices[base + 4] = tri.v2[1];
    vertices[base + 5] = tri.v2[2];
    vertices[base + 6] = tri.v3[0];
    vertices[base + 7] = tri.v3[1];
    vertices[base + 8] = tri.v3[2];

    if (tri.vertexNormals) {
      normals[base] = tri.vertexNormals[0][0];
      normals[base + 1] = tri.vertexNormals[0][1];
      normals[base + 2] = tri.vertexNormals[0][2];
      normals[base + 3] = tri.vertexNormals[1][0];
      normals[base + 4] = tri.vertexNormals[1][1];
      normals[base + 5] = tri.vertexNormals[1][2];
      normals[base + 6] = tri.vertexNormals[2][0];
      normals[base + 7] = tri.vertexNormals[2][1];
      normals[base + 8] = tri.vertexNormals[2][2];
    } else {
      let nx = 0;
      let ny = 0;
      let nz = 1;
      if (tri.normal) {
        [nx, ny, nz] = tri.normal;
      } else {
        const ax = tri.v2[0] - tri.v1[0];
        const ay = tri.v2[1] - tri.v1[1];
        const az = tri.v2[2] - tri.v1[2];
        const bx = tri.v3[0] - tri.v1[0];
        const by = tri.v3[1] - tri.v1[1];
        const bz = tri.v3[2] - tri.v1[2];
        nx = ay * bz - az * by;
        ny = az * bx - ax * bz;
        nz = ax * by - ay * bx;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
      }
      normals[base] = nx;
      normals[base + 1] = ny;
      normals[base + 2] = nz;
      normals[base + 3] = nx;
      normals[base + 4] = ny;
      normals[base + 5] = nz;
      normals[base + 6] = nx;
      normals[base + 7] = ny;
      normals[base + 8] = nz;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.computeBoundingSphere();
  return geo;
}
