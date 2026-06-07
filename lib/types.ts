export type LinkEventType =
  | 'view'
  | 'denied'
  | 'email_submitted'
  | 'password_failed'
  | 'download'
  | 'page_view'
  | 'agreement';
export type AutomationEventType = LinkEventType;

// Where a subscription delivers. 'webhook' POSTs DocFlow's native JSON
// (optionally HMAC-signed); 'teams' POSTs an Adaptive Card envelope to a
// Teams/Power Automate incoming webhook (no HMAC — the secret URL is auth).
export type AutomationDestinationType = 'webhook' | 'teams';

export type McpScope =
  | 'files:read'
  | 'files:write'
  | 'links:read'
  | 'links:write'
  | 'analytics:read'
  | 'automations:read'
  | 'automations:write';

// Teams / workspaces (P1). Resources are tenanted by workspace_id; a user joins
// a workspace via workspace_members with a role. owner > admin > member.
export type WorkspaceRole = 'owner' | 'admin' | 'member';

export type WorkspaceRow = {
  id: string;
  name: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkspaceMemberRow = {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  created_at: string;
};

// A workspace plus the current user's role in it — what requireWorkspace resolves.
export type WorkspaceWithRole = WorkspaceRow & { role: WorkspaceRole };

export type WorkspaceInvitationStatus = 'pending' | 'accepted' | 'revoked';

export type WorkspaceInvitationRow = {
  id: string;
  workspace_id: string;
  email: string;
  role: WorkspaceRole;
  token: string;
  invited_by: string | null;
  status: WorkspaceInvitationStatus;
  accepted_by: string | null;
  accepted_at: string | null;
  expires_at: string | null;
  created_at: string;
};

// A roster row joined with the member's email (resolved via the admin auth API).
export type WorkspaceMemberWithUser = {
  user_id: string;
  role: WorkspaceRole;
  email: string | null;
  created_at: string;
};

export type DeniedReason =
  | 'expired'
  | 'inactive'
  | 'deleted'
  | 'max_views_reached'
  | 'domain_not_allowed'
  | 'wrong_password'
  | 'email_required'
  | 'password_required'
  | 'agreement_required'
  | 'file_missing'
  | 'access_not_granted'
  | 'too_many_attempts'
  | 'unknown';

export type ShareLinkRow = {
  id: string;
  file_id: string | null;
  collection_id: string | null;
  owner_id: string;
  workspace_id: string | null;
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
  // Clickwrap NDA gate: when true the viewer must accept agreement_text
  // (and type their name) before the grant is issued. Captured as an
  // 'agreement' link_event for audit.
  require_agreement: boolean;
  agreement_text: string | null;
  // Data room Phase 3: when set, the link is scoped to a viewer group and the
  // viewer sees only that group's permitted folders (+ root files when the
  // group allows). NULL = full access to the whole data room (default).
  viewer_group_id: string | null;
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
  workspace_id: string | null;
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
  workspace_id: string | null;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type CollectionSummaryRow = CollectionRow & {
  file_count: number;
};

// A folder inside a space (= collection). Self-referential tree;
// parent_folder_id NULL = top level.
export type FolderRow = {
  id: string;
  collection_id: string;
  parent_folder_id: string | null;
  owner_id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

// A file as it sits inside a space — the file row plus its folder
// placement from collection_files (folder_id NULL = space root).
export type SpaceFile = FileRow & {
  folder_id: string | null;
};

// Data room Phase 3: a named permission set inside a data room. A share link
// assigned to a group exposes only the group's permitted folders to viewers.
export type ViewerGroupRow = {
  id: string;
  collection_id: string;
  owner_id: string;
  name: string;
  // Whether grouped viewers also see root-level (folder_id NULL) files.
  include_root: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

// A folder granted to a group. Granting a folder implicitly grants its whole
// subtree (resolved at read time in get_viewer_link_bundle / link_can_view_file).
export type ViewerGroupFolderRow = {
  group_id: string;
  folder_id: string;
  owner_id: string;
  created_at: string;
};

// A group plus the ids of the folders directly granted to it — what the owner
// UI renders (each folder a checkbox, descendants implied).
export type ViewerGroupWithFolders = ViewerGroupRow & {
  folder_ids: string[];
};

// Data room Phase 4: a viewer Q&A. A viewer of a data-room link asks the owner a
// question; the owner answers from the dashboard. Private between the asking
// session + the owner — never visible to other viewers.
export type DataRoomQuestionRow = {
  id: string;
  collection_id: string;
  // The share link the viewer used; SET NULL if that link is later deleted.
  link_id: string | null;
  owner_id: string;
  session_id: string | null;
  asker_email: string | null;
  body: string;
  answer: string | null;
  answered_at: string | null;
  ip_hash: string | null;
  created_at: string;
  updated_at: string;
};

// The viewer-facing slice of their own Q&A thread (no owner_id / ip_hash).
export type ViewerQuestion = {
  id: string;
  body: string;
  answer: string | null;
  answered_at: string | null;
  created_at: string;
};

// File Request: an inbound upload request the owner publishes at /r/<token>.
// Visitors upload files to the owner (the reverse of a share link).
export type FileRequestRow = {
  id: string;
  owner_id: string;
  workspace_id: string | null;
  token: string;
  title: string;
  instructions: string | null;
  require_email: boolean;
  is_active: boolean;
  expires_at: string | null;
  // null = unlimited uploads.
  max_uploads: number | null;
  upload_count: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

// One file uploaded against a request. Stored in the 'request-uploads' bucket,
// kept separate from the owner's curated `files`.
export type FileRequestUploadRow = {
  id: string;
  request_id: string;
  owner_id: string;
  uploader_email: string | null;
  original_name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  ip_hash: string | null;
  // Two-phase commit: NULL until the object is durably stored. Only confirmed
  // rows are shown to the owner; unconfirmed orphans are swept by the cron.
  confirmed_at: string | null;
  created_at: string;
};

// Custom branding (white-label) — one row per owner.
export type OwnerBrandingRow = {
  owner_id: string;
  company_name: string | null;
  brand_color: string | null;
  logo_path: string | null;
  cover_image_path: string | null;
  created_at: string;
  updated_at: string;
};

// Per-data-room branding — layered over OwnerBrandingRow (field-level merge).
export type CollectionBrandingRow = {
  collection_id: string;
  owner_id: string;
  company_name: string | null;
  brand_color: string | null;
  logo_path: string | null;
  cover_image_path: string | null;
  created_at: string;
  updated_at: string;
};

// Resolved branding handed to the public pages: logo_path / cover_image_path →
// absolute public URLs. null = no branding configured (pages show the default
// DocFlow mark).
export type ViewerBranding = {
  company_name: string | null;
  brand_color: string | null;
  logo_url: string | null;
  // Wide hero/cover banner shown on the branded landing surfaces (access gate,
  // empty data room, file request). null = no cover set.
  cover_image_url: string | null;
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
  destination_type: AutomationDestinationType;
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
  // Signer name captured on 'agreement' events; NULL for every other type.
  agreement_name: string | null;
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

// One row per visitor for the link-detail "방문자" table. Keyed by email
// when the link collected one, else by session_id (see get_link_visitors).
export type LinkVisitor = {
  visitor_key: string;
  viewer_email: string | null;
  // Distinct sessions this visitor used.
  sessions: number;
  first_seen: string;
  last_seen: string;
  // Distinct pages read across all of this visitor's sessions.
  pages_viewed: number;
  total_dwell_ms: number;
  downloads: number;
  // Whether this visitor accepted the clickwrap NDA on this link.
  agreed: boolean;
};

// Account-wide rollups for the overview dashboard + contacts (migration 020).
export type OwnerOverview = {
  opens: number;
  unique_viewers: number;
  downloads: number;
  denied: number;
};

export type TopDocument = {
  file_id: string;
  original_name: string;
  viewers: number;
  views: number;
};

// One contact = everyone who submitted an email, rolled up across all links.
export type OwnerContact = {
  viewer_email: string;
  documents: number;
  sessions: number;
  opens: number;
  downloads: number;
  agreed: boolean;
  first_seen: string;
  last_seen: string;
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
  // SpaceFile (FileRow + folder_id) so the viewer can build the folder tree.
  collection_files: SpaceFile[];
  folders: FolderRow[];
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
  // Assent timestamp, set when the viewer accepted a clickwrap NDA gate
  // (absent on links without require_agreement). The signer name is NOT kept
  // here — the durable record lives in link_events.agreement_name.
  agreedAt?: number;
};
