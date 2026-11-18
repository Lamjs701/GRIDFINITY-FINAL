import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  BaseplateConfig,
  BaseplateStyle,
  GridfinityConfig,
  MagnetMode,
  PlacedTool,
} from '../types';
import {
  BASEPLATE_LOWER_BEVEL,
  BASEPLATE_OUTER_CORNER_RADIUS,
  BASEPLATE_PITCH,
  BASEPLATE_PROFILE_HEIGHT,
  BASEPLATE_UPPER_BEVEL,
  BASEPLATE_VERTICAL_WALL,
  buildBaseplateTriangles,
  downloadBaseplateStl,
  getBaseplateDimensions,
} from '../utils/baseplateGeometry';
import { buildBinTriangles, trianglesToBufferGeometry } from '../utils/binGeometry';
import { getBinDimensions } from '../utils/geometry';
import {
  Box,
  Check,
  Download,
  Eye,
  Grid,
  Layers,
  Magnet,
  Maximize2,
  SlidersHorizontal,
} from 'lucide-react';

interface BaseplateViewProps {
  baseplateConfig: BaseplateConfig;
  onUpdateBaseplateConfig: (next: BaseplateConfig) => void;
  binConfig: GridfinityConfig;
  tools: PlacedTool[];
}

type ViewportMode = 'baseplate' | 'assembly';
type ColorPreset = 'graphite' | 'emerald' | 'orange' | 'chalk';
type MaterialFinish = 'matte' | 'satin' | 'carbon';
type CameraPreset = 'iso' | 'top' | 'front' | 'bottom';

const COLOR_HEX: Record<ColorPreset, number> = {
  graphite: 0x334155,
  emerald: 0x059669,
  orange: 0xea580c,
  chalk: 0xe2e8f0,
};

const FINISH_PARAMS: Record<MaterialFinish, { roughness: number; metalness: number; label: string }> = {
  matte: { roughness: 0.68, metalness: 0.04, label: 'Matte PLA' },
  satin: { roughness: 0.36, metalness: 0.14, label: 'Satin PETG' },
  carbon: { roughness: 0.52, metalness: 0.28, label: 'Carbon CF' },
};

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function disposeGroupChildren(group: THREE.Group | null) {
  if (!group) return;
  while (group.children.length > 0) {
    const obj = group.children[0] as THREE.Mesh | THREE.LineSegments;
    group.remove(obj);
    obj.geometry?.dispose();
    if (Array.isArray(obj.material)) {
      obj.material.forEach((m) => m.dispose());
    } else {
      obj.material?.dispose();
    }
  }
}

export const BaseplateView: React.FC<BaseplateViewProps> = ({
  baseplateConfig,
  onUpdateBaseplateConfig,
  binConfig,
  tools,
}) => {
  const [viewportMode, setViewportMode] = useState<ViewportMode>('baseplate');
  const [explodedLiftMm, setExplodedLiftMm] = useState<number>(0);
  const [translucentBaseplate, setTranslucentBaseplate] = useState<boolean>(false);
  const [wireframe, setWireframe] = useState<boolean>(false);
  const [colorPreset, setColorPreset] = useState<ColorPreset>('graphite');
  const [finish, setFinish] = useState<MaterialFinish>('satin');
  const [viewPreset, setViewPreset] = useState<CameraPreset>('iso');
  const [contextLost, setContextLost] = useState<boolean>(false);
  const [downloadedNotice, setDownloadedNotice] = useState<boolean>(false);

  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const baseplateGroupRef = useRef<THREE.Group | null>(null);
  const assemblyBinGroupRef = useRef<THREE.Group | null>(null);
  const isSoftwareGlRef = useRef<boolean>(false);
  const requestRenderRef = useRef<() => void>(() => {});
  const isInteractingRef = useRef<boolean>(false);
  const initialBuildDoneRef = useRef<boolean>(false);

  const bpDims = useMemo(() => getBaseplateDimensions(baseplateConfig), [baseplateConfig]);
  const binDims = useMemo(
    () =>
      getBinDimensions(
        binConfig.gridX,
        binConfig.gridY,
        binConfig.gridZ,
        binConfig.customHeightMm
      ),
    [binConfig.gridX, binConfig.gridY, binConfig.gridZ, binConfig.customHeightMm]
  );

  const baseplateTriangles = useMemo(
    () => buildBaseplateTriangles(baseplateConfig, { centered: true }),
    [baseplateConfig]
  );

  const assemblyBinTriangles = useMemo(() => {
    if (viewportMode !== 'assembly') return [];
    return buildBinTriangles(binConfig, tools, { centered: true });
  }, [viewportMode, binConfig, tools]);

  const binExceedsBaseplate =
    binConfig.gridX > baseplateConfig.gridX || binConfig.gridY > baseplateConfig.gridY;

  const estFilamentGrams = useMemo(() => {
    const unitAreaFactor = baseplateConfig.style === 'solid' ? 11.2 : 5.4;
    const magnetFactor =
      baseplateConfig.magnetMode === 'full'
        ? 1.45
        : baseplateConfig.magnetMode === 'corners'
        ? 1.18
        : 1.0;
    return Math.round(baseplateConfig.gridX * baseplateConfig.gridY * unitAreaFactor * magnetFactor);
  }, [baseplateConfig.gridX, baseplateConfig.gridY, baseplateConfig.style, baseplateConfig.magnetMode]);

  const estPrintMinutes = Math.max(12, Math.round(estFilamentGrams * 1.45));

  const targetZCenter =
    viewportMode === 'assembly'
      ? (bpDims.padHeight + binDims.height + explodedLiftMm) / 2
      : bpDims.totalHeight / 2;

  const maxSpan =
    viewportMode === 'assembly'
      ? Math.max(bpDims.width, bpDims.length, binDims.width, binDims.length, 84)
      : Math.max(bpDims.width, bpDims.length, 84);

  const orbitRef = useRef({
    theta: Math.PI / 4,
    phi: Math.PI / 3,
    radius: Math.max(bpDims.width, bpDims.length) * 1.85,
    target: new THREE.Vector3(0, 0, bpDims.totalHeight / 2),
    goalTheta: Math.PI / 4,
    goalPhi: Math.PI / 3,
    goalRadius: Math.max(bpDims.width, bpDims.length) * 1.85,
    goalTarget: new THREE.Vector3(0, 0, bpDims.totalHeight / 2),
    transitioning: false,
    isOrbiting: false,
    isPanning: false,
    lastMouseX: 0,
    lastMouseY: 0,
  });

  // Single-mount Three.js scene initialization (matches Viewer3D hardware/software-GL contract)
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    isSoftwareGlRef.current = isSoftwareGl;

    const clientWidth = Math.max(1, container.clientWidth);
    const clientHeight = Math.max(1, container.clientHeight);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x090d16);
    scene.fog = new THREE.FogExp2(0x090d16, 0.0011);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(36, clientWidth / clientHeight, 1, 2500);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(clientWidth, clientHeight);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const handleContextRestored = () => {
      setContextLost(false);
      requestRenderRef.current();
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmremGenerator.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();
    pmremGenerator.dispose();

    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x0f172a, 0.55);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff7ed, 1.35);
    keyLight.position.set(130, 140, 190);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.near = 20;
      keyLight.shadow.camera.far = 600;
      const d = 220;
      keyLight.shadow.camera.left = -d;
      keyLight.shadow.camera.right = d;
      keyLight.shadow.camera.top = d;
      keyLight.shadow.camera.bottom = -d;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
    }
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x60a5fa, 0.48);
    rimLight.position.set(-140, -110, 95);
    scene.add(rimLight);

    const underLight = new THREE.DirectionalLight(0x38bdf8, 0.3);
    underLight.position.set(0, 0, -140);
    scene.add(underLight);

    const bpGroup = new THREE.Group();
    scene.add(bpGroup);
    baseplateGroupRef.current = bpGroup;

    const binGroup = new THREE.Group();
    scene.add(binGroup);
    assemblyBinGroupRef.current = binGroup;

    const gridHelper = new THREE.GridHelper(520, 24, 0x1e293b, 0x111827);
    gridHelper.rotation.x = Math.PI / 2;
    gridHelper.position.z = -0.4;
    scene.add(gridHelper);

    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 128;
    shadowCanvas.height = 128;
    const sCtx = shadowCanvas.getContext('2d');
    if (sCtx) {
      const grad = sCtx.createRadialGradient(64, 64, 6, 64, 64, 64);
      grad.addColorStop(0, 'rgba(2, 6, 23, 0.55)');
      grad.addColorStop(1, 'rgba(2, 6, 23, 0.0)');
      sCtx.fillStyle = grad;
      sCtx.fillRect(0, 0, 128, 128);
    }
    const shadowTex = new THREE.CanvasTexture(shadowCanvas);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
    });
    const shadowDisc = new THREE.Mesh(new THREE.CircleGeometry(180, 32), shadowMat);
    shadowDisc.position.z = -0.25;
    scene.add(shadowDisc);

    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let lastTickMs = performance.now();

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync?.(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (!sync) {
        frameId = window.setTimeout(cb, 40);
        return;
      }
      gl.flush();
      let polls = 0;
      const poll = () => {
        polls += 1;
        const state = gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED && polls < 10) {
          frameId = window.setTimeout(poll, 5);
        } else {
          gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 40);
        }
      };
      frameId = window.setTimeout(poll, 5);
    };

    const applyCameraAndRender = (dt: number) => {
      const o = orbitRef.current;
      if (o.transitioning) {
        const lambda = 10;
        o.theta = THREE.MathUtils.damp(o.theta, o.goalTheta, lambda, dt);
        o.phi = THREE.MathUtils.damp(o.phi, o.goalPhi, lambda, dt);
        o.radius = THREE.MathUtils.damp(o.radius, o.goalRadius, lambda, dt);
        o.target.x = THREE.MathUtils.damp(o.target.x, o.goalTarget.x, lambda, dt);
        o.target.y = THREE.MathUtils.damp(o.target.y, o.goalTarget.y, lambda, dt);
        o.target.z = THREE.MathUtils.damp(o.target.z, o.goalTarget.z, lambda, dt);

        const settled =
          Math.abs(o.theta - o.goalTheta) < 0.002 &&
          Math.abs(o.phi - o.goalPhi) < 0.002 &&
          Math.abs(o.radius - o.goalRadius) < 0.25 &&
          o.target.distanceTo(o.goalTarget) < 0.1;

        if (settled) {
          o.theta = o.goalTheta;
          o.phi = o.goalPhi;
          o.radius = o.goalRadius;
          o.target.copy(o.goalTarget);
          o.transitioning = false;
        }
      }

      camera.position.x = o.target.x + o.radius * Math.sin(o.phi) * Math.sin(o.theta);
      camera.position.y = o.target.y - o.radius * Math.sin(o.phi) * Math.cos(o.theta);
      camera.position.z = o.target.z + o.radius * Math.cos(o.phi);
      camera.up.set(0, 0, 1);
      camera.lookAt(o.target);
      renderer.render(scene, camera);
    };

    const requestRender = () => {
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame((now) => {
        const dt = Math.min(0.1, Math.max(0.001, (now - lastTickMs) / 1000));
        lastTickMs = now;
        renderDirty = false;
        applyCameraAndRender(dt);

        const done = () => {
          renderBusy = false;
          if (renderDirty || orbitRef.current.transitioning) {
            requestRender();
          }
        };
        if (isSoftwareGl) {
          afterDraw(done);
        } else {
          done();
        }
      });
    };

    requestRenderRef.current = requestRender;
    requestRender();

    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    };

    window.addEventListener('resize', handleResize);
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
      envTarget.dispose();
      shadowTex.dispose();
      shadowMat.dispose();
      shadowDisc.geometry.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Build Baseplate + Optional Assembly Bin Meshes
  useEffect(() => {
    const bpGroup = baseplateGroupRef.current;
    const binGroup = assemblyBinGroupRef.current;
    if (!bpGroup || !binGroup) return;

    const rebuildMeshes = () => {
      disposeGroupChildren(bpGroup);
      disposeGroupChildren(binGroup);

      const finishCfg = FINISH_PARAMS[finish];
      const useTranslucent = viewportMode === 'assembly' && translucentBaseplate;

      const bpMaterial = new THREE.MeshStandardMaterial({
        color: COLOR_HEX[colorPreset],
        roughness: finishCfg.roughness,
        metalness: finishCfg.metalness,
        wireframe,
        transparent: useTranslucent,
        opacity: useTranslucent ? 0.6 : 1.0,
        side: THREE.DoubleSide,
      });

      const bpGeo = trianglesToBufferGeometry(baseplateTriangles);
      const bpMesh = new THREE.Mesh(bpGeo, bpMaterial);
      bpMesh.castShadow = !useTranslucent;
      bpMesh.receiveShadow = true;
      bpGroup.add(bpMesh);

      const bpEdges = new THREE.EdgesGeometry(bpGeo, 24);
      const bpLine = new THREE.LineSegments(
        bpEdges,
        new THREE.LineBasicMaterial({
          color: useTranslucent ? 0x38bdf8 : colorPreset === 'chalk' ? 0x475569 : 0x94a3b8,
          transparent: true,
          opacity: useTranslucent ? 0.65 : 0.34,
        })
      );
      bpGroup.add(bpLine);

      if (viewportMode === 'assembly' && assemblyBinTriangles.length > 0) {
        const binColor = colorPreset === 'emerald' ? 0x475569 : 0x059669;
        const binMat = new THREE.MeshStandardMaterial({
          color: binColor,
          roughness: finishCfg.roughness,
          metalness: finishCfg.metalness,
          wireframe,
          side: THREE.DoubleSide,
        });
        const binGeo = trianglesToBufferGeometry(assemblyBinTriangles);
        const binMesh = new THREE.Mesh(binGeo, binMat);
        binMesh.castShadow = true;
        binMesh.receiveShadow = true;
        // Seat bin feet at socket shelf Z = bpDims.padHeight + 0.02mm + explodedLiftMm
        const binZ = bpDims.padHeight + explodedLiftMm + 0.02;
        binMesh.position.z = binZ;
        binGroup.add(binMesh);

        const binEdges = new THREE.EdgesGeometry(binGeo, 24);
        const binLine = new THREE.LineSegments(
          binEdges,
          new THREE.LineBasicMaterial({
            color: 0xa7f3d0,
            transparent: true,
            opacity: 0.35,
          })
        );
        binLine.position.z = binZ;
        binGroup.add(binLine);
      }

      orbitRef.current.target.z = targetZCenter;
      orbitRef.current.goalTarget.z = targetZCenter;
      requestRenderRef.current();
    };

    if (!initialBuildDoneRef.current) {
      initialBuildDoneRef.current = true;
      rebuildMeshes();
      return;
    }

    const timer = window.setTimeout(rebuildMeshes, 40);
    return () => clearTimeout(timer);
  }, [
    baseplateTriangles,
    assemblyBinTriangles,
    viewportMode,
    explodedLiftMm,
    translucentBaseplate,
    colorPreset,
    finish,
    wireframe,
    bpDims.padHeight,
    targetZCenter,
  ]);

  const setCameraPreset = (preset: CameraPreset) => {
    setViewPreset(preset);
    const o = orbitRef.current;
    const dist = maxSpan * 1.85;
    o.goalTarget.set(0, 0, targetZCenter);

    if (preset === 'iso') {
      o.goalTheta = Math.PI / 4;
      o.goalPhi = Math.PI / 3;
      o.goalRadius = dist;
    } else if (preset === 'top') {
      o.goalTheta = 0;
      o.goalPhi = 0.06;
      o.goalRadius = dist * 0.92;
    } else if (preset === 'front') {
      o.goalTheta = 0;
      o.goalPhi = Math.PI / 2 - 0.12;
      o.goalRadius = dist * 0.95;
    } else {
      o.goalTheta = Math.PI / 5;
      o.goalPhi = Math.PI - 0.18;
      o.goalRadius = dist * 0.95;
    }

    if (isSoftwareGlRef.current) {
      o.theta = o.goalTheta;
      o.phi = o.goalPhi;
      o.radius = o.goalRadius;
      o.target.copy(o.goalTarget);
      o.transitioning = false;
    } else {
      o.transitioning = true;
    }
    requestRenderRef.current();
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    isInteractingRef.current = true;
    const o = orbitRef.current;
    o.transitioning = false;
    o.isOrbiting = e.button === 0 && !e.shiftKey;
    o.isPanning = e.button === 1 || e.button === 2 || e.shiftKey;
    o.lastMouseX = e.clientX;
    o.lastMouseY = e.clientY;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isInteractingRef.current) return;
    const o = orbitRef.current;
    const dx = e.clientX - o.lastMouseX;
    const dy = e.clientY - o.lastMouseY;
    o.lastMouseX = e.clientX;
    o.lastMouseY = e.clientY;

    if (o.isOrbiting) {
      o.theta -= dx * 0.008;
      o.phi = Math.max(0.05, Math.min(Math.PI - 0.05, o.phi - dy * 0.008));
      requestRenderRef.current();
    } else if (o.isPanning) {
      const panSpeed = o.radius * 0.0015;
      o.target.x -= dx * panSpeed;
      o.target.y += dy * panSpeed;
      requestRenderRef.current();
    }
  };

  const handlePointerUp = () => {
    isInteractingRef.current = false;
    orbitRef.current.isOrbiting = false;
    orbitRef.current.isPanning = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const o = orbitRef.current;
    o.transitioning = false;
    const zoomFactor = e.deltaY < 0 ? 0.88 : 1.14;
    o.radius = Math.max(40, Math.min(950, o.radius * zoomFactor));
    requestRenderRef.current();
  };

  const handleDownload = () => {
    downloadBaseplateStl(baseplateConfig);
    setDownloadedNotice(true);
    setTimeout(() => setDownloadedNotice(false), 2200);
  };

  const magnetSummary =
    baseplateConfig.magnetMode === 'full'
      ? `Full (${bpDims.magnetCount}×)`
      : baseplateConfig.magnetMode === 'corners'
      ? '4 Corners'
      : 'None';

  return (
    <div className="flex-1 flex overflow-hidden bg-slate-950 text-slate-100">
      {/* Left Independent Baseplate Inspector Rail */}
      <aside className="w-72 shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Grid className="w-4 h-4 text-cyan-400" />
            <h1 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
              Baseplate Generator
            </h1>
          </div>
          <span className="text-[11px] font-mono text-cyan-300 tabular-nums">
            {baseplateConfig.gridX}×{baseplateConfig.gridY}U
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Standalone Independence Note */}
          <div className="rounded-lg bg-slate-950 border border-slate-800 p-3 text-[11px] text-slate-400 leading-relaxed">
            Standalone v5 baseplate settings. Modifying dimensions, style, or magnets here{' '}
            <strong className="text-slate-200 font-medium">never alters</strong> your bin or cutouts.
          </div>

          {/* Baseplate Grid Units */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200">Baseplate Grid</span>
              {(baseplateConfig.gridX !== binConfig.gridX ||
                baseplateConfig.gridY !== binConfig.gridY) && (
                <button
                  type="button"
                  onClick={() =>
                    onUpdateBaseplateConfig({
                      ...baseplateConfig,
                      gridX: binConfig.gridX,
                      gridY: binConfig.gridY,
                    })
                  }
                  className="text-[11px] text-cyan-300 hover:text-cyan-200 font-medium cursor-pointer"
                >
                  Match Bin ({binConfig.gridX}×{binConfig.gridY}U)
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                <label
                  htmlFor="bp-grid-x"
                  className="text-[11px] text-slate-400 block mb-1"
                >
                  Cols (X · 42mm)
                </label>
                <div className="flex items-center justify-between gap-1">
                  <button
                    type="button"
                    aria-label="Decrease Baseplate Columns"
                    onClick={() =>
                      onUpdateBaseplateConfig({
                        ...baseplateConfig,
                        gridX: Math.max(1, baseplateConfig.gridX - 1),
                      })
                    }
                    className="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-sm cursor-pointer"
                  >
                    −
                  </button>
                  <input
                    id="bp-grid-x"
                    aria-label="Baseplate Columns"
                    type="number"
                    min="1"
                    max="12"
                    value={baseplateConfig.gridX}
                    onChange={(e) =>
                      onUpdateBaseplateConfig({
                        ...baseplateConfig,
                        gridX: Math.max(1, Math.min(12, parseInt(e.target.value, 10) || 1)),
                      })
                    }
                    className="w-10 bg-transparent text-center font-mono text-sm font-semibold text-white focus:outline-none tabular-nums"
                  />
                  <button
                    type="button"
                    aria-label="Increase Baseplate Columns"
                    onClick={() =>
                      onUpdateBaseplateConfig({
                        ...baseplateConfig,
                        gridX: Math.min(12, baseplateConfig.gridX + 1),
                      })
                    }
                    className="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-sm cursor-pointer"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                <label
                  htmlFor="bp-grid-y"
                  className="text-[11px] text-slate-400 block mb-1"
                >
                  Rows (Y · 42mm)
                </label>
                <div className="flex items-center justify-between gap-1">
                  <button
                    type="button"
                    aria-label="Decrease Baseplate Rows"
                    onClick={() =>
                      onUpdateBaseplateConfig({
                        ...baseplateConfig,
                        gridY: Math.max(1, baseplateConfig.gridY - 1),
                      })
                    }
                    className="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-sm cursor-pointer"
                  >
                    −
                  </button>
                  <input
                    id="bp-grid-y"
                    aria-label="Baseplate Rows"
                    type="number"
                    min="1"
                    max="12"
                    value={baseplateConfig.gridY}
                    onChange={(e) =>
                      onUpdateBaseplateConfig({
                        ...baseplateConfig,
                        gridY: Math.max(1, Math.min(12, parseInt(e.target.value, 10) || 1)),
                      })
                    }
                    className="w-10 bg-transparent text-center font-mono text-sm font-semibold text-white focus:outline-none tabular-nums"
                  />
                  <button
                    type="button"
                    aria-label="Increase Baseplate Rows"
                    onClick={() =>
                      onUpdateBaseplateConfig({
                        ...baseplateConfig,
                        gridY: Math.min(12, baseplateConfig.gridY + 1),
                      })
                    }
                    className="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-sm cursor-pointer"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Frame Style: Skeleton vs Solid */}
          <section className="space-y-2 pt-3 border-t border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200">Baseplate Structure</span>
              <span className="text-[11px] font-mono text-slate-400">
                {bpDims.totalHeight.toFixed(2)}mm H
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800">
              {(
                [
                  { id: 'skeleton', label: 'Skeleton', desc: 'Open cell frame' },
                  { id: 'solid', label: 'Solid', desc: 'Full closed floor' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={baseplateConfig.style === opt.id}
                  onClick={() =>
                    onUpdateBaseplateConfig({
                      ...baseplateConfig,
                      style: opt.id as BaseplateStyle,
                    })
                  }
                  className={`py-2 px-2 rounded-md text-left transition-colors cursor-pointer ${
                    baseplateConfig.style === opt.id
                      ? 'bg-cyan-700 text-white'
                      : 'text-slate-400 hover:text-white hover:bg-slate-900'
                  }`}
                >
                  <div className="text-xs font-semibold">{opt.label}</div>
                  <div
                    className={`text-[10px] mt-0.5 ${
                      baseplateConfig.style === opt.id ? 'text-cyan-100' : 'text-slate-500'
                    }`}
                  >
                    {opt.desc}
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* Magnet Mode: 4 Corners | Full | None */}
          <section className="space-y-2.5 pt-3 border-t border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Magnet className="w-3.5 h-3.5 text-cyan-400" />
                {baseplateConfig.magnetMode === 'none'
                  ? 'Magnets'
                  : `Magnets (${baseplateConfig.magnetDiameter.toFixed(1)}Ø × ${baseplateConfig.magnetDepth.toFixed(1)}mm)`}
              </span>
              <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                {bpDims.magnetCount}×
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
              {(
                [
                  { id: 'corners', label: '4 Corners' },
                  { id: 'full', label: 'Full' },
                  { id: 'none', label: 'None' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={baseplateConfig.magnetMode === opt.id}
                  onClick={() =>
                    onUpdateBaseplateConfig({
                      ...baseplateConfig,
                      magnetMode: opt.id as MagnetMode,
                    })
                  }
                  className={`py-1.5 rounded text-xs font-medium transition-colors cursor-pointer ${
                    baseplateConfig.magnetMode === opt.id
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {baseplateConfig.magnetMode !== 'none' && (
              <div className="bg-slate-950 rounded-lg border border-slate-800 p-2.5 space-y-2.5">
                <div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                    <label htmlFor="bp-magnet-diameter">Pocket Diameter</label>
                    <span className="font-mono text-slate-200 tabular-nums">
                      {baseplateConfig.magnetDiameter.toFixed(1)} mm
                    </span>
                  </div>
                  <input
                    id="bp-magnet-diameter"
                    aria-label="Baseplate Magnet Diameter"
                    type="range"
                    min="3.0"
                    max="8.6"
                    step="0.1"
                    value={baseplateConfig.magnetDiameter}
                    onChange={(e) =>
                      onUpdateBaseplateConfig({
                        ...baseplateConfig,
                        magnetDiameter: parseFloat(e.target.value),
                      })
                    }
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                    <label htmlFor="bp-magnet-depth">Pocket Depth</label>
                    <span className="font-mono text-slate-200 tabular-nums">
                      {baseplateConfig.magnetDepth.toFixed(1)} mm
                    </span>
                  </div>
                  <input
                    id="bp-magnet-depth"
                    aria-label="Baseplate Magnet Depth"
                    type="range"
                    min="0.8"
                    max="5.0"
                    step="0.1"
                    value={baseplateConfig.magnetDepth}
                    onChange={(e) =>
                      onUpdateBaseplateConfig({
                        ...baseplateConfig,
                        magnetDepth: parseFloat(e.target.value),
                      })
                    }
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                </div>

                <div className="grid grid-cols-4 gap-1 pt-0.5">
                  {(
                    [
                      { label: '5×2', d: 5.4, h: 2.4 },
                      { label: '6×2', d: 6.5, h: 2.4 },
                      { label: '6×3', d: 6.5, h: 3.4 },
                      { label: '8×2', d: 8.4, h: 2.4 },
                    ] as const
                  ).map((preset) => {
                    const isMatch =
                      Math.abs(baseplateConfig.magnetDiameter - preset.d) < 0.05 &&
                      Math.abs(baseplateConfig.magnetDepth - preset.h) < 0.05;
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() =>
                          onUpdateBaseplateConfig({
                            ...baseplateConfig,
                            magnetDiameter: preset.d,
                            magnetDepth: preset.h,
                          })
                        }
                        className={`py-1 rounded text-[10px] font-mono font-medium border transition-colors cursor-pointer ${
                          isMatch
                            ? 'bg-cyan-900/70 border-cyan-500 text-cyan-200'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <label className="flex items-center justify-between pt-1 text-xs text-slate-300 cursor-pointer">
              <span>M3 Screw Holes (3.0Ø)</span>
              <input
                type="checkbox"
                checked={baseplateConfig.hasScrews}
                onChange={(e) =>
                  onUpdateBaseplateConfig({
                    ...baseplateConfig,
                    hasScrews: e.target.checked,
                  })
                }
                className="accent-cyan-500 rounded cursor-pointer"
              />
            </label>
          </section>

          {/* Assembly Preview & Inspection Controls */}
          <section className="space-y-3 pt-3 border-t border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Box className="w-3.5 h-3.5 text-emerald-400" />
                Assembly &amp; Fit Check
              </span>
            </div>

            <div className="grid grid-cols-2 gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
              <button
                type="button"
                aria-pressed={viewportMode === 'baseplate'}
                onClick={() => setViewportMode('baseplate')}
                className={`py-1.5 rounded text-xs font-medium transition-colors cursor-pointer ${
                  viewportMode === 'baseplate'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Baseplate Only
              </button>
              <button
                type="button"
                aria-pressed={viewportMode === 'assembly'}
                onClick={() => setViewportMode('assembly')}
                className={`py-1.5 rounded text-xs font-medium transition-colors cursor-pointer ${
                  viewportMode === 'assembly'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Assembly View
              </button>
            </div>

            {viewportMode === 'assembly' && (
              <div className="space-y-2.5 bg-slate-950 p-3 rounded-lg border border-slate-800">
                <div>
                  <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>Exploded Lift</span>
                    <span className="font-mono text-emerald-300 tabular-nums">
                      {explodedLiftMm === 0 ? 'Seated (0mm)' : `+${explodedLiftMm.toFixed(1)}mm`}
                    </span>
                  </div>
                  <input
                    aria-label="Assembly Exploded Lift"
                    type="range"
                    min="0"
                    max="25"
                    step="0.5"
                    value={explodedLiftMm}
                    onChange={(e) => setExplodedLiftMm(parseFloat(e.target.value))}
                    className="w-full accent-emerald-500 cursor-pointer"
                  />
                </div>

                <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer">
                  <span className="flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5 text-cyan-400" />
                    Translucent Baseplate
                  </span>
                  <input
                    type="checkbox"
                    checked={translucentBaseplate}
                    onChange={(e) => setTranslucentBaseplate(e.target.checked)}
                    className="accent-cyan-500 rounded cursor-pointer"
                  />
                </label>

                {binExceedsBaseplate && (
                  <div className="p-2 rounded bg-amber-950/60 border border-amber-800/70 text-[11px] text-amber-200 space-y-1.5">
                    <div>
                      Current bin ({binConfig.gridX}×{binConfig.gridY}U) overhangs this{' '}
                      {baseplateConfig.gridX}×{baseplateConfig.gridY}U plate.
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateBaseplateConfig({
                          ...baseplateConfig,
                          gridX: Math.max(baseplateConfig.gridX, binConfig.gridX),
                          gridY: Math.max(baseplateConfig.gridY, binConfig.gridY),
                        })
                      }
                      className="w-full py-1 px-2 rounded bg-amber-700 hover:bg-amber-600 text-white font-medium cursor-pointer"
                    >
                      Fit Baseplate to Bin
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Engineering Profile Spec Card & Print Estimate */}
          <section className="rounded-lg bg-slate-950 border border-slate-800 p-3 space-y-2 text-[11px]">
            <div className="flex items-center justify-between font-semibold text-slate-200">
              <span className="flex items-center gap-1.5">
                <SlidersHorizontal className="w-3.5 h-3.5 text-cyan-400" />
                v5 Profile Specs
              </span>
              <span className="font-mono text-cyan-300">8.0Ø Corner</span>
            </div>
            <div className="grid grid-cols-2 gap-y-1 text-slate-400 font-mono">
              <span>Footprint</span>
              <span className="text-right text-slate-200">
                {bpDims.width.toFixed(0)} × {bpDims.length.toFixed(0)} mm
              </span>
              <span>Socket Profile</span>
              <span className="text-right text-slate-200">
                {BASEPLATE_PROFILE_HEIGHT.toFixed(2)} mm
              </span>
              <span>45° / Wall / 45°</span>
              <span className="text-right text-slate-200">
                {BASEPLATE_LOWER_BEVEL}/{BASEPLATE_VERTICAL_WALL}/{BASEPLATE_UPPER_BEVEL}mm
              </span>
              <span>Outer Radius</span>
              <span className="text-right text-slate-200">
                R{BASEPLATE_OUTER_CORNER_RADIUS.toFixed(1)} · {BASEPLATE_PITCH}mm
              </span>
              <span>Mesh / Est.</span>
              <span className="text-right text-slate-200">
                {baseplateTriangles.length.toLocaleString()} tris · ~{estFilamentGrams}g (~
                {estPrintMinutes}m)
              </span>
            </div>
          </section>
        </div>

        {/* Sticky Primary STL Export Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900">
          <button
            type="button"
            onClick={handleDownload}
            className="w-full py-2.5 px-4 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors shadow-lg cursor-pointer"
          >
            {downloadedNotice ? (
              <>
                <Check className="w-4 h-4" />
                <span>Baseplate STL Downloaded</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>Download Baseplate .STL</span>
              </>
            )}
          </button>
        </div>
      </aside>

      {/* Right 3D Baseplate & Assembly Viewport */}
      <div
        className="relative flex-1 h-full bg-[#090d16] flex flex-col overflow-hidden select-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Top-Left Viewport Mode Toggle Pill (solid surface, no backdrop-blur) */}
        <div
          className="absolute top-3 left-3 z-20 flex items-center gap-1 bg-slate-900/95 p-1 rounded-xl border border-slate-800 shadow-lg"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            aria-pressed={viewportMode === 'baseplate'}
            onClick={() => setViewportMode('baseplate')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              viewportMode === 'baseplate'
                ? 'bg-cyan-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Grid className="w-3.5 h-3.5" />
            <span>Baseplate Only</span>
          </button>
          <button
            type="button"
            aria-pressed={viewportMode === 'assembly'}
            onClick={() => setViewportMode('assembly')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              viewportMode === 'assembly'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span>Assembly View</span>
          </button>
        </div>

        {/* Top-Right Camera Presets, Wireframe & Swatches */}
        <div
          className="absolute top-3 right-3 z-20 flex items-center gap-2 bg-slate-900/95 px-2.5 py-1.5 rounded-xl border border-slate-800 shadow-lg"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-0.5 bg-slate-950 p-0.5 rounded-lg border border-slate-800">
            {(['iso', 'top', 'front', 'bottom'] as const).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setCameraPreset(preset)}
                className={`px-2 py-1 rounded text-[11px] font-medium capitalize transition-colors whitespace-nowrap cursor-pointer ${
                  viewPreset === preset
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {preset}
              </button>
            ))}
          </div>

          <div className="h-4 w-px bg-slate-800" />

          <button
            type="button"
            onClick={() => setWireframe(!wireframe)}
            aria-pressed={wireframe}
            aria-label="Toggle Wireframe"
            title="Toggle Mesh Wireframe"
            className={`p-1.5 rounded text-xs transition-colors cursor-pointer ${
              wireframe
                ? 'bg-indigo-950 text-indigo-300 border border-indigo-700'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
          </button>

          <div className="h-4 w-px bg-slate-800" />

          <div className="flex items-center gap-1.5">
            {(['graphite', 'emerald', 'orange', 'chalk'] as const).map((col) => (
              <button
                key={col}
                type="button"
                aria-label={`Baseplate Color: ${col}`}
                onClick={() => setColorPreset(col)}
                className={`w-3.5 h-3.5 rounded-full border transition-transform cursor-pointer ${
                  col === 'graphite'
                    ? 'bg-slate-600'
                    : col === 'emerald'
                    ? 'bg-emerald-500'
                    : col === 'orange'
                    ? 'bg-orange-500'
                    : 'bg-slate-200'
                } ${
                  colorPreset === col
                    ? 'border-white scale-110'
                    : 'border-transparent opacity-60 hover:opacity-100'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Bottom Material Finish & Live Dimensions Dock */}
        <div className="absolute bottom-3 left-3 right-3 z-20 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
          <div
            className="pointer-events-auto flex items-center gap-1 bg-slate-900/95 p-1 rounded-lg border border-slate-800"
            onPointerDown={(e) => e.stopPropagation()}
          >
            {(['matte', 'satin', 'carbon'] as const).map((matKey) => (
              <button
                key={matKey}
                type="button"
                aria-pressed={finish === matKey}
                onClick={() => setFinish(matKey)}
                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  finish === matKey
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {FINISH_PARAMS[matKey].label}
              </button>
            ))}
          </div>

          <div className="bg-slate-900/95 px-3 py-1.5 rounded-lg border border-slate-800 text-[11px] font-mono text-slate-300 flex items-center gap-3 tabular-nums">
            <span>
              {baseplateConfig.gridX}×{baseplateConfig.gridY}U Baseplate
            </span>
            <span className="text-slate-600">·</span>
            <span className="text-cyan-300">
              {bpDims.width.toFixed(0)} × {bpDims.length.toFixed(0)} × {bpDims.totalHeight.toFixed(2)} mm
            </span>
            <span className="text-slate-600">·</span>
            <span className="capitalize">{baseplateConfig.style}</span>
            <span className="text-slate-600">·</span>
            <span>
              Magnets: {magnetSummary}
              {baseplateConfig.magnetMode !== 'none'
                ? ` (${baseplateConfig.magnetDiameter.toFixed(1)}Ø×${baseplateConfig.magnetDepth.toFixed(1)})`
                : ''}
            </span>
            {viewportMode === 'assembly' && (
              <>
                <span className="text-slate-600">·</span>
                <span className="text-emerald-300">
                  Bin: {binConfig.gridX}×{binConfig.gridY}U
                </span>
              </>
            )}
          </div>
        </div>

        {contextLost && (
          <div className="absolute inset-0 z-30 bg-slate-950/90 flex items-center justify-center p-6 text-center">
            <div className="max-w-sm space-y-2">
              <h3 className="text-sm font-semibold text-white">3D Viewport Context Paused</h3>
              <p className="text-xs text-slate-400">
                Your browser suspended the WebGL context. Switch tabs or reload to resume 3D
                rendering; Baseplate STL export remains available.
              </p>
            </div>
          </div>
        )}

        <div
          ref={mountRef}
          data-testid="baseplate-3d-canvas"
          className="w-full h-full cursor-grab active:cursor-grabbing block"
        />
      </div>
    </div>
  );
};
