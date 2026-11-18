import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ToolDef, Point2D, FingerPocket } from '../types';
import {
  A4Corners,
  detectA4PaperInImage,
  extractToolFromA4Photo,
} from '../utils/contourExtraction';
import { A4Orientation, getA4DimensionsMm } from '../utils/a4Calibration';
import { simplifyContour, generatePillContour, pointInPolygon, rotatePoint } from '../utils/geometry';
import { smoothContourTangent } from '../utils/curveSmoothing';
import {
  SAMPLE_A4_PRESETS,
  SampleA4PresetId,
  generateSampleA4PhotoDataUrl,
} from '../utils/samplePresets';
import {
  Upload,
  Check,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  FileText,
  Scan,
  ArrowRight,
  Wrench,
  Ruler,
  Hammer,
} from 'lucide-react';

interface ToolScannerViewProps {
  onSaveTool: (tool: ToolDef) => void;
  onCancel: () => void;
  initialTool?: ToolDef | null;
}

type FinetuneDragTarget =
  | { type: 'point'; index: number }
  | {
      type: 'pocket-move' | 'pocket-length' | 'pocket-width' | 'pocket-radius';
      pocketId: string;
      handleSign?: number;
      startWorld: Point2D;
      initialX: number;
      initialY: number;
      initialLength: number;
      initialWidth: number;
      initialRadius: number;
    };

export const ToolScannerView: React.FC<ToolScannerViewProps> = ({
  onSaveTool,
  onCancel,
  initialTool,
}) => {
  const [step, setStep] = useState<'upload' | 'calibrate' | 'finetune'>(
    initialTool ? 'finetune' : 'upload'
  );

  const [imageSrc, setImageSrc] = useState<string>(initialTool?.scannedImageUrl || '');
  const [rectifiedSrc, setRectifiedSrc] = useState<string>(initialTool?.scannedImageUrl || '');
  const [a4Orientation, setA4Orientation] = useState<A4Orientation>('landscape');
  const [a4AutoDetected, setA4AutoDetected] = useState<boolean>(false);
  const [a4Confidence, setA4Confidence] = useState<number>(0);
  const [a4Corners, setA4Corners] = useState<A4Corners>([
    { x: 0.08, y: 0.08 },
    { x: 0.92, y: 0.08 },
    { x: 0.92, y: 0.92 },
    { x: 0.08, y: 0.92 },
  ]);
  const [threshold, setThreshold] = useState<number>(145);
  const [invertMask, setInvertMask] = useState<boolean>(false);
  const [mmPerPixel, setMmPerPixel] = useState<number>(initialTool?.imageScale || 1 / 3);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  const [toolName, setToolName] = useState<string>(initialTool?.name || 'A4 Traced Tool');
  const [category, setCategory] = useState<string>(initialTool?.category || 'Custom');
  const [depthMm, setDepthMm] = useState<number>(initialTool?.depth || 10.0);
  const [clearanceMm, setClearanceMm] = useState<number>(initialTool?.clearance || 0.6);

  const [contour, setContour] = useState<Point2D[]>(initialTool?.contour || []);
  const [curveSmoothing, setCurveSmoothing] = useState<number>(initialTool?.curveSmoothing ?? 65);
  const [fingerPockets, setFingerPockets] = useState<FingerPocket[]>(
    initialTool?.fingerPockets || []
  );

  const [showOverlay, setShowOverlay] = useState<boolean>(true);
  const [overlayOpacity, setOverlayOpacity] = useState<number>(0.65);
  const [overlayScale, setOverlayScale] = useState<number>(1.0);
  const [overlayOffsetX, setOverlayOffsetX] = useState<number>(0);
  const [overlayOffsetY, setOverlayOffsetY] = useState<number>(0);
  const [imgLoadedTick, setImgLoadedTick] = useState<number>(0);

  const calibCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const calibImgRef = useRef<HTMLImageElement | null>(null);
  const [calibImgTick, setCalibImgTick] = useState<number>(0);
  const draggingCornerIdxRef = useRef<number | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [canvasZoom, setCanvasZoom] = useState<number>(2.5);
  const [canvasPan, setCanvasPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [selectedPocketId, setSelectedPocketId] = useState<string | null>(null);
  const dragTargetRef = useRef<FinetuneDragTarget | null>(null);
  const isPanningRef = useRef<boolean>(false);
  const lastMousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    if (!imageSrc) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      calibImgRef.current = img;
      setCalibImgTick((t) => t + 1);
    };
    img.src = imageSrc;
  }, [imageSrc]);

  useEffect(() => {
    if (!rectifiedSrc) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
      setImgLoadedTick((t) => t + 1);
    };
    img.src = rectifiedSrc;
  }, [rectifiedSrc]);

  const runAutoDetectA4 = useCallback(async (src: string) => {
    try {
      const detected = await detectA4PaperInImage(src);
      setA4Corners(detected.corners);
      setA4Orientation(detected.orientation);
      setA4AutoDetected(detected.detected);
      setA4Confidence(detected.confidence);
    } catch (err) {
      console.error('A4 auto-detect fallback:', err);
      setA4AutoDetected(false);
      setA4Confidence(0);
    }
  }, []);

  const loadSourcePhoto = async (src: string) => {
    setImageSrc(src);
    setRectifiedSrc(src);
    setA4AutoDetected(false);
    setA4Confidence(0);
    setStep('calibrate');
    await runAutoDetectA4(src);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const result = event.target?.result as string;
        await loadSourcePhoto(result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleLoadSamplePreset = async (presetId: SampleA4PresetId) => {
    const meta = SAMPLE_A4_PRESETS.find((p) => p.id === presetId);
    if (meta) {
      setToolName(meta.name);
      setCategory(meta.category);
      setDepthMm(meta.defaultDepthMm);
    }
    setInvertMask(false);
    setThreshold(145);
    const dataUrl = generateSampleA4PhotoDataUrl(presetId);
    if (dataUrl) {
      await loadSourcePhoto(dataUrl);
    }
  };

  const handleExtractContour = async () => {
    setIsProcessing(true);
    try {
      const res = await extractToolFromA4Photo(
        imageSrc,
        a4Corners,
        a4Orientation,
        threshold,
        invertMask
      );
      setContour(res.contour);
      setRectifiedSrc(res.rectifiedImageUrl);
      setMmPerPixel(res.mmPerPixel);
      setOverlayScale(1.0);
      setOverlayOffsetX(res.a4WidthMm / 2 - res.centerMm.x);
      setOverlayOffsetY(res.a4HeightMm / 2 - res.centerMm.y);
      setCanvasPan({ x: 0, y: 0 });
      setStep('finetune');
    } catch (err) {
      console.error('A4 extraction error:', err);
      setStep('finetune');
    } finally {
      setIsProcessing(false);
    }
  };

  const getCalibImageRect = useCallback((canvasW: number, canvasH: number) => {
    const img = calibImgRef.current;
    if (!img) return { x: 0, y: 0, w: canvasW, h: canvasH };
    const iw = img.naturalWidth || img.width || 800;
    const ih = img.naturalHeight || img.height || 600;
    const pad = 24;
    const scale = Math.min((canvasW - pad * 2) / iw, (canvasH - pad * 2) / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    return {
      x: (canvasW - dw) / 2,
      y: (canvasH - dh) / 2,
      w: dw,
      h: dh,
    };
  }, []);

  useEffect(() => {
    if (step !== 'calibrate') return;
    const canvas = calibCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, rect.width, rect.height);

    const img = calibImgRef.current;
    if (img) {
      const box = getCalibImageRect(rect.width, rect.height);
      ctx.drawImage(img, box.x, box.y, box.w, box.h);

      const pts = a4Corners.map((c) => ({
        x: box.x + c.x * box.w,
        y: box.y + c.y * box.h,
      }));

      ctx.save();
      ctx.fillStyle = 'rgba(2, 6, 23, 0.55)';
      ctx.beginPath();
      ctx.rect(box.x, box.y, box.w, box.h);
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[3].x, pts[3].y);
      ctx.lineTo(pts[2].x, pts[2].y);
      ctx.lineTo(pts[1].x, pts[1].y);
      ctx.closePath();
      ctx.fill('evenodd');
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[1].x, pts[1].y);
      ctx.lineTo(pts[2].x, pts[2].y);
      ctx.lineTo(pts[3].x, pts[3].y);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();

      const { widthMm, heightMm } = getA4DimensionsMm(a4Orientation);
      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = '#22d3ee';
      ctx.textAlign = 'center';
      ctx.fillText(`${widthMm} mm`, (pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2 - 8);
      ctx.fillText(`${heightMm} mm`, (pts[1].x + pts[2].x) / 2 + 28, (pts[1].y + pts[2].y) / 2);

      const labels = ['TL', 'TR', 'BR', 'BL'];
      pts.forEach((p, idx) => {
        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#22d3ee';
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labels[idx], p.x, p.y);
      });
    }

    ctx.restore();
  }, [step, a4Corners, a4Orientation, calibImgTick, getCalibImageRect]);

  const handleCalibMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = calibCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const box = getCalibImageRect(rect.width, rect.height);

    let hitIdx: number | null = null;
    a4Corners.forEach((c, idx) => {
      const px = box.x + c.x * box.w;
      const py = box.y + c.y * box.h;
      if (Math.hypot(mx - px, my - py) <= 18) {
        hitIdx = idx;
      }
    });
    draggingCornerIdxRef.current = hitIdx;
  };

  const handleCalibMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const idx = draggingCornerIdxRef.current;
    if (idx === null || !calibCanvasRef.current) return;
    const rect = calibCanvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const box = getCalibImageRect(rect.width, rect.height);

    const nx = Math.max(0.0, Math.min(1.0, (mx - box.x) / box.w));
    const ny = Math.max(0.0, Math.min(1.0, (my - box.y) / box.h));

    setA4Corners((prev) => {
      const next = [...prev] as A4Corners;
      next[idx] = { x: nx, y: ny };
      return next;
    });
  };

  const handleCalibMouseUp = () => {
    draggingCornerIdxRef.current = null;
  };

  const screenToWorld = useCallback(
    (screenX: number, screenY: number, width: number, height: number): Point2D => {
      const centerX = width / 2 + canvasPan.x;
      const centerY = height / 2 + canvasPan.y;
      return {
        x: (screenX - centerX) / canvasZoom,
        y: (screenY - centerY) / canvasZoom,
      };
    },
    [canvasPan, canvasZoom]
  );

  useEffect(() => {
    if (step !== 'finetune') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);

    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, rect.width, rect.height);

    const centerX = rect.width / 2 + canvasPan.x;
    const centerY = rect.height / 2 + canvasPan.y;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.scale(canvasZoom, canvasZoom);

    if (showOverlay && imgRef.current) {
      const img = imgRef.current;
      ctx.save();
      ctx.globalAlpha = overlayOpacity;
      const imgWidthMm = (img.naturalWidth || img.width) * mmPerPixel * overlayScale;
      const imgHeightMm = (img.naturalHeight || img.height) * mmPerPixel * overlayScale;
      ctx.drawImage(
        img,
        -imgWidthMm / 2 + overlayOffsetX,
        -imgHeightMm / 2 + overlayOffsetY,
        imgWidthMm,
        imgHeightMm
      );
      ctx.restore();
    }

    ctx.lineWidth = 1.0 / canvasZoom;
    ctx.strokeStyle = '#334155';
    ctx.beginPath();
    ctx.moveTo(-150, 0);
    ctx.lineTo(150, 0);
    ctx.moveTo(0, -150);
    ctx.lineTo(0, 150);
    ctx.stroke();

    if (contour.length >= 3) {
      const displayPts = curveSmoothing > 0 ? smoothContourTangent(contour, curveSmoothing) : contour;

      // Subtle dashed raw control polygon when tangent smoothing is active
      if (curveSmoothing > 0 && displayPts.length >= 3) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(contour[0].x, contour[0].y);
        for (let i = 1; i < contour.length; i++) {
          ctx.lineTo(contour[i].x, contour[i].y);
        }
        ctx.closePath();
        ctx.setLineDash([2 / canvasZoom, 2 / canvasZoom]);
        ctx.lineWidth = 0.8 / canvasZoom;
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
        ctx.stroke();
        ctx.restore();
      }

      ctx.beginPath();
      ctx.moveTo(displayPts[0].x, displayPts[0].y);
      for (let i = 1; i < displayPts.length; i++) {
        ctx.lineTo(displayPts[i].x, displayPts[i].y);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(99, 102, 241, 0.2)';
      ctx.fill();
      ctx.lineWidth = 1.6 / canvasZoom;
      ctx.strokeStyle = curveSmoothing > 0 ? '#22d3ee' : '#818cf8';
      ctx.stroke();

      if (clearanceMm > 0) {
        ctx.save();
        ctx.setLineDash([2 / canvasZoom, 2 / canvasZoom]);
        ctx.lineWidth = 0.8 / canvasZoom;
        ctx.strokeStyle = '#38bdf8';
        ctx.stroke();
        ctx.restore();
      }

      for (let i = 0; i < contour.length; i++) {
        const pt = contour[i];
        const isSelected = i === selectedPointIndex;
        ctx.fillStyle = isSelected ? '#38bdf8' : '#ffffff';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, (isSelected ? 4.5 : 3.0) / canvasZoom, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 1.0 / canvasZoom;
        ctx.strokeStyle = isSelected ? '#ffffff' : '#4f46e5';
        ctx.stroke();
      }
    }

    for (const pocket of fingerPockets) {
      const pillPts = generatePillContour(pocket, 12);
      const isSelectedPocket = pocket.id === selectedPocketId;
      if (pillPts.length > 0) {
        ctx.beginPath();
        ctx.moveTo(pillPts[0].x, pillPts[0].y);
        for (let i = 1; i < pillPts.length; i++) {
          ctx.lineTo(pillPts[i].x, pillPts[i].y);
        }
        ctx.closePath();
        ctx.fillStyle = isSelectedPocket
          ? 'rgba(249, 115, 22, 0.42)'
          : 'rgba(249, 115, 22, 0.28)';
        ctx.fill();
        ctx.lineWidth = (isSelectedPocket ? 1.8 : 1.2) / canvasZoom;
        ctx.strokeStyle = isSelectedPocket ? '#fb923c' : '#f97316';
        ctx.stroke();

        ctx.fillStyle = '#fed7aa';
        ctx.font = `${Math.max(2.5, 3)}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(
          `${pocket.length.toFixed(0)}×${pocket.width.toFixed(0)} R${(
            pocket.cornerRadius ?? pocket.width / 2
          ).toFixed(1)}`,
          pocket.x,
          pocket.y
        );

        const hx = Math.max(2, pocket.length / 2);
        const hy = Math.max(2, pocket.width / 2);
        const maxR = Math.min(hx, hy);
        const r = Math.max(0.5, Math.min(pocket.cornerRadius ?? hy, maxR));
        const toWorld = (lx: number, ly: number) => {
          const rot = rotatePoint({ x: lx, y: ly }, pocket.rotation);
          return { x: pocket.x + rot.x, y: pocket.y + rot.y };
        };

        const hSize = 5 / canvasZoom;
        [toWorld(hx, 0), toWorld(-hx, 0)].forEach((hp) => {
          ctx.fillStyle = '#06b6d4';
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1 / canvasZoom;
          ctx.fillRect(hp.x - hSize / 2, hp.y - hSize / 2, hSize, hSize);
          ctx.strokeRect(hp.x - hSize / 2, hp.y - hSize / 2, hSize, hSize);
        });
        [toWorld(0, hy), toWorld(0, -hy)].forEach((hp) => {
          ctx.fillStyle = '#10b981';
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1 / canvasZoom;
          ctx.fillRect(hp.x - hSize / 2, hp.y - hSize / 2, hSize, hSize);
          ctx.strokeRect(hp.x - hSize / 2, hp.y - hSize / 2, hSize, hSize);
        });
        const rPt = toWorld(hx - r * 0.5, hy - r * 0.5);
        ctx.fillStyle = '#facc15';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1 / canvasZoom;
        ctx.beginPath();
        ctx.arc(rPt.x, rPt.y, 3.2 / canvasZoom, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    ctx.restore();
    ctx.restore();
  }, [
    step,
    contour,
    curveSmoothing,
    selectedPointIndex,
    selectedPocketId,
    fingerPockets,
    showOverlay,
    overlayOpacity,
    overlayScale,
    overlayOffsetX,
    overlayOffsetY,
    canvasZoom,
    canvasPan,
    mmPerPixel,
    clearanceMm,
    imgLoadedTick,
  ]);

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);

    if (e.button === 1 || e.button === 2 || e.shiftKey) {
      isPanningRef.current = true;
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    const hitRadiusMm = 8 / canvasZoom;

    for (let i = fingerPockets.length - 1; i >= 0; i--) {
      const pocket = fingerPockets[i];
      const hx = Math.max(2, pocket.length / 2);
      const hy = Math.max(2, pocket.width / 2);
      const maxR = Math.min(hx, hy);
      const r = Math.max(0.5, Math.min(pocket.cornerRadius ?? hy, maxR));
      const local = rotatePoint({ x: world.x - pocket.x, y: world.y - pocket.y }, -pocket.rotation);

      if (Math.hypot(local.x - (hx - r * 0.5), local.y - (hy - r * 0.5)) <= hitRadiusMm) {
        setSelectedPocketId(pocket.id);
        setSelectedPointIndex(null);
        dragTargetRef.current = {
          type: 'pocket-radius',
          pocketId: pocket.id,
          startWorld: world,
          initialX: pocket.x,
          initialY: pocket.y,
          initialLength: pocket.length,
          initialWidth: pocket.width,
          initialRadius: r,
        };
        return;
      }

      if (Math.hypot(local.x - hx, local.y) <= hitRadiusMm || Math.hypot(local.x + hx, local.y) <= hitRadiusMm) {
        setSelectedPocketId(pocket.id);
        setSelectedPointIndex(null);
        dragTargetRef.current = {
          type: 'pocket-length',
          pocketId: pocket.id,
          handleSign: local.x >= 0 ? 1 : -1,
          startWorld: world,
          initialX: pocket.x,
          initialY: pocket.y,
          initialLength: pocket.length,
          initialWidth: pocket.width,
          initialRadius: r,
        };
        return;
      }

      if (Math.hypot(local.x, local.y - hy) <= hitRadiusMm || Math.hypot(local.x, local.y + hy) <= hitRadiusMm) {
        setSelectedPocketId(pocket.id);
        setSelectedPointIndex(null);
        dragTargetRef.current = {
          type: 'pocket-width',
          pocketId: pocket.id,
          handleSign: local.y >= 0 ? 1 : -1,
          startWorld: world,
          initialX: pocket.x,
          initialY: pocket.y,
          initialLength: pocket.length,
          initialWidth: pocket.width,
          initialRadius: r,
        };
        return;
      }

      const pillPts = generatePillContour(pocket, 10);
      if (pointInPolygon(world, pillPts)) {
        setSelectedPocketId(pocket.id);
        setSelectedPointIndex(null);
        dragTargetRef.current = {
          type: 'pocket-move',
          pocketId: pocket.id,
          startWorld: world,
          initialX: pocket.x,
          initialY: pocket.y,
          initialLength: pocket.length,
          initialWidth: pocket.width,
          initialRadius: r,
        };
        return;
      }
    }

    let hitIndex: number | null = null;
    for (let i = 0; i < contour.length; i++) {
      if (Math.hypot(contour[i].x - world.x, contour[i].y - world.y) <= hitRadiusMm) {
        hitIndex = i;
        break;
      }
    }

    if (hitIndex !== null) {
      setSelectedPointIndex(hitIndex);
      setSelectedPocketId(null);
      dragTargetRef.current = { type: 'point', index: hitIndex };
    } else {
      setSelectedPointIndex(null);
      isPanningRef.current = true;
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanningRef.current) {
      const dx = e.clientX - lastMousePosRef.current.x;
      const dy = e.clientY - lastMousePosRef.current.y;
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
      setCanvasPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      return;
    }

    const drag = dragTargetRef.current;
    if (!drag || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);

    if (drag.type === 'point') {
      setContour((prev) => {
        const next = [...prev];
        next[drag.index] = {
          x: Math.round(world.x * 10) / 10,
          y: Math.round(world.y * 10) / 10,
        };
        return next;
      });
      return;
    }

    setFingerPockets((prev) =>
      prev.map((p) => {
        if (p.id !== drag.pocketId) return p;

        if (drag.type === 'pocket-move') {
          return {
            ...p,
            x: Math.round((drag.initialX + (world.x - drag.startWorld.x)) * 10) / 10,
            y: Math.round((drag.initialY + (world.y - drag.startWorld.y)) * 10) / 10,
          };
        }

        const local = rotatePoint({ x: world.x - p.x, y: world.y - p.y }, -p.rotation);

        if (drag.type === 'pocket-length') {
          const newLen = Math.round(Math.max(8, Math.min(120, Math.abs(local.x) * 2)) * 10) / 10;
          const maxR = Math.min(newLen / 2, p.width / 2);
          return { ...p, length: newLen, cornerRadius: Math.min(p.cornerRadius ?? maxR, maxR) };
        }

        if (drag.type === 'pocket-width') {
          const newW = Math.round(Math.max(6, Math.min(80, Math.abs(local.y) * 2)) * 10) / 10;
          const maxR = Math.min(p.length / 2, newW / 2);
          return { ...p, width: newW, cornerRadius: Math.min(p.cornerRadius ?? maxR, maxR) };
        }

        if (drag.type === 'pocket-radius') {
          const hx = p.length / 2;
          const hy = p.width / 2;
          const maxR = Math.min(hx, hy);
          const inset = Math.max(hx - local.x, hy - local.y);
          const newR = Math.round(Math.max(0.5, Math.min(maxR, inset / 0.5)) * 10) / 10;
          return { ...p, cornerRadius: newR };
        }

        return p;
      })
    );
  };

  const handleCanvasMouseUp = () => {
    dragTargetRef.current = null;
    isPanningRef.current = false;
  };

  const handleCanvasWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    setCanvasZoom((prev) => Math.max(0.5, Math.min(10.0, prev * factor)));
  };

  const handleCanvasDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || contour.length === 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);

    setContour((prev) => {
      let bestDist = Infinity;
      let insertIdx = 0;
      for (let i = 0; i < prev.length; i++) {
        const next = (i + 1) % prev.length;
        const d1 = Math.hypot(prev[i].x - world.x, prev[i].y - world.y);
        const d2 = Math.hypot(prev[next].x - world.x, prev[next].y - world.y);
        if (d1 + d2 < bestDist) {
          bestDist = d1 + d2;
          insertIdx = next;
        }
      }
      const updated = [...prev];
      updated.splice(insertIdx, 0, {
        x: Math.round(world.x * 10) / 10,
        y: Math.round(world.y * 10) / 10,
      });
      setSelectedPointIndex(insertIdx);
      return updated;
    });
  };

  const lengthMm =
    contour.length > 0
      ? Math.round((Math.max(...contour.map((p) => p.x)) - Math.min(...contour.map((p) => p.x))) * 10) / 10
      : 0;
  const widthMm =
    contour.length > 0
      ? Math.round((Math.max(...contour.map((p) => p.y)) - Math.min(...contour.map((p) => p.y))) * 10) / 10
      : 0;

  const { widthMm: a4W, heightMm: a4H } = getA4DimensionsMm(a4Orientation);

  const handleSave = () => {
    const newTool: ToolDef = {
      id: initialTool?.id || `tool-${Date.now()}`,
      name: toolName,
      category,
      contour,
      curveSmoothing,
      depth: depthMm,
      clearance: clearanceMm,
      fingerPockets,
      scannedImageUrl: rectifiedSrc,
      imageScale: mmPerPixel,
    };
    onSaveTool(newTool);
  };

  const stepLabels = {
    upload: 'Step 1 of 3 · Capture or Select Sample',
    calibrate: 'Step 2 of 3 · Align A4 Corners',
    finetune: 'Step 3 of 3 · Fine-Tune & Finger Pockets',
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-950 text-slate-100 overflow-hidden">
      {/* Sub-Header */}
      <div className="h-12 bg-slate-900 border-b border-slate-800 px-5 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-sm font-semibold text-white whitespace-nowrap font-display">
            A4 Reference Tool Scanner
          </h1>
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span className="text-xs text-slate-400 truncate font-mono tabular-nums">
            {stepLabels[step]} · ISO A4 ({a4W}×{a4H}mm)
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {step === 'finetune' && (
            <button
              type="button"
              onClick={handleSave}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
            >
              <Check className="w-3.5 h-3.5 shrink-0" />
              <span>Save &amp; Open in Studio</span>
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
          >
            <span>Open CAD Studio</span>
            <ArrowRight className="w-3.5 h-3.5 shrink-0" />
          </button>
        </div>
      </div>

      {/* Step 1: Two-Column Upload + Instant Sample A4 Scans */}
      {step === 'upload' && (
        <div className="flex-1 overflow-y-auto p-6 lg:p-10 flex items-center justify-center">
          <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
            {/* Left: Primary Photo Upload */}
            <div className="lg:col-span-7 bg-slate-900 rounded-xl border border-slate-800 p-7 flex flex-col justify-between gap-6">
              <div className="space-y-4">
                <div className="w-11 h-11 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white font-display">
                    Trace Any Physical Tool at Exact 1:1 Scale
                  </h2>
                  <p className="text-sm text-slate-400 mt-2 leading-relaxed max-w-xl">
                    Set your tool flat on a standard <strong className="text-slate-200">A4 sheet (210 × 297 mm)</strong> over a darker desk. Homography perspective correction maps the paper corners to exact millimeters before extracting your cutout contour.
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-4 pt-3 border-t border-slate-800 text-xs">
                  <div>
                    <div className="font-semibold text-cyan-300">01. Keep 4 Corners Visible</div>
                    <p className="text-slate-400 mt-1">Ensure all four corners of the white A4 paper appear inside the frame.</p>
                  </div>
                  <div>
                    <div className="font-semibold text-indigo-300">02. High Contrast Desk</div>
                    <p className="text-slate-400 mt-1">Darker desk surfaces help auto-detect the white A4 sheet cleanly.</p>
                  </div>
                  <div>
                    <div className="font-semibold text-emerald-300">03. Parametric Export</div>
                    <p className="text-slate-400 mt-1">Fine-tune vertices, add pill grab pockets, and export STL or 5S SVG.</p>
                  </div>
                </div>
              </div>

              <div className="space-y-2.5">
                <label className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm cursor-pointer transition-colors">
                  <Upload className="w-4 h-4 shrink-0" />
                  <span>Upload A4 + Tool Photo</span>
                  <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
                </label>
                <p className="text-xs text-slate-500 text-center">
                  Supports PNG, JPG, and WebP photos taken from above or at a slight angle.
                </p>
              </div>
            </div>

            {/* Right: Instant Sample A4 Scans */}
            <div className="lg:col-span-5 bg-slate-900 rounded-xl border border-slate-800 p-7 flex flex-col justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-white font-display">
                  Try an Instant Sample Scan
                </h2>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Test the real A4 corner detection, perspective homography, and contour tracing pipeline immediately using a synthetic A4 workbench photo.
                </p>
              </div>

              <div className="space-y-2.5 flex-1 flex flex-col justify-center">
                {SAMPLE_A4_PRESETS.map((preset) => {
                  const Icon =
                    preset.id === 'wrench' ? Wrench : preset.id === 'caliper' ? Ruler : Hammer;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleLoadSamplePreset(preset.id)}
                      className="w-full flex items-center gap-3.5 p-3.5 rounded-lg bg-slate-950 hover:bg-slate-800/80 border border-slate-800 hover:border-indigo-500/60 text-left transition-colors cursor-pointer group"
                    >
                      <div className="w-10 h-10 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center text-cyan-400 group-hover:text-indigo-300 shrink-0">
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-white truncate">
                          {preset.name}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5 truncate font-mono">
                          {preset.subtitle}
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-white shrink-0" />
                    </button>
                  );
                })}
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
                <span>Want to design from scratch?</span>
                <button
                  type="button"
                  onClick={onCancel}
                  className="text-indigo-400 hover:text-indigo-300 font-medium cursor-pointer"
                >
                  Jump to CAD Studio
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: A4 Corner Alignment & Tracing Calibration */}
      {step === 'calibrate' && (
        <div className="flex-1 p-5 grid grid-cols-1 md:grid-cols-3 gap-5 max-w-6xl mx-auto w-full overflow-hidden">
          <div className="md:col-span-2 bg-slate-900 rounded-xl border border-slate-800 p-3 flex flex-col relative overflow-hidden">
            <div className="flex items-center justify-between mb-2 px-1 gap-2 flex-wrap">
              <div className="flex items-center gap-2 text-xs">
                <Scan className="w-3.5 h-3.5 text-cyan-400" />
                <span data-testid="a4-detect-status" className="font-medium text-slate-200">
                  {a4AutoDetected
                    ? `A4 Auto-Detected (${Math.round(a4Confidence * 100)}% confidence)`
                    : 'Manual / Refining A4 Corners'}
                </span>
                <span className="text-slate-600 hidden sm:inline">·</span>
                <span className="text-slate-400 hidden sm:inline">
                  Drag TL, TR, BR, BL handles to align paper corners
                </span>
              </div>
              <button
                type="button"
                onClick={() => runAutoDetectA4(imageSrc)}
                className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-cyan-300 transition-colors cursor-pointer whitespace-nowrap"
              >
                Re-Detect A4
              </button>
            </div>
            <div className="flex-1 relative rounded-lg overflow-hidden bg-slate-950 border border-slate-800">
              <canvas
                ref={calibCanvasRef}
                data-testid="a4-calib-canvas"
                onMouseDown={handleCalibMouseDown}
                onMouseMove={handleCalibMouseMove}
                onMouseUp={handleCalibMouseUp}
                onMouseLeave={handleCalibMouseUp}
                className="w-full h-full cursor-crosshair block"
              />
            </div>
          </div>

          <div className="bg-slate-900 rounded-xl border border-slate-800 p-5 flex flex-col justify-between overflow-y-auto">
            <div className="space-y-5">
              <div>
                <h3 className="text-xs font-semibold text-slate-300 mb-2">A4 Sheet Orientation</h3>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setA4Orientation('landscape')}
                    className={`py-2 px-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                      a4Orientation === 'landscape'
                        ? 'bg-indigo-600 text-white border-indigo-500'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                    }`}
                  >
                    Landscape (297×210)
                  </button>
                  <button
                    type="button"
                    onClick={() => setA4Orientation('portrait')}
                    className={`py-2 px-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                      a4Orientation === 'portrait'
                        ? 'bg-indigo-600 text-white border-indigo-500'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                    }`}
                  >
                    Portrait (210×297)
                  </button>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 font-mono text-xs space-y-1.5 tabular-nums">
                <div className="flex justify-between">
                  <span className="text-slate-400">Reference Frame:</span>
                  <span className="text-cyan-300">ISO A4 ({a4W} × {a4H} mm)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Trace Target:</span>
                  <span className="text-emerald-400">Largest item inside A4</span>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 space-y-3">
                <div>
                  <div className="flex items-center justify-between text-xs text-slate-300 mb-1.5">
                    <span>Object Trace Threshold</span>
                    <span className="font-mono text-indigo-300 tabular-nums">{threshold}</span>
                  </div>
                  <input
                    aria-label="Object Trace Threshold"
                    type="range"
                    min="40"
                    max="225"
                    value={threshold}
                    onChange={(e) => setThreshold(parseInt(e.target.value, 10))}
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Lower to ignore light shadows on the white sheet; raise for metallic silver tools.
                  </p>
                </div>

                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={invertMask}
                    onChange={(e) => setInvertMask(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-950 text-indigo-600"
                  />
                  <span>Light object on dark background (Invert)</span>
                </label>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-800 flex flex-col gap-2">
              <button
                type="button"
                disabled={isProcessing}
                onClick={handleExtractContour}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold text-xs transition-colors cursor-pointer"
              >
                <Scan className="w-4 h-4 shrink-0" />
                <span>{isProcessing ? 'Rectifying A4 & Tracing...' : 'Trace Item on A4 & Fine-Tune'}</span>
              </button>
              <button
                type="button"
                onClick={() => setStep('upload')}
                className="w-full py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors cursor-pointer"
              >
                Choose Different Photo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Fine-Tuning with Rectified A4 Overlay */}
      {step === 'finetune' && (
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 relative bg-slate-950 flex flex-col overflow-hidden">
            <div className="absolute top-3 left-3 z-20 flex items-center gap-2 bg-slate-900/95 px-3 py-1.5 rounded-lg border border-slate-800 shadow-lg">
              <button
                type="button"
                onClick={() => setShowOverlay(!showOverlay)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                  showOverlay
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {showOverlay ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                <span>{showOverlay ? 'Overlay Visible' : 'Overlay Hidden'}</span>
              </button>

              {showOverlay && (
                <div className="flex items-center gap-2 px-2 border-l border-slate-800 text-xs text-slate-300">
                  <span className="text-slate-400">Opacity:</span>
                  <input
                    aria-label="Overlay Opacity"
                    type="range"
                    min="0.1"
                    max="1.0"
                    step="0.05"
                    value={overlayOpacity}
                    onChange={(e) => setOverlayOpacity(parseFloat(e.target.value))}
                    className="w-20 accent-indigo-500 cursor-pointer"
                  />
                  <span className="font-mono text-[11px] text-indigo-300 w-9 tabular-nums">
                    {Math.round(overlayOpacity * 100)}%
                  </span>
                </div>
              )}

              <div className="h-4 w-px bg-slate-800" />
              <button
                type="button"
                onClick={() => setCanvasZoom((z) => Math.min(10.0, z * 1.2))}
                aria-label="Zoom in"
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setCanvasZoom((z) => Math.max(0.5, z / 1.2))}
                aria-label="Zoom out"
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="absolute bottom-3 left-3 z-20 bg-slate-900/95 px-3 py-1.5 rounded-lg border border-slate-800 text-xs text-slate-400 flex items-center gap-2.5">
              <span>A4 1:1 Scale</span>
              <span className="text-slate-600">·</span>
              <span>Drag vertices to refine contour</span>
              <span className="text-slate-600">·</span>
              <span>Double-click to insert point</span>
              <span className="text-slate-600">·</span>
              <span>Shift+Drag to pan</span>
            </div>

            <canvas
              ref={canvasRef}
              data-testid="finetune-canvas"
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onWheel={handleCanvasWheel}
              onDoubleClick={handleCanvasDoubleClick}
              className="w-full h-full cursor-crosshair block"
            />
          </div>

          <div className="w-80 bg-slate-900 border-l border-slate-800 p-4 flex flex-col justify-between overflow-y-auto shrink-0">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                <h3 className="font-semibold text-xs text-slate-200">Tool Parameters</h3>
                <button
                  type="button"
                  onClick={() => setStep('calibrate')}
                  className="text-xs text-cyan-400 hover:text-cyan-300 cursor-pointer"
                >
                  Re-calibrate A4
                </button>
              </div>

              <div>
                <label htmlFor="scanner-tool-name" className="text-xs font-medium text-slate-400 block mb-1">
                  Tool Name
                </label>
                <input
                  id="scanner-tool-name"
                  type="text"
                  value={toolName}
                  onChange={(e) => setToolName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 py-2.5 border-y border-slate-800 font-mono tabular-nums">
                <div>
                  <div className="text-[11px] text-slate-500">Length</div>
                  <div className="text-sm font-semibold text-cyan-300">{lengthMm} mm</div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">Width</div>
                  <div className="text-sm font-semibold text-indigo-300">{widthMm} mm</div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs text-slate-300 mb-1">
                  <span>Cavity Pocket Depth</span>
                  <span className="font-mono text-indigo-300 tabular-nums">{depthMm} mm</span>
                </div>
                <input
                  aria-label="Cavity Pocket Depth"
                  type="range"
                  min="3"
                  max="25"
                  step="0.5"
                  value={depthMm}
                  onChange={(e) => setDepthMm(parseFloat(e.target.value))}
                  className="w-full accent-indigo-500 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-xs text-slate-300 mb-1">
                  <span>Fit Clearance Offset</span>
                  <span className="font-mono text-cyan-300 tabular-nums">{clearanceMm} mm</span>
                </div>
                <input
                  aria-label="Fit Clearance Offset"
                  type="range"
                  min="0.2"
                  max="2.0"
                  step="0.1"
                  value={clearanceMm}
                  onChange={(e) => setClearanceMm(parseFloat(e.target.value))}
                  className="w-full accent-cyan-500 cursor-pointer"
                />
              </div>

              <div className="pt-3 border-t border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-xs text-orange-300">
                    Finger Grab Pockets
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const newPocket: FingerPocket = {
                        id: `fp-${Date.now()}`,
                        x: 0,
                        y: 0,
                        width: 18,
                        length: 30,
                        depth: depthMm + 2.0,
                        rotation: 0,
                        cornerRadius: 9,
                        slopeAngle: 30,
                      };
                      setFingerPockets([...fingerPockets, newPocket]);
                    }}
                    className="flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-orange-300 transition-colors cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add Pill</span>
                  </button>
                </div>

                {fingerPockets.map((fp, idx) => {
                  const maxCornerR = Math.min(fp.length / 2, fp.width / 2);
                  const currentR = Math.min(fp.cornerRadius ?? fp.width / 2, maxCornerR);
                  return (
                    <div
                      key={fp.id}
                      className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 space-y-2 mb-2"
                    >
                      <div className="flex items-center justify-between text-xs text-orange-300 font-medium">
                        <span>Pill #{idx + 1}</span>
                        <button
                          type="button"
                          aria-label={`Remove Pill Shape ${idx + 1}`}
                          onClick={() =>
                            setFingerPockets(fingerPockets.filter((p) => p.id !== fp.id))
                          }
                          className="text-rose-400 hover:text-rose-300 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400 font-mono tabular-nums">
                        <div>
                          <span>W: {fp.width}mm</span>
                          <input
                            aria-label={`Pill ${idx + 1} Width`}
                            type="range"
                            min="6"
                            max="60"
                            step="0.5"
                            value={fp.width}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              const nextMaxR = Math.min(fp.length / 2, val / 2);
                              setFingerPockets(
                                fingerPockets.map((p) =>
                                  p.id === fp.id
                                    ? {
                                        ...p,
                                        width: val,
                                        cornerRadius: Math.min(p.cornerRadius ?? nextMaxR, nextMaxR),
                                      }
                                    : p
                                )
                              );
                            }}
                            className="w-full accent-orange-500"
                          />
                        </div>
                        <div>
                          <span>L: {fp.length}mm</span>
                          <input
                            aria-label={`Pill ${idx + 1} Length`}
                            type="range"
                            min="8"
                            max="90"
                            step="0.5"
                            value={fp.length}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              const nextMaxR = Math.min(val / 2, fp.width / 2);
                              setFingerPockets(
                                fingerPockets.map((p) =>
                                  p.id === fp.id
                                    ? {
                                        ...p,
                                        length: val,
                                        cornerRadius: Math.min(p.cornerRadius ?? nextMaxR, nextMaxR),
                                      }
                                    : p
                                )
                              );
                            }}
                            className="w-full accent-orange-500"
                          />
                        </div>
                        <div>
                          <span>R: {currentR.toFixed(1)}mm</span>
                          <input
                            aria-label={`Pill ${idx + 1} Corner Radius`}
                            type="range"
                            min="0.5"
                            max={maxCornerR}
                            step="0.5"
                            value={currentR}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setFingerPockets(
                                fingerPockets.map((p) =>
                                  p.id === fp.id ? { ...p, cornerRadius: val } : p
                                )
                              );
                            }}
                            className="w-full accent-amber-400"
                          />
                        </div>
                        <div>
                          <span>Depth: {fp.depth}mm</span>
                          <input
                            aria-label={`Pill ${idx + 1} Depth`}
                            type="range"
                            min="3"
                            max="30"
                            step="0.5"
                            value={fp.depth}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setFingerPockets(
                                fingerPockets.map((p) =>
                                  p.id === fp.id ? { ...p, depth: val } : p
                                )
                              );
                            }}
                            className="w-full accent-orange-400"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="pt-3 border-t border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-cyan-300">
                    Tangent Curve Smoothing
                  </span>
                  <button
                    type="button"
                    aria-pressed={curveSmoothing > 0}
                    onClick={() => setCurveSmoothing((prev) => (prev > 0 ? 0 : 65))}
                    className={`px-2.5 py-0.5 rounded text-[11px] font-medium border transition-colors cursor-pointer ${
                      curveSmoothing > 0
                        ? 'bg-cyan-700/80 border-cyan-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {curveSmoothing > 0 ? 'On' : 'Off'}
                  </button>
                </div>

                <div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                    <span>Spline Strength</span>
                    <span className="font-mono text-cyan-300 tabular-nums">
                      {curveSmoothing > 0 ? `${curveSmoothing}% · C² Tangent` : 'Off (Polygonal)'}
                    </span>
                  </div>
                  <input
                    aria-label="Tangent Curve Smoothing"
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={curveSmoothing}
                    onChange={(e) => setCurveSmoothing(parseInt(e.target.value, 10))}
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Replaces sharp corner kinks with tangent C² arcs so 3D walls &amp; 45° chamfers print smoothly.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setContour(simplifyContour(contour, 0.5))}
                  className="w-full py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3 text-indigo-400" />
                  <span>Simplify Control Points ({contour.length} pts)</span>
                </button>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={handleSave}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-colors cursor-pointer"
              >
                <Check className="w-4 h-4 shrink-0" />
                <span>Save to Gridfinity Bin</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
