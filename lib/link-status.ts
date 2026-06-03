// Shared share-link status derivation. Previously duplicated verbatim in
// app/dashboard/files/[fileId]/page.tsx and
// app/dashboard/collections/[collectionId]/page.tsx.

export type LinkStatus = 'active' | 'inactive' | 'expired' | 'deleted';
export type LinkStatusBadgeVariant = 'success' | 'warning' | 'danger';

type LinkStatusInput = {
  is_active: boolean;
  deleted_at: string | null;
  expires_at: string | null;
};

export function linkStatus(link: LinkStatusInput): LinkStatus {
  if (link.deleted_at) return 'deleted';
  if (!link.is_active) return 'inactive';
  if (link.expires_at && new Date(link.expires_at) < new Date()) return 'expired';
  return 'active';
}

export function statusVariant(status: LinkStatus): LinkStatusBadgeVariant {
  if (status === 'active') return 'success';
  if (status === 'deleted') return 'danger';
  return 'warning';
}
