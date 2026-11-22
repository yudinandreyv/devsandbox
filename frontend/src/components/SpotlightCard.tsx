import React, { useEffect, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';

interface SpotlightCardProps {
  children: React.ReactNode;
  className?: string;
}

export const SpotlightCard: React.FC<SpotlightCardProps> = ({ children, className = '' }) => {
  return <div className={'relative rounded-2xl ' + className}>{children}</div>;
};

interface ParamWithTooltipProps {
  label: string;
  description: string;
  value?: React.ReactNode;
  children: React.ReactNode;
}

export const ParamWithTooltip: React.FC<ParamWithTooltipProps> = ({ label, description, value, children }) => {
  const [open, setOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const tooltipId = `param-help-${React.useId()}`;

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={'relative isolate space-y-2 ' + (open || isHovered ? 'z-30' : 'z-0')}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex items-center justify-between gap-2 text-[11px] font-medium">
        <button
          type="button"
          aria-expanded={open || isHovered}
          aria-describedby={open || isHovered ? tooltipId : undefined}
          onClick={() => setOpen((wasOpen) => !wasOpen)}
          className="group/param inline-flex items-center gap-1.5 text-left text-slate-300 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
        >
          <span>{label}</span>
          <HelpCircle aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-500 transition-colors group-hover/param:text-emerald-400" />
        </button>
        {value}
      </div>
      <div
        id={tooltipId}
        role="tooltip"
        className={'absolute bottom-full left-0 z-40 mb-2 w-[min(18rem,calc(100vw-4rem))] rounded-xl border border-white/15 bg-slate-900/95 p-3 text-xs leading-relaxed text-slate-300 shadow-2xl backdrop-blur-xl transition duration-150 ' +
          (open || isHovered ? 'visible translate-y-0 opacity-100' : 'invisible translate-y-1 opacity-0')}
      >
        <div className="mb-1 font-mono text-[11px] font-semibold text-emerald-400">{label}</div>
        {description}
      </div>
      {children}
    </div>
  );
};
