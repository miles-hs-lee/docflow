export type LinkEventType = 'view' | 'denied' | 'email_submitted' | 'password_failed' | 'download';
export type AutomationEventType = LinkEventType;

export type McpScope =
  | 'files:read'
  | 'files:write'
  | 'links:read'
  | 'links:write'
  | 'analytics:read'
  | 'automations:read'
  | 'automations:write';

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
  file_id: string | null;
  collection_id: string | null;
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
  collection?: {
    id: string;
    name: string;
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

export type CollectionRow = {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type CollectionSummaryRow = CollectionRow & {
  file_count: number;
};

export type McpApiKeyRow = {
  id: string;
  owner_id: string;
  label: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type AutomationSubscriptionRow = {
  id: string;
  owner_id: string;
  name: string;
  webhook_url: string;
  signing_secret: string | null;
  event_types: AutomationEventType[];
  is_active: boolean;
  last_delivery_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type LinkEventRow = {
  id: number;
  link_id: string;
  file_id: string;
  owner_id: string;
  event_type: LinkEventType;
  reason: string | null;
  session_id: string | null;
  viewer_email: string | null;
  ip_hash: string | null;
  user_agent: string | null;
  created_at: string;
};

export type OutboxPayload = {
  eventId: number;
  eventType: LinkEventType;
  ownerId: string;
  linkId: string;
  fileId: string;
  reason: string | null;
  sessionId: string | null;
  viewerEmail: string | null;
  createdAt: string;
};

export type ViewerLinkBundle = ShareLinkRow & {
  file: FileRow | null;
  collection: CollectionRow | null;
  collection_files: FileRow[];
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
