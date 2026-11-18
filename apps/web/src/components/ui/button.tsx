import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'vr';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

const baseStyles =
  'inline-flex items-center justify-center font-sans font-medium transition-colors duration-fast select-none cursor-pointer ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-energy-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ' +
  'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none';

const sizeStyles = {
  sm: 'text-xs px-2.5 py-1.5 rounded-control-sm gap-1.5 h-8',
  md: 'text-sm px-4 py-2 rounded-control gap-2 h-10',
};

const variantStyles = {
  primary:
    'bg-solar-amber text-slate-950 hover:bg-warning-amber active:brightness-95 shadow-sm font-semibold',
  secondary:
    'bg-surface text-text-primary border border-border hover:bg-surface-hover hover:border-border-strong active:bg-surface-elevated',
  ghost:
    'bg-transparent text-text-secondary hover:text-text-primary hover:bg-surface-hover active:bg-surface-elevated',
  danger:
    'bg-critical-red/15 text-critical-red border border-critical-red/40 hover:bg-critical-red/25 active:bg-critical-red/35',
  /** VR immersion entry (the showcase): filled cyan with a glow, louder than every other action. */
  vr: 'bg-energy-cyan text-slate-950 font-semibold shadow-md shadow-energy-cyan/30 ring-1 ring-energy-cyan/60 hover:bg-energy-cyan/90 active:brightness-95',
};

/** Button classes, for elements that must look like a button but aren't one (e.g. a `<Link>`). */
export function buttonVariants({
  variant = 'secondary',
  size = 'md',
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  return cn(baseStyles, sizeStyles[size], variantStyles[variant], className);
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  children,
  className,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      {...props}
      disabled={isDisabled}
      aria-busy={loading ? 'true' : undefined}
      className={buttonVariants({ variant, size, className })}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-current shrink-0" aria-hidden="true" />
      ) : icon ? (
        <span className="shrink-0" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children && <span>{children}</span>}
    </button>
  );
}
