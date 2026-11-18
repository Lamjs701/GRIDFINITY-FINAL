import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PlacedTool, GridfinityConfig } from '../types';
import {
  getBinDimensions,
  getStackingLipProfile,
  STACKING_LIP_HEIGHT,
} from '../utils/geometry';
import { buildBinTriangles, trianglesToBufferGeometry } from '../utils/binGeometry';
import {
  BASEPLATE_PROFILE_HEIGHT,
  buildBaseplateTriangles,
  createDefaultBaseplateConfig,
  getBaseplateDimensions,
} from '../utils/baseplateGeometry';
import { Grid, Layers } from 'lucide-react';

interface Viewer3DProps {
  config: GridfinityConfig;
  tools: PlacedTool[];
  selectedToolId: string | null;
}

type ColorPreset = 'emerald' | 'graphite' | 'orange' | 'chalk';
type MaterialFinish = 'matte' | 'satin' | 'carbon';
type CameraPreset = 'iso' | 'top' | 'front' | 'bottom';

const COLOR_HEX: Record<ColorPreset, number> = {
  emerald: 0x059669,
  graphite: 0x334155,
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

export const Viewer3D: React.FC<Viewer3DProps> = ({ config, tools }) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const meshGroupRef = useRef<THREE.Group | null>(null);
  const baseplateGroupRef = useRef<THREE.Group | null>(null);
  const isSoftwareGlRef = useRef<boolean>(false);

  const [wireframe, setWireframe] = useState<boolean>(false);
  const [showBaseplate, setShowBaseplate] = useState<boolean>(false);
  const [colorPreset, setColorPreset] = useState<ColorPreset>('emerald');
  const [finish, setFinish] = useState<MaterialFinish>('satin');
  const [viewPreset, setViewPreset] = useState<CameraPreset>('iso');
  const [contextLost, setContextLost] = useState<boolean>(false);

  const { width: binWidth, length: binLength, height: binHeight } = getBinDimensions(
    config.gridX,
    config.gridY,
    config.gridZ,
    config.customHeightMm
  );

  // Current & target spherical orbit coordinates for smooth damped camera transitions
  const orbitRef = useRef({
    theta: Math.PI / 4,
    phi: Math.PI / 3,
    radius: Math.max(binWidth, binLength) * 1.95,
    target: new THREE.Vector3(0, 0, binHeight / 2),
    goalTheta: Math.PI / 4,
    goalPhi: Math.PI / 3,
    goalRadius: Math.max(binWidth, binLength) * 1.95,
    goalTarget: new THREE.Vector3(0, 0, binHeight / 2),
    transitioning: false,
    isOrbiting: false,
    isPanning: false,
    lastMouseX: 0,
    lastMouseY: 0,
  });

  const requestRenderRef = useRef<() => void>(() => {});
  const isInteractingRef = useRef<boolean>(false);

  // Build parametric Gridfinity v5 mesh centered around X=0, Y=0, Z=0..totalHeight
  const buildBinGeometry = useCallback(() => {
    const tris = buildBinTriangles(config, tools, { centered: true });
    return trianglesToBufferGeometry(tris);
  }, [config, tools]);

  // Initialize WebGL Scene once
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

    // Procedural Studio IBL Environment
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmremGenerator.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();
    pmremGenerator.dispose();

    // Warm/cool 3-point studio lighting rig
    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x0f172a, 0.55);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff7ed, 1.35);
    keyLight.position.set(130, 140, 190);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.near = 20;
      keyLight.shadow.camera.far = 600;
      const d = 180;
      keyLight.shadow.camera.left = -d;
      keyLight.shadow.camera.right = d;
      keyLight.shadow.camera.top = d;
      keyLight.shadow.camera.bottom = -d;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
    }
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x60a5fa, 0.45);
    rimLight.position.set(-140, -110, 90);
    scene.add(rimLight);

    const underLight = new THREE.DirectionalLight(0x38bdf8, 0.28);
    underLight.position.set(0, 0, -140);
    scene.add(underLight);

    const meshGroup = new THREE.Group();
    scene.add(meshGroup);
    meshGroupRef.current = meshGroup;

    const baseplateGroup = new THREE.Group();
    scene.add(baseplateGroup);
    baseplateGroupRef.current = baseplateGroup;

    // Subtle grounded workshop floor grid (disjoint Y/Z offset to prevent Z-fighting)
    const gridHelper = new THREE.GridHelper(420, 20, 0x1e293b, 0x111827);
    gridHelper.rotation.x = Math.PI / 2;
    gridHelper.position.z = -0.4;
    scene.add(gridHelper);

    // Subtle radial contact shadow disc
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
    const shadowDisc = new THREE.Mesh(new THREE.CircleGeometry(140, 32), shadowMat);
    shadowDisc.position.z = -0.25;
    scene.add(shadowDisc);

    // Coalesced on-demand renderer with software-WebGL afterDraw pacing
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

  const initialBuildDoneRef = useRef<boolean>(false);

  // Update Bin Geometry & Materials (immediate on first mount, debounced 60ms on edits)
  useEffect(() => {
    const group = meshGroupRef.current;
    if (!group) return;

    const rebuildMesh = () => {
      while (group.children.length > 0) {
        const obj = group.children[0] as THREE.Mesh | THREE.LineSegments;
        group.remove(obj);
        obj.geometry?.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material?.dispose();
      }

      const finishCfg = FINISH_PARAMS[finish];
      const material = new THREE.MeshStandardMaterial({
        color: COLOR_HEX[colorPreset],
        roughness: finishCfg.roughness,
        metalness: finishCfg.metalness,
        wireframe,
        side: THREE.DoubleSide,
      });

      const geo = buildBinGeometry();
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);

      const edges = new THREE.EdgesGeometry(geo, 24);
      const lineMaterial = new THREE.LineBasicMaterial({
        color: colorPreset === 'chalk' ? 0x475569 : 0x94a3b8,
        transparent: true,
        opacity: colorPreset === 'emerald' ? 0.35 : 0.28,
      });
      const wireMesh = new THREE.LineSegments(edges, lineMaterial);
      group.add(wireMesh);

      // Keep camera look target Z aligned with bin vertical center
      orbitRef.current.target.z = binHeight / 2;
      orbitRef.current.goalTarget.z = binHeight / 2;

      requestRenderRef.current();
    };

    if (!initialBuildDoneRef.current) {
      initialBuildDoneRef.current = true;
      rebuildMesh();
      return;
    }

    const timer = window.setTimeout(rebuildMesh, 60);
    return () => clearTimeout(timer);
  }, [buildBinGeometry, colorPreset, finish, wireframe, binHeight]);

  // Optional real Gridfinity v5 Baseplate Silhouette Preview seated cleanly around the bin feet
  useEffect(() => {
    const bpGroup = baseplateGroupRef.current;
    if (!bpGroup) return;

    while (bpGroup.children.length > 0) {
      const obj = bpGroup.children[0] as THREE.Mesh | THREE.LineSegments;
      bpGroup.remove(obj);
      obj.geometry?.dispose();
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
      else obj.material?.dispose();
    }

    if (showBaseplate) {
      const previewCfg = {
        ...createDefaultBaseplateConfig(),
        gridX: config.gridX,
        gridY: config.gridY,
        style: 'skeleton' as const,
        magnetMode: config.magnetMode ?? (config.hasMagnets ? 'corners' : 'none'),
        magnetDiameter: config.magnetDiameter,
        magnetDepth: config.magnetDepth,
      };
      const previewDims = getBaseplateDimensions(previewCfg);
      const plateGeo = trianglesToBufferGeometry(
        buildBaseplateTriangles(previewCfg, { centered: true })
      );
      const plateMat = new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.62,
        metalness: 0.16,
        transparent: true,
        opacity: 0.78,
      });
      const plate = new THREE.Mesh(plateGeo, plateMat);
      // Socket shelf aligns cleanly under bin z = 0
      plate.position.z = -(previewDims.padHeight + 0.02);
      bpGroup.add(plate);

      const edges = new THREE.EdgesGeometry(plateGeo, 24);
      const line = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.48 })
      );
      line.position.copy(plate.position);
      bpGroup.add(line);
      void BASEPLATE_PROFILE_HEIGHT;
    }

    requestRenderRef.current();
  }, [
    showBaseplate,
    config.gridX,
    config.gridY,
    config.magnetMode,
    config.hasMagnets,
    config.magnetDiameter,
    config.magnetDepth,
  ]);

  const setCameraPreset = (preset: CameraPreset) => {
    setViewPreset(preset);
    const o = orbitRef.current;
    const dist = Math.max(binWidth, binLength) * 1.95;
    o.goalTarget.set(0, 0, binHeight / 2);

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
    o.radius = Math.max(40, Math.min(850, o.radius * zoomFactor));
    requestRenderRef.current();
  };

  const lipVal = config.lipHeight ?? (config.hasStackingLip !== false ? STACKING_LIP_HEIGHT : 0);
  const lipInfo = getStackingLipProfile(lipVal);
  const magnetMode = config.magnetMode ?? (config.hasMagnets ? 'corners' : 'none');
  const magnetLabel =
    magnetMode === 'full'
      ? `Full (${config.gridX * config.gridY * 4}×)`
      : magnetMode === 'corners'
      ? '4 Corners'
      : 'None';

  return (
    <div
      className="relative w-full h-full bg-[#090d16] flex flex-col overflow-hidden select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Top-Right Compact Controls Bar (solid surface over WebGL, no backdrop-blur) */}
      <div
        className="absolute top-3 right-3 z-20 flex items-center gap-2 bg-slate-900/95 px-2.5 py-1.5 rounded-xl border border-slate-800 shadow-lg"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Camera Preset Views */}
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

        {/* Baseplate Preview Toggle */}
        <button
          type="button"
          onClick={() => setShowBaseplate(!showBaseplate)}
          aria-pressed={showBaseplate}
          title="Toggle 42mm Gridfinity Baseplate Preview"
          className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
            showBaseplate
              ? 'bg-cyan-950 text-cyan-300 border border-cyan-700/70'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Grid className="w-3.5 h-3.5" />
          <span>Baseplate</span>
        </button>

        {/* Wireframe Toggle */}
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

        {/* Color Swatches */}
        <div className="flex items-center gap-1.5">
          {(['emerald', 'graphite', 'orange', 'chalk'] as const).map((col) => (
            <button
              key={col}
              type="button"
              aria-label={`Bin Color: ${col}`}
              onClick={() => setColorPreset(col)}
              className={`w-3.5 h-3.5 rounded-full border transition-transform cursor-pointer ${
                col === 'emerald'
                  ? 'bg-emerald-500'
                  : col === 'graphite'
                  ? 'bg-slate-600'
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

      {/* Bottom Compact Material Finish & CAD Readout Dock (no backdrop-blur over WebGL) */}
      <div
        className="absolute bottom-3 left-3 right-3 z-20 flex flex-wrap items-center justify-between gap-2 pointer-events-none"
      >
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
            {config.gridX}×{config.gridY}U
          </span>
          <span className="text-slate-600">·</span>
          <span className="text-cyan-300">
            {binWidth.toFixed(1)} × {binLength.toFixed(1)} ×{' '}
            {(binHeight + (lipInfo.enabled ? lipInfo.height : 0)).toFixed(1)} mm
          </span>
          <span className="text-slate-600">·</span>
          <span>Chamfer {config.chamferSize}mm</span>
          <span className="text-slate-600">·</span>
          <span>
            Magnets: {magnetLabel}
            {magnetMode !== 'none'
              ? ` (${config.magnetDiameter.toFixed(1)}Ø×${config.magnetDepth.toFixed(1)})`
              : ''}
          </span>
        </div>
      </div>

      {contextLost && (
        <div className="absolute inset-0 z-30 bg-slate-950/90 flex items-center justify-center p-6 text-center">
          <div className="max-w-sm space-y-2">
            <h3 className="text-sm font-semibold text-white">3D Viewport Context Paused</h3>
            <p className="text-xs text-slate-400">
              Your browser suspended the WebGL context. Switch tabs or reload to resume 3D rendering; all CAD exports remain available.
            </p>
          </div>
        </div>
      )}

      {/* Isolated Empty WebGL Container */}
      <div
        ref={mountRef}
        data-testid="viewer-3d-canvas"
        className="w-full h-full cursor-grab active:cursor-grabbing block"
      />
    </div>
  );
};
