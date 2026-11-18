import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { VrQuickLink, VR_QUICK_HREF } from '../vr-quick-link';
import { Header } from '../header';
import { I18nProvider } from '@/lib/i18n';
import { ThemeProvider } from '@/lib/theme';

let mockPathname = '/overview';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <ThemeProvider>
    <I18nProvider>{children}</I18nProvider>
  </ThemeProvider>
);

describe('VrQuickLink', () => {
  it('opens the /village VR immersion directly', () => {
    expect(VR_QUICK_HREF).toBe('/village?immersion=vr');
    mockPathname = '/overview';
    render(<VrQuickLink variant="sidebar" />, { wrapper });
    const link = screen.getByRole('link', { name: /enter vr/i });
    expect(link).toHaveAttribute('href', VR_QUICK_HREF);
    expect(link.className).toContain('bg-energy-cyan');
  });

  it('is in the header on every page but /village', () => {
    mockPathname = '/simulation';
    const { unmount } = render(<Header title="T" />, { wrapper });
    expect(screen.getByRole('link', { name: /enter vr/i })).toHaveAttribute('href', VR_QUICK_HREF);
    unmount();

    mockPathname = '/village';
    render(<Header title="T" />, { wrapper });
    expect(screen.queryByRole('link', { name: /enter vr/i })).toBeNull();
  });
});
