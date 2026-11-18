import earcut from 'earcut';
import { BaseplateConfig, MagnetMode, Point2D } from '../types';
import { MeshTriangle } from './cutoutGeometry';
import { GRID_UNIT, V5_MAGNET_DIAMETER, V5_SCREW_DIAMETER } from './geometry';

// Gridfinity Baseplate v5 Specification (matching reference engineering drawing)
export const BASEPLATE_PITCH = GRID_UNIT; // 42.0mm per cell
export const BASEPLATE_OUTER_CORNER_RADIUS = 4.0; // 8.0Ø outer corners
export const BASEPLATE_LOWER_BEVEL = 0.7; // 45° bottom inner bevel
export const BASEPLATE_VERTICAL_WALL = 1.8; // vertical step wall
export const BASEPLATE_UPPER_BEVEL = 2.15; // 45° upper funnel bevel
export const BASEPLATE_PROFILE_HEIGHT =
  BASEPLATE_LOWER_BEVEL + BASEPLATE_VERTICAL_WALL + BASEPLATE_UPPER_BEVEL; // 4.65mm (~5mm)

// Socket pocket cross-section inside each 42x42mm cell (preserves 0.25mm clearance to 41.5/37.2/35.6 bin feet)
export const BASEPLATE_TOP_OPENING = 41.8; // leaves crisp 0.20mm divider ridge between adjacent cells
export const BASEPLATE_MID_OPENING = BASEPLATE_TOP_OPENING - 2 * BASEPLATE_UPPER_BEVEL; // 37.50mm
export const BASEPLATE_BOT_OPENING = BASEPLATE_MID_OPENING - 2 * BASEPLATE_LOWER_BEVEL; // 36.10mm (0.25mm/side clear vs 35.6mm bin foot)

export const BASEPLATE_TOP_CORNER_RADIUS = 3.9;
export const BASEPLATE_MID_CORNER_RADIUS = BASEPLATE_TOP_CORNER_RADIUS - BASEPLATE_UPPER_BEVEL; // 1.75mm
export const BASEPLATE_BOT_CORNER_RADIUS = BASEPLATE_MID_CORNER_RADIUS - BASEPLATE_LOWER_BEVEL; // 1.05mm

// Pad thicknesses beneath the 4.65mm stepped socket profile
export const BASEPLATE_SOLID_PLAIN_PAD = 1.2; // solid baseplate without magnets/screws
export const BASEPLATE_MAGNET_PAD = 2.8; // houses 2.4mm deep magnet pockets with 0.4mm top floor

// Magnet corner offset relative to each 42mm cell center:
// Bin magnet offset = 13.0mm from unit center. Baseplate unit center aligns concentrically!
export const BASEPLATE_MAGNET_CELL_OFFSET = 13.0; // 8.0mm from 42mm cell outer border

export function createDefaultBaseplateConfig(): BaseplateConfig {
  return {
    gridX: 4,
    gridY: 2,
    style: 'skeleton',
    magnetMode: 'corners',
    hasScrews: false,
    magnetDiameter: V5_MAGNET_DIAMETER,
    magnetDepth: 2.4,
    screwDiameter: V5_SCREW_DIAMETER,
  };
}

export function getBaseplateDimensions(config: BaseplateConfig) {
  const width = config.gridX * BASEPLATE_PITCH;
  const length = config.gridY * BASEPLATE_PITCH;
  const hasMagnets = config.magnetMode !== 'none';
  const hasHardware = hasMagnets || config.hasScrews;
  const safeDepth = Math.max(0.8, Math.min(5.0, config.magnetDepth || 2.4));
  const padHeight = hasMagnets
    ? Math.max(1.8, Math.round((safeDepth + 0.4) * 1000) / 1000)
    : config.hasScrews
    ? BASEPLATE_MAGNET_PAD
    : config.style === 'solid'
    ? BASEPLATE_SOLID_PLAIN_PAD
    : 0;
  const profileHeight = BASEPLATE_PROFILE_HEIGHT;
  const totalHeight = Math.round((padHeight + profileHeight) * 1000) / 1000;

  const magnetCount =
    config.magnetMode === 'none'
      ? 0
      : config.magnetMode === 'corners'
      ? 4
      : config.gridX * config.gridY * 4;

  const holeCount =
    hasHardware
      ? config.magnetMode === 'corners' && !config.hasScrews
        ? 4
        : config.magnetMode === 'corners'
        ? 4
        : config.gridX * config.gridY * 4
      : 0;

  return {
    width,
    length,
    padHeight,
    profileHeight,
    totalHeight,
    magnetCount,
    holeCount,
  };
}

/**
 * Returns magnet / screw hole center coordinates in [0..width, 0..length] space (or centered).
 * Aligned 1:1 concentrically with Gridfinity bin foot magnets (+0.25mm offset baked into 42mm pitch).
 */
export function getBaseplateHardwarePositions(
  gridX: number,
  gridY: number,
  mode: MagnetMode,
  centered: boolean = false
): Point2D[] {
  if (mode === 'none') return [];
  const width = gridX * BASEPLATE_PITCH;
  const length = gridY * BASEPLATE_PITCH;
  const sx = centered ? -width / 2 : 0;
  const sy = centered ? -length / 2 : 0;

  if (mode === 'corners') {
    const inset = BASEPLATE_PITCH / 2 - BASEPLATE_MAGNET_CELL_OFFSET; // 21 - 13 = 8.0mm
    return [
      { x: inset + sx, y: inset + sy },
      { x: width - inset + sx, y: inset + sy },
      { x: inset + sx, y: length - inset + sy },
      { x: width - inset + sx, y: length - inset + sy },
    ];
  }

  const pts: Point2D[] = [];
  for (let row = 0; row < gridY; row++) {
    for (let col = 0; col < gridX; col++) {
      const cx = (col + 0.5) * BASEPLATE_PITCH + sx;
      const cy = (row + 0.5) * BASEPLATE_PITCH + sy;
      pts.push(
        { x: cx - BASEPLATE_MAGNET_CELL_OFFSET, y: cy - BASEPLATE_MAGNET_CELL_OFFSET },
        { x: cx + BASEPLATE_MAGNET_CELL_OFFSET, y: cy - BASEPLATE_MAGNET_CELL_OFFSET },
        { x: cx - BASEPLATE_MAGNET_CELL_OFFSET, y: cy + BASEPLATE_MAGNET_CELL_OFFSET },
        { x: cx + BASEPLATE_MAGNET_CELL_OFFSET, y: cy + BASEPLATE_MAGNET_CELL_OFFSET }
      );
    }
  }
  return pts;
}

/**
 * Creates clockwise (CW) rounded rectangle points around (cx, cy).
 */
function createRoundedRectCW(
  cx: number,
  cy: number,
  w: number,
  l: number,
  radius: number,
  segments: number = 6
): Point2D[] {
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
}

/**
 * Creates a skeleton cell inner opening ring (strictly inside BASEPLATE_BOT_OPENING)
 * with smooth inward rounded corner bosses ONLY where corner magnets/screws exist.
 * Returned in clockwise (CW) order around (cx, cy).
 */
function createSkeletonOpeningRingCW(
  cx: number,
  cy: number,
  cornerFlags: { tr: boolean; br: boolean; bl: boolean; tl: boolean },
  cornerSegs: number = 8
): Point2D[] {
  const H = BASEPLATE_BOT_OPENING / 2 - 0.3; // 17.75mm -> strictly 0.3mm inside 18.05 socket wall
  const M = BASEPLATE_MAGNET_CELL_OFFSET; // 13.0mm
  const bossR = H - M; // 4.75mm (leaves 1.50mm solid wall around 6.5mm magnets!)
  const plainR = 0.85;

  const pts: Point2D[] = [];
  const pushUnique = (x: number, y: number) => {
    const prev = pts[pts.length - 1];
    if (!prev || Math.hypot(x - prev.x, y - prev.y) > 1e-4) {
      pts.push({ x, y });
    }
  };

  // Sweep CW around cell center: TR -> BR -> BL -> TL
  // 1. Top-Right corner (+H, +H)
  if (cornerFlags.tr) {
    // Tangent at top edge (M, H) -> arc around (M, M) from +90° down to 0°?
    // Wait: magnet lobe sits INSIDE corner, so arc wraps the INNER side of (M, M):
    // From (cx + M, cy + H) [90°] -> (cx + M - bossR, cy + M) [180°] -> (cx + M, cy + M - bossR) [270°] -> (cx + H, cy + M) [360°]
    for (let i = 0; i <= cornerSegs * 2; i++) {
      const a = Math.PI / 2 + (i / (cornerSegs * 2)) * (1.5 * Math.PI);
      pushUnique(cx + M + bossR * Math.cos(a), cy + M + bossR * Math.sin(a));
    }
  } else {
    for (let i = 0; i <= 4; i++) {
      const a = Math.PI / 2 - (i / 4) * (Math.PI / 2);
      pushUnique(cx + (H - plainR) + plainR * Math.cos(a), cy + (H - plainR) + plainR * Math.sin(a));
    }
  }

  // 2. Bottom-Right corner (+H, -H)
  if (cornerFlags.br) {
    // From (cx + H, cy - M) [0°] -> (cx + M, cy - M + bossR) [90°] -> (cx + M - bossR, cy - M) [180°] -> (cx + M, cy - H) [270°]
    for (let i = 0; i <= cornerSegs * 2; i++) {
      const a = (i / (cornerSegs * 2)) * (1.5 * Math.PI);
      pushUnique(cx + M + bossR * Math.cos(a), cy - M + bossR * Math.sin(a));
    }
  } else {
    for (let i = 0; i <= 4; i++) {
      const a = -(i / 4) * (Math.PI / 2);
      pushUnique(cx + (H - plainR) + plainR * Math.cos(a), cy - (H - plainR) + plainR * Math.sin(a));
    }
  }

  // 3. Bottom-Left corner (-H, -H)
  if (cornerFlags.bl) {
    // From (cx - M, cy - H) [270°] -> [360°] -> [90°] -> (cx - H, cy - M) [180°]
    for (let i = 0; i <= cornerSegs * 2; i++) {
      const a = (1.5 * Math.PI) + (i / (cornerSegs * 2)) * (1.5 * Math.PI);
      pushUnique(cx - M + bossR * Math.cos(a), cy - M + bossR * Math.sin(a));
    }
  } else {
    for (let i = 0; i <= 4; i++) {
      const a = -Math.PI / 2 - (i / 4) * (Math.PI / 2);
      pushUnique(cx - (H - plainR) + plainR * Math.cos(a), cy - (H - plainR) + plainR * Math.sin(a));
    }
  }

  // 4. Top-Left corner (-H, +H)
  if (cornerFlags.tl) {
    // From (cx - H, cy + M) [180°] -> [270°] -> [360°] -> (cx - M, cy + H) [90°]
    for (let i = 0; i <= cornerSegs * 2; i++) {
      const a = Math.PI + (i / (cornerSegs * 2)) * (1.5 * Math.PI);
      pushUnique(cx - M + bossR * Math.cos(a), cy + M + bossR * Math.sin(a));
    }
  } else {
    for (let i = 0; i <= 4; i++) {
      const a = -Math.PI - (i / 4) * (Math.PI / 2);
      pushUnique(cx - (H - plainR) + plainR * Math.cos(a), cy + (H - plainR) + plainR * Math.sin(a));
    }
  }

  if (pts.length > 3 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1e-4) {
    pts.pop();
  }
  return pts;
}

/**
 * Emits a horizontal flat triangle while guaranteeing exact outward Z normal orientation.
 */
function pushOrientedFlatTri(
  triangles: MeshTriangle[],
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  z: number,
  targetNz: 1 | -1
) {
  const crossZ = (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
  if (Math.abs(crossZ) < 1e-8) return;
  if (crossZ * targetNz > 0) {
    triangles.push({
      v1: [p1.x, p1.y, z],
      v2: [p2.x, p2.y, z],
      v3: [p3.x, p3.y, z],
      normal: [0, 0, targetNz],
    });
  } else {
    triangles.push({
      v1: [p1.x, p1.y, z],
      v2: [p3.x, p3.y, z],
      v3: [p2.x, p2.y, z],
      normal: [0, 0, targetNz],
    });
  }
}

function signedArea2D(pts: Point2D[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % pts.length];
    a += p1.x * p2.y - p2.x * p1.y;
  }
  return a / 2;
}

function triangulateFlatFaceWithHoles(
  triangles: MeshTriangle[],
  outerCW: Point2D[],
  holes: Point2D[][],
  z: number,
  targetNz: 1 | -1
) {
  // earcut works most reliably when outer ring is CCW (area > 0) and holes are CW (area < 0)
  const outer = signedArea2D(outerCW) < 0 ? [...outerCW].reverse() : outerCW;
  const coords: number[] = [];
  const holeIndices: number[] = [];
  for (const p of outer) coords.push(p.x, p.y);
  for (const hole of holes) {
    if (hole.length < 3) continue;
    const holeCW = signedArea2D(hole) > 0 ? [...hole].reverse() : hole;
    holeIndices.push(coords.length / 2);
    for (const p of holeCW) coords.push(p.x, p.y);
  }
  const indices = earcut(coords, holeIndices.length > 0 ? holeIndices : undefined);
  for (let i = 0; i < indices.length; i += 3) {
    const i1 = indices[i] * 2;
    const i2 = indices[i + 1] * 2;
    const i3 = indices[i + 2] * 2;
    pushOrientedFlatTri(
      triangles,
      { x: coords[i1], y: coords[i1 + 1] },
      { x: coords[i2], y: coords[i2 + 1] },
      { x: coords[i3], y: coords[i3 + 1] },
      z,
      targetNz
    );
  }
}

/**
 * Generates watertight manifold 3D triangles for a Gridfinity v5 Baseplate
 * matching exact 42mm pitch, R4.0mm (8.0Ø) corners, 4.65mm stepped socket profile,
 * Skeleton vs Solid style, and 4-Corners / Full / None magnet pockets.
 */
export function buildBaseplateTriangles(
  config: BaseplateConfig,
  options: { centered?: boolean } = {}
): MeshTriangle[] {
  const { width, length, padHeight, totalHeight } = getBaseplateDimensions(config);
  const shiftX = options.centered ? -width / 2 : 0;
  const shiftY = options.centered ? -length / 2 : 0;

  const triangles: MeshTriangle[] = [];

  const pushOuterRingStrip = (ringA: Point2D[], zA: number, ringB: Point2D[], zB: number) => {
    for (let i = 0; i < ringA.length; i++) {
      const next = (i + 1) % ringA.length;
      const a1 = ringA[i];
      const a2 = ringA[next];
      const b1 = ringB[i];
      const b2 = ringB[next];
      triangles.push({ v1: [a1.x, a1.y, zA], v2: [b2.x, b2.y, zB], v3: [a2.x, a2.y, zA] });
      triangles.push({ v1: [a1.x, a1.y, zA], v2: [b1.x, b1.y, zB], v3: [b2.x, b2.y, zB] });
    }
  };

  // For inner cavity walls wound CW when looking down from +Z:
  // Reversing strip order guarantees normals point INWARD into the cavity!
  const pushInnerRingStrip = (ringLow: Point2D[], zLow: number, ringHigh: Point2D[], zHigh: number) => {
    for (let i = 0; i < ringLow.length; i++) {
      const next = (i + 1) % ringLow.length;
      const a1 = ringLow[i];
      const a2 = ringLow[next];
      const b1 = ringHigh[i];
      const b2 = ringHigh[next];
      triangles.push({ v1: [a1.x, a1.y, zLow], v2: [a2.x, a2.y, zLow], v3: [b2.x, b2.y, zHigh] });
      triangles.push({ v1: [a1.x, a1.y, zLow], v2: [b2.x, b2.y, zHigh], v3: [b1.x, b1.y, zHigh] });
    }
  };

  const zBot = 0;
  const zSocketBot = padHeight;
  const zSocketMid1 = zSocketBot + BASEPLATE_LOWER_BEVEL;
  const zSocketMid2 = zSocketMid1 + BASEPLATE_VERTICAL_WALL;
  const zTop = totalHeight;

  const rOuterCorner = Math.min(BASEPLATE_OUTER_CORNER_RADIUS, BASEPLATE_PITCH / 2 - 1);

  // Build exact cell outer border ring CCW for cell (col, row), rounding ONLY corners on overall outer boundary
  const createCellOuterRingCCW = (col: number, row: number, segsPerCorner: number = 8): Point2D[] => {
    const x0 = col * BASEPLATE_PITCH + shiftX;
    const x1 = (col + 1) * BASEPLATE_PITCH + shiftX;
    const y0 = row * BASEPLATE_PITCH + shiftY;
    const y1 = (row + 1) * BASEPLATE_PITCH + shiftY;

    const roundBL = col === 0 && row === 0;
    const roundBR = col === config.gridX - 1 && row === 0;
    const roundTR = col === config.gridX - 1 && row === config.gridY - 1;
    const roundTL = col === 0 && row === config.gridY - 1;

    const pts: Point2D[] = [];
    const pushPt = (x: number, y: number) => {
      const prev = pts[pts.length - 1];
      if (!prev || Math.hypot(x - prev.x, y - prev.y) > 1e-4) pts.push({ x, y });
    };

    // Bottom edge (left -> right)
    pushPt(roundBL ? x0 + rOuterCorner : x0, y0);
    pushPt(roundBR ? x1 - rOuterCorner : x1, y0);

    // Bottom-right corner arc (y0 -> x1)
    if (roundBR) {
      for (let i = 1; i <= segsPerCorner; i++) {
        const a = -Math.PI / 2 + (i / segsPerCorner) * (Math.PI / 2);
        pushPt(x1 - rOuterCorner + rOuterCorner * Math.cos(a), y0 + rOuterCorner + rOuterCorner * Math.sin(a));
      }
    }

    // Right edge (bottom -> top)
    pushPt(x1, roundTR ? y1 - rOuterCorner : y1);

    // Top-right corner arc (x1 -> y1)
    if (roundTR) {
      for (let i = 1; i <= segsPerCorner; i++) {
        const a = (i / segsPerCorner) * (Math.PI / 2);
        pushPt(x1 - rOuterCorner + rOuterCorner * Math.cos(a), y1 - rOuterCorner + rOuterCorner * Math.sin(a));
      }
    }

    // Top edge (right -> left)
    pushPt(roundTL ? x0 + rOuterCorner : x0, y1);

    // Top-left corner arc (y1 -> x0)
    if (roundTL) {
      for (let i = 1; i <= segsPerCorner; i++) {
        const a = Math.PI / 2 + (i / segsPerCorner) * (Math.PI / 2);
        pushPt(x0 + rOuterCorner + rOuterCorner * Math.cos(a), y1 - rOuterCorner + rOuterCorner * Math.sin(a));
      }
    }

    // Left edge (top -> bottom)
    pushPt(x0, roundBL ? y0 + rOuterCorner : y0);

    // Bottom-left corner arc (x0 -> y0)
    if (roundBL) {
      for (let i = 1; i <= segsPerCorner; i++) {
        const a = Math.PI + (i / segsPerCorner) * (Math.PI / 2);
        pushPt(x0 + rOuterCorner + rOuterCorner * Math.cos(a), y0 + rOuterCorner + rOuterCorner * Math.sin(a));
      }
    }

    if (pts.length > 3 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1e-4) {
      pts.pop();
    }
    return pts;
  };

  // Overall outer perimeter CW matching the exact union vertices of createCellOuterRingCCW
  const createOuterPerimeterCW = (segsPerCorner: number = 8): Point2D[] => {
    const minX = shiftX;
    const maxX = width + shiftX;
    const minY = shiftY;
    const maxY = length + shiftY;
    const pts: Point2D[] = [];
    const pushPt = (x: number, y: number) => {
      const prev = pts[pts.length - 1];
      if (!prev || Math.hypot(x - prev.x, y - prev.y) > 1e-4) pts.push({ x, y });
    };

    // Top-right corner
    for (let i = 0; i <= segsPerCorner; i++) {
      const a = (i / segsPerCorner) * (Math.PI / 2);
      pushPt(maxX - rOuterCorner + rOuterCorner * Math.sin(a), maxY - rOuterCorner + rOuterCorner * Math.cos(a));
    }
    // Right edge (top -> bottom) intermediate grid dividers
    for (let row = config.gridY - 1; row >= 1; row--) {
      pushPt(maxX, shiftY + row * BASEPLATE_PITCH);
    }
    // Bottom-right corner
    for (let i = 0; i <= segsPerCorner; i++) {
      const a = Math.PI / 2 + (i / segsPerCorner) * (Math.PI / 2);
      pushPt(maxX - rOuterCorner + rOuterCorner * Math.sin(a), minY + rOuterCorner + rOuterCorner * Math.cos(a));
    }
    // Bottom edge (right -> left) intermediate grid dividers
    for (let col = config.gridX - 1; col >= 1; col--) {
      pushPt(shiftX + col * BASEPLATE_PITCH, minY);
    }
    // Bottom-left corner
    for (let i = 0; i <= segsPerCorner; i++) {
      const a = Math.PI + (i / segsPerCorner) * (Math.PI / 2);
      pushPt(minX + rOuterCorner + rOuterCorner * Math.sin(a), minY + rOuterCorner + rOuterCorner * Math.cos(a));
    }
    // Left edge (bottom -> top) intermediate grid dividers
    for (let row = 1; row < config.gridY; row++) {
      pushPt(minX, shiftY + row * BASEPLATE_PITCH);
    }
    // Top-left corner
    for (let i = 0; i <= segsPerCorner; i++) {
      const a = (3 * Math.PI) / 2 + (i / segsPerCorner) * (Math.PI / 2);
      pushPt(minX + rOuterCorner + rOuterCorner * Math.sin(a), maxY - rOuterCorner + rOuterCorner * Math.cos(a));
    }
    // Top edge (left -> right) intermediate grid dividers
    for (let col = 1; col < config.gridX; col++) {
      pushPt(shiftX + col * BASEPLATE_PITCH, maxY);
    }

    if (pts.length > 3 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1e-4) {
      pts.pop();
    }
    return pts;
  };

  const outerPerimeter = createOuterPerimeterCW(8);

  // 1. Exterior vertical walls (Z = 0 -> zTop)
  pushOuterRingStrip(outerPerimeter, zBot, outerPerimeter, zTop);

  // 2. Hardware hole calculations (magnets + optional M3 screw holes)
  const hasMagnets = config.magnetMode !== 'none';
  const hasHardware = hasMagnets || config.hasScrews;
  const hwMode: MagnetMode =
    config.magnetMode !== 'none' ? config.magnetMode : config.hasScrews ? 'corners' : 'none';
  const hwPositions = hasHardware
    ? getBaseplateHardwarePositions(config.gridX, config.gridY, hwMode, options.centered)
    : [];

  const safeMagnetDiameter = Math.max(
    3.0,
    Math.min(8.6, config.magnetDiameter || V5_MAGNET_DIAMETER)
  );
  const safeMagnetDepth = Math.max(0.8, Math.min(5.0, config.magnetDepth || 2.4));
  const holeRadius = hasMagnets ? safeMagnetDiameter / 2 : config.screwDiameter / 2;
  const magnetHoleDepth = Math.min(safeMagnetDepth, Math.max(0.4, padHeight - 0.35));
  const holeSegments = 16;

  const makeCircleRingCW = (px: number, py: number, rad: number): Point2D[] => {
    const pts: Point2D[] = [];
    for (let s = 0; s < holeSegments; s++) {
      const a = -(s / holeSegments) * Math.PI * 2;
      pts.push({ x: px + rad * Math.cos(a), y: py + rad * Math.sin(a) });
    }
    return pts;
  };

  const allHardwareRings = hwPositions.map((p) => makeCircleRingCW(p.x, p.y, holeRadius));

  // Emit downward magnet pockets or through-screw cylinders
  for (let k = 0; k < hwPositions.length; k++) {
    const ring = allHardwareRings[k];
    if (hasMagnets) {
      pushInnerRingStrip(ring, zBot, ring, magnetHoleDepth);
      triangulateFlatFaceWithHoles(triangles, ring, [], magnetHoleDepth, -1);
    } else if (config.hasScrews) {
      pushInnerRingStrip(ring, zBot, ring, zSocketBot);
    }
  }

  // 3. Per-cell stepped socket geometry, top rim deck, and bottom floor/skeleton (zero inter-cell earcut artifacts!)
  for (let row = 0; row < config.gridY; row++) {
    for (let col = 0; col < config.gridX; col++) {
      const cx = (col + 0.5) * BASEPLATE_PITCH + shiftX;
      const cy = (row + 0.5) * BASEPLATE_PITCH + shiftY;
      const cellOuter = createCellOuterRingCCW(col, row, 8);

      const rTop = createRoundedRectCW(
        cx,
        cy,
        BASEPLATE_TOP_OPENING,
        BASEPLATE_TOP_OPENING,
        BASEPLATE_TOP_CORNER_RADIUS,
        6
      );
      const rMid = createRoundedRectCW(
        cx,
        cy,
        BASEPLATE_MID_OPENING,
        BASEPLATE_MID_OPENING,
        BASEPLATE_MID_CORNER_RADIUS,
        6
      );
      const rBot = createRoundedRectCW(
        cx,
        cy,
        BASEPLATE_BOT_OPENING,
        BASEPLATE_BOT_OPENING,
        BASEPLATE_BOT_CORNER_RADIUS,
        6
      );

      // Stepped inner socket walls (lower 45° bevel -> vertical step -> upper 45° bevel)
      pushInnerRingStrip(rBot, zSocketBot, rMid, zSocketMid1);
      pushInnerRingStrip(rMid, zSocketMid1, rMid, zSocketMid2);
      pushInnerRingStrip(rMid, zSocketMid2, rTop, zTop);

      // Top rim deck for this cell at zTop
      triangulateFlatFaceWithHoles(triangles, cellOuter, [rTop], zTop, 1);

      // Hardware holes belonging to this cell
      const cellHwRings: Point2D[][] = [];
      for (let k = 0; k < hwPositions.length; k++) {
        const p = hwPositions[k];
        if (Math.abs(p.x - cx) < BASEPLATE_PITCH / 2 && Math.abs(p.y - cy) < BASEPLATE_PITCH / 2) {
          cellHwRings.push(allHardwareRings[k]);
        }
      }

      if (config.style === 'skeleton') {
        if (padHeight <= 1e-4) {
          // Pure open skeleton (no magnets/screws): bottom face at z=0 bridges cellOuter to rBot
          triangulateFlatFaceWithHoles(triangles, cellOuter, [rBot], zBot, -1);
        } else {
          // Skeleton with corner magnet/screw boss tabs
          const cornerFlags =
            hwMode === 'full'
              ? { tr: true, br: true, bl: true, tl: true }
              : {
                  bl: col === 0 && row === 0,
                  br: col === config.gridX - 1 && row === 0,
                  tl: col === 0 && row === config.gridY - 1,
                  tr: col === config.gridX - 1 && row === config.gridY - 1,
                };
          const opening = createSkeletonOpeningRingCW(cx, cy, cornerFlags);

          // Inner vertical wall of skeleton opening (z=0 -> z=padHeight)
          pushInnerRingStrip(opening, zBot, opening, zSocketBot);

          // Shelf ledge at z=padHeight bridging socket bottom ring (rBot) to cell skeleton opening
          const cellFloorHoles: Point2D[][] = [opening];
          if (!hasMagnets && config.hasScrews) {
            cellFloorHoles.push(...cellHwRings);
          }
          triangulateFlatFaceWithHoles(triangles, rBot, cellFloorHoles, zSocketBot, 1);

          // Bottom face of this cell at z=0
          triangulateFlatFaceWithHoles(triangles, cellOuter, [opening, ...cellHwRings], zBot, -1);
        }
      } else {
        // style === 'solid': Continuous flat bottom + solid socket floor cap at zSocketBot
        triangulateFlatFaceWithHoles(triangles, cellOuter, cellHwRings, zBot, -1);
        const cellFloorHoles = !hasMagnets && config.hasScrews ? cellHwRings : [];
        triangulateFlatFaceWithHoles(triangles, rBot, cellFloorHoles, zSocketBot, 1);
      }
    }
  }

  return triangles;
}

/**
 * Serializes triangles into a standard binary STL ArrayBuffer.
 */
export function buildBaseplateBinaryStl(triangles: MeshTriangle[]): ArrayBuffer {
  const bufferSize = 84 + triangles.length * 50;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  const header = 'Gridfinity Studio — Parametric v5 Baseplate';
  for (let i = 0; i < 80; i++) {
    view.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
  }
  view.setUint32(80, triangles.length, true);

  let offset = 84;
  for (const tri of triangles) {
    let norm = tri.normal;
    if (!norm) {
      const ax = tri.v2[0] - tri.v1[0];
      const ay = tri.v2[1] - tri.v1[1];
      const az = tri.v2[2] - tri.v1[2];
      const bx = tri.v3[0] - tri.v1[0];
      const by = tri.v3[1] - tri.v1[1];
      const bz = tri.v3[2] - tri.v1[2];
      const nx = ay * bz - az * by;
      const ny = az * bx - ax * bz;
      const nz = ax * by - ay * bx;
      const len = Math.hypot(nx, ny, nz) || 1;
      norm = [nx / len, ny / len, nz / len];
    }

    view.setFloat32(offset, norm[0], true);
    view.setFloat32(offset + 4, norm[1], true);
    view.setFloat32(offset + 8, norm[2], true);

    view.setFloat32(offset + 12, tri.v1[0], true);
    view.setFloat32(offset + 16, tri.v1[1], true);
    view.setFloat32(offset + 20, tri.v1[2], true);

    view.setFloat32(offset + 24, tri.v2[0], true);
    view.setFloat32(offset + 28, tri.v2[1], true);
    view.setFloat32(offset + 32, tri.v2[2], true);

    view.setFloat32(offset + 36, tri.v3[0], true);
    view.setFloat32(offset + 40, tri.v3[1], true);
    view.setFloat32(offset + 44, tri.v3[2], true);

    view.setUint16(offset + 48, 0, true);
    offset += 50;
  }

  return buffer;
}

export function generateBaseplateStl(config: BaseplateConfig): ArrayBuffer {
  const triangles = buildBaseplateTriangles(config, { centered: false });
  return buildBaseplateBinaryStl(triangles);
}

export function downloadBaseplateStl(config: BaseplateConfig, fileName?: string) {
  const stlData = generateBaseplateStl(config);
  const blob = new Blob([stlData], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download =
    fileName ||
    `Gridfinity_Baseplate_${config.gridX}x${config.gridY}U_${config.style}_${config.magnetMode}.stl`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
