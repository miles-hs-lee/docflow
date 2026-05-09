'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';

import type { FileRow } from '@/lib/types';

type CreateAction = (formData: FormData) => void | Promise<void>;

// Heavy client component (Polaris primitives + per-file checkboxes) that
// most owners never open. Defer the JS bundle until the disclosure
// expands; on first render we ship only this tiny wrapper.
const CollectionBuilder = dynamic(
  () => import('@/components/collection-builder').then((m) => m.CollectionBuilder),
  { ssr: false }
);

export function CollectionBuilderLazy({
  files,
  createCollectionAction
}: {
  files: FileRow[];
  createCollectionAction: CreateAction;
}) {
  const [open, setOpen] = useState(false);

  return (
    <details
      className="collapsible-details"
      onToggle={(event) => {
        setOpen((event.currentTarget as HTMLDetailsElement).open);
      }}
    >
      <summary className="collapsible-summary">
        <div className="stack-sm">
          <h2>문서 묶음 생성</h2>
          <p className="muted small">여러 문서를 하나의 링크로 공유할 수 있는 묶음을 만듭니다.</p>
        </div>
        <span className="collapsible-chevron" aria-hidden>▾</span>
      </summary>
      <div className="collapsible-body">
        {open ? <CollectionBuilder files={files} createCollectionAction={createCollectionAction} /> : null}
      </div>
    </details>
  );
}
