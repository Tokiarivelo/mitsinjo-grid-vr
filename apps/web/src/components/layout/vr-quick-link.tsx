'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Glasses } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import { immersionHref } from '@/features/microgrid-3d/utils/immersion-query';
import { useTranslations } from '@/lib/i18n';

/** The showcase's door: the /village VR studio (photo → 3D model), opened at once. */
export const VR_QUICK_PATH = '/village';
export const VR_QUICK_HREF = immersionHref(VR_QUICK_PATH);

export interface VrQuickLinkProps {
  /** `header`: compact pill (icon only under `sm`). `sidebar`: full-width card above the nav. */
  variant: 'header' | 'sidebar';
  /** Sidebar folded to its icon rail (xl+). */
  collapsed?: boolean;
  onNavigate?: () => void;
  className?: string;
}

/**
 * One-tap entry into the VR immersion from any page. Hidden on /village itself: the page's own
 * « View in VR » button is there, and a same-path link would not reopen the immersion.
 */
export function VrQuickLink({
  variant,
  collapsed = false,
  onNavigate,
  className,
}: VrQuickLinkProps) {
  const pathname = usePathname();
  const t = useTranslations('nav');
  if (pathname === VR_QUICK_PATH) return null;
  const label = t('vrImmersion');
  const hint = t('vrImmersionHint');

  if (variant === 'header') {
    return (
      <Link
        href={VR_QUICK_HREF}
        aria-label={`${label}: ${hint}`}
        title={hint}
        className={buttonVariants({
          variant: 'vr',
          size: 'sm',
          className: cn('h-10 min-w-10 px-2.5 sm:h-9 sm:px-3', className),
        })}
      >
        <Glasses className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="hidden sm:inline">{label}</span>
      </Link>
    );
  }

  return (
    <Link
      href={VR_QUICK_HREF}
      onClick={onNavigate}
      title={collapsed ? label : hint}
      aria-label={`${label}: ${hint}`}
      className={buttonVariants({
        variant: 'vr',
        size: 'md',
        className: cn(
          'w-full min-h-11 h-auto justify-start py-2.5',
          collapsed && 'xl:justify-center xl:px-0',
          className
        ),
      })}
    >
      <Glasses className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span
        className={cn(
          'flex flex-col items-start text-left leading-tight',
          collapsed && 'xl:sr-only'
        )}
      >
        <span className="text-sm">{label}</span>
        <span className="text-[11px] font-medium opacity-80">{hint}</span>
      </span>
    </Link>
  );
}
