import React from 'react';

type Props = {
  active: boolean;
  percent: number;
  label: string;
};

export function GenerationProgress({ active, percent, label }: Props) {
  if (!active) return null;
  const value = Math.max(2, Math.min(100, Math.round(percent)));
  return (
    <div className="mt-md" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
      <div className="flex justify-between text-xs text-text-secondary mb-xs">
        <span>{label}</span><span>{value}%</span>
      </div>
      <div className="h-3 rounded bg-bg-surface border border-border-subtle overflow-hidden">
        <div className="h-full bg-accent-cyan transition-all duration-300" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}
