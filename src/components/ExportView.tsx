import React, { useMemo, useRef, useState } from 'react';
import { PlacedTool, GridfinityConfig } from '../types';
import {
  getBinDimensions,
  getStackingLipProfile,
  STACKING_LIP_HEIGHT,
} from '../utils/geometry';
import { downloadStl, generateGridfinityStl } from '../utils/stlExporter';
import { downloadSvg, generateLaserCutSvg } from '../utils/svgExporter';
import {
  Download,
  FileCode,
  Printer,
  Layers,
  CheckCircle2,
  Cpu,
  ShieldCheck,
  X,
} from 'lucide-react';

interface ExportViewProps {
  config: GridfinityConfig;
  tools: PlacedTool[];
}

export const ExportView: React.FC<ExportViewProps> = ({ config, tools }) => {
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);
  const [showPrintModal, setShowPrintModal] = useState<boolean>(false);
  const printIframeRef = useRef<HTMLIFrameElement | null>(null);

  const { width, length, height } = getBinDimensions(
    config.gridX,
    config.gridY,
    config.gridZ,
    config.customHeightMm
  );
  const lipInfo = getStackingLipProfile(
    config.lipHeight ?? (config.hasStackingLip !== false ? STACKING_LIP_HEIGHT : 0)
  );
  const totalHeight = height + (lipInfo.enabled ? lipInfo.height : 0);
  const magnetMode = config.magnetMode ?? (config.hasMagnets ? 'corners' : 'none');
  const magnetLabel =
    magnetMode === 'full'
      ? `Full (${config.gridX * config.gridY * 4} Magnets)`
      : magnetMode === 'corners'
      ? '4 Outermost Corners'
      : 'None';

  // Compute live binary STL mesh stats (exact triangle count & binary size)
  const stlStats = useMemo(() => {
    const buffer = generateGridfinityStl(config, tools);
    const view = new DataView(buffer);
    const triangleCount = view.getUint32(80, true);
    const sizeKb = Math.round((buffer.byteLength / 1024) * 10) / 10;
    return { triangleCount, sizeKb };
  }, [config, tools]);

  const svgContent = useMemo(() => generateLaserCutSvg(config, tools), [config, tools]);

  // Print estimates
  const volumeCm3 = Math.max(8, Math.round((width * length * totalHeight * 0.35) / 1000));
  const filamentGrams = Math.round(volumeCm3 * 1.24);
  const totalMinutes = Math.max(25, Math.round((filamentGrams / 35) * 60));
  const printHours = Math.floor(totalMinutes / 60);
  const printMins = totalMinutes % 60;

  const handleDownloadStl = () => {
    downloadStl(config, tools);
    setDownloadSuccess('Binary STL file downloaded and ready for slicing.');
    setTimeout(() => setDownloadSuccess(null), 4000);
  };

  const handleDownloadSvg = () => {
    downloadSvg(config, tools);
    setDownloadSuccess('1:1 Laser Cut 5S Foam SVG exported.');
    setTimeout(() => setDownloadSuccess(null), 4000);
  };

  const handleIframePrint = () => {
    const iframe = printIframeRef.current;
    if (!iframe || !iframe.contentWindow) return;
    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Gridfinity 1:1 Scale Fitment Template</title>
        <style>
          @page { size: auto; margin: 10mm; }
          body { margin: 0; display: flex; flex-direction: column; align-items: center; font-family: sans-serif; color: #111827; }
          .header { margin-bottom: 8mm; text-align: center; }
          h2 { margin: 0 0 2mm 0; font-size: 14pt; }
          p { margin: 0; font-size: 9.5pt; color: #4b5563; }
          svg { border: 1px dashed #9ca3af; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>Gridfinity Studio — 1:1 Scale Fitment Template</h2>
          <p>Verify printer scale against the 100mm ruler. Place tools on this sheet to check fit before 3D printing.</p>
        </div>
        ${svgContent}
      </body>
      </html>
    `);
    doc.close();
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
  };

  const handleDownloadPrintableHtml = () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Gridfinity 1:1 Scale Fitment Sheet</title>
  <style>
    @page { size: auto; margin: 10mm; }
    body { margin: 16px; display: flex; flex-direction: column; align-items: center; font-family: system-ui, sans-serif; color: #0f172a; }
    h2 { margin: 0 0 4px 0; }
    p { margin: 0 0 16px 0; font-size: 12px; color: #475569; }
    svg { border: 1px dashed #94a3b8; }
  </style>
</head>
<body>
  <h2>Gridfinity Studio — 1:1 Scale Fitment Template (${config.gridX}×${config.gridY}U)</h2>
  <p>Print at 100% scale (no scaling). Verify with a physical ruler against the 100mm check bar.</p>
  ${svgContent}
</body>
</html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Gridfinity_Fitment_${config.gridX}x${config.gridY}U.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setDownloadSuccess('Printable 1:1 HTML fitment sheet downloaded.');
    setTimeout(() => setDownloadSuccess(null), 4000);
  };

  return (
    <div className="flex-1 bg-slate-950 p-6 overflow-y-auto text-slate-100">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight font-display">
              Export &amp; Manufacturing Production
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Download verified binary STL meshes, 1:1 laser-cut 5S foam vectors, or print a 1:1 paper template to test physical tool tolerances.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs font-mono text-slate-300 tabular-nums">
            <span>{config.gridX}×{config.gridY}U</span>
            <span className="text-slate-600">·</span>
            <span className="text-cyan-300">
              {width.toFixed(1)} × {length.toFixed(1)} × {totalHeight.toFixed(1)} mm
            </span>
            <span className="text-slate-600">·</span>
            <span>{stlStats.triangleCount.toLocaleString()} triangles</span>
          </div>
        </div>

        {downloadSuccess && (
          <div className="bg-emerald-950/80 border border-emerald-800 text-emerald-300 px-4 py-2.5 rounded-xl text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{downloadSuccess}</span>
          </div>
        )}

        {/* 3 Main Export Cards (single-elevation flat cards with hairline borders) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* 1. 3D Print STL */}
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-5 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                <FileCode className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-semibold text-sm text-white">3D Printable STL (Binary)</h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Watertight manifold mesh with Gridfinity v5 stepped base, stackable lip, 45° cutout chamfers, and negative pill pockets.
                </p>
              </div>
              <dl className="text-xs font-mono text-slate-400 pt-2 border-t border-slate-800 space-y-1 tabular-nums">
                <div className="flex justify-between">
                  <dt>Mesh Size:</dt>
                  <dd className="text-slate-200">{stlStats.triangleCount.toLocaleString()} tris ({stlStats.sizeKb} KB)</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Cutout Chamfer:</dt>
                  <dd className="text-slate-200">{config.chamferSize}mm @ 45°</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Stacking Lip:</dt>
                  <dd className="text-slate-200">{lipInfo.enabled ? `${lipInfo.height.toFixed(1)}mm` : 'Disabled'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Base Magnets:</dt>
                  <dd className="text-slate-200">
                    {magnetLabel}
                    {magnetMode !== 'none'
                      ? ` (${config.magnetDiameter.toFixed(1)}Ø×${config.magnetDepth.toFixed(1)}mm)`
                      : ''}
                  </dd>
                </div>
              </dl>
            </div>
            <button
              type="button"
              onClick={handleDownloadStl}
              className="mt-5 w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-colors cursor-pointer whitespace-nowrap"
            >
              <Download className="w-4 h-4 shrink-0" />
              <span>Download .STL File</span>
            </button>
          </div>

          {/* 2. 1:1 Laser Cut Foam SVG */}
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-5 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-semibold text-sm text-white">Laser Cut 5S Shadow Foam</h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  1:1 millimeter-scale vector paths for Kaizen foam laser cutting or CNC pocket routing with color-separated cut layers.
                </p>
              </div>
              <dl className="text-xs font-mono text-slate-400 pt-2 border-t border-slate-800 space-y-1">
                <div className="flex justify-between">
                  <dt>Red Stroke:</dt>
                  <dd className="text-slate-200">Outer Perimeter</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Blue Stroke:</dt>
                  <dd className="text-slate-200">Tool Cavity Cuts</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Orange Stroke:</dt>
                  <dd className="text-slate-200">Pill Finger Pockets</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Cutouts Included:</dt>
                  <dd className="text-slate-200 tabular-nums">{tools.length}</dd>
                </div>
              </dl>
            </div>
            <button
              type="button"
              onClick={handleDownloadSvg}
              className="mt-5 w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs transition-colors cursor-pointer whitespace-nowrap"
            >
              <Download className="w-4 h-4 shrink-0" />
              <span>Download .SVG File</span>
            </button>
          </div>

          {/* 3. 1:1 Paper Fitment Template */}
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-5 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <Printer className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-semibold text-sm text-white">1:1 Printable Fitment Sheet</h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Preview or print directly onto A4 / US Letter paper with a 100mm scale check bar to physically test tool clearance before printing.
                </p>
              </div>
              <dl className="text-xs font-mono text-slate-400 pt-2 border-t border-slate-800 space-y-1">
                <div className="flex justify-between">
                  <dt>Output Scale:</dt>
                  <dd className="text-slate-200">100% (1:1 mm)</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Scale Bar:</dt>
                  <dd className="text-slate-200">100.0 mm Check Ruler</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Verification:</dt>
                  <dd className="text-slate-200">Physical Tool Laydown</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Bed Fit Check:</dt>
                  <dd className="text-emerald-400">
                    {width <= 250 && length <= 250 ? 'Fits Standard 256mm Bed' : 'Large Format Bed'}
                  </dd>
                </div>
              </dl>
            </div>
            <button
              type="button"
              onClick={() => setShowPrintModal(true)}
              className="mt-5 w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-colors cursor-pointer whitespace-nowrap"
            >
              <Printer className="w-4 h-4 shrink-0" />
              <span>Preview &amp; Print 1:1 Sheet</span>
            </button>
          </div>
        </div>

        {/* Recommended Slicing Parameters */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-5">
          <h3 className="font-semibold text-sm text-white flex items-center gap-2 mb-4">
            <Cpu className="w-4 h-4 text-indigo-400" />
            <span>Recommended 3D Slicer Parameters (Bambu Studio / OrcaSlicer / PrusaSlicer)</span>
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 text-xs font-mono tabular-nums border-b border-slate-800 pb-4">
            <div>
              <div className="text-slate-500 text-[11px]">Layer Height</div>
              <div className="text-white font-semibold text-sm mt-0.5">0.20 mm</div>
              <div className="text-[11px] text-slate-400 mt-0.5">Standard structural profile</div>
            </div>
            <div>
              <div className="text-slate-500 text-[11px]">Perimeters &amp; Infill</div>
              <div className="text-white font-semibold text-sm mt-0.5">3 Walls / 15%</div>
              <div className="text-[11px] text-slate-400 mt-0.5">Gyroid infill pattern</div>
            </div>
            <div>
              <div className="text-slate-500 text-[11px]">Cutout Chamfer</div>
              <div className="text-emerald-400 font-semibold text-sm mt-0.5">{config.chamferSize}mm @ 45°</div>
              <div className="text-[11px] text-slate-400 mt-0.5">Zero-support overhang</div>
            </div>
            <div>
              <div className="text-slate-500 text-[11px]">Est. Material &amp; Time</div>
              <div className="text-cyan-300 font-semibold text-sm mt-0.5">~{filamentGrams}g PLA</div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Approx. {printHours > 0 ? `${printHours}h ${printMins}m` : `${printMins}m`}
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Gridfinity v5 Reference Compliant · 42.0mm Pitch · 41.5mm Unit (0.5mm Tol.)</span>
            </div>
            <div className="text-slate-300 font-mono tabular-nums">
              4.75mm Stepped Base (0.8 / 1.8 / 2.15mm) · 35.6mm Foot · {magnetLabel}
            </div>
          </div>
        </div>
      </div>

      {/* Hidden iframe for native print without window.open */}
      <iframe
        ref={printIframeRef}
        title="1:1 Print Frame"
        className="hidden"
      />

      {/* In-App 1:1 Fitment Sheet Preview Modal */}
      {showPrintModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="fitment-modal-title"
          className="fixed inset-0 z-50 bg-slate-950/85 flex items-center justify-center p-4"
        >
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between gap-4">
              <div>
                <h3 id="fitment-modal-title" className="text-sm font-semibold text-white">
                  1:1 Scale Paper Fitment Preview
                </h3>
                <p className="text-xs text-slate-400">
                  Print at 100% scale (no fit-to-page) and verify with a ruler against the 100mm reference bar.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close Fitment Preview"
                onClick={() => setShowPrintModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-6 bg-white flex items-center justify-center">
              <div
                className="max-w-full"
                dangerouslySetInnerHTML={{ __html: svgContent }}
              />
            </div>

            <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-900 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleDownloadPrintableHtml}
                className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap"
              >
                Download Printable HTML
              </button>
              <button
                type="button"
                onClick={handleIframePrint}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
              >
                <Printer className="w-3.5 h-3.5 shrink-0" />
                <span>Print 1:1 Sheet</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
