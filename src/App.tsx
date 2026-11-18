/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { BaseplateConfig, GridfinityConfig, PlacedTool, ToolDef } from './types';
import { Navbar, NavTab } from './components/Navbar';
import { StudioView } from './components/StudioView';
import { ToolScannerView } from './components/ToolScannerView';
import { BaseplateView } from './components/BaseplateView';
import { ExportView } from './components/ExportView';
import {
  getBinDimensions,
  getStackingLipProfile,
  getToolBounds,
  calculateAutoGridfinityLayout,
  findBestClearTextPosition,
  STACKING_LIP_HEIGHT,
  V5_MAGNET_DIAMETER,
  V5_SCREW_DIAMETER,
} from './utils/geometry';
import {
  createDefaultBaseplateConfig,
  downloadBaseplateStl,
  getBaseplateDimensions,
} from './utils/baseplateGeometry';
import { downloadStl } from './utils/stlExporter';

const STORAGE_KEY = 'gridfinity-studio-remix-v1';
const BASEPLATE_STORAGE_KEY = 'gridfinity-baseplate-v1';

interface WorkspaceSnapshot {
  config: GridfinityConfig;
  tools: PlacedTool[];
}

function createDefaultConfig(): GridfinityConfig {
  return {
    gridX: 4,
    gridY: 2,
    gridZ: 4,
    customHeightMm: 28,
    wallThickness: 1.8,
    floorThickness: 6.0,
    chamferSize: 1.0,
    lipHeight: STACKING_LIP_HEIGHT,
    hasStackingLip: true,
    magnetMode: 'corners',
    hasMagnets: true,
    hasScrews: false,
    magnetDiameter: V5_MAGNET_DIAMETER,
    magnetDepth: 2.4,
    screwDiameter: V5_SCREW_DIAMETER,
    smartSnapping: true,
    snapTolerance: 2.5,
    textLabel: {
      text: '',
      mode: 'engrave',
      fontSize: 9,
      depth: 1.0,
      x: 83.8,
      y: 70,
      rotation: 0,
    },
  };
}

function loadSavedWorkspace(): WorkspaceSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<WorkspaceSnapshot>;
      if (parsed.config && Array.isArray(parsed.tools)) {
        return {
          config: { ...createDefaultConfig(), ...parsed.config },
          tools: parsed.tools,
        };
      }
    }
  } catch {
    // Ignore corrupt localStorage and fall back to defaults
  }
  return { config: createDefaultConfig(), tools: [] };
}

function loadSavedBaseplateConfig(): BaseplateConfig {
  try {
    const raw = localStorage.getItem(BASEPLATE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<BaseplateConfig>;
      if (typeof parsed.gridX === 'number' && typeof parsed.gridY === 'number') {
        return { ...createDefaultBaseplateConfig(), ...parsed };
      }
    }
  } catch {
    // Ignore corrupt localStorage and fall back to defaults
  }
  return createDefaultBaseplateConfig();
}

function resolveInitialTab(): NavTab {
  if (typeof window === 'undefined') return 'scanner';
  const params = new URLSearchParams(window.location.search);
  const tabParam = params.get('tab');
  if (
    tabParam === 'studio' ||
    tabParam === 'scanner' ||
    tabParam === 'baseplate' ||
    tabParam === 'export'
  ) {
    return tabParam;
  }
  if (params.get('autostart') === '1') {
    return 'studio';
  }
  return 'scanner';
}

export default function App() {
  const [currentTab, setCurrentTab] = useState<NavTab>(resolveInitialTab);
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot>(loadSavedWorkspace);
  const [baseplateConfig, setBaseplateConfig] = useState<BaseplateConfig>(
    loadSavedBaseplateConfig
  );
  const [past, setPast] = useState<WorkspaceSnapshot[]>([]);
  const [future, setFuture] = useState<WorkspaceSnapshot[]>([]);

  const { config, tools } = workspace;

  // Persist workspace changes cleanly
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
    } catch {
      // Ignore storage quota errors
    }
  }, [workspace]);

  // Persist standalone baseplate config independently of bin workspace
  useEffect(() => {
    try {
      localStorage.setItem(BASEPLATE_STORAGE_KEY, JSON.stringify(baseplateConfig));
    } catch {
      // Ignore storage quota errors
    }
  }, [baseplateConfig]);

  const commitWorkspace = useCallback((next: WorkspaceSnapshot) => {
    setWorkspace((prev) => {
      setPast((p) => [...p.slice(-24), prev]);
      setFuture([]);
      return next;
    });
  }, []);

  const handleUpdateConfig = useCallback(
    (nextConfig: GridfinityConfig) => {
      commitWorkspace({ config: nextConfig, tools: workspace.tools });
    },
    [commitWorkspace, workspace.tools]
  );

  const handleUpdateTools = useCallback(
    (nextTools: PlacedTool[]) => {
      commitWorkspace({ config: workspace.config, tools: nextTools });
    },
    [commitWorkspace, workspace.config]
  );

  const handleUndo = useCallback(() => {
    setPast((prevPast) => {
      if (prevPast.length === 0) return prevPast;
      const previous = prevPast[prevPast.length - 1];
      setWorkspace((curr) => {
        setFuture((f) => [curr, ...f.slice(0, 24)]);
        return previous;
      });
      return prevPast.slice(0, -1);
    });
  }, []);

  const handleRedo = useCallback(() => {
    setFuture((prevFuture) => {
      if (prevFuture.length === 0) return prevFuture;
      const next = prevFuture[0];
      setWorkspace((curr) => {
        setPast((p) => [...p.slice(-24), curr]);
        return next;
      });
      return prevFuture.slice(1);
    });
  }, []);

  // Keyboard shortcuts for Undo / Redo when not typing in text fields
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo]);

  const handleResetWorkspace = useCallback(() => {
    commitWorkspace({ config: createDefaultConfig(), tools: [] });
  }, [commitWorkspace]);

  const handleSaveScannedTool = (newTool: ToolDef) => {
    const newPlacedDraft: PlacedTool = {
      instanceId: `inst-custom-${Date.now()}`,
      toolId: newTool.id,
      tool: newTool,
      x: 0,
      y: 0,
      rotation: 0,
      fingerPockets: [...newTool.fingerPockets],
    };

    let candidateTools: PlacedTool[];
    if (tools.length === 0) {
      candidateTools = [newPlacedDraft];
    } else {
      let maxBottom = -Infinity;
      let sumX = 0;
      for (const t of tools) {
        const b = getToolBounds(t);
        if (b.maxY > maxBottom) maxBottom = b.maxY;
        sumX += b.centerX;
      }
      const newBounds = getToolBounds(newPlacedDraft);
      candidateTools = [
        ...tools,
        {
          ...newPlacedDraft,
          x: sumX / tools.length,
          y: maxBottom + newBounds.height / 2 + 8,
        },
      ];
    }

    const autoLayout = calculateAutoGridfinityLayout(candidateTools, config, {
      optimizeOrientation: tools.length === 0,
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

    commitWorkspace({
      config: {
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
      },
      tools: autoLayout.tools,
    });
    setCurrentTab('studio');
  };

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
  const bpDims = getBaseplateDimensions(baseplateConfig);
  const activeGridLabel =
    currentTab === 'baseplate'
      ? `${baseplateConfig.gridX}×${baseplateConfig.gridY}U Baseplate (${bpDims.width.toFixed(0)}×${bpDims.length.toFixed(0)}×${bpDims.totalHeight.toFixed(2)}mm)`
      : `${config.gridX}×${config.gridY}U (${width.toFixed(0)}×${length.toFixed(0)}×${totalHeight.toFixed(1)}mm)`;

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden">
      <Navbar
        currentTab={currentTab}
        onTabChange={setCurrentTab}
        onQuickDownloadStl={() =>
          currentTab === 'baseplate'
            ? downloadBaseplateStl(baseplateConfig)
            : downloadStl(config, tools)
        }
        toolCount={tools.length}
        gridLabel={activeGridLabel}
      />

      <main className="flex-1 flex overflow-hidden">
        {currentTab === 'studio' && (
          <StudioView
            config={config}
            onUpdateConfig={handleUpdateConfig}
            tools={tools}
            onUpdateTools={handleUpdateTools}
            onOpenScanner={() => setCurrentTab('scanner')}
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={past.length > 0}
            canRedo={future.length > 0}
            onResetWorkspace={handleResetWorkspace}
          />
        )}

        {currentTab === 'scanner' && (
          <ToolScannerView
            onSaveTool={handleSaveScannedTool}
            onCancel={() => setCurrentTab('studio')}
          />
        )}

        {currentTab === 'baseplate' && (
          <BaseplateView
            baseplateConfig={baseplateConfig}
            onUpdateBaseplateConfig={setBaseplateConfig}
            binConfig={config}
            tools={tools}
          />
        )}

        {currentTab === 'export' && (
          <ExportView config={config} tools={tools} />
        )}
      </main>
    </div>
  );
}
