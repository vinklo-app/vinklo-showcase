// Generado por scripts/gen-db-types.sh desde supabase/migrations (no editar a mano).
// Regenerar: TEST_DATABASE_URL=… scripts/test-sql.sh && TEST_DATABASE_URL=… scripts/gen-db-types.sh

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      builder_draft_stash: {
        Row: {
          created_at: string
          draft: Json
          email: string
          expires_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          draft: Json
          email: string
          expires_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          draft?: Json
          email?: string
          expires_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      contributions: {
        Row: {
          created_at: string
          cubierto_cents: number
          gift_cents: number
          guest_email: string | null
          guest_name: string
          id: string
          message: string | null
          method: Database["public"]["Enums"]["contribution_method"]
          n_cubiertos: number
          service_fee_cents: number
          status: Database["public"]["Enums"]["contribution_status"]
          stripe_payment_intent_id: string | null
          total_cents: number
          wedding_id: string
        }
        Insert: {
          created_at?: string
          cubierto_cents: number
          gift_cents?: number
          guest_email?: string | null
          guest_name: string
          id?: string
          message?: string | null
          method: Database["public"]["Enums"]["contribution_method"]
          n_cubiertos?: number
          service_fee_cents?: number
          status?: Database["public"]["Enums"]["contribution_status"]
          stripe_payment_intent_id?: string | null
          total_cents: number
          wedding_id: string
        }
        Update: {
          created_at?: string
          cubierto_cents?: number
          gift_cents?: number
          guest_email?: string | null
          guest_name?: string
          id?: string
          message?: string | null
          method?: Database["public"]["Enums"]["contribution_method"]
          n_cubiertos?: number
          service_fee_cents?: number
          status?: Database["public"]["Enums"]["contribution_status"]
          stripe_payment_intent_id?: string | null
          total_cents?: number
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contributions_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: false
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          id: number
          payload: Json
          type: string
          wedding_id: string | null
        }
        Insert: {
          created_at?: string
          id?: never
          payload?: Json
          type: string
          wedding_id?: string | null
        }
        Update: {
          created_at?: string
          id?: never
          payload?: Json
          type?: string
          wedding_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: false
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_tranches: {
        Row: {
          amount_cents: number
          created_at: string
          due_date: string | null
          id: string
          label: string
          paid_at: string | null
          status: Database["public"]["Enums"]["tranche_status"]
          vendor_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          due_date?: string | null
          id?: string
          label: string
          paid_at?: string | null
          status?: Database["public"]["Enums"]["tranche_status"]
          vendor_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          due_date?: string | null
          id?: string
          label?: string
          paid_at?: string | null
          status?: Database["public"]["Enums"]["tranche_status"]
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_tranches_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_deletions: {
        Row: {
          attempts: number
          id: string
          kind: string
          last_attempt_at: string | null
          last_error: string | null
          requested_at: string
          target_id: string
          vendor_ids: string[]
        }
        Insert: {
          attempts?: number
          id?: string
          kind: string
          last_attempt_at?: string | null
          last_error?: string | null
          requested_at?: string
          target_id: string
          vendor_ids?: string[]
        }
        Update: {
          attempts?: number
          id?: string
          kind?: string
          last_attempt_at?: string | null
          last_error?: string | null
          requested_at?: string
          target_id?: string
          vendor_ids?: string[]
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          phone: string | null
          role: Database["public"]["Enums"]["profile_role"]
        }
        Insert: {
          created_at?: string
          full_name?: string
          id: string
          phone?: string | null
          role?: Database["public"]["Enums"]["profile_role"]
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["profile_role"]
        }
        Relationships: []
      }
      rate_limit_hits: {
        Row: {
          bucket_key: string
          created_at: string
          id: number
        }
        Insert: {
          bucket_key: string
          created_at?: string
          id?: never
        }
        Update: {
          bucket_key?: string
          created_at?: string
          id?: never
        }
        Relationships: []
      }
      vendor_invoices: {
        Row: {
          file_path: string
          id: string
          notes: string | null
          total_cents: number
          uploaded_at: string
          vendor_id: string
        }
        Insert: {
          file_path: string
          id?: string
          notes?: string | null
          total_cents: number
          uploaded_at?: string
          vendor_id: string
        }
        Update: {
          file_path?: string
          id?: string
          notes?: string | null
          total_cents?: number
          uploaded_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_invoices_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          category: string
          created_at: string
          email: string
          iban: string | null
          id: string
          invite_token: string
          invite_token_expires_at: string
          name: string
          status: Database["public"]["Enums"]["vendor_status"]
          wedding_id: string
        }
        Insert: {
          category: string
          created_at?: string
          email: string
          iban?: string | null
          id?: string
          invite_token?: string
          invite_token_expires_at?: string
          name: string
          status?: Database["public"]["Enums"]["vendor_status"]
          wedding_id: string
        }
        Update: {
          category?: string
          created_at?: string
          email?: string
          iban?: string | null
          id?: string
          invite_token?: string
          invite_token_expires_at?: string
          name?: string
          status?: Database["public"]["Enums"]["vendor_status"]
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendors_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: false
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist: {
        Row: {
          created_at: string
          email: string
          id: string
          interested_in_gifts: boolean
          kind: Database["public"]["Enums"]["waitlist_kind"]
          name: string | null
          source: string | null
          wedding_date: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          interested_in_gifts?: boolean
          kind?: Database["public"]["Enums"]["waitlist_kind"]
          name?: string | null
          source?: string | null
          wedding_date?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          interested_in_gifts?: boolean
          kind?: Database["public"]["Enums"]["waitlist_kind"]
          name?: string | null
          source?: string | null
          wedding_date?: string | null
        }
        Relationships: []
      }
      wedding_agenda_items: {
        Row: {
          address: string | null
          created_at: string
          id: string
          notes: string | null
          place: string | null
          sort: number
          time_label: string | null
          title: string
          wedding_id: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          place?: string | null
          sort?: number
          time_label?: string | null
          title: string
          wedding_id: string
        }
        Update: {
          address?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          place?: string | null
          sort?: number
          time_label?: string | null
          title?: string
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wedding_agenda_items_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: false
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
        ]
      }
      wedding_budget_items: {
        Row: {
          agreed_cents: number | null
          budgeted_cents: number | null
          category: string
          created_at: string
          id: string
          label: string
          notes: string | null
          position: number
          updated_at: string
          vendor_contact_id: string | null
          wedding_id: string
        }
        Insert: {
          agreed_cents?: number | null
          budgeted_cents?: number | null
          category?: string
          created_at?: string
          id?: string
          label: string
          notes?: string | null
          position?: number
          updated_at?: string
          vendor_contact_id?: string | null
          wedding_id: string
        }
        Update: {
          agreed_cents?: number | null
          budgeted_cents?: number | null
          category?: string
          created_at?: string
          id?: string
          label?: string
          notes?: string | null
          position?: number
          updated_at?: string
          vendor_contact_id?: string | null
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wedding_budget_items_vendor_fkey"
            columns: ["vendor_contact_id", "wedding_id"]
            isOneToOne: false
            referencedRelation: "wedding_vendor_contacts"
            referencedColumns: ["id", "wedding_id"]
          },
          {
            foreignKeyName: "wedding_budget_items_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: false
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
        ]
      }
      wedding_budget_payments: {
        Row: {
          amount_cents: number
          created_at: string
          due_on: string | null
          id: string
          item_id: string
          note: string | null
          paid_on: string | null
          updated_at: string
          wedding_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          due_on?: string | null
          id?: string
          item_id: string
          note?: string | null
          paid_on?: string | null
          updated_at?: string
          wedding_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          due_on?: string | null
          id?: string
          item_id?: string
          note?: string | null
          paid_on?: string | null
          updated_at?: string
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wedding_budget_payments_item_fkey"
            columns: ["item_id", "wedding_id"]
            isOneToOne: false
            referencedRelation: "wedding_budget_items"
            referencedColumns: ["id", "wedding_id"]
          },
          {
            foreignKeyName: "wedding_budget_payments_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: false
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
        ]
      }
      wedding_budgets: {
        Row: {
          created_at: string
          total_cents: number | null
          updated_at: string
          wedding_id: string
        }
        Insert: {
          created_at?: string
          total_cents?: number | null
          updated_at?: string
          wedding_id: string
        }
        Update: {
          created_at?: string
          total_cents?: number | null
          updated_at?: string
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wedding_budgets_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: true
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
        ]
      }
      wedding_gift_givers: {
        Row: {
          gift_id: string
          guest_id: string
          wedding_id: string
        }
        Insert: {
          gift_id: string
          guest_id: string
          wedding_id: string
        }
        Update: {
          gift_id?: string
          guest_id?: string
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wedding_gift_givers_gift_id_wedding_id_fkey"
            columns: ["gift_id", "wedding_id"]
            isOneToOne: false
            referencedRelation: "wedding_gifts"
            referencedColumns: ["id", "wedding_id"]
          },
          {
            foreignKeyName: "wedding_gift_givers_guest_id_wedding_id_fkey"
            columns: ["guest_id", "wedding_id"]
            isOneToOne: false
            referencedRelation: "wedding_guests"
            referencedColumns: ["id", "wedding_id"]
          },
        ]
      }
      wedding_gifts: {
        Row: {
          amount_cents: number | null
          created_at: string
          description: string | null
          id: string
          kind: string
          note: string | null
          received_on: string | null
          thanked_at: string | null
          updated_at: string
          wedding_id: string
        }
        Insert: {
          amount_cents?: number | null
          created_at?: string
          description?: string | null
          id?: string
          kind: string
          note?: string | null
          received_on?: string | null
          thanked_at?: string | null
          updated_at?: string
          wedding_id: string
        }
        Update: {
          amount_cents?: number | null
          created_at?: string
          description?: string | null
          id?: string
          kind?: string
          note?: string | null
          received_on?: string | null
          thanked_at?: string | null
          updated_at?: string
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wedding_gifts_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: false
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
        ]
      }
      wedding_guest_apart: {
        Row: {
          created_at: string
          guest_a: string
          guest_b: string
          wedding_id: string
        }
        Insert: {
          created_at?: string
          guest_a: string
          guest_b: string
          wedding_id: string
        }
        Update: {
          created_at?: string
          guest_a?: string
          guest_b?: string
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wedding_guest_apart_a_fkey"
            columns: ["guest_a", "wedding_id"]
            isOneToOne: false
            referencedRelation: "wedding_guests"
            referencedColumns: ["id", "wedding_id"]
          },
          {
            foreignKeyName: "wedding_guest_apart_b_fkey"
            columns: ["guest_b", "wedding_id"]
            isOneToOne: false
            referencedRelation: "wedding_guests"
            referencedColumns: ["id", "wedding_id"]
          },
          {
            foreignKeyName: "wedding_guest_apart_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: false
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
        ]
      }
      wedding_guest_companions: {
        Row: {
          by_guest: boolean
          created_at: string
          guest_id: string
          id: string
          is_kid: boolean
          name: string
          notes: string | null
          position: number
          table_id: string | null
          updated_at: string
          wedding_id: string
        }
        Insert: {
          by_guest?: boolean
          created_at?: string
          guest_id: string
          id?: string
          is_kid?: boolean
          name: string
          notes?: string | null
          position?: number
          table_id?: string | null
          updated_at?: string
          wedding_id: string
        }
        Update: {
          by_guest?: boolean
          created_at?: string
          guest_id?: string
          id?: string
          is_kid?: boolean
          name?: string
          notes?: string | null
          position?: number
          table_id?: string | null
          updated_at?: string
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wedding_guest_companions_guest_fkey"
            columns: ["guest_id", "wedding_id"]
            isOneToOne: false
            referencedRelation: "wedding_guests"
            referencedColumns: ["id", "wedding_id"]
          },
          {
            foreignKeyName: "wedding_guest_companions_table_fkey"
            columns: ["table_id", "wedding_id"]
            isOneToOne: false
            referencedRelation: "wedding_tables"
            referencedColumns: ["id", "wedding_id"]
          },
          {
            foreignKeyName: "wedding_guest_companions_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: false
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
        ]
      }
      wedding_guest_imports: {
        Row: {
          created_at: string
          guests: number
          id: string
          people: number
          wedding_id: string
        }
        Insert: {
          created_at?: string
          guests: number
          id: string
          people: number
          wedding_id: string
        }
        Update: {
          created_at?: string
          guests?: number
          id?: string
          people?: number
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wedding_guest_imports_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: false
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
        ]
      }
      wedding_guest_tokens: {
        Row: {
          created_at: string
          guest_id: string
          id: string
          revoked_at: string | null
          token_hash: string
          wedding_id: string
        }
        Insert: {
          created_at?: string
          guest_id: string
          id?: string
          revoked_at?: string | null
          token_hash: string
          wedding_id: string
        }
        Update: {
          created_at?: string
          guest_id?: string
          id?: string
          revoked_at?: string | null
          token_hash?: string
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wedding_guest_tokens_guest_id_wedding_id_fkey"
            columns: ["guest_id", "wedding_id"]
            isOneToOne: false
            referencedRelation: "wedding_guests"
            referencedColumns: ["id", "wedding_id"]
          },
        ]
      }
      wedding_guests: {
        Row: {
          amount_cents: number | null
          created_at: string
          extra_fields: Json
          gift_none: boolean
          gift_status: Database["public"]["Enums"]["guest_gift_status"]
          group_name: string | null
          health_consent_at: string | null
          health_consent_version: string | null
          id: string
          invitation_opened_at: string | null
          invitation_prepared_at: string | null
          invitation_sent_at: string | null
          invitation_token_hash: string | null
          last_reminder_at: string | null
          max_companions: number | null
          name: string
          notes: string | null
          phone: string | null
          reminder_count: number
          reminders_opt_out: boolean
          responded_at: string | null
          rsvp_answers: Json | null
          rsvp_companions: number
          rsvp_key_hash: string | null
          rsvp_logistic_notes: string | null
          rsvp_notes: string | null
          rsvp_notes_by_guest: boolean
          rsvp_status: string
          side: string | null
          source: string
          table_id: string | null
          tags: string[]
          updated_at: string
          wedding_id: string
        }
        Insert: {
          amount_cents?: number | null
          created_at?: string
          extra_fields?: Json
          gift_none?: boolean
          gift_status?: Database["public"]["Enums"]["guest_gift_status"]
          group_name?: string | null
          health_consent_at?: string | null
          health_consent_version?: string | null
          id?: string
          invitation_opened_at?: string | null
          invitation_prepared_at?: string | null
          invitation_sent_at?: string | null
          invitation_token_hash?: string | null
          last_reminder_at?: string | null
          max_companions?: number | null
          name: string
          notes?: string | null
          phone?: string | null
          reminder_count?: number
          reminders_opt_out?: boolean
          responded_at?: string | null
          rsvp_answers?: Json | null
          rsvp_companions?: number
          rsvp_key_hash?: string | null
          rsvp_logistic_notes?: string | null
          rsvp_notes?: string | null
          rsvp_notes_by_guest?: boolean
          rsvp_status?: string
          side?: string | null
          source?: string
          table_id?: string | null
          tags?: string[]
          updated_at?: string
          wedding_id: string
        }
        Update: {
          amount_cents?: number | null
          created_at?: string
          extra_fields?: Json
          gift_none?: boolean
          gift_status?: Database["public"]["Enums"]["guest_gift_status"]
          group_name?: string | null
          health_consent_at?: string | null
          health_consent_version?: string | null
          id?: string
          invitation_opened_at?: string | null
          invitation_prepared_at?: string | null
          invitation_sent_at?: string | null
          invitation_token_hash?: string | null
          last_reminder_at?: string | null
          max_companions?: number | null
          name?: string
          notes?: string | null
          phone?: string | null
          reminder_count?: number
          reminders_opt_out?: boolean
          responded_at?: string | null
          rsvp_answers?: Json | null
          rsvp_companions?: number
          rsvp_key_hash?: string | null
          rsvp_logistic_notes?: string | null
          rsvp_notes?: string | null
          rsvp_notes_by_guest?: boolean
          rsvp_status?: string
          side?: string | null
          source?: string
          table_id?: string | null
          tags?: string[]
          updated_at?: string
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wedding_guests_table_fkey"
            columns: ["table_id", "wedding_id"]
            isOneToOne: false
            referencedRelation: "wedding_tables"
            referencedColumns: ["id", "wedding_id"]
          },
          {
            foreignKeyName: "wedding_guests_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: false
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
        ]
      }
      wedding_member_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          created_by: string | null
          email: string
          expires_at: string
          id: string
          sent_at: string
          token_hash: string
          wedding_id: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          created_by?: string | null
          email: string
          expires_at: string
          id?: string
          sent_at?: string
          token_hash: string
          wedding_id: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          created_by?: string | null
          email?: string
          expires_at?: string
          id?: string
          sent_at?: string
          token_hash?: string
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wedding_member_invites_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wedding_member_invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wedding_member_invites_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: false
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
        ]
      }
      wedding_members: {
        Row: {
          created_at: string
          digest_opt_out: boolean
          role: string
          user_id: string
          wedding_id: string
        }
        Insert: {
          created_at?: string
          digest_opt_out?: boolean
          role: string
          user_id: string
          wedding_id: string
        }
        Update: {
          created_at?: string
          digest_opt_out?: boolean
          role?: string
          user_id?: string
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wedding_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wedding_members_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: false
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
        ]
      }
      wedding_message_templates: {
        Row: {
          body: string
          kind: string
          updated_at: string
          wedding_id: string
        }
        Insert: {
          body: string
          kind: string
          updated_at?: string
          wedding_id: string
        }
        Update: {
          body?: string
          kind?: string
          updated_at?: string
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wedding_message_templates_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: false
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
        ]
      }
      wedding_retention: {
        Row: {
          anonymised_at: string | null
          notice_sent_at: string | null
          wedding_id: string
        }
        Insert: {
          anonymised_at?: string | null
          notice_sent_at?: string | null
          wedding_id: string
        }
        Update: {
          anonymised_at?: string | null
          notice_sent_at?: string | null
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wedding_retention_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: true
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
        ]
      }
      wedding_site_drafts_history: {
        Row: {
          author_id: string | null
          changes: Json
          created_at: string
          document: Json
          draft_version: number
          id: string
          kind: string
          prompt: string
          summary: string
          wedding_id: string
        }
        Insert: {
          author_id?: string | null
          changes?: Json
          created_at?: string
          document: Json
          draft_version: number
          id?: string
          kind: string
          prompt?: string
          summary?: string
          wedding_id: string
        }
        Update: {
          author_id?: string | null
          changes?: Json
          created_at?: string
          document?: Json
          draft_version?: number
          id?: string
          kind?: string
          prompt?: string
          summary?: string
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wedding_site_drafts_history_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: false
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
        ]
      }
      wedding_site_revisions: {
        Row: {
          created_at: string
          document: Json
          id: string
          number: number
          published_by: string | null
          schema_version: number
          site_id: string
          wedding_id: string
        }
        Insert: {
          created_at?: string
          document: Json
          id?: string
          number: number
          published_by?: string | null
          schema_version: number
          site_id: string
          wedding_id: string
        }
        Update: {
          created_at?: string
          document?: Json
          id?: string
          number?: number
          published_by?: string | null
          schema_version?: number
          site_id?: string
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wedding_site_revisions_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "wedding_sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wedding_site_revisions_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: false
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
        ]
      }
      wedding_sites: {
        Row: {
          created_at: string
          draft_document: Json
          draft_version: number
          id: string
          published_at: string | null
          published_revision_id: string | null
          unpublished_at: string | null
          updated_at: string
          wedding_id: string
        }
        Insert: {
          created_at?: string
          draft_document: Json
          draft_version?: number
          id?: string
          published_at?: string | null
          published_revision_id?: string | null
          unpublished_at?: string | null
          updated_at?: string
          wedding_id: string
        }
        Update: {
          created_at?: string
          draft_document?: Json
          draft_version?: number
          id?: string
          published_at?: string | null
          published_revision_id?: string | null
          unpublished_at?: string | null
          updated_at?: string
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wedding_sites_published_revision_fkey"
            columns: ["published_revision_id", "wedding_id"]
            isOneToOne: false
            referencedRelation: "wedding_site_revisions"
            referencedColumns: ["id", "wedding_id"]
          },
          {
            foreignKeyName: "wedding_sites_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: true
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
        ]
      }
      wedding_tables: {
        Row: {
          created_at: string
          id: string
          name: string
          pinned_group: string | null
          pos_x: number | null
          pos_y: number | null
          position: number
          seats: number
          shape: string | null
          wedding_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          pinned_group?: string | null
          pos_x?: number | null
          pos_y?: number | null
          position?: number
          seats?: number
          shape?: string | null
          wedding_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          pinned_group?: string | null
          pos_x?: number | null
          pos_y?: number | null
          position?: number
          seats?: number
          shape?: string | null
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wedding_tables_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: false
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
        ]
      }
      wedding_tasks: {
        Row: {
          category: string | null
          created_at: string
          done: boolean
          done_at: string | null
          due_on: string | null
          id: string
          notes: string | null
          position: number
          template_key: string | null
          title: string
          updated_at: string
          wedding_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          done?: boolean
          done_at?: string | null
          due_on?: string | null
          id?: string
          notes?: string | null
          position?: number
          template_key?: string | null
          title: string
          updated_at?: string
          wedding_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          done?: boolean
          done_at?: string | null
          due_on?: string | null
          id?: string
          notes?: string | null
          position?: number
          template_key?: string | null
          title?: string
          updated_at?: string
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wedding_tasks_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: false
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
        ]
      }
      wedding_vendor_contacts: {
        Row: {
          category: string
          contact_name: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          payment_note: string | null
          phone: string | null
          status: string
          updated_at: string
          wedding_id: string
        }
        Insert: {
          category?: string
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          payment_note?: string | null
          phone?: string | null
          status?: string
          updated_at?: string
          wedding_id: string
        }
        Update: {
          category?: string
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          payment_note?: string | null
          phone?: string | null
          status?: string
          updated_at?: string
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wedding_vendor_contacts_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: false
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
        ]
      }
      weddings: {
        Row: {
          bizum_phone: string | null
          couple_id: string
          cover_image_url: string | null
          created_at: string
          cubierto_price_cents: number
          deleted_at: string | null
          guest_count_est: number | null
          id: string
          notify_contribution: string
          page_config: Json
          partner_name_1: string
          partner_name_2: string
          plan: Database["public"]["Enums"]["wedding_plan"]
          planner_id: string | null
          rsvp_deadline: string | null
          slug: string
          stripe_account_id: string | null
          stripe_onboarded: boolean
          wedding_date: string | null
        }
        Insert: {
          bizum_phone?: string | null
          couple_id: string
          cover_image_url?: string | null
          created_at?: string
          cubierto_price_cents?: number
          deleted_at?: string | null
          guest_count_est?: number | null
          id?: string
          notify_contribution?: string
          page_config?: Json
          partner_name_1: string
          partner_name_2: string
          plan?: Database["public"]["Enums"]["wedding_plan"]
          planner_id?: string | null
          rsvp_deadline?: string | null
          slug: string
          stripe_account_id?: string | null
          stripe_onboarded?: boolean
          wedding_date?: string | null
        }
        Update: {
          bizum_phone?: string | null
          couple_id?: string
          cover_image_url?: string | null
          created_at?: string
          cubierto_price_cents?: number
          deleted_at?: string | null
          guest_count_est?: number | null
          id?: string
          notify_contribution?: string
          page_config?: Json
          partner_name_1?: string
          partner_name_2?: string
          plan?: Database["public"]["Enums"]["wedding_plan"]
          planner_id?: string | null
          rsvp_deadline?: string | null
          slug?: string
          stripe_account_id?: string | null
          stripe_onboarded?: boolean
          wedding_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "weddings_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weddings_planner_id_fkey"
            columns: ["planner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      wedding_agenda_public: {
        Row: {
          address: string | null
          id: string | null
          notes: string | null
          place: string | null
          slug: string | null
          sort: number | null
          time_label: string | null
          title: string | null
        }
        Relationships: []
      }
      wedding_sites_public: {
        Row: {
          document: Json | null
          is_published: boolean | null
          plan: Database["public"]["Enums"]["wedding_plan"] | null
          published_at: string | null
          revision_id: string | null
          schema_version: number | null
          slug: string | null
          unpublished_at: string | null
        }
        Relationships: []
      }
      weddings_public: {
        Row: {
          bizum_phone: string | null
          cover_image_url: string | null
          cubierto_price_cents: number | null
          page_config: Json | null
          partner_name_1: string | null
          partner_name_2: string | null
          plan: Database["public"]["Enums"]["wedding_plan"] | null
          rsvp_deadline: string | null
          slug: string | null
          stripe_onboarded: boolean | null
          wedding_date: string | null
        }
        Insert: {
          bizum_phone?: string | null
          cover_image_url?: string | null
          cubierto_price_cents?: number | null
          page_config?: Json | null
          partner_name_1?: string | null
          partner_name_2?: string | null
          plan?: Database["public"]["Enums"]["wedding_plan"] | null
          rsvp_deadline?: string | null
          slug?: string | null
          stripe_onboarded?: boolean | null
          wedding_date?: string | null
        }
        Update: {
          bizum_phone?: string | null
          cover_image_url?: string | null
          cubierto_price_cents?: number | null
          page_config?: Json | null
          partner_name_1?: string | null
          partner_name_2?: string | null
          plan?: Database["public"]["Enums"]["wedding_plan"] | null
          rsvp_deadline?: string | null
          slug?: string | null
          stripe_onboarded?: boolean | null
          wedding_date?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_wedding_invite: { Args: { p_token: string }; Returns: string }
      anonymise_expired_guests: {
        Args: { p_limit?: number; p_today: string }
        Returns: number
      }
      apply_seating: {
        Args: {
          p_assignments?: Json
          p_new_tables?: Json
          p_wedding_id: string
        }
        Returns: Json
      }
      attendance_summary: {
        Args: { p_wedding_id: string }
        Returns: {
          attendees: number
          companions: number
          confirmed: number
          declined: number
          pending: number
          prepared: number
          sent: number
          total: number
        }[]
      }
      builder_draft_stash_put: {
        Args: {
          p_draft: Json
          p_email: string
          p_expires_at: string
          p_updated_at: string
        }
        Returns: boolean
      }
      cleanup_rate_limit_hits: {
        Args: { p_batch_size?: number }
        Returns: number
      }
      confirm_guest_reminder: {
        Args: { p_guest_id: string }
        Returns: {
          last_reminder_at: string
          reminder_count: number
        }[]
      }
      create_wedding_gift: {
        Args: {
          p_amount_cents: number
          p_description: string
          p_guest_ids: string[]
          p_kind: string
          p_note: string
          p_received_on: string
          p_wedding_id: string
        }
        Returns: string
      }
      crm_funnel_summary: {
        Args: { p_wedding_id: string }
        Returns: {
          added: number
          attendees: number
          no: number
          not_sent: number
          opened: number
          opened_unanswered: number
          prepared: number
          responded: number
          sent: number
          sent_unopened: number
          to_remind: number
          yes: number
        }[]
      }
      crm_gift_summary: {
        Args: { p_wedding_id: string }
        Returns: {
          by_kind: Json
          gift_count: number
          guests_no: number
          guests_unknown: number
          guests_yes: number
          total_cents: number
          unthanked: number
          with_amount: number
        }[]
      }
      guest_companion_list_valid: {
        Args: { p_list: Json; p_max: number }
        Returns: boolean
      }
      guest_extra_fields_valid: { Args: { p_fields: Json }; Returns: boolean }
      guest_filter_counts: {
        Args: { p_wedding_id: string }
        Returns: {
          abierta_sin_responder: number
          con_notas: number
          con_regalo: number
          enviada_sin_abrir: number
          esperando: number
          no_vienen: number
          para_recordar: number
          regalo_sin_indicar: number
          sin_agradecer: number
          sin_enviar: number
          sin_regalo: number
          sin_respuesta: number
          sin_telefono: number
          todos: number
          vienen: number
        }[]
      }
      guest_group_summary: {
        Args: { p_wedding_id: string }
        Returns: {
          attendees: number
          confirmed: number
          declined: number
          group_name: string
          guests: number
          pending: number
        }[]
      }
      guest_in_filter: {
        Args: {
          g: Database["public"]["Tables"]["wedding_guests"]["Row"]
          p_filter: string
        }
        Returns: boolean
      }
      guest_invitation_opened: {
        Args: { p_slug: string; p_token_hash: string; p_viewer_id?: string }
        Returns: string
      }
      guest_page: {
        Args: {
          p_filter: string
          p_group?: string
          p_limit: number
          p_offset: number
          p_search: string
          p_side?: string
          p_tag?: string
          p_wedding_id: string
        }
        Returns: {
          created_at: string
          gift_count: number
          gift_none: boolean
          gift_total_cents: number
          gift_unthanked: boolean
          group_name: string
          id: string
          invitation_opened_at: string
          invitation_prepared_at: string
          invitation_sent_at: string
          last_reminder_at: string
          name: string
          phone: string
          reminder_count: number
          reminders_opt_out: boolean
          rsvp_companions: number
          rsvp_notes: string
          rsvp_status: string
          side: string
          source: string
          tags: string[]
          total_count: number
        }[]
      }
      guest_rsvp_closes_at:
        | {
            Args: {
              p_rsvp_deadline: string
              p_token_created_at: string
              p_wedding_date: string
            }
            Returns: string
          }
        | {
            Args: { p_token_created_at: string; p_wedding_date: string }
            Returns: string
          }
      guest_rsvp_current: {
        Args: { p_slug: string; p_token_hash: string }
        Returns: Json
      }
      guest_rsvp_respond:
        | {
            Args: {
              p_answers: Json
              p_companion_list: Json
              p_companions: number
              p_health_consent_version: string
              p_health_notes: string
              p_logistic_notes: string
              p_slug: string
              p_status: string
              p_token_hash: string
            }
            Returns: string
          }
        | {
            Args: {
              p_answers: Json
              p_companion_list: Json
              p_companions: number
              p_health_consent_version: string
              p_health_notes: string
              p_keep_health_notes: boolean
              p_logistic_notes: string
              p_slug: string
              p_status: string
              p_token_hash: string
            }
            Returns: string
          }
        | {
            Args: {
              p_companions: number
              p_notes: string
              p_slug: string
              p_status: string
              p_token_hash: string
            }
            Returns: string
          }
        | {
            Args: {
              p_answers: Json
              p_companion_list?: Json
              p_companions: number
              p_notes: string
              p_slug: string
              p_status: string
              p_token_hash: string
            }
            Returns: string
          }
      guest_tag_summary: {
        Args: { p_wedding_id: string }
        Returns: {
          attendees: number
          confirmed: number
          guests: number
          tag: string
        }[]
      }
      guest_tags_clean: { Args: { p_tags: string[] }; Returns: string[] }
      guest_tags_valid: { Args: { p_tags: string[] }; Returns: boolean }
      import_wedding_guests: {
        Args: { p_import_id: string; p_rows: Json; p_wedding_id: string }
        Returns: Json
      }
      issue_guest_token: {
        Args: { p_guest_id: string; p_mode: string; p_token_hash: string }
        Returns: {
          token_id: string
        }[]
      }
      mark_retention_notice: {
        Args: { p_wedding_id: string }
        Returns: boolean
      }
      owns_wedding: { Args: { w_id: string }; Returns: boolean }
      pending_wedding_invite_for_me: { Args: never; Returns: boolean }
      purge_old_events: { Args: { p_batch_size?: number }; Returns: number }
      reminder_queue: {
        Args: {
          p_group?: string
          p_limit?: number
          p_tag?: string
          p_wedding_id: string
        }
        Returns: {
          delivered_by: string
          group_name: string
          id: string
          invitation_sent_at: string
          last_reminder_at: string
          name: string
          phone: string
          reminder_count: number
          tags: string[]
          total_count: number
        }[]
      }
      reminder_window_state: {
        Args: { p_rsvp_deadline: string; p_wedding_date: string }
        Returns: string
      }
      remove_wedding_partner: { Args: never; Returns: number }
      rename_guest_tag: {
        Args: { p_from: string; p_to: string; p_wedding_id: string }
        Returns: number
      }
      retention_notice_candidates: {
        Args: { p_limit?: number; p_today: string }
        Returns: {
          anonymise_on: string
          slug: string
          wedding_date: string
          wedding_id: string
        }[]
      }
      rl_check: {
        Args: { p_key: string; p_max: number; p_window_secs: number }
        Returns: boolean
      }
      save_floor_plan: {
        Args: { p_tables: Json; p_wedding_id: string }
        Returns: Json
      }
      set_guest_companions: {
        Args: { p_guest_id: string; p_list: Json; p_wedding_id: string }
        Returns: Json
      }
      set_guest_tags: {
        Args: {
          p_add?: string[]
          p_ids: string[]
          p_remove?: string[]
          p_wedding_id: string
        }
        Returns: number
      }
      site_document_has_private_media: {
        Args: { p_doc: Json }
        Returns: boolean
      }
      site_document_issue: { Args: { p_doc: Json }; Returns: string }
      site_document_publish_issue: { Args: { p_doc: Json }; Returns: string }
      update_wedding_gift: {
        Args: {
          p_amount_cents: number
          p_description: string
          p_gift_id: string
          p_guest_ids: string[]
          p_kind: string
          p_note: string
          p_received_on: string
        }
        Returns: boolean
      }
      wedding_gift_list: {
        Args: { p_wedding_id: string }
        Returns: {
          amount_cents: number
          created_at: string
          description: string
          givers: Json
          id: string
          kind: string
          note: string
          received_on: string
          thanked_at: string
        }[]
      }
      wedding_gift_list_for: {
        Args: { p_guest_ids: string[]; p_wedding_id: string }
        Returns: {
          amount_cents: number
          created_at: string
          description: string
          givers: Json
          id: string
          kind: string
          note: string
          received_on: string
          thanked_at: string
        }[]
      }
      wedding_mark_deleted: { Args: { p_wedding_id: string }; Returns: string }
      wedding_partners: {
        Args: never
        Returns: {
          created_at: string
          email: string
          is_me: boolean
          role: string
          user_id: string
        }[]
      }
      wedding_photo_wedding_id: {
        Args: { object_name: string }
        Returns: string
      }
      wedding_seating: { Args: { p_wedding_id: string }; Returns: Json }
      wedding_site_publish: {
        Args: {
          p_document: Json
          p_expected_version: number
          p_legacy?: Json
          p_wedding_id: string
        }
        Returns: {
          draft_version: number
          published_at: string
          revision_id: string
        }[]
      }
      wedding_site_unpublish: {
        Args: { p_wedding_id: string }
        Returns: undefined
      }
      wedding_vendor_summary: {
        Args: { p_wedding_id: string }
        Returns: {
          contactado: number
          contratado: number
          descartado: number
          en_conversacion: number
          por_contactar: number
          total: number
        }[]
      }
      whatsapp_number: { Args: { p_phone: string }; Returns: string }
    }
    Enums: {
      contribution_method: "card" | "bizum_manual"
      contribution_status: "pending" | "confirmed" | "failed"
      guest_gift_status:
        "pendiente" | "enlace" | "bizum" | "efectivo" | "transferencia"
      profile_role: "couple" | "planner"
      tranche_status: "pending" | "paid"
      vendor_status: "invited" | "active"
      waitlist_kind: "pareja" | "planner" | "proveedor" | "otro"
      wedding_plan: "free" | "premium"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      contribution_method: ["card", "bizum_manual"],
      contribution_status: ["pending", "confirmed", "failed"],
      guest_gift_status: [
        "pendiente",
        "enlace",
        "bizum",
        "efectivo",
        "transferencia",
      ],
      profile_role: ["couple", "planner"],
      tranche_status: ["pending", "paid"],
      vendor_status: ["invited", "active"],
      waitlist_kind: ["pareja", "planner", "proveedor", "otro"],
      wedding_plan: ["free", "premium"],
    },
  },
} as const

