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
          workspace_id: string | null;
          name: string;
          description: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          workspace_id?: string | null;
          name: string;
          description?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          workspace_id?: string | null;
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
          workspace_id: string | null;
          sort_order: number;
          folder_id: string | null;
          created_at: string;
        };
        Insert: {
          collection_id: string;
          file_id: string;
          owner_id: string;
          workspace_id?: string | null;
          sort_order?: number;
          folder_id?: string | null;
          created_at?: string;
        };
        Update: {
          collection_id?: string;
          file_id?: string;
          owner_id?: string;
          workspace_id?: string | null;
          sort_order?: number;
          folder_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      folders: {
        Row: {
          id: string;
          collection_id: string;
          parent_folder_id: string | null;
          owner_id: string;
          workspace_id: string | null;
          name: string;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          collection_id: string;
          parent_folder_id?: string | null;
          owner_id: string;
          workspace_id?: string | null;
          name: string;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          collection_id?: string;
          parent_folder_id?: string | null;
          owner_id?: string;
          workspace_id?: string | null;
          name?: string;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      viewer_groups: {
        Row: {
          id: string;
          collection_id: string;
          owner_id: string;
          workspace_id: string | null;
          name: string;
          include_root: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          collection_id: string;
          owner_id: string;
          workspace_id?: string | null;
          name: string;
          include_root?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          collection_id?: string;
          owner_id?: string;
          workspace_id?: string | null;
          name?: string;
          include_root?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      viewer_group_folders: {
        Row: {
          group_id: string;
          folder_id: string;
          owner_id: string;
          workspace_id: string | null;
          created_at: string;
        };
        Insert: {
          group_id: string;
          folder_id: string;
          owner_id: string;
          workspace_id?: string | null;
          created_at?: string;
        };
        Update: {
          group_id?: string;
          folder_id?: string;
          owner_id?: string;
          workspace_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      mcp_api_keys: {
        Row: {
          id: string;
          owner_id: string;
          workspace_id: string | null;
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
          workspace_id?: string | null;
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
          workspace_id?: string | null;
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
          workspace_id: string | null;
          name: string;
          webhook_url: string;
          signing_secret: string | null;
          event_types: string[];
          destination_type: 'webhook' | 'teams';
          is_active: boolean;
          last_delivery_at: string | null;
          last_error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          workspace_id?: string | null;
          name: string;
          webhook_url: string;
          signing_secret?: string | null;
          event_types: string[];
          destination_type?: 'webhook' | 'teams';
          is_active?: boolean;
          last_delivery_at?: string | null;
          last_error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          workspace_id?: string | null;
          name?: string;
          webhook_url?: string;
          signing_secret?: string | null;
          event_types?: string[];
          destination_type?: 'webhook' | 'teams';
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
          bucket: string;
        };
        Insert: {
          id?: number;
          storage_path: string;
          reason?: string | null;
          created_at?: string;
          processed_at?: string | null;
          attempts?: number;
          bucket?: string;
        };
        Update: {
          id?: number;
          storage_path?: string;
          reason?: string | null;
          created_at?: string;
          processed_at?: string | null;
          attempts?: number;
          bucket?: string;
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
          workspace_id: string | null;
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
          workspace_id?: string | null;
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
          workspace_id?: string | null;
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
          require_agreement: boolean;
          agreement_text: string | null;
          viewer_group_id: string | null;
          deleted_at: string | null;
          view_count: number;
          open_count: number;
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
          workspace_id?: string | null;
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
          watermark?: boolean;
          require_agreement?: boolean;
          agreement_text?: string | null;
          viewer_group_id?: string | null;
          deleted_at?: string | null;
          view_count?: number;
          open_count?: number;
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
          workspace_id?: string | null;
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
          watermark?: boolean;
          require_agreement?: boolean;
          agreement_text?: string | null;
          viewer_group_id?: string | null;
          deleted_at?: string | null;
          view_count?: number;
          open_count?: number;
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
          workspace_id: string | null;
          event_type: 'view' | 'denied' | 'email_submitted' | 'password_failed' | 'download' | 'page_view' | 'agreement';
          reason: string | null;
          session_id: string | null;
          viewer_email: string | null;
          ip_hash: string | null;
          user_agent: string | null;
          page_number: number | null;
          dwell_ms: number | null;
          agreement_name: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          link_id: string | null;
          file_id: string | null;
          owner_id: string;
          workspace_id?: string | null;
          event_type: 'view' | 'denied' | 'email_submitted' | 'password_failed' | 'download' | 'page_view' | 'agreement';
          reason?: string | null;
          session_id?: string | null;
          viewer_email?: string | null;
          ip_hash?: string | null;
          user_agent?: string | null;
          page_number?: number | null;
          dwell_ms?: number | null;
          agreement_name?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          link_id?: string | null;
          file_id?: string | null;
          owner_id?: string;
          workspace_id?: string | null;
          event_type?: 'view' | 'denied' | 'email_submitted' | 'password_failed' | 'download' | 'page_view' | 'agreement';
          reason?: string | null;
          session_id?: string | null;
          viewer_email?: string | null;
          ip_hash?: string | null;
          user_agent?: string | null;
          page_number?: number | null;
          dwell_ms?: number | null;
          agreement_name?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      file_requests: {
        Row: {
          id: string;
          owner_id: string;
          workspace_id: string | null;
          token: string;
          title: string;
          instructions: string | null;
          require_email: boolean;
          is_active: boolean;
          expires_at: string | null;
          max_uploads: number | null;
          upload_count: number;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          workspace_id?: string | null;
          token: string;
          title: string;
          instructions?: string | null;
          require_email?: boolean;
          is_active?: boolean;
          expires_at?: string | null;
          max_uploads?: number | null;
          upload_count?: number;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          workspace_id?: string | null;
          token?: string;
          title?: string;
          instructions?: string | null;
          require_email?: boolean;
          is_active?: boolean;
          expires_at?: string | null;
          max_uploads?: number | null;
          upload_count?: number;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      file_request_uploads: {
        Row: {
          id: string;
          request_id: string;
          owner_id: string;
          workspace_id: string | null;
          uploader_email: string | null;
          original_name: string;
          storage_path: string;
          mime_type: string;
          size_bytes: number;
          ip_hash: string | null;
          confirmed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          request_id: string;
          owner_id: string;
          workspace_id?: string | null;
          uploader_email?: string | null;
          original_name: string;
          storage_path: string;
          mime_type: string;
          size_bytes: number;
          ip_hash?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          request_id?: string;
          owner_id?: string;
          workspace_id?: string | null;
          uploader_email?: string | null;
          original_name?: string;
          storage_path?: string;
          mime_type?: string;
          size_bytes?: number;
          ip_hash?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      owner_branding: {
        Row: {
          owner_id: string;
          workspace_id: string | null;
          company_name: string | null;
          brand_color: string | null;
          logo_path: string | null;
          cover_image_path: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          owner_id: string;
          workspace_id?: string | null;
          company_name?: string | null;
          brand_color?: string | null;
          logo_path?: string | null;
          cover_image_path?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          owner_id?: string;
          workspace_id?: string | null;
          company_name?: string | null;
          brand_color?: string | null;
          logo_path?: string | null;
          cover_image_path?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      collection_branding: {
        Row: {
          collection_id: string;
          owner_id: string;
          workspace_id: string | null;
          company_name: string | null;
          brand_color: string | null;
          logo_path: string | null;
          cover_image_path: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          collection_id: string;
          owner_id: string;
          workspace_id?: string | null;
          company_name?: string | null;
          brand_color?: string | null;
          logo_path?: string | null;
          cover_image_path?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          collection_id?: string;
          owner_id?: string;
          workspace_id?: string | null;
          company_name?: string | null;
          brand_color?: string | null;
          logo_path?: string | null;
          cover_image_path?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      data_room_questions: {
        Row: {
          id: string;
          collection_id: string;
          link_id: string | null;
          owner_id: string;
          workspace_id: string | null;
          session_id: string | null;
          asker_email: string | null;
          body: string;
          answer: string | null;
          answered_at: string | null;
          ip_hash: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          collection_id: string;
          link_id?: string | null;
          owner_id: string;
          workspace_id?: string | null;
          session_id?: string | null;
          asker_email?: string | null;
          body: string;
          answer?: string | null;
          answered_at?: string | null;
          ip_hash?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          collection_id?: string;
          link_id?: string | null;
          owner_id?: string;
          workspace_id?: string | null;
          session_id?: string | null;
          asker_email?: string | null;
          body?: string;
          answer?: string | null;
          answered_at?: string | null;
          ip_hash?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      workspaces: {
        Row: {
          id: string;
          name: string;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      workspace_members: {
        Row: {
          workspace_id: string;
          user_id: string;
          role: 'owner' | 'admin' | 'member';
          created_at: string;
        };
        Insert: {
          workspace_id: string;
          user_id: string;
          role?: 'owner' | 'admin' | 'member';
          created_at?: string;
        };
        Update: {
          workspace_id?: string;
          user_id?: string;
          role?: 'owner' | 'admin' | 'member';
          created_at?: string;
        };
        Relationships: [];
      };
      workspace_invitations: {
        Row: {
          id: string;
          workspace_id: string;
          email: string;
          role: 'owner' | 'admin' | 'member';
          token: string;
          invited_by: string | null;
          status: 'pending' | 'accepted' | 'revoked';
          accepted_by: string | null;
          accepted_at: string | null;
          expires_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          email: string;
          role?: 'owner' | 'admin' | 'member';
          token: string;
          invited_by?: string | null;
          status?: 'pending' | 'accepted' | 'revoked';
          accepted_by?: string | null;
          accepted_at?: string | null;
          expires_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          email?: string;
          role?: 'owner' | 'admin' | 'member';
          token?: string;
          invited_by?: string | null;
          status?: 'pending' | 'accepted' | 'revoked';
          accepted_by?: string | null;
          accepted_at?: string | null;
          expires_at?: string | null;
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
          p_workspace_id: string;
        };
        Returns: boolean;
      };
      ensure_personal_workspace: {
        Args: {
          p_user_id: string;
        };
        Returns: {
          id: string;
          name: string;
          created_by: string;
          created_at: string;
          updated_at: string;
          role: 'owner' | 'admin' | 'member';
        }[];
      };
      delete_file_cascade: {
        Args: {
          p_file_id: string;
          p_workspace_id: string;
        };
        Returns: {
          status: 'not_found' | 'active_links_exist' | 'active_collection_links_exist' | 'ok';
        }[];
      };
      delete_collection_cascade: {
        Args: {
          p_collection_id: string;
          p_workspace_id: string;
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
      link_can_view_file: {
        Args: {
          p_link_id: string;
          p_file_id: string;
        };
        Returns: boolean;
      };
      viewer_group_folder_closure: {
        Args: {
          p_group_id: string;
          p_collection_id: string;
          p_owner_id: string;
        };
        Returns: string[];
      };
      claim_file_request_upload: {
        Args: {
          p_request_id: string;
          p_upload_id: string;
          p_uploader_email: string | null;
          p_original_name: string;
          p_storage_path: string;
          p_mime_type: string;
          p_size_bytes: number;
          p_ip_hash: string | null;
        };
        Returns: string;
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
          viewers: number;
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
      get_link_daily_views: {
        Args: {
          p_owner_id: string;
          p_link_id: string;
          p_days?: number;
        };
        Returns: {
          day: string;
          sessions: number;
          new_viewers: number;
        }[];
      };
      get_viewer_link_bundle: {
        Args: {
          p_token: string;
        };
        Returns: Json;
      };
      increment_link_open_count: {
        Args: {
          p_link_id: string;
        };
        Returns: undefined;
      };
      accept_workspace_invitation: {
        Args: {
          p_token: string;
          p_user_id: string;
          p_user_email: string;
        };
        Returns: {
          workspace_id: string;
          outcome: string;
        }[];
      };
      reorder_collection_files: {
        Args: {
          p_collection_id: string;
          p_workspace_id: string;
          p_file_ids: string[];
        };
        Returns: undefined;
      };
      reorder_folders: {
        Args: {
          p_collection_id: string;
          p_workspace_id: string;
          p_folder_ids: string[];
        };
        Returns: undefined;
      };
      get_link_visitors: {
        Args: {
          p_owner_id: string;
          p_link_id: string;
          p_limit?: number;
        };
        Returns: {
          visitor_key: string;
          viewer_email: string | null;
          sessions: number;
          first_seen: string;
          last_seen: string;
          pages_viewed: number;
          total_dwell_ms: number;
          downloads: number;
          agreed: boolean;
        }[];
      };
      get_owner_overview: {
        Args: {
          p_owner_id: string;
        };
        Returns: {
          opens: number;
          unique_viewers: number;
          downloads: number;
          denied: number;
        }[];
      };
      get_owner_top_documents: {
        Args: {
          p_owner_id: string;
          p_limit?: number;
        };
        Returns: {
          file_id: string;
          original_name: string;
          viewers: number;
          views: number;
        }[];
      };
      get_collection_unique_views: {
        Args: {
          p_owner_id: string;
          p_collection_id: string;
        };
        Returns: number;
      };
      get_collection_link_uniques: {
        Args: {
          p_owner_id: string;
          p_collection_id: string;
        };
        Returns: {
          link_id: string;
          unique_viewers: number;
        }[];
      };
      get_owner_contacts: {
        Args: {
          p_owner_id: string;
          p_limit?: number;
        };
        Returns: {
          viewer_email: string;
          documents: number;
          sessions: number;
          opens: number;
          downloads: number;
          agreed: boolean;
          first_seen: string;
          last_seen: string;
        }[];
      };
      get_workspace_overview: {
        Args: {
          p_workspace_id: string;
        };
        Returns: {
          opens: number;
          unique_viewers: number;
          downloads: number;
          denied: number;
        }[];
      };
      get_workspace_top_documents: {
        Args: {
          p_workspace_id: string;
          p_limit?: number;
        };
        Returns: {
          file_id: string;
          original_name: string;
          viewers: number;
          views: number;
        }[];
      };
      get_workspace_contacts: {
        Args: {
          p_workspace_id: string;
          p_limit?: number;
        };
        Returns: {
          viewer_email: string;
          documents: number;
          sessions: number;
          opens: number;
          downloads: number;
          agreed: boolean;
          first_seen: string;
          last_seen: string;
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
