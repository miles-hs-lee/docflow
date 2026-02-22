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
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      link_events: {
        Row: {
          id: number;
          link_id: string;
          file_id: string;
          owner_id: string;
          event_type: 'view' | 'denied' | 'email_submitted' | 'password_failed' | 'download';
          reason: string | null;
          session_id: string | null;
          viewer_email: string | null;
          ip_hash: string | null;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          link_id: string;
          file_id: string;
          owner_id: string;
          event_type: 'view' | 'denied' | 'email_submitted' | 'password_failed' | 'download';
          reason?: string | null;
          session_id?: string | null;
          viewer_email?: string | null;
          ip_hash?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          link_id?: string;
          file_id?: string;
          owner_id?: string;
          event_type?: 'view' | 'denied' | 'email_submitted' | 'password_failed' | 'download';
          reason?: string | null;
          session_id?: string | null;
          viewer_email?: string | null;
          ip_hash?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
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
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
