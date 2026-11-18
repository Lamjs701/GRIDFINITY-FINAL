import { PlacedTool, GridfinityConfig } from '../types';
import { buildBinTriangles } from './binGeometry';
import { MeshTriangle } from './cutoutGeometry';

function computeNormal(
  v1: [number, number, number],
  v2: [number, number, number],
  v3: [number, number, number]
): [number, number, number] {
  const ax = v2[0] - v1[0];
  const ay = v2[1] - v1[1];
  const az = v2[2] - v1[2];

  const bx = v3[0] - v1[0];
  const by = v3[1] - v1[1];
  const bz = v3[2] - v1[2];

  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;

  const len = Math.hypot(nx, ny, nz);
  if (len === 0) return [0, 0, 1];
  return [nx / len, ny / len, nz / len];
}

/**
 * Builds binary STL ArrayBuffer from list of triangles.
 */
export function buildBinaryStl(triangles: MeshTriangle[]): ArrayBuffer {
  const bufferSize = 84 + triangles.length * 50;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  const header = 'AI Gridfinity Studio — Parametric Precision CAD Bin';
  for (let i = 0; i < 80; i++) {
    view.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
  }

  view.setUint32(80, triangles.length, true);

  let offset = 84;
  for (const tri of triangles) {
    const norm = tri.normal || computeNormal(tri.v1, tri.v2, tri.v3);

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

/**
 * Generates complete 3D printable Gridfinity Bin geometry with tool cutouts,
 * true 45° smooth chamfer, negative pill finger pockets, and configurable magnets/screws.
 */
export function generateGridfinityStl(
  config: GridfinityConfig,
  tools: PlacedTool[]
): ArrayBuffer {
  const triangles = buildBinTriangles(config, tools, { centered: false });
  return buildBinaryStl(triangles);
}

/**
 * Triggers browser download of generated binary STL file.
 */
export function downloadStl(config: GridfinityConfig, tools: PlacedTool[], fileName?: string) {
  const stlData = generateGridfinityStl(config, tools);
  const blob = new Blob([stlData], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || `Gridfinity_${config.gridX}x${config.gridY}U_${tools.length}tools.stl`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
