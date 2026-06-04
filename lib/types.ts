export type LinkEventType =
  | 'view'
  | 'denied'
  | 'email_submitted'
  | 'password_failed'
  | 'download'
  | 'page_view';
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
  | 'too_many_attempts'
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
  watermark: boolean;
  deleted_at: string | null;
  // Session-deduped view claims — drives max_views / one_time enforcement.
  view_count: number;
  // Total viewer-page opens (repeat-inclusive). Surfaced as "조회수"; pairs
  // with unique_viewers ("유니크") so the two tiles are no longer identical.
  open_count: number;
  download_count: number;
  denied_count: number;
  policy_version: number;
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
  // Migration 005 dropped NOT NULL on link_id / file_id and switched both
  // FKs to ON DELETE SET NULL so audit rows survive parent hard-delete.
  link_id: string | null;
  file_id: string | null;
  owner_id: string;
  event_type: LinkEventType;
  reason: string | null;
  session_id: string | null;
  viewer_email: string | null;
  ip_hash: string | null;
  user_agent: string | null;
  page_number: number | null;
  dwell_ms: number | null;
  created_at: string;
};

export type PerPageStat = {
  page_number: number;
  // Raw page_view row count (one per dwell segment) — internal use.
  views: number;
  // Distinct sessions that read this page — what the UI surfaces ("N명").
  viewers: number;
  total_dwell_ms: number;
};

export type LinkDailyView = {
  day: string;
  // Distinct sessions with any view/page_view activity that day.
  sessions: number;
  // First-time 'view' events that day (new unique viewers).
  new_viewers: number;
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
  // Total opens (open_count) — repeat-inclusive, distinct from unique_viewers.
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
  policyVersion: number;
  email?: string;
  grantedAt: number;
};
