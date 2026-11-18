import { Point2D, ToolDef, PlacedTool } from '../types';
import { getToolBounds } from './geometry';

export type SampleA4PresetId = 'wrench' | 'caliper' | 'driver';
export type ParametricPresetId = 'pill-slot' | 'utility-tray' | 'hex-bit-strip' | 'sd-usb-rack';

export interface SampleA4PresetMeta {
  id: SampleA4PresetId;
  name: string;
  category: string;
  subtitle: string;
  defaultDepthMm: number;
}

export const SAMPLE_A4_PRESETS: SampleA4PresetMeta[] = [
  {
    id: 'wrench',
    name: '10mm Combination Wrench',
    category: 'Hand Tools',
    subtitle: '132 × 28 mm · Skewed A4 scan',
    defaultDepthMm: 10,
  },
  {
    id: 'caliper',
    name: 'Digital Vernier Caliper',
    category: 'Metrology',
    subtitle: '164 × 58 mm · Precision jaws',
    defaultDepthMm: 14,
  },
  {
    id: 'driver',
    name: 'Precision Hex Driver',
    category: 'Drivers',
    subtitle: '138 × 22 mm · Knurled handle',
    defaultDepthMm: 16,
  },
];

function makeRoundedRectContour(w: number, h: number, r: number, segs: number = 6): Point2D[] {
  const pts: Point2D[] = [];
  const hw = w / 2;
  const hh = h / 2;
  const rad = Math.min(r, hw * 0.9, hh * 0.9);
  const corners = [
    { cx: hw - rad, cy: -hh + rad, start: -Math.PI / 2 },
    { cx: hw - rad, cy: hh - rad, start: 0 },
    { cx: -hw + rad, cy: hh - rad, start: Math.PI / 2 },
    { cx: -hw + rad, cy: -hh + rad, start: Math.PI },
  ];
  for (const c of corners) {
    for (let i = 0; i <= segs; i++) {
      const a = c.start + (i / segs) * (Math.PI / 2);
      pts.push({
        x: Math.round((c.cx + rad * Math.cos(a)) * 10) / 10,
        y: Math.round((c.cy + rad * Math.sin(a)) * 10) / 10,
      });
    }
  }
  return pts;
}

/**
 * Generates clean parametric tool cutouts that can be dropped directly onto the Gridfinity bin.
 */
export function createParametricPresetTool(
  presetId: ParametricPresetId,
  centerX: number,
  centerY: number
): PlacedTool {
  const ts = Date.now();

  if (presetId === 'pill-slot') {
    const tool: ToolDef = {
      id: `pill-slot-${ts}`,
      name: 'Pill Slot Cutout',
      category: 'Custom Slot',
      contour: [],
      depth: 12,
      clearance: 0.4,
      fingerPockets: [
        {
          id: `fp-${ts}`,
          x: 0,
          y: 0,
          width: 20,
          length: 42,
          depth: 12,
          rotation: 0,
          cornerRadius: 10,
          slopeAngle: 30,
        },
      ],
    };
    return {
      instanceId: `inst-pill-${ts}`,
      toolId: tool.id,
      tool,
      x: centerX,
      y: centerY,
      rotation: 0,
      fingerPockets: [...tool.fingerPockets],
    };
  }

  if (presetId === 'utility-tray') {
    const tool: ToolDef = {
      id: `tray-${ts}`,
      name: 'Utility Pocket Tray',
      category: 'Hardware Tray',
      contour: makeRoundedRectContour(68, 32, 6),
      depth: 15,
      clearance: 0.4,
      fingerPockets: [
        {
          id: `fp-tray-${ts}`,
          x: 0,
          y: 0,
          width: 18,
          length: 28,
          depth: 17,
          rotation: 90,
          cornerRadius: 9,
          slopeAngle: 30,
        },
      ],
    };
    return {
      instanceId: `inst-tray-${ts}`,
      toolId: tool.id,
      tool,
      x: centerX,
      y: centerY,
      rotation: 0,
      fingerPockets: [...tool.fingerPockets],
    };
  }

  if (presetId === 'hex-bit-strip') {
    // Stepped 6-bit bar silhouette
    const contour: Point2D[] = [
      { x: -46, y: -11 },
      { x: 46, y: -11 },
      { x: 48, y: -8 },
      { x: 48, y: 8 },
      { x: 46, y: 11 },
      { x: -46, y: 11 },
      { x: -48, y: 8 },
      { x: -48, y: -8 },
    ];
    const tool: ToolDef = {
      id: `hex-strip-${ts}`,
      name: '1/4" Hex Bit Organizer',
      category: 'Bits & Drivers',
      contour,
      depth: 14,
      clearance: 0.4,
      fingerPockets: [
        {
          id: `fp-hex-${ts}`,
          x: 0,
          y: 0,
          width: 16,
          length: 26,
          depth: 16,
          rotation: 90,
          cornerRadius: 8,
          slopeAngle: 30,
        },
      ],
    };
    return {
      instanceId: `inst-hex-${ts}`,
      toolId: tool.id,
      tool,
      x: centerX,
      y: centerY,
      rotation: 0,
      fingerPockets: [...tool.fingerPockets],
    };
  }

  // sd-usb-rack
  const tool: ToolDef = {
    id: `sd-usb-${ts}`,
    name: 'SD / USB Drive Dock',
    category: 'Media Storage',
    contour: makeRoundedRectContour(34, 24, 3),
    depth: 12,
    clearance: 0.5,
    fingerPockets: [],
  };
  return {
    instanceId: `inst-sd-${ts}`,
    toolId: tool.id,
    tool,
    x: centerX,
    y: centerY,
    rotation: 0,
    fingerPockets: [],
  };
}

/**
 * Duplicates an existing PlacedTool slightly offset so it remains clearly visible.
 */
export function duplicatePlacedTool(source: PlacedTool, binWidth: number, binLength: number): PlacedTool {
  const ts = Date.now();
  const bounds = getToolBounds(source);
  const nextY = source.y + Math.min(24, bounds.height * 0.4 + 8);
  const clampedY = nextY < binLength - 12 ? nextY : Math.max(12, source.y - 16);
  const clampedX = Math.min(binWidth - 12, Math.max(12, source.x + 8));

  return {
    ...source,
    instanceId: `inst-dup-${ts}`,
    toolId: `${source.toolId}-copy-${ts}`,
    x: Math.round(clampedX * 10) / 10,
    y: Math.round(clampedY * 10) / 10,
    fingerPockets: source.fingerPockets.map((fp, idx) => ({
      ...fp,
      id: `fp-dup-${ts}-${idx}`,
    })),
  };
}

/**
 * Browser-only: Renders a realistic slightly-skewed A4 paper photo on a dark workbench
 * containing a crisp tool silhouette so users can run the full A4 homography & contour
 * extraction pipeline in 1 click without needing to upload a photo first.
 */
export function generateSampleA4PhotoDataUrl(presetId: SampleA4PresetId): string {
  const W = 900;
  const H = 660;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Dark slate workbench background with subtle wood/mat grain
  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0, '#1e2430');
  bgGrad.addColorStop(1, '#12161f');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 30) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y < H; y += 30) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  // Slightly skewed white A4 landscape quad (ratio ~ 297:210 = 1.414)
  // Corners: TL, TR, BR, BL
  const quad = [
    { x: 118, y: 108 },
    { x: 778, y: 92 },
    { x: 806, y: 562 },
    { x: 96, y: 546 },
  ];

  // Drop shadow under A4 sheet
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.moveTo(quad[0].x + 8, quad[0].y + 10);
  ctx.lineTo(quad[1].x + 8, quad[1].y + 10);
  ctx.lineTo(quad[2].x + 8, quad[2].y + 10);
  ctx.lineTo(quad[3].x + 8, quad[3].y + 10);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Crisp bright A4 paper sheet
  const paperGrad = ctx.createLinearGradient(100, 90, 800, 560);
  paperGrad.addColorStop(0, '#f8fafc');
  paperGrad.addColorStop(1, '#eef2f6');
  ctx.fillStyle = paperGrad;
  ctx.beginPath();
  ctx.moveTo(quad[0].x, quad[0].y);
  ctx.lineTo(quad[1].x, quad[1].y);
  ctx.lineTo(quad[2].x, quad[2].y);
  ctx.lineTo(quad[3].x, quad[3].y);
  ctx.closePath();
  ctx.fill();

  // Draw the tool centered inside the A4 sheet with dark high-contrast silhouette
  const cx = 450;
  const cy = 328;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.04); // slight natural hand placement angle

  ctx.fillStyle = '#1e293b';
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 2;

  if (presetId === 'wrench') {
    // 10mm Combination Wrench (~280px long = ~130mm)
    // Shaft
    ctx.beginPath();
    ctx.roundRect(-105, -13, 210, 26, 6);
    ctx.fill();

    // Left open-end jaw
    ctx.beginPath();
    ctx.arc(-120, 0, 32, 0.45, Math.PI * 2 - 0.45);
    ctx.lineTo(-104, -12);
    ctx.lineTo(-104, 12);
    ctx.closePath();
    ctx.fill();

    // Right box-end ring
    ctx.beginPath();
    ctx.arc(118, 0, 26, 0, Math.PI * 2);
    ctx.fill();

    // Inner shaft recess detail (darker metallic groove)
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.roundRect(-70, -6, 140, 12, 4);
    ctx.fill();
  } else if (presetId === 'caliper') {
    // Digital Vernier Caliper (~340px long = ~160mm)
    // Main beam
    ctx.beginPath();
    ctx.roundRect(-165, -14, 340, 28, 3);
    ctx.fill();

    // Fixed outer jaw (left bottom)
    ctx.beginPath();
    ctx.moveTo(-165, 14);
    ctx.lineTo(-165, 92);
    ctx.lineTo(-148, 86);
    ctx.lineTo(-125, 14);
    ctx.closePath();
    ctx.fill();

    // Fixed inner jaw (left top)
    ctx.beginPath();
    ctx.moveTo(-165, -14);
    ctx.lineTo(-165, -56);
    ctx.lineTo(-148, -50);
    ctx.lineTo(-136, -14);
    ctx.closePath();
    ctx.fill();

    // Sliding housing + LCD body
    ctx.beginPath();
    ctx.roundRect(-108, -32, 118, 66, 6);
    ctx.fill();

    // Sliding outer jaw
    ctx.beginPath();
    ctx.moveTo(-108, 34);
    ctx.lineTo(-108, 92);
    ctx.lineTo(-90, 86);
    ctx.lineTo(-68, 34);
    ctx.closePath();
    ctx.fill();

    // Sliding inner jaw
    ctx.beginPath();
    ctx.moveTo(-108, -32);
    ctx.lineTo(-108, -56);
    ctx.lineTo(-92, -50);
    ctx.lineTo(-80, -32);
    ctx.closePath();
    ctx.fill();

    // LCD bezel highlight
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.roundRect(-84, -18, 72, 32, 3);
    ctx.fill();
  } else {
    // Precision Hex Driver (~295px long = ~138mm)
    // Ergonomic handle
    ctx.beginPath();
    ctx.roundRect(-145, -24, 136, 48, 22);
    ctx.fill();

    // Collar bolster
    ctx.beginPath();
    ctx.roundRect(-14, -15, 22, 30, 5);
    ctx.fill();

    // Chrome/dark shaft + hex tip
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.roundRect(6, -7, 138, 14, 4);
    ctx.fill();

    // Handle grip ribs
    ctx.fillStyle = '#0f172a';
    for (let rx = -120; rx <= -35; rx += 18) {
      ctx.fillRect(rx, -18, 6, 36);
    }
  }

  ctx.restore();
  return canvas.toDataURL('image/png');
}
