'use client';

import { ToastProvider, ToastViewport, Toaster, TooltipProvider } from '@polaris/ui';

export function PolarisProvider({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={180}>
      <ToastProvider swipeDirection="right">
        {children}
        <Toaster />
        <ToastViewport position="top-right" />
      </ToastProvider>
    </TooltipProvider>
  );
}
