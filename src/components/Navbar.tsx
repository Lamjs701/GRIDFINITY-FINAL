import React from 'react';
import { Box, Camera, Download, Grid, Layers, SlidersHorizontal } from 'lucide-react';

export type NavTab = 'scanner' | 'studio' | 'baseplate' | 'export';

interface NavbarProps {
  currentTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  onQuickDownloadStl: () => void;
  toolCount: number;
  gridLabel: string;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  onTabChange,
  onQuickDownloadStl,
  toolCount,
  gridLabel,
}) => {
  return (
    <header className="h-14 bg-slate-950 border-b border-slate-800/90 text-slate-100 select-none shrink-0 z-40">
      <div className="h-full max-w-[1600px] mx-auto px-5 flex items-center justify-between gap-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <a
          href="#studio"
          onClick={(e) => {
            e.preventDefault();
            onTabChange('studio');
          }}
          className="flex items-center gap-2.5 text-base font-semibold tracking-tight text-white whitespace-nowrap shrink-0 font-display focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-md px-1"
        >
          <span className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white shrink-0">
            <Box className="w-4 h-4" />
          </span>
          <span>Gridfinity Studio</span>
        </a>

        {/* Zone 2: Clean Single-Line Navigation Links */}
        <nav aria-label="Primary Workspace Views" className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onTabChange('scanner')}
            aria-current={currentTab === 'scanner' ? 'page' : undefined}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              currentTab === 'scanner'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900'
            }`}
          >
            <Camera className="w-3.5 h-3.5 shrink-0" />
            <span>Tool Scanner</span>
          </button>

          <button
            type="button"
            onClick={() => onTabChange('studio')}
            aria-current={currentTab === 'studio' ? 'page' : undefined}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              currentTab === 'studio'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
            <span>CAD Studio</span>
          </button>

          <button
            type="button"
            onClick={() => onTabChange('baseplate')}
            aria-current={currentTab === 'baseplate' ? 'page' : undefined}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${
              currentTab === 'baseplate'
                ? 'bg-slate-800 text-cyan-300'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900'
            }`}
          >
            <Grid className="w-3.5 h-3.5 shrink-0" />
            <span>Baseplate</span>
          </button>

          <button
            type="button"
            onClick={() => onTabChange('export')}
            aria-current={currentTab === 'export' ? 'page' : undefined}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              currentTab === 'export'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900'
            }`}
          >
            <Layers className="w-3.5 h-3.5 shrink-0" />
            <span>Export &amp; Print</span>
          </button>
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex items-center gap-4 shrink-0">
          <span className="hidden lg:inline text-xs font-mono text-slate-400 whitespace-nowrap tabular-nums">
            {gridLabel} · {toolCount} {toolCount === 1 ? 'cutout' : 'cutouts'}
          </span>
          <button
            type="button"
            onClick={onQuickDownloadStl}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 ${
              currentTab === 'baseplate'
                ? 'bg-cyan-600 hover:bg-cyan-500 focus-visible:ring-cyan-400'
                : 'bg-indigo-600 hover:bg-indigo-500 focus-visible:ring-indigo-400'
            }`}
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            <span>{currentTab === 'baseplate' ? 'Download Baseplate' : 'Download STL'}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
