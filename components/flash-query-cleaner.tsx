'use client';

import { useEffect } from 'react';

const FLASH_QUERY_KEYS = ['success', 'error'] as const;

export function FlashQueryCleaner() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
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
