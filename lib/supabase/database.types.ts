export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      collections: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          description: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          description?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          name?: string;
          description?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      collection_files: {
        Row: {
          collection_id: string;
          file_id: string;
          owner_id: string;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          collection_id: string;
          file_id: string;
          owner_id: string;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          collection_id?: string;
          file_id?: string;
          owner_id?: string;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      mcp_api_keys: {
        Row: {
          id: string;
          owner_id: string;
          label: string;
          key_hash: string;
          key_prefix: string;
          scopes: string[];
          last_used_at: string | null;
          revoked_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          label: string;
          key_hash: string;
          key_prefix: string;
          scopes?: string[];
          last_used_at?: string | null;
          revoked_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          label?: string;
          key_hash?: string;
          key_prefix?: string;
          scopes?: string[];
          last_used_at?: string | null;
          revoked_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      automation_subscriptions: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          webhook_url: string;
          signing_secret: string | null;
          event_types: string[];
          is_active: boolean;
          last_delivery_at: string | null;
          last_error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          webhook_url: string;
          signing_secret?: string | null;
          event_types: string[];
          is_active?: boolean;
          last_delivery_at?: string | null;
          last_error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          name?: string;
          webhook_url?: string;
          signing_secret?: string | null;
          event_types?: string[];
          is_active?: boolean;
          last_delivery_at?: string | null;
          last_error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      pending_storage_deletions: {
        Row: {
          id: number;
          storage_path: string;
          reason: string | null;
          created_at: string;
          processed_at: string | null;
          attempts: number;
        };
        Insert: {
          id?: number;
          storage_path: string;
          reason?: string | null;
          created_at?: string;
          processed_at?: string | null;
          attempts?: number;
        };
        Update: {
          id?: number;
          storage_path?: string;
          reason?: string | null;
          created_at?: string;
          processed_at?: string | null;
          attempts?: number;
        };
        Relationships: [];
      };
      automation_event_outbox: {
        Row: {
          id: number;
          link_event_id: number;
          owner_id: string;
          event_type: string;
          payload: Json;
          status: 'pending' | 'processing' | 'delivered' | 'failed' | 'dead';
          attempts: number;
          next_attempt_at: string;
          locked_at: string | null;
          delivered_at: string | null;
          last_error: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          link_event_id: number;
          owner_id: string;
          event_type: string;
          payload: Json;
          status?: 'pending' | 'processing' | 'delivered' | 'failed' | 'dead';
          attempts?: number;
          next_attempt_at?: string;
          locked_at?: string | null;
          delivered_at?: string | null;
          last_error?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          link_event_id?: number;
          owner_id?: string;
          event_type?: string;
          payload?: Json;
          status?: 'pending' | 'processing' | 'delivered' | 'failed' | 'dead';
          attempts?: number;
          next_attempt_at?: string;
          locked_at?: string | null;
          delivered_at?: string | null;
          last_error?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      automation_deliveries: {
        Row: {
          id: number;
          outbox_id: number;
          subscription_id: string;
          status: 'delivered' | 'failed';
          attempt_no: number;
          http_status: number | null;
          error: string | null;
          response_body: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          outbox_id: number;
          subscription_id: string;
          status: 'delivered' | 'failed';
          attempt_no?: number;
          http_status?: number | null;
          error?: string | null;
          response_body?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: number;
          outbox_id?: number;
          subscription_id?: string;
          status?: 'delivered' | 'failed';
          attempt_no?: number;
          http_status?: number | null;
          error?: string | null;
          response_body?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      files: {
        Row: {
          id: string;
          owner_id: string;
          original_name: string;
          mime_type: string;
          size_bytes: number;
          storage_path: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          original_name: string;
          mime_type: string;
          size_bytes: number;
          storage_path: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          original_name?: string;
          mime_type?: string;
          size_bytes?: number;
          storage_path?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      share_links: {
        Row: {
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
          policy_version: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          file_id?: string | null;
          collection_id?: string | null;
          owner_id: string;
          label: string;
          token: string;
          is_active?: boolean;
          expires_at?: string | null;
          max_views?: number | null;
          require_email?: boolean;
          allowed_domains?: string[];
          password_hash?: string | null;
          allow_download?: boolean;
          one_time?: boolean;
          deleted_at?: string | null;
          view_count?: number;
          download_count?: number;
          denied_count?: number;
          policy_version?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          file_id?: string | null;
          collection_id?: string | null;
          owner_id?: string;
          label?: string;
          token?: string;
          is_active?: boolean;
          expires_at?: string | null;
          max_views?: number | null;
          require_email?: boolean;
          allowed_domains?: string[];
          password_hash?: string | null;
          allow_download?: boolean;
          one_time?: boolean;
          deleted_at?: string | null;
          view_count?: number;
          download_count?: number;
          denied_count?: number;
          policy_version?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      link_events: {
        Row: {
          id: number;
          link_id: string | null;
          file_id: string | null;
          owner_id: string;
          event_type: 'view' | 'denied' | 'email_submitted' | 'password_failed' | 'download' | 'page_view';
          reason: string | null;
          session_id: string | null;
          viewer_email: string | null;
          ip_hash: string | null;
          user_agent: string | null;
          page_number: number | null;
          dwell_ms: number | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          link_id: string | null;
          file_id: string | null;
          owner_id: string;
          event_type: 'view' | 'denied' | 'email_submitted' | 'password_failed' | 'download' | 'page_view';
          reason?: string | null;
          session_id?: string | null;
          viewer_email?: string | null;
          ip_hash?: string | null;
          user_agent?: string | null;
          page_number?: number | null;
          dwell_ms?: number | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          link_id?: string | null;
          file_id?: string | null;
          owner_id?: string;
          event_type?: 'view' | 'denied' | 'email_submitted' | 'password_failed' | 'download' | 'page_view';
          reason?: string | null;
          session_id?: string | null;
          viewer_email?: string | null;
          ip_hash?: string | null;
          user_agent?: string | null;
          page_number?: number | null;
          dwell_ms?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      hard_delete_link: {
        Args: {
          p_link_id: string;
          p_owner_id: string;
        };
        Returns: boolean;
      };
      delete_file_cascade: {
        Args: {
          p_file_id: string;
          p_owner_id: string;
        };
        Returns: {
          status: 'not_found' | 'active_links_exist' | 'active_collection_links_exist' | 'ok';
        }[];
      };
      delete_collection_cascade: {
        Args: {
          p_collection_id: string;
          p_owner_id: string;
        };
        Returns: {
          status: 'not_found' | 'active_links_exist' | 'ok';
        }[];
      };
      claim_view: {
        Args: {
          p_link_id: string;
          p_file_id: string;
          p_session_id: string | null;
          p_viewer_email: string | null;
          p_ip_hash: string | null;
          p_user_agent: string | null;
        };
        Returns: {
          allowed: boolean;
          reason: string | null;
        }[];
      };
      get_owner_link_metrics: {
        Args: {
          p_file_id: string;
        };
        Returns: {
          link_id: string;
          views: number;
          unique_viewers: number;
          downloads: number;
          denied: number;
        }[];
      };
      get_denied_reason_breakdown: {
        Args: {
          p_link_id: string;
        };
        Returns: {
          reason: string;
          total: number;
        }[];
      };
      claim_event_outbox_jobs: {
        Args: {
          p_limit?: number;
        };
        Returns: {
          id: number;
          link_event_id: number;
          owner_id: string;
          event_type: string;
          payload: Json;
          status: 'pending' | 'processing' | 'delivered' | 'failed' | 'dead';
          attempts: number;
          next_attempt_at: string;
          locked_at: string | null;
          delivered_at: string | null;
          last_error: string | null;
          created_at: string;
        }[];
      };
      get_link_summary_for_owner: {
        Args: {
          p_owner_id: string;
          p_link_id: string;
        };
        Returns: {
          link_id: string;
          views: number;
          unique_viewers: number;
          downloads: number;
          denied: number;
        }[];
      };
      get_link_denied_breakdown_for_owner: {
        Args: {
          p_owner_id: string;
          p_link_id: string;
        };
        Returns: {
          reason: string;
          total: number;
        }[];
      };
      get_link_for_event: {
        Args: {
          p_token: string;
        };
        Returns: {
          id: string;
          owner_id: string;
          file_id: string | null;
          collection_id: string | null;
          is_active: boolean;
          deleted_at: string | null;
          expires_at: string | null;
          max_views: number | null;
          one_time: boolean;
          view_count: number;
          require_email: boolean;
          allowed_domains: string[];
          password_hash: string | null;
          policy_version: number;
        }[];
      };
      collection_contains_file: {
        Args: {
          p_collection_id: string;
          p_file_id: string;
          p_owner_id: string;
        };
        Returns: boolean;
      };
      get_per_page_stats: {
        Args: {
          p_owner_id: string;
          p_file_id: string;
          p_link_id?: string | null;
        };
        Returns: {
          page_number: number;
          views: number;
          total_dwell_ms: number;
        }[];
      };
      get_link_unique_views: {
        Args: {
          p_owner_id: string;
          p_link_id: string;
        };
        Returns: number;
      };
      get_viewer_link_bundle: {
        Args: {
          p_token: string;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
