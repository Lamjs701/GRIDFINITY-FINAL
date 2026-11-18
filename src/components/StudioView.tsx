import React, { useEffect, useState } from 'react';
import {
  PlacedTool,
  GridfinityConfig,
  FingerPocket,
  MagnetMode,
  GridfinityTextConfig,
  TextReliefMode,
} from '../types';
import { Canvas2D } from './Canvas2D';
import { Viewer3D } from './Viewer3D';
import {
  getBinDimensions,
  recenterToolsOnGrid,
  calculateAutoGridfinityLayout,
  findBestClearTextPosition,
  STACKING_LIP_HEIGHT,
} from '../utils/geometry';
import {
  createParametricPresetTool,
  duplicatePlacedTool,
  ParametricPresetId,
} from '../utils/samplePresets';
import {
  Crosshair,
  Magnet,
  Plus,
  Layers,
  Box,
  Camera,
  Columns,
  Square,
  Type,
  Wand2,
  Undo2,
  Redo2,
  Copy,
  Trash2,
  RotateCw,
  X,
  Spline,
} from 'lucide-react';

interface StudioViewProps {
  config: GridfinityConfig;
  onUpdateConfig: (config: GridfinityConfig) => void;
  tools: PlacedTool[];
  onUpdateTools: (tools: PlacedTool[]) => void;
  onOpenScanner: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onResetWorkspace: () => void;
}

export const StudioView: React.FC<StudioViewProps> = ({
  config,
  onUpdateConfig,
  tools,
  onUpdateTools,
  onOpenScanner,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onResetWorkspace,
}) => {
  const [selectedToolId, setSelectedToolId] = useState<string | null>(
    tools.length > 0 ? tools[0].instanceId : null
  );
  const [viewMode, setViewMode] = useState<'split' | '2d-only' | '3d-only'>('split');
  const [showToolModal, setShowToolModal] = useState<boolean>(false);
  const [inspectorSection, setInspectorSection] = useState<'bin' | 'cutout' | 'label'>('bin');
  const [fineTuneToolId, setFineTuneToolId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Sync selectedToolId if tools list changes (e.g. undo/delete/add)
  useEffect(() => {
    if (tools.length === 0) {
      setSelectedToolId(null);
    } else if (!selectedToolId || !tools.some((t) => t.instanceId === selectedToolId)) {
      setSelectedToolId(tools[tools.length - 1].instanceId);
    }
  }, [tools, selectedToolId]);

  // Clear fine-tune mode if user switches selection or tool has < 3 contour vertices
  useEffect(() => {
    if (!fineTuneToolId) return;
    if (fineTuneToolId !== selectedToolId) {
      setFineTuneToolId(null);
      return;
    }
    const target = tools.find((t) => t.instanceId === fineTuneToolId);
    if (!target || target.tool.contour.length < 3) {
      setFineTuneToolId(null);
    }
  }, [fineTuneToolId, selectedToolId, tools]);

  const { width: binWidth, length: binLength, height: binHeight } = getBinDimensions(
    config.gridX,
    config.gridY,
    config.gridZ,
    config.customHeightMm
  );

  const currentLipHeight =
    config.lipHeight ?? (config.hasStackingLip !== false ? STACKING_LIP_HEIGHT : 0);
  const currentMagnetMode: MagnetMode =
    config.magnetMode ?? (config.hasMagnets ? 'corners' : 'none');

  const currentTextLabel: GridfinityTextConfig = config.textLabel ?? {
    text: '',
    mode: 'engrave',
    fontSize: 9,
    depth: 1.0,
    x: Math.round((binWidth / 2) * 10) / 10,
    y: Math.round(Math.max(10, binLength - 12) * 10) / 10,
    rotation: 0,
  };

  const selectedTool = tools.find((t) => t.instanceId === selectedToolId) ?? null;

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2400);
  };

  const updateTextLabel = (patch: Partial<GridfinityTextConfig>) => {
    const nextText =
      patch.text !== undefined
        ? patch.text.toUpperCase()
        : currentTextLabel.text.toUpperCase();
    onUpdateConfig({
      ...config,
      textLabel: {
        ...currentTextLabel,
        ...patch,
        text: nextText,
      },
    });
  };

  const handleUpdateTool = (updated: PlacedTool) => {
    onUpdateTools(tools.map((t) => (t.instanceId === updated.instanceId ? updated : t)));
  };

  const handleRecenterTools = () => {
    if (tools.length === 0) {
      showToast('Add a cutout first to center it.');
      return;
    }
    const recentered = recenterToolsOnGrid(tools, binWidth, binLength);
    onUpdateTools(recentered);
    showToast('Cutouts centered on Gridfinity grid.');
  };

  const handleAutoFitAndCenter = () => {
    if (tools.length === 0) {
      showToast('Add a scanned tool or preset cutout first.');
      return;
    }

    const autoLayout = calculateAutoGridfinityLayout(tools, config, {
      optimizeOrientation: tools.length === 1,
    });

    const { width: newW, length: newL } = getBinDimensions(
      autoLayout.gridX,
      autoLayout.gridY,
      autoLayout.gridZ,
      autoLayout.customHeightMm
    );
    const bestTextPos = findBestClearTextPosition(
      autoLayout.tools,
      newW,
      newL,
      config.textLabel?.fontSize ?? 9
    );

    onUpdateConfig({
      ...config,
      gridX: autoLayout.gridX,
      gridY: autoLayout.gridY,
      gridZ: autoLayout.gridZ,
      customHeightMm: autoLayout.customHeightMm,
      textLabel: config.textLabel
        ? {
            ...config.textLabel,
            x: bestTextPos.x,
            y: bestTextPos.y,
          }
        : undefined,
    });
    onUpdateTools(autoLayout.tools);
    showToast(`Auto-sized to ${autoLayout.gridX}×${autoLayout.gridY}U and centered.`);
  };

  const handleAddFingerPocket = (toolInstanceId: string) => {
    const target = tools.find((t) => t.instanceId === toolInstanceId);
    if (!target) return;
    const baseDepth = target.depthOverride ?? target.tool.depth;
    const newPocket: FingerPocket = {
      id: `fp-${Date.now()}`,
      x: 0,
      y: 0,
      width: 18,
      length: 34,
      depth: baseDepth + 2.0,
      rotation: 0,
      cornerRadius: 9,
      slopeAngle: 30,
    };
    const existing = target.fingerPockets?.length
      ? target.fingerPockets
      : target.tool.fingerPockets;
    handleUpdateTool({
      ...target,
      fingerPockets: [...existing, newPocket],
    });
  };

  const handleAddPresetCutout = (presetId: ParametricPresetId) => {
    const tool = createParametricPresetTool(presetId, binWidth / 2, binLength / 2);
    onUpdateTools([...tools, tool]);
    setSelectedToolId(tool.instanceId);
    setInspectorSection('cutout');
    setShowToolModal(false);
  };

  const handleDuplicateTool = (tool: PlacedTool) => {
    const dup = duplicatePlacedTool(tool, binWidth, binLength);
    onUpdateTools([...tools, dup]);
    setSelectedToolId(dup.instanceId);
    showToast(`Duplicated "${tool.tool.name}".`);
  };

  const handleDeleteTool = (instanceId: string) => {
    onUpdateTools(tools.filter((t) => t.instanceId !== instanceId));
  };

  const handleSetMagnetMode = (mode: MagnetMode) => {
    onUpdateConfig({
      ...config,
      magnetMode: mode,
      hasMagnets: mode !== 'none',
    });
  };

  return (
    <div className="flex-1 flex bg-slate-950 text-slate-100 overflow-hidden">
      {/* Left Parametric CAD Inspector Rail */}
      <aside
        aria-label="Parametric CAD Inspector"
        className="w-72 shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col overflow-hidden"
      >
        {/* Inspector Section Switcher */}
        <div
          role="tablist"
          aria-label="Inspector Sections"
          className="grid grid-cols-3 p-1.5 bg-slate-950 border-b border-slate-800 gap-1 shrink-0"
        >
          <button
            type="button"
            role="tab"
            aria-selected={inspectorSection === 'bin'}
            onClick={() => setInspectorSection('bin')}
            className={`py-1.5 px-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
              inspectorSection === 'bin'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Bin Spec
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={inspectorSection === 'cutout'}
            onClick={() => setInspectorSection('cutout')}
            className={`py-1.5 px-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
              inspectorSection === 'cutout'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Cutouts ({tools.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={inspectorSection === 'label'}
            onClick={() => setInspectorSection('label')}
            className={`py-1.5 px-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
              inspectorSection === 'label'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Label
          </button>
        </div>

        {/* Inspector Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {inspectorSection === 'bin' && (
            <>
              {/* Grid Footprint */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold text-slate-200">Gridfinity Footprint</h2>
                  <span className="text-xs font-mono text-cyan-300 tabular-nums">
                    {binWidth.toFixed(1)}×{binLength.toFixed(1)}mm
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label htmlFor="grid-cols-input" className="text-[11px] text-slate-400 block">
                      Columns (X)
                    </label>
                    <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
                      <button
                        type="button"
                        aria-label="Decrease Columns"
                        onClick={() =>
                          onUpdateConfig({ ...config, gridX: Math.max(1, config.gridX - 1) })
                        }
                        disabled={config.gridX <= 1}
                        className="w-8 h-8 flex items-center justify-center text-slate-300 hover:bg-slate-800 disabled:opacity-35 cursor-pointer"
                      >
                        -
                      </button>
                      <input
                        id="grid-cols-input"
                        type="number"
                        aria-label="Grid Columns"
                        min={1}
                        max={12}
                        value={config.gridX}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          if (!Number.isNaN(val)) {
                            onUpdateConfig({
                              ...config,
                              gridX: Math.max(1, Math.min(12, val)),
                            });
                          }
                        }}
                        className="w-full bg-transparent text-center text-xs text-white font-mono font-semibold focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <button
                        type="button"
                        aria-label="Increase Columns"
                        onClick={() =>
                          onUpdateConfig({ ...config, gridX: Math.min(12, config.gridX + 1) })
                        }
                        disabled={config.gridX >= 12}
                        className="w-8 h-8 flex items-center justify-center text-slate-300 hover:bg-slate-800 disabled:opacity-35 cursor-pointer"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="grid-rows-input" className="text-[11px] text-slate-400 block">
                      Rows (Y)
                    </label>
                    <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
                      <button
                        type="button"
                        aria-label="Decrease Rows"
                        onClick={() =>
                          onUpdateConfig({ ...config, gridY: Math.max(1, config.gridY - 1) })
                        }
                        disabled={config.gridY <= 1}
                        className="w-8 h-8 flex items-center justify-center text-slate-300 hover:bg-slate-800 disabled:opacity-35 cursor-pointer"
                      >
                        -
                      </button>
                      <input
                        id="grid-rows-input"
                        type="number"
                        aria-label="Grid Rows"
                        min={1}
                        max={12}
                        value={config.gridY}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          if (!Number.isNaN(val)) {
                            onUpdateConfig({
                              ...config,
                              gridY: Math.max(1, Math.min(12, val)),
                            });
                          }
                        }}
                        className="w-full bg-transparent text-xs text-center text-white font-mono font-semibold focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <button
                        type="button"
                        aria-label="Increase Rows"
                        onClick={() =>
                          onUpdateConfig({ ...config, gridY: Math.min(12, config.gridY + 1) })
                        }
                        disabled={config.gridY >= 12}
                        className="w-8 h-8 flex items-center justify-center text-slate-300 hover:bg-slate-800 disabled:opacity-35 cursor-pointer"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Height & Lip */}
              <div className="pt-4 border-t border-slate-800 space-y-4">
                <div>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <label htmlFor="bin-height-slider" className="text-slate-300 font-medium">
                      Body Height
                    </label>
                    <span className="font-mono text-emerald-300 tabular-nums">
                      {binHeight.toFixed(0)}mm ({(binHeight / 7).toFixed(1).replace(/\.0$/, '')}U)
                    </span>
                  </div>
                  <input
                    id="bin-height-slider"
                    aria-label="Bin Height Slider"
                    type="range"
                    min="7"
                    max="84"
                    step="1"
                    value={binHeight}
                    onChange={(e) => {
                      const h = parseFloat(e.target.value);
                      onUpdateConfig({
                        ...config,
                        customHeightMm: h,
                        gridZ: Math.max(1, Math.round(h / 7)),
                      });
                    }}
                    className="w-full accent-emerald-500 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateConfig({
                          ...config,
                          lipHeight: currentLipHeight > 0 ? 0 : STACKING_LIP_HEIGHT,
                          hasStackingLip: currentLipHeight <= 0,
                        })
                      }
                      className="flex items-center gap-1.5 text-slate-300 font-medium hover:text-amber-300 cursor-pointer"
                    >
                      <Layers className="w-3.5 h-3.5 text-amber-400" />
                      <span>Stacking Lip</span>
                    </button>
                    <span className="font-mono text-amber-300 tabular-nums">
                      {currentLipHeight >= 0.2 ? `${currentLipHeight.toFixed(1)}mm` : 'Off'}
                    </span>
                  </div>
                  <input
                    aria-label="Stackable Lip Wall Height"
                    type="range"
                    min="0"
                    max="12"
                    step="0.5"
                    value={currentLipHeight}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      onUpdateConfig({
                        ...config,
                        lipHeight: val,
                        hasStackingLip: val >= 0.2,
                      });
                    }}
                    className="w-full accent-amber-400 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <label htmlFor="chamfer-slider" className="text-slate-300 font-medium">
                      Cutout 45° Chamfer
                    </label>
                    <span className="font-mono text-cyan-300 tabular-nums">
                      {config.chamferSize.toFixed(1)}mm
                    </span>
                  </div>
                  <input
                    id="chamfer-slider"
                    aria-label="Model cutout 45 degree chamfer size in mm"
                    type="range"
                    min="0"
                    max="2.5"
                    step="0.1"
                    value={config.chamferSize}
                    onChange={(e) =>
                      onUpdateConfig({ ...config, chamferSize: parseFloat(e.target.value) })
                    }
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                </div>
              </div>

              {/* Base Magnets & Screws */}
              <div className="pt-4 border-t border-slate-800 space-y-3">
                <div className="flex items-center justify-between text-xs font-medium text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <Magnet className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Base Magnet Recesses</span>
                  </span>
                  {currentMagnetMode !== 'none' && (
                    <span className="font-mono text-[11px] text-cyan-300 tabular-nums">
                      {config.magnetDiameter.toFixed(1)}Ø × {config.magnetDepth.toFixed(1)}mm
                    </span>
                  )}
                </div>
                <div
                  className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800"
                  role="group"
                  aria-label="Magnet Mode"
                >
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
                      aria-pressed={currentMagnetMode === opt.id}
                      onClick={() => handleSetMagnetMode(opt.id)}
                      className={`py-1.5 px-2 rounded text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                        currentMagnetMode === opt.id
                          ? 'bg-cyan-700 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {currentMagnetMode !== 'none' && (
                  <div className="bg-slate-950 rounded-lg border border-slate-800 p-2.5 space-y-2.5">
                    <div>
                      <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                        <label htmlFor="bin-magnet-diameter">Pocket Diameter</label>
                        <span className="font-mono text-slate-200 tabular-nums">
                          {config.magnetDiameter.toFixed(1)} mm
                        </span>
                      </div>
                      <input
                        id="bin-magnet-diameter"
                        aria-label="Bin Magnet Diameter"
                        type="range"
                        min="3.0"
                        max="8.6"
                        step="0.1"
                        value={config.magnetDiameter}
                        onChange={(e) =>
                          onUpdateConfig({
                            ...config,
                            magnetDiameter: parseFloat(e.target.value),
                          })
                        }
                        className="w-full accent-cyan-400 cursor-pointer"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                        <label htmlFor="bin-magnet-depth">Pocket Depth</label>
                        <span className="font-mono text-slate-200 tabular-nums">
                          {config.magnetDepth.toFixed(1)} mm
                        </span>
                      </div>
                      <input
                        id="bin-magnet-depth"
                        aria-label="Bin Magnet Depth"
                        type="range"
                        min="0.8"
                        max="4.2"
                        step="0.1"
                        value={Math.min(4.2, config.magnetDepth)}
                        onChange={(e) =>
                          onUpdateConfig({
                            ...config,
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
                          Math.abs(config.magnetDiameter - preset.d) < 0.05 &&
                          Math.abs(config.magnetDepth - preset.h) < 0.05;
                        return (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() =>
                              onUpdateConfig({
                                ...config,
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

                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={config.hasScrews}
                    onChange={(e) => onUpdateConfig({ ...config, hasScrews: e.target.checked })}
                    className="rounded border-slate-700 bg-slate-950 text-indigo-600"
                  />
                  <span>Include M3 Screw Holes</span>
                </label>
              </div>

              <div className="pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={onResetWorkspace}
                  className="w-full py-2 px-3 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                >
                  Reset Bin to Defaults
                </button>
              </div>
            </>
          )}

          {inspectorSection === 'cutout' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-slate-200">Placed Cutouts</h2>
                <button
                  type="button"
                  onClick={() => setShowToolModal(true)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-3 h-3" />
                  <span>Add</span>
                </button>
              </div>

              {tools.length === 0 ? (
                <div className="py-8 text-center space-y-3 border border-dashed border-slate-800 rounded-lg p-4">
                  <p className="text-xs text-slate-400">
                    No tool cutouts on this bin yet. Scan a photo on A4 paper or drop a parametric cutout.
                  </p>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={onOpenScanner}
                      className="w-full py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer"
                    >
                      Scan Tool on A4 Sheet
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAddPresetCutout('pill-slot')}
                      className="w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium cursor-pointer"
                    >
                      Insert Pill Slot Cutout
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <ul className="space-y-1.5">
                    {tools.map((tool) => {
                      const isSel = tool.instanceId === selectedToolId;
                      return (
                        <li
                          key={tool.instanceId}
                          className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border text-xs transition-colors ${
                            isSel
                              ? 'bg-slate-800 border-indigo-500/70 text-white'
                              : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedToolId(tool.instanceId)}
                            className="flex-1 text-left truncate font-medium cursor-pointer"
                          >
                            {tool.tool.name}
                          </button>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              aria-label={`Duplicate ${tool.tool.name}`}
                              onClick={() => handleDuplicateTool(tool)}
                              className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 cursor-pointer"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete ${tool.tool.name}`}
                              onClick={() => handleDeleteTool(tool.instanceId)}
                              className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-700 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  {selectedTool && (
                    <div className="pt-4 border-t border-slate-800 space-y-3.5">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-semibold text-indigo-300 truncate">
                          {selectedTool.tool.name}
                        </h3>
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateTool({
                              ...selectedTool,
                              rotation: (selectedTool.rotation + 90) % 360,
                            })
                          }
                          className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 cursor-pointer whitespace-nowrap"
                        >
                          <RotateCw className="w-3 h-3" />
                          <span>+90°</span>
                        </button>
                      </div>

                      <div>
                        <div className="flex justify-between text-xs text-slate-400 mb-1">
                          <span>Rotation</span>
                          <span className="font-mono text-slate-200 tabular-nums">
                            {Math.round(selectedTool.rotation)}°
                          </span>
                        </div>
                        <input
                          aria-label="Selected Cutout Rotation"
                          type="range"
                          min="-180"
                          max="180"
                          step="5"
                          value={
                            selectedTool.rotation > 180
                              ? selectedTool.rotation - 360
                              : selectedTool.rotation
                          }
                          onChange={(e) =>
                            handleUpdateTool({
                              ...selectedTool,
                              rotation: parseFloat(e.target.value),
                            })
                          }
                          className="w-full accent-indigo-500 cursor-pointer"
                        />
                      </div>

                      {selectedTool.tool.contour.length >= 3 && (
                        <>
                          <div>
                            <div className="flex justify-between text-xs text-slate-400 mb-1">
                              <span>Cavity Depth</span>
                              <span className="font-mono text-emerald-300 tabular-nums">
                                {(selectedTool.depthOverride ?? selectedTool.tool.depth).toFixed(1)}mm
                              </span>
                            </div>
                            <input
                              aria-label="Selected Cutout Depth"
                              type="range"
                              min="3"
                              max="40"
                              step="0.5"
                              value={selectedTool.depthOverride ?? selectedTool.tool.depth}
                              onChange={(e) =>
                                handleUpdateTool({
                                  ...selectedTool,
                                  depthOverride: parseFloat(e.target.value),
                                })
                              }
                              className="w-full accent-emerald-500 cursor-pointer"
                            />
                          </div>

                          <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-slate-300 font-medium">
                                Tangent Curve Smooth
                              </span>
                              <button
                                type="button"
                                aria-pressed={(selectedTool.tool.curveSmoothing ?? 0) > 0}
                                onClick={() =>
                                  handleUpdateTool({
                                    ...selectedTool,
                                    tool: {
                                      ...selectedTool.tool,
                                      curveSmoothing:
                                        (selectedTool.tool.curveSmoothing ?? 0) > 0 ? 0 : 65,
                                    },
                                  })
                                }
                                className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors cursor-pointer ${
                                  (selectedTool.tool.curveSmoothing ?? 0) > 0
                                    ? 'bg-cyan-700/80 border-cyan-500 text-white'
                                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                                }`}
                              >
                                {(selectedTool.tool.curveSmoothing ?? 0) > 0
                                  ? `${selectedTool.tool.curveSmoothing}% On`
                                  : 'Off'}
                              </button>
                            </div>
                            <input
                              aria-label="Selected Cutout Curve Smoothing"
                              type="range"
                              min="0"
                              max="100"
                              step="5"
                              value={selectedTool.tool.curveSmoothing ?? 0}
                              onChange={(e) =>
                                handleUpdateTool({
                                  ...selectedTool,
                                  tool: {
                                    ...selectedTool.tool,
                                    curveSmoothing: parseInt(e.target.value, 10),
                                  },
                                })
                              }
                              className="w-full accent-cyan-400 cursor-pointer"
                            />
                            <p className="text-[11px] text-slate-500">
                              Smooths contour kinks into C² tangent curves for clean, non-jagged 3D STL walls &amp; chamfers.
                            </p>
                          </div>

                          <button
                            type="button"
                            aria-pressed={fineTuneToolId === selectedTool.instanceId}
                            onClick={() => {
                              setFineTuneToolId((prev) =>
                                prev === selectedTool.instanceId ? null : selectedTool.instanceId
                              );
                              if (viewMode === '3d-only') setViewMode('split');
                            }}
                            className={`w-full py-2 px-3 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                              fineTuneToolId === selectedTool.instanceId
                                ? 'bg-amber-600 border-amber-500 text-white shadow-sm'
                                : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-amber-300'
                            }`}
                          >
                            <Spline className="w-3.5 h-3.5" />
                            <span>
                              {fineTuneToolId === selectedTool.instanceId
                                ? 'Done Fine-Tuning'
                                : 'Fine Tune Points & Lines'}
                            </span>
                          </button>
                        </>
                      )}

                      <button
                        type="button"
                        onClick={() => handleAddFingerPocket(selectedTool.instanceId)}
                        className="w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-orange-300 text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add Finger Grab Pocket</span>
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {inspectorSection === 'label' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xs font-semibold text-slate-200 mb-1">
                  CAPSLOCK 3D Label Relief
                </h2>
                <p className="text-xs text-slate-400">
                  Engraves or embosses vector typography directly into the STL mesh.
                </p>
              </div>

              <div>
                <label htmlFor="capslock-label-input" className="text-xs text-slate-400 block mb-1">
                  Label Text
                </label>
                <input
                  id="capslock-label-input"
                  aria-label="CAPSLOCK Gridfinity Text"
                  type="text"
                  maxLength={28}
                  placeholder="E.G. 10MM WRENCH"
                  value={currentTextLabel.text}
                  onChange={(e) => updateTextLabel({ text: e.target.value.toUpperCase() })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white font-mono uppercase tracking-wider focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <span className="text-xs text-slate-400 block mb-1.5">Relief Mode</span>
                <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                  {(
                    [
                      { id: 'none', label: 'Off' },
                      { id: 'engrave', label: 'Engrave' },
                      { id: 'emboss', label: 'Emboss' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      aria-pressed={currentTextLabel.mode === m.id}
                      onClick={() => updateTextLabel({ mode: m.id as TextReliefMode })}
                      className={`py-1.5 rounded text-xs font-medium transition-colors cursor-pointer ${
                        currentTextLabel.mode === m.id
                          ? 'bg-purple-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>Letter Height</span>
                  <span className="font-mono text-purple-300 tabular-nums">
                    {currentTextLabel.fontSize.toFixed(1)}mm
                  </span>
                </div>
                <input
                  aria-label="Text Font Size"
                  type="range"
                  min="5"
                  max="24"
                  step="0.5"
                  value={currentTextLabel.fontSize}
                  onChange={(e) => updateTextLabel({ fontSize: parseFloat(e.target.value) })}
                  className="w-full accent-purple-500 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>{currentTextLabel.mode === 'emboss' ? 'Emboss Height' : 'Engrave Depth'}</span>
                  <span className="font-mono text-sky-300 tabular-nums">
                    {currentTextLabel.depth.toFixed(1)}mm
                  </span>
                </div>
                <input
                  aria-label="Text Relief Depth"
                  type="range"
                  min="0.4"
                  max="3.0"
                  step="0.2"
                  value={currentTextLabel.depth}
                  onChange={(e) => updateTextLabel({ depth: parseFloat(e.target.value) })}
                  className="w-full accent-sky-400 cursor-pointer"
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  const best = findBestClearTextPosition(
                    tools,
                    binWidth,
                    binLength,
                    currentTextLabel.fontSize
                  );
                  updateTextLabel({ x: best.x, y: best.y });
                  showToast('Label moved to clearest available deck area.');
                }}
                className="w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors cursor-pointer"
              >
                Auto-Center Label
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main CAD Viewport */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Clean Single-Line Viewport Toolbar (zero wrapping) */}
        <div className="h-11 bg-slate-900 border-b border-slate-800 px-3 flex items-center justify-between gap-4 shrink-0 overflow-x-auto">
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowToolModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span>Add Cutout</span>
            </button>

            <button
              type="button"
              onClick={handleAutoFitAndCenter}
              title="Auto-size Gridfinity units and center cutouts"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-300 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Wand2 className="w-3.5 h-3.5 shrink-0" />
              <span>Auto-Fit Grid</span>
            </button>

            <button
              type="button"
              onClick={handleRecenterTools}
              title="Center all cutouts on current grid"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Crosshair className="w-3.5 h-3.5 shrink-0" />
              <span>Recenter</span>
            </button>

            <button
              type="button"
              aria-pressed={config.smartSnapping}
              onClick={() => onUpdateConfig({ ...config, smartSnapping: !config.smartSnapping })}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                config.smartSnapping
                  ? 'bg-indigo-950/90 text-indigo-300 border-indigo-700'
                  : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
              }`}
            >
              Snap: {config.smartSnapping ? 'On' : 'Off'}
            </button>

            <button
              type="button"
              onClick={() => setInspectorSection('label')}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                currentTextLabel.text.trim() && currentTextLabel.mode !== 'none'
                  ? 'bg-purple-950 text-purple-300 border border-purple-700'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
              }`}
            >
              <Type className="w-3.5 h-3.5 shrink-0" />
              <span>Label</span>
            </button>

            <div className="h-4 w-px bg-slate-800 mx-0.5 shrink-0" />

            <button
              type="button"
              aria-label="Undo"
              onClick={onUndo}
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
              className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-35 cursor-pointer shrink-0"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              aria-label="Redo"
              onClick={onRedo}
              disabled={!canRedo}
              title="Redo (Ctrl+Shift+Z)"
              className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-35 cursor-pointer shrink-0"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* View Layout Switcher */}
          <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 shrink-0">
            <button
              type="button"
              onClick={() => setViewMode('split')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                viewMode === 'split' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Columns className="w-3.5 h-3.5 shrink-0" />
              <span>Split</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('2d-only')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                viewMode === '2d-only' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Square className="w-3.5 h-3.5 shrink-0" />
              <span>2D</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('3d-only')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                viewMode === '3d-only' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Box className="w-3.5 h-3.5 shrink-0" />
              <span>3D</span>
            </button>
          </div>
        </div>

        {/* 2D + 3D Split Stage */}
        <div className="flex-1 flex overflow-hidden relative">
          {toastMessage && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 bg-indigo-600 text-white text-xs font-semibold px-4 py-2 rounded-lg shadow-xl flex items-center gap-2">
              <Crosshair className="w-3.5 h-3.5 shrink-0" />
              <span>{toastMessage}</span>
            </div>
          )}

          {(viewMode === 'split' || viewMode === '2d-only') && (
            <div
              className={`${
                viewMode === 'split' ? 'w-1/2 border-r border-slate-800' : 'w-full'
              } h-full relative`}
            >
              <div className="absolute top-3.5 right-3 z-10 text-[11px] font-mono font-medium text-slate-400 pointer-events-none">
                2D Plan View
              </div>
              <Canvas2D
                config={config}
                tools={tools}
                selectedToolId={selectedToolId}
                fineTuneToolId={fineTuneToolId}
                onSelectTool={(id) => {
                  setSelectedToolId(id);
                  if (id) setInspectorSection('cutout');
                }}
                onSetFineTuneToolId={(id) => setFineTuneToolId(id)}
                onUpdateTool={handleUpdateTool}
                onUpdateTools={onUpdateTools}
                onUpdateTextPosition={(x, y) => updateTextLabel({ x, y })}
                onRecenterTools={handleRecenterTools}
                onAddFingerPocket={handleAddFingerPocket}
              />
            </div>
          )}

          {(viewMode === 'split' || viewMode === '3d-only') && (
            <div className={`${viewMode === 'split' ? 'w-1/2' : 'w-full'} h-full relative`}>
              <div className="absolute top-3 left-3 z-10 text-[11px] font-mono font-medium text-slate-400 pointer-events-none">
                3D Parametric CAD
              </div>
              <Viewer3D
                config={config}
                tools={tools}
                selectedToolId={selectedToolId}
              />
            </div>
          )}
        </div>
      </div>

      {/* Add Cutout Modal */}
      {showToolModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-cutout-title"
          className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4"
        >
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-6 max-w-lg w-full shadow-2xl space-y-5">
            <div className="flex items-start justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 id="add-cutout-title" className="font-semibold text-base text-white font-display">
                  Add Cutout to Gridfinity Bin
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Scan a physical tool on A4 paper or insert a ready-to-resize parametric cutout.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close Add Cutout Dialog"
                onClick={() => setShowToolModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setShowToolModal(false);
                onOpenScanner();
              }}
              className="w-full flex items-center gap-4 p-4 rounded-xl bg-indigo-950/60 hover:bg-indigo-950 border border-indigo-700/70 text-left transition-colors cursor-pointer"
            >
              <div className="w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center text-white shrink-0">
                <Camera className="w-5 h-5" />
              </div>
              <div>
                <div className="font-semibold text-sm text-white">
                  Scan Tool on A4 Reference Sheet
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  Upload a photo or load a sample A4 scan to trace an exact 1:1 millimeter outline.
                </div>
              </div>
            </button>

            <div className="space-y-2">
              <div className="text-xs font-medium text-slate-400">Parametric Cutout Presets</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {(
                  [
                    {
                      id: 'pill-slot',
                      title: 'Pill Slot Cutout',
                      desc: '42×20mm · Draggable R & W handles',
                    },
                    {
                      id: 'utility-tray',
                      title: 'Utility Pocket Tray',
                      desc: '68×32mm · Rounded pocket + grab',
                    },
                    {
                      id: 'hex-bit-strip',
                      title: '1/4" Hex Bit Strip',
                      desc: '96×22mm · Bit bar cavity',
                    },
                    {
                      id: 'sd-usb-rack',
                      title: 'SD / USB Drive Dock',
                      desc: '34×24mm · Compact media slot',
                    },
                  ] as const
                ).map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleAddPresetCutout(preset.id)}
                    className="p-3 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-left transition-colors cursor-pointer"
                  >
                    <div className="text-xs font-semibold text-white">{preset.title}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5 font-mono">{preset.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
