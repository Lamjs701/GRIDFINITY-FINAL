import { Point2D } from '../types';

/**
 * Removes near-duplicate consecutive vertices from a closed contour.
 */
function cleanClosedPoints(pts: Point2D[], minDist: number = 0.05): Point2D[] {
  if (pts.length < 3) return pts;
  const out: Point2D[] = [];
  for (const p of pts) {
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) >= minDist) {
      out.push({ x: p.x, y: p.y });
    }
  }
  while (
    out.length > 3 &&
    Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) < minDist
  ) {
    out.pop();
  }
  return out;
}

/**
 * Zero-shrinkage Taubin (lambda / mu) low-pass smoothing on short noisy segments.
 * Relaxes staircase / pixel-trace jitter without shrinking cavity dimensions
 * or bowing long straight edges.
 */
function taubinRelaxShortSegments(pts: Point2D[], passes: number, shortEdgeThresholdMm: number): Point2D[] {
  let curr = pts.map((p) => ({ x: p.x, y: p.y }));
  const n = curr.length;
  if (n < 5 || passes <= 0) return curr;

  const lambda = 0.45;
  const mu = -0.47;

  const stepPass = (input: Point2D[], weight: number): Point2D[] => {
    return input.map((p, i) => {
      const prev = input[(i - 1 + n) % n];
      const next = input[(i + 1) % n];
      const dPrev = Math.hypot(p.x - prev.x, p.y - prev.y);
      const dNext = Math.hypot(next.x - p.x, next.y - p.y);
      const maxAdj = Math.max(dPrev, dNext);

      // Leave vertices anchored to long straight flanks undisturbed
      if (maxAdj > shortEdgeThresholdMm) {
        return p;
      }

      const midX = 0.5 * (prev.x + next.x);
      const midY = 0.5 * (prev.y + next.y);
      return {
        x: p.x + weight * (midX - p.x),
        y: p.y + weight * (midY - p.y),
      };
    });
  };

  for (let iter = 0; iter < passes; iter++) {
    curr = stepPass(curr, lambda);
    curr = stepPass(curr, mu);
  }

  return curr;
}

/**
 * Inserts tangent-anchor points near ends of long straight edges so a periodic
 * C2 cubic B-spline preserves crisp flat flanks while smoothly filleting corners.
 */
function insertStraightEdgeAnchors(pts: Point2D[], anchorDistMm: number): Point2D[] {
  const n = pts.length;
  if (n < 3 || anchorDistMm <= 0.1) return pts;

  const out: Point2D[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    out.push(a);

    if (len > anchorDistMm * 2.2) {
      const t1 = anchorDistMm / len;
      const t2 = 1 - t1;
      out.push({
        x: a.x + (b.x - a.x) * t1,
        y: a.y + (b.y - a.y) * t1,
      });
      if (t2 - t1 > 0.08) {
        const midCount = Math.max(1, Math.min(4, Math.floor((len - 2 * anchorDistMm) / Math.max(8, anchorDistMm * 2))));
        for (let m = 1; m <= midCount; m++) {
          const tm = t1 + (t2 - t1) * (m / (midCount + 1));
          out.push({
            x: a.x + (b.x - a.x) * tm,
            y: a.y + (b.y - a.y) * tm,
          });
        }
      }
      out.push({
        x: a.x + (b.x - a.x) * t2,
        y: a.y + (b.y - a.y) * t2,
      });
    }
  }
  return out;
}

/**
 * Evaluates a closed C2-continuous Uniform Cubic B-Spline through control points.
 */
function evaluateClosedCubicBSpline(ctrl: Point2D[], targetSegmentMm: number): Point2D[] {
  const n = ctrl.length;
  if (n < 3) return ctrl;

  const out: Point2D[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n];
    const p1 = ctrl[i];
    const p2 = ctrl[(i + 1) % n];
    const p3 = ctrl[(i + 2) % n];

    // Estimate curvature / chord length to pick adaptive subdivision steps
    const chord = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const v1x = p1.x - p0.x;
    const v1y = p1.y - p0.y;
    const v2x = p2.x - p1.x;
    const v2y = p2.y - p1.y;
    const v3x = p3.x - p2.x;
    const v3y = p3.y - p2.y;
    const l1 = Math.hypot(v1x, v1y) || 1;
    const l2 = chord || 1;
    const l3 = Math.hypot(v3x, v3y) || 1;

    const dotA = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)));
    const dotB = Math.max(-1, Math.min(1, (v2x * v3x + v2y * v3y) / (l2 * l3)));
    const angleA = (Math.acos(dotA) * 180) / Math.PI;
    const angleB = (Math.acos(dotB) * 180) / Math.PI;
    const maxBendDeg = Math.max(angleA, angleB);

    const steps =
      maxBendDeg < 3.0
        ? 1
        : Math.max(3, Math.min(14, Math.max(Math.ceil(chord / targetSegmentMm), Math.ceil(maxBendDeg / 9))));

    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const w0 = (-t3 + 3 * t2 - 3 * t + 1) / 6;
      const w1 = (3 * t3 - 6 * t2 + 4) / 6;
      const w2 = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6;
      const w3 = t3 / 6;

      out.push({
        x: Math.round((w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x) * 1000) / 1000,
        y: Math.round((w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y) * 1000) / 1000,
      });
    }
  }

  return out;
}

/**
 * Removes intermediate collinear points on dead-straight segments while keeping curved tangent points intact.
 */
function pruneCollinearPoints(pts: Point2D[], angleTolDeg: number = 0.8): Point2D[] {
  const n = pts.length;
  if (n <= 4) return pts;
  const minDot = Math.cos((angleTolDeg * Math.PI) / 180);
  const out: Point2D[] = [];

  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];

    const ax = curr.x - prev.x;
    const ay = curr.y - prev.y;
    const bx = next.x - curr.x;
    const by = next.y - curr.y;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 1e-4 || lb < 1e-4) continue;

    const dot = (ax * bx + ay * by) / (la * lb);
    // Keep vertex unless adjacent segments are collinear within tight tolerance AND neither segment is tiny curve arc
    if (dot < minDot || Math.min(la, lb) < 0.8) {
      out.push(curr);
    }
  }

  return out.length >= 3 ? out : pts;
}

/**
 * Smooths a closed 2D tool contour into a tangent-continuous (G1/C2) curve
 * without jagged facets or shrinkage.
 *
 * @param points Closed 2D polygon vertices in mm
 * @param smoothnessPct 0 (off) to 100 (maximum tangent smoothing)
 */
export function smoothContourTangent(points: Point2D[], smoothnessPct: number): Point2D[] {
  if (!points || points.length < 3 || smoothnessPct <= 0) {
    return points;
  }

  const s = Math.max(0, Math.min(1, smoothnessPct / 100));
  const cleaned = cleanClosedPoints(points, 0.08);
  if (cleaned.length < 3) return points;

  // 1. Zero-shrinkage Taubin pass removes pixel-staircase jaggedness on short segments
  const taubinPasses = Math.max(1, Math.round(1 + s * 3));
  const relaxed = taubinRelaxShortSegments(cleaned, taubinPasses, 7.5 + s * 6.5);

  // 2. Preserve flat straight flanks while giving corners controllable tangent fillet span
  const anchorSpanMm = 1.2 + s * 5.2;
  const anchored = insertStraightEdgeAnchors(relaxed, anchorSpanMm);

  // 3. Closed C2 Cubic B-Spline tangent curve generation
  const targetSegMm = Math.max(0.9, 2.0 - s * 0.9);
  const splinePts = evaluateClosedCubicBSpline(anchored, targetSegMm);

  // 4. Clean micro-segments & redundant straight-line intermediate vertices
  const deduped = cleanClosedPoints(splinePts, 0.12);
  const finalPts = pruneCollinearPoints(deduped, 0.6);
  return finalPts.length >= 3 ? finalPts : cleaned;
}

/**
 * Computes maximum exterior turning angle (degrees) across all vertices in a closed polygon.
 * Lower max turning angle indicates smoother tangent continuity.
 */
export function computeMaxTurningAngleDeg(points: Point2D[]): number {
  const n = points.length;
  if (n < 3) return 0;
  let maxDeg = 0;

  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];
    const ax = curr.x - prev.x;
    const ay = curr.y - prev.y;
    const bx = next.x - curr.x;
    const by = next.y - curr.y;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 1e-6 || lb < 1e-6) continue;
    const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
    const deg = (Math.acos(cos) * 180) / Math.PI;
    if (deg > maxDeg) maxDeg = deg;
  }

  return Math.round(maxDeg * 100) / 100;
}

/**
 * Returns the effective contour for a ToolDef, applying tangent curve smoothing if enabled.
 */
export function getEffectiveToolContour(tool: {
  contour: Point2D[];
  curveSmoothing?: number;
}): Point2D[] {
  const smoothing = tool.curveSmoothing ?? 0;
  if (smoothing <= 0 || tool.contour.length < 3) {
    return tool.contour;
  }
  return smoothContourTangent(tool.contour, smoothing);
}
