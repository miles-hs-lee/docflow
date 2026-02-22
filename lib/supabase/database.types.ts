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
        Insert: {
          id?: string;
          file_id: string;
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
          file_id?: string;
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
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
