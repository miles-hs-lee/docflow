'use client';

import { ToastProvider, ToastViewport, Toaster, TooltipProvider } from '@polaris/ui';

export function PolarisProvider({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={180}>
      <ToastProvider swipeDirection="right">
        {children}
        {/* defaultDuration (v0.7.6) — toast() callsites no longer need to pass `duration` for the standard 4s feedback. */}
        <Toaster defaultDuration={4000} />
        <ToastViewport position="top-right" />
      </ToastProvider>
    </TooltipProvider>
  );
}
