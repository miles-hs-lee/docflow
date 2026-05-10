'use client';

import { Disclosure } from '@polaris/ui';
import dynamic from 'next/dynamic';
import { useState } from 'react';

type CreateAction = (formData: FormData) => void | Promise<void>;

// Heavy client component (Polaris primitives + per-file checkboxes) that
// most owners never open. Defer the JS bundle until the disclosure
// expands; on first render we ship only this tiny wrapper.
const CollectionBuilder = dynamic(
  () => import('@/components/collection-builder').then((m) => m.CollectionBuilder),
  { ssr: false }
);

export function CollectionBuilderLazy({
  createCollectionAction
}: {
  createCollectionAction: CreateAction;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Disclosure
      title={
        <span className="disclosure-title">
          <span className="disclosure-title-main">문서 묶음 생성</span>
          <span className="muted small">여러 문서를 하나의 링크로 공유할 수 있는 묶음을 만듭니다.</span>
        </span>
      }
      open={open}
      onOpenChange={setOpen}
    >
      {open ? <CollectionBuilder createCollectionAction={createCollectionAction} /> : null}
    </Disclosure>
  );
}
