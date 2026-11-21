import React, { useRef } from 'react';

interface RangeSliderProps {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  className?: string;
}

/** Keeps the native slider geometry in the layout and extends only its pointer target. */
export const RangeSlider: React.FC<RangeSliderProps> = ({
  id,
  label,
  min,
  max,
  step,
  value,
  onChange,
  className = '',
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const updateFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width === 0) return;

    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const rawValue = min + ratio * (max - min);
    const steppedValue = min + Math.round((rawValue - min) / step) * step;
    onChange(Math.min(max, Math.max(min, steppedValue)));
  };

  return (
    <div className="relative h-4 w-full">
      <input
        ref={inputRef}
        id={id}
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        className={'relative z-0 block h-4 w-full pointer-events-none ' + className}
      />
      <div
        aria-hidden="true"
        className="absolute -left-0 -right-0 -top-[30px] -bottom-[20px] z-10 cursor-pointer touch-pan-y"
        onPointerDown={(event) => {
          inputRef.current?.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          updateFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons !== 0) updateFromPointer(event);
        }}
      />
    </div>
  );
};
