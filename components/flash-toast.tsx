'use client';

import { toast } from '@polaris/ui';
import { useEffect } from 'react';

const FLASH_QUERY_KEYS = ['success', 'error'] as const;

// Bridges URL-based flash (?success=… / ?error=…) — which server actions
// set via redirect — to Polaris toasts. Server actions can't dispatch
// client toast() directly, so we keep the redirect contract and let
// this client island fire the toast on mount, then strip the keys
// from the URL so reloads don't re-toast.
export function FlashToast() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const success = params.get('success');
    const error = params.get('error');

    if (success) {
      toast({ title: '완료', description: decodeURIComponent(success), variant: 'success' });
    }
    if (error) {
      toast({ title: '확인 필요', description: decodeURIComponent(error), variant: 'danger' });
    }

    if (!success && !error) return;

    let changed = false;
    FLASH_QUERY_KEYS.forEach((key) => {
      if (params.has(key)) {
        params.delete(key);
        changed = true;
      }
    });
    if (!changed) return;

    const search = params.toString();
    const nextUrl = `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', nextUrl);
  }, []);

  return null;
}
