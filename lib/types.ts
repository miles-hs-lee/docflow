export type LinkEventType = 'view' | 'denied' | 'email_submitted' | 'password_failed' | 'download';

export type DeniedReason =
  | 'expired'
  | 'inactive'
  | 'deleted'
  | 'max_views_reached'
  | 'domain_not_allowed'
  | 'wrong_password'
  | 'email_required'
  | 'password_required'
  | 'file_missing'
  | 'access_not_granted'
  | 'unknown';

export type ShareLinkRow = {
  id: string;
  file_id: string;
  owner_id: string;
  label: string;
  token: string;
  is_active: boolean;
  expires_at: string | null;
  max_views: number | null;
  require_email: boolean;
  allowed_domains: string[];
  password_hash: string | null;
  allow_download: boolean;
  one_time: boolean;
  deleted_at: string | null;
  view_count: number;
  download_count: number;
  denied_count: number;
  created_at: string;
  updated_at: string;
};

export type ShareLinkTrashRow = ShareLinkRow & {
  file?: {
    id: string;
    original_name: string;
  } | null;
};

export type FileRow = {
  id: string;
  owner_id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  created_at: string;
  updated_at: string;
};

export type LinkMetrics = {
  link_id: string;
  views: number;
  unique_viewers: number;
  downloads: number;
  denied: number;
};

export type DeniedReasonCount = {
  reason: string;
  total: number;
};

export type ViewerGrantPayload = {
  linkId: string;
  email?: string;
  grantedAt: number;
};
