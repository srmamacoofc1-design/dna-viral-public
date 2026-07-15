export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      audit_trail: {
        Row: {
          change_type: string
          changed_by: string
          created_at: string
          field_name: string | null
          id: string
          new_value: string | null
          previous_value: string | null
          record_id: string
          table_name: string
        }
        Insert: {
          change_type: string
          changed_by?: string
          created_at?: string
          field_name?: string | null
          id?: string
          new_value?: string | null
          previous_value?: string | null
          record_id: string
          table_name: string
        }
        Update: {
          change_type?: string
          changed_by?: string
          created_at?: string
          field_name?: string | null
          id?: string
          new_value?: string | null
          previous_value?: string | null
          record_id?: string
          table_name?: string
        }
        Relationships: []
      }
      block_phrase_patterns: {
        Row: {
          block_id: string
          block_type: string
          created_at: string
          id: string
          is_emotional: boolean
          is_repeated: boolean
          is_strong: boolean
          phrase: string
          phrase_category: string | null
          phrase_length: number | null
          phrase_position: number | null
          phrase_strength_score: number | null
          phrase_type: string | null
          video_id: string
          weighted_score: number | null
        }
        Insert: {
          block_id: string
          block_type: string
          created_at?: string
          id?: string
          is_emotional?: boolean
          is_repeated?: boolean
          is_strong?: boolean
          phrase: string
          phrase_category?: string | null
          phrase_length?: number | null
          phrase_position?: number | null
          phrase_strength_score?: number | null
          phrase_type?: string | null
          video_id: string
          weighted_score?: number | null
        }
        Update: {
          block_id?: string
          block_type?: string
          created_at?: string
          id?: string
          is_emotional?: boolean
          is_repeated?: boolean
          is_strong?: boolean
          phrase?: string
          phrase_category?: string | null
          phrase_length?: number | null
          phrase_position?: number | null
          phrase_strength_score?: number | null
          phrase_type?: string | null
          video_id?: string
          weighted_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "block_phrase_patterns_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "video_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "block_phrase_patterns_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      block_semantic_patterns: {
        Row: {
          block_emotional_intensity: number | null
          block_emotional_type: string | null
          block_emotional_words: Json | null
          block_id: string
          block_keywords: Json | null
          block_repeated_words: Json | null
          block_strong_phrases: Json | null
          block_text: string | null
          block_type: string
          block_verbal_tone: string | null
          created_at: string
          dominant_words: Json | null
          id: string
          rare_words: Json | null
          updated_at: string
          video_id: string
          weighted_phrase_score: number | null
          weighted_word_score: number | null
        }
        Insert: {
          block_emotional_intensity?: number | null
          block_emotional_type?: string | null
          block_emotional_words?: Json | null
          block_id: string
          block_keywords?: Json | null
          block_repeated_words?: Json | null
          block_strong_phrases?: Json | null
          block_text?: string | null
          block_type: string
          block_verbal_tone?: string | null
          created_at?: string
          dominant_words?: Json | null
          id?: string
          rare_words?: Json | null
          updated_at?: string
          video_id: string
          weighted_phrase_score?: number | null
          weighted_word_score?: number | null
        }
        Update: {
          block_emotional_intensity?: number | null
          block_emotional_type?: string | null
          block_emotional_words?: Json | null
          block_id?: string
          block_keywords?: Json | null
          block_repeated_words?: Json | null
          block_strong_phrases?: Json | null
          block_text?: string | null
          block_type?: string
          block_verbal_tone?: string | null
          created_at?: string
          dominant_words?: Json | null
          id?: string
          rare_words?: Json | null
          updated_at?: string
          video_id?: string
          weighted_phrase_score?: number | null
          weighted_word_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "block_semantic_patterns_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: true
            referencedRelation: "video_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "block_semantic_patterns_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      block_verbal_analysis: {
        Row: {
          block_id: string
          confidence_score: number | null
          created_at: string
          data_source_type: string
          emotional_intensity: number | null
          full_text: string | null
          id: string
          linguistic_density: number | null
          origin_level: string
          phrase_count: number | null
          phrase_pattern: string | null
          semantic_pressure_score: number | null
          syntactic_complexity: number | null
          tone: string | null
          trigger_words: Json | null
          updated_at: string
          video_id: string
          word_count: number | null
        }
        Insert: {
          block_id: string
          confidence_score?: number | null
          created_at?: string
          data_source_type?: string
          emotional_intensity?: number | null
          full_text?: string | null
          id?: string
          linguistic_density?: number | null
          origin_level?: string
          phrase_count?: number | null
          phrase_pattern?: string | null
          semantic_pressure_score?: number | null
          syntactic_complexity?: number | null
          tone?: string | null
          trigger_words?: Json | null
          updated_at?: string
          video_id: string
          word_count?: number | null
        }
        Update: {
          block_id?: string
          confidence_score?: number | null
          created_at?: string
          data_source_type?: string
          emotional_intensity?: number | null
          full_text?: string | null
          id?: string
          linguistic_density?: number | null
          origin_level?: string
          phrase_count?: number | null
          phrase_pattern?: string | null
          semantic_pressure_score?: number | null
          syntactic_complexity?: number | null
          tone?: string | null
          trigger_words?: Json | null
          updated_at?: string
          video_id?: string
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "block_verbal_analysis_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "video_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "block_verbal_analysis_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      block_word_patterns: {
        Row: {
          block_id: string
          block_type: string
          created_at: string
          id: string
          is_dominant: boolean
          is_emotional: boolean
          is_impact: boolean
          is_rare: boolean
          timestamp_end: number | null
          timestamp_start: number | null
          video_id: string
          weighted_score: number | null
          word: string
          word_frequency: number
        }
        Insert: {
          block_id: string
          block_type: string
          created_at?: string
          id?: string
          is_dominant?: boolean
          is_emotional?: boolean
          is_impact?: boolean
          is_rare?: boolean
          timestamp_end?: number | null
          timestamp_start?: number | null
          video_id: string
          weighted_score?: number | null
          word: string
          word_frequency?: number
        }
        Update: {
          block_id?: string
          block_type?: string
          created_at?: string
          id?: string
          is_dominant?: boolean
          is_emotional?: boolean
          is_impact?: boolean
          is_rare?: boolean
          timestamp_end?: number | null
          timestamp_start?: number | null
          video_id?: string
          weighted_score?: number | null
          word?: string
          word_frequency?: number
        }
        Relationships: [
          {
            foreignKeyName: "block_word_patterns_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "video_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "block_word_patterns_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      blueprint_contexts: {
        Row: {
          block_count_expected: number | null
          block_sequence: Json
          blueprint_name: string
          blueprint_rules: Json | null
          created_at: string
          cta_expected_position_seconds: number | null
          cta_position_tolerance_seconds: number | null
          dominant_cta_type: string | null
          dominant_emotion: string | null
          hook_expected_position_pct: number | null
          hook_position_tolerance_pct: number | null
          id: string
          payoff_expected_position_pct: number | null
          payoff_position_tolerance_pct: number | null
          source_template_context_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          block_count_expected?: number | null
          block_sequence?: Json
          blueprint_name?: string
          blueprint_rules?: Json | null
          created_at?: string
          cta_expected_position_seconds?: number | null
          cta_position_tolerance_seconds?: number | null
          dominant_cta_type?: string | null
          dominant_emotion?: string | null
          hook_expected_position_pct?: number | null
          hook_position_tolerance_pct?: number | null
          id?: string
          payoff_expected_position_pct?: number | null
          payoff_position_tolerance_pct?: number | null
          source_template_context_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          block_count_expected?: number | null
          block_sequence?: Json
          blueprint_name?: string
          blueprint_rules?: Json | null
          created_at?: string
          cta_expected_position_seconds?: number | null
          cta_position_tolerance_seconds?: number | null
          dominant_cta_type?: string | null
          dominant_emotion?: string | null
          hook_expected_position_pct?: number | null
          hook_position_tolerance_pct?: number | null
          id?: string
          payoff_expected_position_pct?: number | null
          payoff_position_tolerance_pct?: number | null
          source_template_context_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blueprint_contexts_source_template_context_id_fkey"
            columns: ["source_template_context_id"]
            isOneToOne: false
            referencedRelation: "template_contexts"
            referencedColumns: ["id"]
          },
        ]
      }
      cohort_analysis_summary: {
        Row: {
          avg_alignment_score: number | null
          avg_engagement_rate: number | null
          avg_normalized_performance_score: number | null
          avg_performance: number | null
          cohort_id: string | null
          cohort_name: string
          confidence_score: number | null
          created_at: string
          data_source_type: string | null
          dominant_cta_pattern: string | null
          dominant_emotion: string | null
          dominant_emotional_arc: string | null
          dominant_patterns: Json | null
          dominant_structure: string | null
          dominant_verbal_pattern: string | null
          id: string
          origin_level: string | null
          summary_json: Json | null
          updated_at: string
          video_count: number | null
        }
        Insert: {
          avg_alignment_score?: number | null
          avg_engagement_rate?: number | null
          avg_normalized_performance_score?: number | null
          avg_performance?: number | null
          cohort_id?: string | null
          cohort_name: string
          confidence_score?: number | null
          created_at?: string
          data_source_type?: string | null
          dominant_cta_pattern?: string | null
          dominant_emotion?: string | null
          dominant_emotional_arc?: string | null
          dominant_patterns?: Json | null
          dominant_structure?: string | null
          dominant_verbal_pattern?: string | null
          id?: string
          origin_level?: string | null
          summary_json?: Json | null
          updated_at?: string
          video_count?: number | null
        }
        Update: {
          avg_alignment_score?: number | null
          avg_engagement_rate?: number | null
          avg_normalized_performance_score?: number | null
          avg_performance?: number | null
          cohort_id?: string | null
          cohort_name?: string
          confidence_score?: number | null
          created_at?: string
          data_source_type?: string | null
          dominant_cta_pattern?: string | null
          dominant_emotion?: string | null
          dominant_emotional_arc?: string | null
          dominant_patterns?: Json | null
          dominant_structure?: string | null
          dominant_verbal_pattern?: string | null
          id?: string
          origin_level?: string | null
          summary_json?: Json | null
          updated_at?: string
          video_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cohort_analysis_summary_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "dataset_cohort"
            referencedColumns: ["id"]
          },
        ]
      }
      cta_deep_analysis: {
        Row: {
          confidence_score: number | null
          created_at: string
          cta_intensity: number | null
          cta_position: string | null
          cta_target: string | null
          cta_text: string | null
          cta_tone: string | null
          cta_type: string | null
          data_source_type: string
          id: string
          implicit_cta_detected: boolean | null
          origin_level: string
          updated_at: string
          video_id: string
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string
          cta_intensity?: number | null
          cta_position?: string | null
          cta_target?: string | null
          cta_text?: string | null
          cta_tone?: string | null
          cta_type?: string | null
          data_source_type?: string
          id?: string
          implicit_cta_detected?: boolean | null
          origin_level?: string
          updated_at?: string
          video_id: string
        }
        Update: {
          confidence_score?: number | null
          created_at?: string
          cta_intensity?: number | null
          cta_position?: string | null
          cta_target?: string | null
          cta_text?: string | null
          cta_tone?: string | null
          cta_type?: string | null
          data_source_type?: string
          id?: string
          implicit_cta_detected?: boolean | null
          origin_level?: string
          updated_at?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cta_deep_analysis_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      cta_profiles: {
        Row: {
          created_at: string
          cta_action: string | null
          cta_emotion: string | null
          cta_intensity: number | null
          cta_position_seconds: number | null
          cta_text: string | null
          cta_type: string | null
          id: string
          updated_at: string
          video_id: string
        }
        Insert: {
          created_at?: string
          cta_action?: string | null
          cta_emotion?: string | null
          cta_intensity?: number | null
          cta_position_seconds?: number | null
          cta_text?: string | null
          cta_type?: string | null
          id?: string
          updated_at?: string
          video_id: string
        }
        Update: {
          created_at?: string
          cta_action?: string | null
          cta_emotion?: string | null
          cta_intensity?: number | null
          cta_position_seconds?: number | null
          cta_text?: string | null
          cta_type?: string | null
          id?: string
          updated_at?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cta_profiles_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: true
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      data_consistency_reports: {
        Row: {
          created_at: string
          current_value: string | null
          expected_rule: string
          field_name: string | null
          id: string
          issue_type: string
          severity: string
          validation_step: string
          video_id: string
        }
        Insert: {
          created_at?: string
          current_value?: string | null
          expected_rule: string
          field_name?: string | null
          id?: string
          issue_type: string
          severity?: string
          validation_step: string
          video_id: string
        }
        Update: {
          created_at?: string
          current_value?: string | null
          expected_rule?: string
          field_name?: string | null
          id?: string
          issue_type?: string
          severity?: string
          validation_step?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_consistency_reports_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      dataset_cohort: {
        Row: {
          active: boolean | null
          cohort_name: string
          cohort_type: string | null
          confidence_score: number | null
          created_at: string
          created_by: string | null
          data_source_type: string | null
          filter_duration_max: number | null
          filter_duration_min: number | null
          filter_score_max: number | null
          filter_score_min: number | null
          filter_segment: string | null
          filter_views_max: number | null
          filter_views_min: number | null
          id: string
          origin_level: string | null
          rules_json: Json | null
          updated_at: string
          video_count: number | null
          video_ids: Json | null
        }
        Insert: {
          active?: boolean | null
          cohort_name: string
          cohort_type?: string | null
          confidence_score?: number | null
          created_at?: string
          created_by?: string | null
          data_source_type?: string | null
          filter_duration_max?: number | null
          filter_duration_min?: number | null
          filter_score_max?: number | null
          filter_score_min?: number | null
          filter_segment?: string | null
          filter_views_max?: number | null
          filter_views_min?: number | null
          id?: string
          origin_level?: string | null
          rules_json?: Json | null
          updated_at?: string
          video_count?: number | null
          video_ids?: Json | null
        }
        Update: {
          active?: boolean | null
          cohort_name?: string
          cohort_type?: string | null
          confidence_score?: number | null
          created_at?: string
          created_by?: string | null
          data_source_type?: string | null
          filter_duration_max?: number | null
          filter_duration_min?: number | null
          filter_score_max?: number | null
          filter_score_min?: number | null
          filter_segment?: string | null
          filter_views_max?: number | null
          filter_views_min?: number | null
          id?: string
          origin_level?: string | null
          rules_json?: Json | null
          updated_at?: string
          video_count?: number | null
          video_ids?: Json | null
        }
        Relationships: []
      }
      dataset_cohort_videos: {
        Row: {
          cohort_id: string
          created_at: string
          id: string
          video_id: string
        }
        Insert: {
          cohort_id: string
          created_at?: string
          id?: string
          video_id: string
        }
        Update: {
          cohort_id?: string
          created_at?: string
          id?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dataset_cohort_videos_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "dataset_cohort"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dataset_cohort_videos_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      dna_base_v2: {
        Row: {
          avg_density: number | null
          created_at: string
          cta_distribution: Json | null
          dataset_type: string
          dominant_cta_pattern: string | null
          dominant_emotional_arc: string | null
          dominant_structure_sequence: string | null
          dominant_verbal_pattern: string | null
          formula_registry_snapshot: Json | null
          generated_at: string
          id: string
          segment_breakdown: Json | null
          total_blocks_used: number | null
          total_videos_used: number | null
          verbal_density: number | null
          version_name: string
        }
        Insert: {
          avg_density?: number | null
          created_at?: string
          cta_distribution?: Json | null
          dataset_type?: string
          dominant_cta_pattern?: string | null
          dominant_emotional_arc?: string | null
          dominant_structure_sequence?: string | null
          dominant_verbal_pattern?: string | null
          formula_registry_snapshot?: Json | null
          generated_at?: string
          id?: string
          segment_breakdown?: Json | null
          total_blocks_used?: number | null
          total_videos_used?: number | null
          verbal_density?: number | null
          version_name?: string
        }
        Update: {
          avg_density?: number | null
          created_at?: string
          cta_distribution?: Json | null
          dataset_type?: string
          dominant_cta_pattern?: string | null
          dominant_emotional_arc?: string | null
          dominant_structure_sequence?: string | null
          dominant_verbal_pattern?: string | null
          formula_registry_snapshot?: Json | null
          generated_at?: string
          id?: string
          segment_breakdown?: Json | null
          total_blocks_used?: number | null
          total_videos_used?: number | null
          verbal_density?: number | null
          version_name?: string
        }
        Relationships: []
      }
      dna_base_v2_formal: {
        Row: {
          consistency_check: Json | null
          created_at: string
          data_sources_used: Json | null
          emotional: Json
          formal_dna_json: Json
          generated_at: string
          id: string
          performance: Json
          source_dna_base_v2_id: string | null
          structural: Json
          temporal: Json
          total_blocks_used: number | null
          total_videos_used: number | null
          verbal: Json
          version_name: string
        }
        Insert: {
          consistency_check?: Json | null
          created_at?: string
          data_sources_used?: Json | null
          emotional?: Json
          formal_dna_json?: Json
          generated_at?: string
          id?: string
          performance?: Json
          source_dna_base_v2_id?: string | null
          structural?: Json
          temporal?: Json
          total_blocks_used?: number | null
          total_videos_used?: number | null
          verbal?: Json
          version_name?: string
        }
        Update: {
          consistency_check?: Json | null
          created_at?: string
          data_sources_used?: Json | null
          emotional?: Json
          formal_dna_json?: Json
          generated_at?: string
          id?: string
          performance?: Json
          source_dna_base_v2_id?: string | null
          structural?: Json
          temporal?: Json
          total_blocks_used?: number | null
          total_videos_used?: number | null
          verbal?: Json
          version_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "dna_base_v2_formal_source_dna_base_v2_id_fkey"
            columns: ["source_dna_base_v2_id"]
            isOneToOne: false
            referencedRelation: "dna_base_v2"
            referencedColumns: ["id"]
          },
        ]
      }
      dna_base_versions: {
        Row: {
          avg_density: number | null
          avg_hook_time: number | null
          avg_payoff_time: number | null
          avg_reveal_time: number | null
          avg_turn_count: number | null
          created_at: string
          dataset_type: string
          dominant_cta_type: string | null
          dominant_emotion_sequence: string | null
          dominant_hook_type: string | null
          dominant_structure_sequence: string | null
          formula_registry_snapshot: Json | null
          generated_at: string
          id: string
          segment_breakdown: Json | null
          total_blocks_used: number
          total_videos_used: number
          version_name: string
        }
        Insert: {
          avg_density?: number | null
          avg_hook_time?: number | null
          avg_payoff_time?: number | null
          avg_reveal_time?: number | null
          avg_turn_count?: number | null
          created_at?: string
          dataset_type?: string
          dominant_cta_type?: string | null
          dominant_emotion_sequence?: string | null
          dominant_hook_type?: string | null
          dominant_structure_sequence?: string | null
          formula_registry_snapshot?: Json | null
          generated_at?: string
          id?: string
          segment_breakdown?: Json | null
          total_blocks_used?: number
          total_videos_used?: number
          version_name?: string
        }
        Update: {
          avg_density?: number | null
          avg_hook_time?: number | null
          avg_payoff_time?: number | null
          avg_reveal_time?: number | null
          avg_turn_count?: number | null
          created_at?: string
          dataset_type?: string
          dominant_cta_type?: string | null
          dominant_emotion_sequence?: string | null
          dominant_hook_type?: string | null
          dominant_structure_sequence?: string | null
          formula_registry_snapshot?: Json | null
          generated_at?: string
          id?: string
          segment_breakdown?: Json | null
          total_blocks_used?: number
          total_videos_used?: number
          version_name?: string
        }
        Relationships: []
      }
      dna_objects: {
        Row: {
          avg_block_count: number | null
          avg_cta_time: number | null
          avg_engagement_rate: number | null
          avg_hook_time: number | null
          avg_payoff_time: number | null
          avg_video_duration: number | null
          created_at: string
          dominant_cta_type: string | null
          dominant_emotion: string | null
          dominant_sequence: string | null
          id: string
          notes: string | null
          optional_blocks: Json | null
          required_blocks: Json | null
          secondary_emotion: string | null
          source_scope: string
          status: string
          total_videos_used: number | null
          updated_at: string
        }
        Insert: {
          avg_block_count?: number | null
          avg_cta_time?: number | null
          avg_engagement_rate?: number | null
          avg_hook_time?: number | null
          avg_payoff_time?: number | null
          avg_video_duration?: number | null
          created_at?: string
          dominant_cta_type?: string | null
          dominant_emotion?: string | null
          dominant_sequence?: string | null
          id?: string
          notes?: string | null
          optional_blocks?: Json | null
          required_blocks?: Json | null
          secondary_emotion?: string | null
          source_scope?: string
          status?: string
          total_videos_used?: number | null
          updated_at?: string
        }
        Update: {
          avg_block_count?: number | null
          avg_cta_time?: number | null
          avg_engagement_rate?: number | null
          avg_hook_time?: number | null
          avg_payoff_time?: number | null
          avg_video_duration?: number | null
          created_at?: string
          dominant_cta_type?: string | null
          dominant_emotion?: string | null
          dominant_sequence?: string | null
          id?: string
          notes?: string | null
          optional_blocks?: Json | null
          required_blocks?: Json | null
          secondary_emotion?: string | null
          source_scope?: string
          status?: string
          total_videos_used?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      extraction_logs: {
        Row: {
          confidence_score: number
          created_at: string
          error_flag: boolean
          error_message: string | null
          extracted_value: string | null
          extraction_step: string
          field_name: string
          id: string
          origin_level: Database["public"]["Enums"]["data_origin_level"]
          source_type: Database["public"]["Enums"]["data_source_type"]
          video_id: string
        }
        Insert: {
          confidence_score?: number
          created_at?: string
          error_flag?: boolean
          error_message?: string | null
          extracted_value?: string | null
          extraction_step: string
          field_name: string
          id?: string
          origin_level?: Database["public"]["Enums"]["data_origin_level"]
          source_type: Database["public"]["Enums"]["data_source_type"]
          video_id: string
        }
        Update: {
          confidence_score?: number
          created_at?: string
          error_flag?: boolean
          error_message?: string | null
          extracted_value?: string | null
          extraction_step?: string
          field_name?: string
          id?: string
          origin_level?: Database["public"]["Enums"]["data_origin_level"]
          source_type?: Database["public"]["Enums"]["data_source_type"]
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "extraction_logs_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_contexts: {
        Row: {
          created_at: string
          generation_name: string
          generation_rules: Json | null
          id: string
          slot_count_expected: number | null
          slot_sequence: Json
          source_blueprint_id: string | null
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          generation_name?: string
          generation_rules?: Json | null
          id?: string
          slot_count_expected?: number | null
          slot_sequence?: Json
          source_blueprint_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          generation_name?: string
          generation_rules?: Json | null
          id?: string
          slot_count_expected?: number | null
          slot_sequence?: Json
          source_blueprint_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "generation_contexts_source_blueprint_id_fkey"
            columns: ["source_blueprint_id"]
            isOneToOne: false
            referencedRelation: "blueprint_contexts"
            referencedColumns: ["id"]
          },
        ]
      }
      narrative_judge_results: {
        Row: {
          batch_id: string | null
          block_id: string | null
          candidate_text: string
          confidence_score: number | null
          created_at: string
          emotional_intent: string | null
          id: string
          is_valid_narrative_unit: boolean
          model: string | null
          narrative_function: string | null
          processing_time_ms: number | null
          provider: string | null
          replicable_for_dna: boolean | null
          short_reason: string | null
          video_id: string
          viewer_directed: boolean | null
        }
        Insert: {
          batch_id?: string | null
          block_id?: string | null
          candidate_text: string
          confidence_score?: number | null
          created_at?: string
          emotional_intent?: string | null
          id?: string
          is_valid_narrative_unit?: boolean
          model?: string | null
          narrative_function?: string | null
          processing_time_ms?: number | null
          provider?: string | null
          replicable_for_dna?: boolean | null
          short_reason?: string | null
          video_id: string
          viewer_directed?: boolean | null
        }
        Update: {
          batch_id?: string | null
          block_id?: string | null
          candidate_text?: string
          confidence_score?: number | null
          created_at?: string
          emotional_intent?: string | null
          id?: string
          is_valid_narrative_unit?: boolean
          model?: string | null
          narrative_function?: string | null
          processing_time_ms?: number | null
          provider?: string | null
          replicable_for_dna?: boolean | null
          short_reason?: string | null
          video_id?: string
          viewer_directed?: boolean | null
        }
        Relationships: []
      }
      outlier_detection: {
        Row: {
          confidence_score: number | null
          created_at: string
          id: string
          outlier_flag: boolean | null
          outlier_reason: string | null
          outlier_type: string | null
          reference_mean: number | null
          reference_stddev: number | null
          video_id: string
          z_score: number | null
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string
          id?: string
          outlier_flag?: boolean | null
          outlier_reason?: string | null
          outlier_type?: string | null
          reference_mean?: number | null
          reference_stddev?: number | null
          video_id: string
          z_score?: number | null
        }
        Update: {
          confidence_score?: number | null
          created_at?: string
          id?: string
          outlier_flag?: boolean | null
          outlier_reason?: string | null
          outlier_type?: string | null
          reference_mean?: number | null
          reference_stddev?: number | null
          video_id?: string
          z_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "outlier_detection_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      pattern_performance_weights: {
        Row: {
          avg_comments_rate: number | null
          avg_engagement_score: number | null
          avg_likes_rate: number | null
          avg_views: number | null
          block_type: string | null
          created_at: string
          frequency: number
          id: string
          pattern_type: string
          pattern_value: string
          sample_size: number | null
          strength_score: number | null
          updated_at: string
        }
        Insert: {
          avg_comments_rate?: number | null
          avg_engagement_score?: number | null
          avg_likes_rate?: number | null
          avg_views?: number | null
          block_type?: string | null
          created_at?: string
          frequency?: number
          id?: string
          pattern_type: string
          pattern_value: string
          sample_size?: number | null
          strength_score?: number | null
          updated_at?: string
        }
        Update: {
          avg_comments_rate?: number | null
          avg_engagement_score?: number | null
          avg_likes_rate?: number | null
          avg_views?: number | null
          block_type?: string | null
          created_at?: string
          frequency?: number
          id?: string
          pattern_type?: string
          pattern_value?: string
          sample_size?: number | null
          strength_score?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      performance_correlation: {
        Row: {
          confidence_score: number | null
          correlation_with_engagement: number | null
          correlation_with_retention: number | null
          correlation_with_views: number | null
          created_at: string
          id: string
          pattern_name: string
          pattern_type: string
          sample_size: number | null
          updated_at: string
        }
        Insert: {
          confidence_score?: number | null
          correlation_with_engagement?: number | null
          correlation_with_retention?: number | null
          correlation_with_views?: number | null
          created_at?: string
          id?: string
          pattern_name: string
          pattern_type: string
          sample_size?: number | null
          updated_at?: string
        }
        Update: {
          confidence_score?: number | null
          correlation_with_engagement?: number | null
          correlation_with_retention?: number | null
          correlation_with_views?: number | null
          created_at?: string
          id?: string
          pattern_name?: string
          pattern_type?: string
          sample_size?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      processing_queue: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          priority: number | null
          started_at: string | null
          status: Database["public"]["Enums"]["processing_status"]
          updated_at: string
          video_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          priority?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["processing_status"]
          updated_at?: string
          video_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          priority?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["processing_status"]
          updated_at?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "processing_queue_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      promoted_scripts: {
        Row: {
          created_at: string
          id: string
          promoted_at: string
          promotion_trace: Json
          script_blocks: Json
          script_status: string
          script_text: string
          script_title: string
          source_blueprint_id: string | null
          source_generation_context_id: string | null
          source_script_assembly_id: string
          updated_at: string
          user_id: string | null
          validation_status: string | null
          validation_version: number
        }
        Insert: {
          created_at?: string
          id?: string
          promoted_at?: string
          promotion_trace?: Json
          script_blocks?: Json
          script_status?: string
          script_text?: string
          script_title?: string
          source_blueprint_id?: string | null
          source_generation_context_id?: string | null
          source_script_assembly_id: string
          updated_at?: string
          user_id?: string | null
          validation_status?: string | null
          validation_version?: number
        }
        Update: {
          created_at?: string
          id?: string
          promoted_at?: string
          promotion_trace?: Json
          script_blocks?: Json
          script_status?: string
          script_text?: string
          script_title?: string
          source_blueprint_id?: string | null
          source_generation_context_id?: string | null
          source_script_assembly_id?: string
          updated_at?: string
          user_id?: string | null
          validation_status?: string | null
          validation_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "promoted_scripts_source_blueprint_id_fkey"
            columns: ["source_blueprint_id"]
            isOneToOne: false
            referencedRelation: "blueprint_contexts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promoted_scripts_source_generation_context_id_fkey"
            columns: ["source_generation_context_id"]
            isOneToOne: false
            referencedRelation: "generation_contexts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promoted_scripts_source_script_assembly_id_fkey"
            columns: ["source_script_assembly_id"]
            isOneToOne: true
            referencedRelation: "script_assemblies"
            referencedColumns: ["id"]
          },
        ]
      }
      readiness_reports: {
        Row: {
          created_at: string
          generated_at: string
          id: string
          readiness_score: number
          report_json: Json
          total_blocks: number
          total_videos: number
          validation_status: string
        }
        Insert: {
          created_at?: string
          generated_at?: string
          id?: string
          readiness_score?: number
          report_json?: Json
          total_blocks?: number
          total_videos?: number
          validation_status?: string
        }
        Update: {
          created_at?: string
          generated_at?: string
          id?: string
          readiness_score?: number
          report_json?: Json
          total_blocks?: number
          total_videos?: number
          validation_status?: string
        }
        Relationships: []
      }
      reference_generation_runs: {
        Row: {
          actual_duration_seconds: number | null
          content_guardrails: Json
          created_at: string
          current_step: string | null
          duration_alignment_score: number | null
          error_message: string | null
          estimated_duration_seconds: number | null
          execution_mode: string
          finished_at: string | null
          foreign_entity_contamination_score: number | null
          generation_context_id: string | null
          id: string
          pipeline_status: string
          progress_pct: number
          promoted_script_id: string | null
          reference_video_id: string
          script_assembly_id: string | null
          semantic_alignment_score: number | null
          started_at: string | null
          updated_at: string
          user_id: string | null
          validation_status: string | null
          visual_sync_score: number | null
        }
        Insert: {
          actual_duration_seconds?: number | null
          content_guardrails?: Json
          created_at?: string
          current_step?: string | null
          duration_alignment_score?: number | null
          error_message?: string | null
          estimated_duration_seconds?: number | null
          execution_mode?: string
          finished_at?: string | null
          foreign_entity_contamination_score?: number | null
          generation_context_id?: string | null
          id?: string
          pipeline_status?: string
          progress_pct?: number
          promoted_script_id?: string | null
          reference_video_id: string
          script_assembly_id?: string | null
          semantic_alignment_score?: number | null
          started_at?: string | null
          updated_at?: string
          user_id?: string | null
          validation_status?: string | null
          visual_sync_score?: number | null
        }
        Update: {
          actual_duration_seconds?: number | null
          content_guardrails?: Json
          created_at?: string
          current_step?: string | null
          duration_alignment_score?: number | null
          error_message?: string | null
          estimated_duration_seconds?: number | null
          execution_mode?: string
          finished_at?: string | null
          foreign_entity_contamination_score?: number | null
          generation_context_id?: string | null
          id?: string
          pipeline_status?: string
          progress_pct?: number
          promoted_script_id?: string | null
          reference_video_id?: string
          script_assembly_id?: string | null
          semantic_alignment_score?: number | null
          started_at?: string | null
          updated_at?: string
          user_id?: string | null
          validation_status?: string | null
          visual_sync_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "reference_generation_runs_generation_context_id_fkey"
            columns: ["generation_context_id"]
            isOneToOne: false
            referencedRelation: "generation_contexts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_generation_runs_promoted_script_id_fkey"
            columns: ["promoted_script_id"]
            isOneToOne: false
            referencedRelation: "promoted_scripts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_generation_runs_reference_video_id_fkey"
            columns: ["reference_video_id"]
            isOneToOne: false
            referencedRelation: "reference_videos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_generation_runs_script_assembly_id_fkey"
            columns: ["script_assembly_id"]
            isOneToOne: false
            referencedRelation: "script_assemblies"
            referencedColumns: ["id"]
          },
        ]
      }
      reference_video_frames: {
        Row: {
          created_at: string
          description: string
          emotional_tone: string | null
          frame_order: number | null
          id: string
          reference_video_id: string
          scene_type: string | null
          timestamp_seconds: number
          updated_at: string
          visual_elements: Json
        }
        Insert: {
          created_at?: string
          description: string
          emotional_tone?: string | null
          frame_order?: number | null
          id?: string
          reference_video_id: string
          scene_type?: string | null
          timestamp_seconds: number
          updated_at?: string
          visual_elements?: Json
        }
        Update: {
          created_at?: string
          description?: string
          emotional_tone?: string | null
          frame_order?: number | null
          id?: string
          reference_video_id?: string
          scene_type?: string | null
          timestamp_seconds?: number
          updated_at?: string
          visual_elements?: Json
        }
        Relationships: [
          {
            foreignKeyName: "reference_video_frames_reference_video_id_fkey"
            columns: ["reference_video_id"]
            isOneToOne: false
            referencedRelation: "reference_videos"
            referencedColumns: ["id"]
          },
        ]
      }
      reference_video_topics: {
        Row: {
          central_topic: string | null
          created_at: string
          detected_language: string | null
          estimated_target_word_count: number | null
          forbidden_foreign_entities: string[]
          id: string
          key_topics: string[]
          narrative_progression: Json
          reference_video_id: string
          semantic_alignment_rules: Json
          semantic_summary: string | null
          topic_status: string
          updated_at: string
          visual_anchor_points: Json
        }
        Insert: {
          central_topic?: string | null
          created_at?: string
          detected_language?: string | null
          estimated_target_word_count?: number | null
          forbidden_foreign_entities?: string[]
          id?: string
          key_topics?: string[]
          narrative_progression?: Json
          reference_video_id: string
          semantic_alignment_rules?: Json
          semantic_summary?: string | null
          topic_status?: string
          updated_at?: string
          visual_anchor_points?: Json
        }
        Update: {
          central_topic?: string | null
          created_at?: string
          detected_language?: string | null
          estimated_target_word_count?: number | null
          forbidden_foreign_entities?: string[]
          id?: string
          key_topics?: string[]
          narrative_progression?: Json
          reference_video_id?: string
          semantic_alignment_rules?: Json
          semantic_summary?: string | null
          topic_status?: string
          updated_at?: string
          visual_anchor_points?: Json
        }
        Relationships: [
          {
            foreignKeyName: "reference_video_topics_reference_video_id_fkey"
            columns: ["reference_video_id"]
            isOneToOne: true
            referencedRelation: "reference_videos"
            referencedColumns: ["id"]
          },
        ]
      }
      reference_video_transcripts: {
        Row: {
          created_at: string
          detected_language: string | null
          id: string
          reference_video_id: string
          segment_count: number
          transcript_provider: string | null
          transcript_segments: Json
          transcript_status: string
          transcript_text: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          detected_language?: string | null
          id?: string
          reference_video_id: string
          segment_count?: number
          transcript_provider?: string | null
          transcript_segments?: Json
          transcript_status?: string
          transcript_text?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          detected_language?: string | null
          id?: string
          reference_video_id?: string
          segment_count?: number
          transcript_provider?: string | null
          transcript_segments?: Json
          transcript_status?: string
          transcript_text?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reference_video_transcripts_reference_video_id_fkey"
            columns: ["reference_video_id"]
            isOneToOne: true
            referencedRelation: "reference_videos"
            referencedColumns: ["id"]
          },
        ]
      }
      reference_videos: {
        Row: {
          created_at: string
          duration_seconds: number | null
          error_message: string | null
          file_name: string
          frames: Json | null
          id: string
          processing_scope: string
          source_idempotency_key: string | null
          source_scope: string
          source_url: string | null
          status: string
          storage_bucket: string
          storage_path: string | null
          transcription: string | null
          transcription_segments: Json | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          duration_seconds?: number | null
          error_message?: string | null
          file_name: string
          frames?: Json | null
          id?: string
          processing_scope?: string
          source_idempotency_key?: string | null
          source_scope?: string
          source_url?: string | null
          status?: string
          storage_bucket?: string
          storage_path?: string | null
          transcription?: string | null
          transcription_segments?: Json | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          duration_seconds?: number | null
          error_message?: string | null
          file_name?: string
          frames?: Json | null
          id?: string
          processing_scope?: string
          source_idempotency_key?: string | null
          source_scope?: string
          source_url?: string | null
          status?: string
          storage_bucket?: string
          storage_path?: string | null
          transcription?: string | null
          transcription_segments?: Json | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      reprocess_job_items: {
        Row: {
          attempts: number
          created_at: string
          current_step: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          job_id: string
          progress_pct: number
          started_at: string | null
          status: string
          video_id: string
          video_title: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          current_step?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          job_id: string
          progress_pct?: number
          started_at?: string | null
          status?: string
          video_id: string
          video_title?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          current_step?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          job_id?: string
          progress_pct?: number
          started_at?: string | null
          status?: string
          video_id?: string
          video_title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reprocess_job_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "reprocess_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      reprocess_jobs: {
        Row: {
          completed_videos: number
          created_at: string
          current_step: string | null
          current_video_id: string | null
          error_message: string | null
          failed_videos: number
          finished_at: string | null
          id: string
          skipped_videos: number
          started_at: string | null
          status: string
          total_videos: number
          updated_at: string
        }
        Insert: {
          completed_videos?: number
          created_at?: string
          current_step?: string | null
          current_video_id?: string | null
          error_message?: string | null
          failed_videos?: number
          finished_at?: string | null
          id?: string
          skipped_videos?: number
          started_at?: string | null
          status?: string
          total_videos?: number
          updated_at?: string
        }
        Update: {
          completed_videos?: number
          created_at?: string
          current_step?: string | null
          current_video_id?: string | null
          error_message?: string | null
          failed_videos?: number
          finished_at?: string | null
          id?: string
          skipped_videos?: number
          started_at?: string | null
          status?: string
          total_videos?: number
          updated_at?: string
        }
        Relationships: []
      }
      script_assemblies: {
        Row: {
          assembly_name: string
          assembly_rules: Json | null
          block_count_expected: number | null
          created_at: string
          id: string
          script_blocks: Json
          source_generation_context_id: string | null
          status: string
          updated_at: string
          user_id: string | null
          validated_at: string | null
          validation_result: Json | null
          validation_status: string | null
          validation_version: number
        }
        Insert: {
          assembly_name?: string
          assembly_rules?: Json | null
          block_count_expected?: number | null
          created_at?: string
          id?: string
          script_blocks?: Json
          source_generation_context_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
          validated_at?: string | null
          validation_result?: Json | null
          validation_status?: string | null
          validation_version?: number
        }
        Update: {
          assembly_name?: string
          assembly_rules?: Json | null
          block_count_expected?: number | null
          created_at?: string
          id?: string
          script_blocks?: Json
          source_generation_context_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
          validated_at?: string | null
          validation_result?: Json | null
          validation_status?: string | null
          validation_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "script_assemblies_source_generation_context_id_fkey"
            columns: ["source_generation_context_id"]
            isOneToOne: false
            referencedRelation: "generation_contexts"
            referencedColumns: ["id"]
          },
        ]
      }
      semantic_patterns: {
        Row: {
          created_at: string
          cta_exists: boolean | null
          cta_tone: string | null
          cta_type: string | null
          dominant_verbal_tone: string | null
          hook_emotional_intensity: number | null
          hook_emotional_type: string | null
          hook_phrase_type: string | null
          hook_text: string | null
          hook_word_count: number | null
          id: string
          most_common_trigger_words: Json | null
          payoff_emotional_intensity: number | null
          payoff_emotional_type: string | null
          payoff_pattern: string | null
          payoff_text: string | null
          repeated_words: Json | null
          strong_phrases: Json | null
          trigger_words: Json | null
          updated_at: string
          verbal_tone_per_block: Json | null
          video_id: string
        }
        Insert: {
          created_at?: string
          cta_exists?: boolean | null
          cta_tone?: string | null
          cta_type?: string | null
          dominant_verbal_tone?: string | null
          hook_emotional_intensity?: number | null
          hook_emotional_type?: string | null
          hook_phrase_type?: string | null
          hook_text?: string | null
          hook_word_count?: number | null
          id?: string
          most_common_trigger_words?: Json | null
          payoff_emotional_intensity?: number | null
          payoff_emotional_type?: string | null
          payoff_pattern?: string | null
          payoff_text?: string | null
          repeated_words?: Json | null
          strong_phrases?: Json | null
          trigger_words?: Json | null
          updated_at?: string
          verbal_tone_per_block?: Json | null
          video_id: string
        }
        Update: {
          created_at?: string
          cta_exists?: boolean | null
          cta_tone?: string | null
          cta_type?: string | null
          dominant_verbal_tone?: string | null
          hook_emotional_intensity?: number | null
          hook_emotional_type?: string | null
          hook_phrase_type?: string | null
          hook_text?: string | null
          hook_word_count?: number | null
          id?: string
          most_common_trigger_words?: Json | null
          payoff_emotional_intensity?: number | null
          payoff_emotional_type?: string | null
          payoff_pattern?: string | null
          payoff_text?: string | null
          repeated_words?: Json | null
          strong_phrases?: Json | null
          trigger_words?: Json | null
          updated_at?: string
          verbal_tone_per_block?: Json | null
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "semantic_patterns_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: true
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      supported_languages: {
        Row: {
          code: string
          created_at: string
          name: string
          native_name: string
        }
        Insert: {
          code: string
          created_at?: string
          name: string
          native_name: string
        }
        Update: {
          code?: string
          created_at?: string
          name?: string
          native_name?: string
        }
        Relationships: []
      }
      template_contexts: {
        Row: {
          avg_block_count: number | null
          avg_video_duration: number | null
          created_at: string
          cta_position_seconds: number | null
          dominant_cta_type: string | null
          dominant_emotion: string | null
          dominant_sequence: string | null
          hook_position_pct: number | null
          id: string
          notes: string | null
          optional_blocks: Json | null
          payoff_position_pct: number | null
          required_blocks: Json | null
          secondary_emotion: string | null
          source_dna_object_id: string | null
          status: string
          template_name: string
          template_rules: Json | null
          updated_at: string
        }
        Insert: {
          avg_block_count?: number | null
          avg_video_duration?: number | null
          created_at?: string
          cta_position_seconds?: number | null
          dominant_cta_type?: string | null
          dominant_emotion?: string | null
          dominant_sequence?: string | null
          hook_position_pct?: number | null
          id?: string
          notes?: string | null
          optional_blocks?: Json | null
          payoff_position_pct?: number | null
          required_blocks?: Json | null
          secondary_emotion?: string | null
          source_dna_object_id?: string | null
          status?: string
          template_name?: string
          template_rules?: Json | null
          updated_at?: string
        }
        Update: {
          avg_block_count?: number | null
          avg_video_duration?: number | null
          created_at?: string
          cta_position_seconds?: number | null
          dominant_cta_type?: string | null
          dominant_emotion?: string | null
          dominant_sequence?: string | null
          hook_position_pct?: number | null
          id?: string
          notes?: string | null
          optional_blocks?: Json | null
          payoff_position_pct?: number | null
          required_blocks?: Json | null
          secondary_emotion?: string | null
          source_dna_object_id?: string | null
          status?: string
          template_name?: string
          template_rules?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_contexts_source_dna_object_id_fkey"
            columns: ["source_dna_object_id"]
            isOneToOne: false
            referencedRelation: "dna_objects"
            referencedColumns: ["id"]
          },
        ]
      }
      text_image_compatibility: {
        Row: {
          action_match_score: number | null
          block_id: string
          block_type: string | null
          compatibility_label: string | null
          compatibility_reason: string | null
          compatibility_score: number | null
          confidence_score: number | null
          contradiction_detected: boolean | null
          created_at: string
          curiosity_match_score: number | null
          data_source_type: string | null
          emotional_match_score: number | null
          id: string
          intensity_gap: number | null
          origin_level: string | null
          recommended_visual_direction: string | null
          reveal_match_score: number | null
          semantic_coherence_score: number | null
          text_intensity_score: number | null
          text_requires_visual_boost: boolean | null
          updated_at: string
          video_id: string
          visual_intensity_score_calc: number | null
          visual_overload_detected: boolean | null
          visual_overpowered: boolean | null
          visual_underpowered: boolean | null
        }
        Insert: {
          action_match_score?: number | null
          block_id: string
          block_type?: string | null
          compatibility_label?: string | null
          compatibility_reason?: string | null
          compatibility_score?: number | null
          confidence_score?: number | null
          contradiction_detected?: boolean | null
          created_at?: string
          curiosity_match_score?: number | null
          data_source_type?: string | null
          emotional_match_score?: number | null
          id?: string
          intensity_gap?: number | null
          origin_level?: string | null
          recommended_visual_direction?: string | null
          reveal_match_score?: number | null
          semantic_coherence_score?: number | null
          text_intensity_score?: number | null
          text_requires_visual_boost?: boolean | null
          updated_at?: string
          video_id: string
          visual_intensity_score_calc?: number | null
          visual_overload_detected?: boolean | null
          visual_overpowered?: boolean | null
          visual_underpowered?: boolean | null
        }
        Update: {
          action_match_score?: number | null
          block_id?: string
          block_type?: string | null
          compatibility_label?: string | null
          compatibility_reason?: string | null
          compatibility_score?: number | null
          confidence_score?: number | null
          contradiction_detected?: boolean | null
          created_at?: string
          curiosity_match_score?: number | null
          data_source_type?: string | null
          emotional_match_score?: number | null
          id?: string
          intensity_gap?: number | null
          origin_level?: string | null
          recommended_visual_direction?: string | null
          reveal_match_score?: number | null
          semantic_coherence_score?: number | null
          text_intensity_score?: number | null
          text_requires_visual_boost?: boolean | null
          updated_at?: string
          video_id?: string
          visual_intensity_score_calc?: number | null
          visual_overload_detected?: boolean | null
          visual_overpowered?: boolean | null
          visual_underpowered?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "text_image_compatibility_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "video_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "text_image_compatibility_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      text_visual_alignment: {
        Row: {
          action_alignment_score: number | null
          alignment_score: number | null
          block_id: string
          confidence_score: number
          created_at: string
          data_source_type: string
          emotion_alignment_score: number | null
          id: string
          intensity_alignment_score: number | null
          origin_level: string
          text_action: string | null
          text_emotion: string | null
          updated_at: string
          video_id: string
          visual_action: string | null
          visual_emotion: string | null
        }
        Insert: {
          action_alignment_score?: number | null
          alignment_score?: number | null
          block_id: string
          confidence_score?: number
          created_at?: string
          data_source_type?: string
          emotion_alignment_score?: number | null
          id?: string
          intensity_alignment_score?: number | null
          origin_level?: string
          text_action?: string | null
          text_emotion?: string | null
          updated_at?: string
          video_id: string
          visual_action?: string | null
          visual_emotion?: string | null
        }
        Update: {
          action_alignment_score?: number | null
          alignment_score?: number | null
          block_id?: string
          confidence_score?: number
          created_at?: string
          data_source_type?: string
          emotion_alignment_score?: number | null
          id?: string
          intensity_alignment_score?: number | null
          origin_level?: string
          text_action?: string | null
          text_emotion?: string | null
          updated_at?: string
          video_id?: string
          visual_action?: string | null
          visual_emotion?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "text_visual_alignment_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "video_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "text_visual_alignment_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      validation_reports: {
        Row: {
          anomaly_detected: boolean | null
          confidence_score: number | null
          created_at: string
          id: string
          report_data: Json
          validation_type: string
          video_id: string | null
        }
        Insert: {
          anomaly_detected?: boolean | null
          confidence_score?: number | null
          created_at?: string
          id?: string
          report_data?: Json
          validation_type: string
          video_id?: string | null
        }
        Update: {
          anomaly_detected?: boolean | null
          confidence_score?: number | null
          created_at?: string
          id?: string
          report_data?: Json
          validation_type?: string
          video_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "validation_reports_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      verbal_canonical_units: {
        Row: {
          block_id: string | null
          candidate_text: string
          confidence_score: number | null
          created_at: string
          emotional_intensity: number | null
          emotional_intent: string | null
          id: string
          is_top_ranked: boolean | null
          narrative_function: string
          narrative_replicability_score: number | null
          rank_within_function: number | null
          replicable_for_dna: boolean | null
          source_judge_id: string | null
          updated_at: string
          video_engagement_rate: number | null
          video_id: string
          video_title: string | null
          video_views: number | null
          viewer_directed: boolean | null
        }
        Insert: {
          block_id?: string | null
          candidate_text: string
          confidence_score?: number | null
          created_at?: string
          emotional_intensity?: number | null
          emotional_intent?: string | null
          id?: string
          is_top_ranked?: boolean | null
          narrative_function: string
          narrative_replicability_score?: number | null
          rank_within_function?: number | null
          replicable_for_dna?: boolean | null
          source_judge_id?: string | null
          updated_at?: string
          video_engagement_rate?: number | null
          video_id: string
          video_title?: string | null
          video_views?: number | null
          viewer_directed?: boolean | null
        }
        Update: {
          block_id?: string | null
          candidate_text?: string
          confidence_score?: number | null
          created_at?: string
          emotional_intensity?: number | null
          emotional_intent?: string | null
          id?: string
          is_top_ranked?: boolean | null
          narrative_function?: string
          narrative_replicability_score?: number | null
          rank_within_function?: number | null
          replicable_for_dna?: boolean | null
          source_judge_id?: string | null
          updated_at?: string
          video_engagement_rate?: number | null
          video_id?: string
          video_title?: string | null
          video_views?: number | null
          viewer_directed?: boolean | null
        }
        Relationships: []
      }
      verbal_intelligence_summary: {
        Row: {
          avg_confidence: number | null
          avg_emotional_intensity: number | null
          avg_replicability: number | null
          avg_replicability_score: number | null
          created_at: string
          id: string
          narrative_function: string
          primary_emotion: string | null
          secondary_emotion: string | null
          top_patterns: Json | null
          top_units: Json | null
          total_canonical_units: number | null
          updated_at: string
          viewer_directed_rate: number | null
        }
        Insert: {
          avg_confidence?: number | null
          avg_emotional_intensity?: number | null
          avg_replicability?: number | null
          avg_replicability_score?: number | null
          created_at?: string
          id?: string
          narrative_function: string
          primary_emotion?: string | null
          secondary_emotion?: string | null
          top_patterns?: Json | null
          top_units?: Json | null
          total_canonical_units?: number | null
          updated_at?: string
          viewer_directed_rate?: number | null
        }
        Update: {
          avg_confidence?: number | null
          avg_emotional_intensity?: number | null
          avg_replicability?: number | null
          avg_replicability_score?: number | null
          created_at?: string
          id?: string
          narrative_function?: string
          primary_emotion?: string | null
          secondary_emotion?: string | null
          top_patterns?: Json | null
          top_units?: Json | null
          total_canonical_units?: number | null
          updated_at?: string
          viewer_directed_rate?: number | null
        }
        Relationships: []
      }
      verbal_layer_patterns: {
        Row: {
          avg_emotion_intensity: number | null
          avg_engagement_rate: number | null
          created_at: string
          engagement_weighted_phrases: Json | null
          engagement_weighted_words: Json | null
          id: string
          layer_type: string
          top_emotions: Json | null
          top_phrases: Json | null
          top_tones: Json | null
          top_words: Json | null
          total_blocks_analyzed: number | null
          total_videos_analyzed: number | null
          updated_at: string
        }
        Insert: {
          avg_emotion_intensity?: number | null
          avg_engagement_rate?: number | null
          created_at?: string
          engagement_weighted_phrases?: Json | null
          engagement_weighted_words?: Json | null
          id?: string
          layer_type: string
          top_emotions?: Json | null
          top_phrases?: Json | null
          top_tones?: Json | null
          top_words?: Json | null
          total_blocks_analyzed?: number | null
          total_videos_analyzed?: number | null
          updated_at?: string
        }
        Update: {
          avg_emotion_intensity?: number | null
          avg_engagement_rate?: number | null
          created_at?: string
          engagement_weighted_phrases?: Json | null
          engagement_weighted_words?: Json | null
          id?: string
          layer_type?: string
          top_emotions?: Json | null
          top_phrases?: Json | null
          top_tones?: Json | null
          top_words?: Json | null
          total_blocks_analyzed?: number | null
          total_videos_analyzed?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      verbal_narrative_sequences: {
        Row: {
          avg_confidence: number | null
          avg_emotional_intensity: number | null
          avg_engagement_rate: number | null
          avg_replicability: number | null
          avg_replicability_score: number | null
          created_at: string
          dominant_emotion: string | null
          frequency: number
          id: string
          sample_videos: Json | null
          sequence_length: number
          sequence_pattern: string
          updated_at: string
          video_ids: Json | null
          viewer_directed_rate: number | null
        }
        Insert: {
          avg_confidence?: number | null
          avg_emotional_intensity?: number | null
          avg_engagement_rate?: number | null
          avg_replicability?: number | null
          avg_replicability_score?: number | null
          created_at?: string
          dominant_emotion?: string | null
          frequency?: number
          id?: string
          sample_videos?: Json | null
          sequence_length?: number
          sequence_pattern: string
          updated_at?: string
          video_ids?: Json | null
          viewer_directed_rate?: number | null
        }
        Update: {
          avg_confidence?: number | null
          avg_emotional_intensity?: number | null
          avg_engagement_rate?: number | null
          avg_replicability?: number | null
          avg_replicability_score?: number | null
          created_at?: string
          dominant_emotion?: string | null
          frequency?: number
          id?: string
          sample_videos?: Json | null
          sequence_length?: number
          sequence_pattern?: string
          updated_at?: string
          video_ids?: Json | null
          viewer_directed_rate?: number | null
        }
        Relationships: []
      }
      verbal_noise_archive: {
        Row: {
          block_id: string | null
          combination_text: string
          created_at: string
          dominant_function: string | null
          emotional_intent: string | null
          emotional_score: number | null
          id: string
          impact_score: number | null
          rejection_reason: string
          semantic_coherence_score: number | null
          source_block_type: string | null
          video_id: string
          word_count: number | null
        }
        Insert: {
          block_id?: string | null
          combination_text: string
          created_at?: string
          dominant_function?: string | null
          emotional_intent?: string | null
          emotional_score?: number | null
          id?: string
          impact_score?: number | null
          rejection_reason: string
          semantic_coherence_score?: number | null
          source_block_type?: string | null
          video_id: string
          word_count?: number | null
        }
        Update: {
          block_id?: string | null
          combination_text?: string
          created_at?: string
          dominant_function?: string | null
          emotional_intent?: string | null
          emotional_score?: number | null
          id?: string
          impact_score?: number | null
          rejection_reason?: string
          semantic_coherence_score?: number | null
          source_block_type?: string | null
          video_id?: string
          word_count?: number | null
        }
        Relationships: []
      }
      verbal_phase2_profile: {
        Row: {
          avg_confidence: number | null
          avg_emotional_intensity: number | null
          avg_replicability: number | null
          avg_replicability_score: number | null
          created_at: string
          emotion_distribution: Json | null
          id: string
          intensity_histogram: Json | null
          narrative_function: string
          primary_emotion: string | null
          secondary_emotion: string | null
          top_units: Json | null
          top_verbal_patterns: Json | null
          total_units: number
          updated_at: string
          viewer_directed_rate: number | null
        }
        Insert: {
          avg_confidence?: number | null
          avg_emotional_intensity?: number | null
          avg_replicability?: number | null
          avg_replicability_score?: number | null
          created_at?: string
          emotion_distribution?: Json | null
          id?: string
          intensity_histogram?: Json | null
          narrative_function: string
          primary_emotion?: string | null
          secondary_emotion?: string | null
          top_units?: Json | null
          top_verbal_patterns?: Json | null
          total_units?: number
          updated_at?: string
          viewer_directed_rate?: number | null
        }
        Update: {
          avg_confidence?: number | null
          avg_emotional_intensity?: number | null
          avg_replicability?: number | null
          avg_replicability_score?: number | null
          created_at?: string
          emotion_distribution?: Json | null
          id?: string
          intensity_histogram?: Json | null
          narrative_function?: string
          primary_emotion?: string | null
          secondary_emotion?: string | null
          top_units?: Json | null
          top_verbal_patterns?: Json | null
          total_units?: number
          updated_at?: string
          viewer_directed_rate?: number | null
        }
        Relationships: []
      }
      video_blocks: {
        Row: {
          block_density_score: number | null
          bloco_id: number
          created_at: string
          descricao_visual: string | null
          elemento_visual: string | null
          emocao: Database["public"]["Enums"]["emocao"] | null
          frame_url: string | null
          funcao_narrativa: string | null
          id: string
          language_code: string
          semantic_shift_score: number | null
          tempo_fim: number
          tempo_inicio: number
          texto: string | null
          tipo_bloco: Database["public"]["Enums"]["tipo_bloco"]
          video_id: string
          visual_shift_score: number | null
        }
        Insert: {
          block_density_score?: number | null
          bloco_id: number
          created_at?: string
          descricao_visual?: string | null
          elemento_visual?: string | null
          emocao?: Database["public"]["Enums"]["emocao"] | null
          frame_url?: string | null
          funcao_narrativa?: string | null
          id?: string
          language_code?: string
          semantic_shift_score?: number | null
          tempo_fim: number
          tempo_inicio: number
          texto?: string | null
          tipo_bloco: Database["public"]["Enums"]["tipo_bloco"]
          video_id: string
          visual_shift_score?: number | null
        }
        Update: {
          block_density_score?: number | null
          bloco_id?: number
          created_at?: string
          descricao_visual?: string | null
          elemento_visual?: string | null
          emocao?: Database["public"]["Enums"]["emocao"] | null
          frame_url?: string | null
          funcao_narrativa?: string | null
          id?: string
          language_code?: string
          semantic_shift_score?: number | null
          tempo_fim?: number
          tempo_inicio?: number
          texto?: string | null
          tipo_bloco?: Database["public"]["Enums"]["tipo_bloco"]
          video_id?: string
          visual_shift_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "video_blocks_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      video_cta_events: {
        Row: {
          block_id: string | null
          created_at: string
          cta_confidence: number | null
          cta_intensity: number
          cta_language: string | null
          cta_position_seconds: number | null
          cta_text: string | null
          cta_type: string
          id: string
          video_id: string
        }
        Insert: {
          block_id?: string | null
          created_at?: string
          cta_confidence?: number | null
          cta_intensity?: number
          cta_language?: string | null
          cta_position_seconds?: number | null
          cta_text?: string | null
          cta_type: string
          id?: string
          video_id: string
        }
        Update: {
          block_id?: string | null
          created_at?: string
          cta_confidence?: number | null
          cta_intensity?: number
          cta_language?: string | null
          cta_position_seconds?: number | null
          cta_text?: string | null
          cta_type?: string
          id?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_cta_events_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "video_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_cta_events_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      video_frames: {
        Row: {
          block_id: string | null
          created_at: string
          file_path: string | null
          frame_hash: string | null
          frame_number: number
          frame_role: string | null
          id: string
          scene_change_flag: boolean | null
          source_method: string | null
          timestamp_seconds: number
          video_id: string
          visual_intensity_score: number | null
        }
        Insert: {
          block_id?: string | null
          created_at?: string
          file_path?: string | null
          frame_hash?: string | null
          frame_number: number
          frame_role?: string | null
          id?: string
          scene_change_flag?: boolean | null
          source_method?: string | null
          timestamp_seconds: number
          video_id: string
          visual_intensity_score?: number | null
        }
        Update: {
          block_id?: string | null
          created_at?: string
          file_path?: string | null
          frame_hash?: string | null
          frame_number?: number
          frame_role?: string | null
          id?: string
          scene_change_flag?: boolean | null
          source_method?: string | null
          timestamp_seconds?: number
          video_id?: string
          visual_intensity_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "video_frames_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      video_languages: {
        Row: {
          created_at: string
          id: string
          is_original: boolean
          language_code: string
          video_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_original?: boolean
          language_code: string
          video_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_original?: boolean
          language_code?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_languages_language_code_fkey"
            columns: ["language_code"]
            isOneToOne: false
            referencedRelation: "supported_languages"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "video_languages_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      video_logs: {
        Row: {
          created_at: string
          duracao_ms: number | null
          etapa: string
          id: string
          mensagem: string | null
          status: string
          video_id: string
        }
        Insert: {
          created_at?: string
          duracao_ms?: number | null
          etapa: string
          id?: string
          mensagem?: string | null
          status: string
          video_id: string
        }
        Update: {
          created_at?: string
          duracao_ms?: number | null
          etapa?: string
          id?: string
          mensagem?: string | null
          status?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_logs_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      video_metadata: {
        Row: {
          chave: string
          created_at: string
          id: string
          valor: string | null
          video_id: string
        }
        Insert: {
          chave: string
          created_at?: string
          id?: string
          valor?: string | null
          video_id: string
        }
        Update: {
          chave?: string
          created_at?: string
          id?: string
          valor?: string | null
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_metadata_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      video_micro_events: {
        Row: {
          alignment_score: number
          block_id: string
          confidence_score: number
          created_at: string
          event_strength: number
          event_type: string
          id: string
          processing_status: string
          temporal_intensity: number
          timestamp_seconds: number
          updated_at: string
          video_id: string
          visual_change_score: number
        }
        Insert: {
          alignment_score?: number
          block_id: string
          confidence_score?: number
          created_at?: string
          event_strength?: number
          event_type: string
          id?: string
          processing_status?: string
          temporal_intensity?: number
          timestamp_seconds?: number
          updated_at?: string
          video_id: string
          visual_change_score?: number
        }
        Update: {
          alignment_score?: number
          block_id?: string
          confidence_score?: number
          created_at?: string
          event_strength?: number
          event_type?: string
          id?: string
          processing_status?: string
          temporal_intensity?: number
          timestamp_seconds?: number
          updated_at?: string
          video_id?: string
          visual_change_score?: number
        }
        Relationships: []
      }
      video_scripts: {
        Row: {
          created_at: string
          id: string
          language_code: string
          roteiro: string
          updated_at: string
          video_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          language_code: string
          roteiro: string
          updated_at?: string
          video_id: string
        }
        Update: {
          created_at?: string
          id?: string
          language_code?: string
          roteiro?: string
          updated_at?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_scripts_language_code_fkey"
            columns: ["language_code"]
            isOneToOne: false
            referencedRelation: "supported_languages"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "video_scripts_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      video_temporal_profile: {
        Row: {
          avg_cut_interval: number
          block_id: string
          confidence_score: number
          created_at: string
          cut_count: number
          cut_density: number
          error_message: string | null
          id: string
          processing_status: string
          rhythm_level: string
          tempo_pattern: string
          updated_at: string
          video_id: string
        }
        Insert: {
          avg_cut_interval?: number
          block_id: string
          confidence_score?: number
          created_at?: string
          cut_count?: number
          cut_density?: number
          error_message?: string | null
          id?: string
          processing_status?: string
          rhythm_level?: string
          tempo_pattern?: string
          updated_at?: string
          video_id: string
        }
        Update: {
          avg_cut_interval?: number
          block_id?: string
          confidence_score?: number
          created_at?: string
          cut_count?: number
          cut_density?: number
          error_message?: string | null
          id?: string
          processing_status?: string
          rhythm_level?: string
          tempo_pattern?: string
          updated_at?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_temporal_profile_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "video_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_temporal_profile_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      video_transcripts: {
        Row: {
          created_at: string
          duracao: number
          id: string
          language_code: string
          tempo_fim: number
          tempo_inicio: number
          texto: string
          video_id: string
        }
        Insert: {
          created_at?: string
          duracao: number
          id?: string
          language_code?: string
          tempo_fim: number
          tempo_inicio: number
          texto: string
          video_id: string
        }
        Update: {
          created_at?: string
          duracao?: number
          id?: string
          language_code?: string
          tempo_fim?: number
          tempo_inicio?: number
          texto?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_transcripts_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      videos: {
        Row: {
          approved_for_global: boolean
          avg_alignment_score: number | null
          block_segmentation_version: string | null
          codec: string | null
          comments: number | null
          comments_norm: number | null
          confianca_estilo: number | null
          confianca_segmento: number | null
          created_at: string
          created_by: string | null
          cta_flow_break_score: number | null
          cta_intrusion_score: number | null
          cta_position_time: number | null
          cta_text: string | null
          cta_type: string | null
          dataset_weight_pct: number | null
          duracao: number | null
          duracao_gancho: number | null
          emocao_predominante: Database["public"]["Enums"]["emocao"] | null
          engagement_percentile: number | null
          engagement_percentile_display: number | null
          engagement_rate: number | null
          engagement_rate_log: number | null
          engagement_rate_norm: number | null
          engagement_rate_relative: number | null
          estilo_visual:
            | Database["public"]["Enums"]["video_estilo_visual"]
            | null
          estilo_visual_ia: string | null
          first_impact_time: number | null
          fps: number | null
          gancho_detectado: boolean | null
          hook_emotion_intensity: number | null
          hook_emotion_verbal: string | null
          hook_keywords: Json | null
          hook_phrase_pattern: string | null
          hook_text: string | null
          hook_type_verbal: string | null
          id: string
          idioma: string | null
          intensidade_emocional:
            | Database["public"]["Enums"]["intensidade_emocional"]
            | null
          likes: number | null
          likes_norm: number | null
          loop_detectado: boolean | null
          micro_turn_count: number | null
          micro_turn_types: Json | null
          narrative_progression_type: string | null
          normalized_performance_score: number | null
          numero_blocos: number | null
          numero_frames: number | null
          origem: string | null
          payoff_emotion: string | null
          payoff_text: string | null
          payoff_type: string | null
          performance_z_score: number | null
          resolucao: string | null
          segment_adjusted_score: number | null
          segmento: Database["public"]["Enums"]["video_segmento"] | null
          segmento_ia: string | null
          status: Database["public"]["Enums"]["processing_status"]
          tamanho: number | null
          tempo_gancho: number | null
          tempo_payoff: number | null
          tempo_primeira_revelacao: number | null
          tempo_primeiro_evento: number | null
          thumbnail: string | null
          tipo_entrada: string
          tipo_gancho: Database["public"]["Enums"]["tipo_gancho"] | null
          tipo_viral: string | null
          titulo: string | null
          updated_at: string
          views: number | null
          views_norm: number | null
        }
        Insert: {
          approved_for_global?: boolean
          avg_alignment_score?: number | null
          block_segmentation_version?: string | null
          codec?: string | null
          comments?: number | null
          comments_norm?: number | null
          confianca_estilo?: number | null
          confianca_segmento?: number | null
          created_at?: string
          created_by?: string | null
          cta_flow_break_score?: number | null
          cta_intrusion_score?: number | null
          cta_position_time?: number | null
          cta_text?: string | null
          cta_type?: string | null
          dataset_weight_pct?: number | null
          duracao?: number | null
          duracao_gancho?: number | null
          emocao_predominante?: Database["public"]["Enums"]["emocao"] | null
          engagement_percentile?: number | null
          engagement_percentile_display?: number | null
          engagement_rate?: number | null
          engagement_rate_log?: number | null
          engagement_rate_norm?: number | null
          engagement_rate_relative?: number | null
          estilo_visual?:
            | Database["public"]["Enums"]["video_estilo_visual"]
            | null
          estilo_visual_ia?: string | null
          first_impact_time?: number | null
          fps?: number | null
          gancho_detectado?: boolean | null
          hook_emotion_intensity?: number | null
          hook_emotion_verbal?: string | null
          hook_keywords?: Json | null
          hook_phrase_pattern?: string | null
          hook_text?: string | null
          hook_type_verbal?: string | null
          id?: string
          idioma?: string | null
          intensidade_emocional?:
            | Database["public"]["Enums"]["intensidade_emocional"]
            | null
          likes?: number | null
          likes_norm?: number | null
          loop_detectado?: boolean | null
          micro_turn_count?: number | null
          micro_turn_types?: Json | null
          narrative_progression_type?: string | null
          normalized_performance_score?: number | null
          numero_blocos?: number | null
          numero_frames?: number | null
          origem?: string | null
          payoff_emotion?: string | null
          payoff_text?: string | null
          payoff_type?: string | null
          performance_z_score?: number | null
          resolucao?: string | null
          segment_adjusted_score?: number | null
          segmento?: Database["public"]["Enums"]["video_segmento"] | null
          segmento_ia?: string | null
          status?: Database["public"]["Enums"]["processing_status"]
          tamanho?: number | null
          tempo_gancho?: number | null
          tempo_payoff?: number | null
          tempo_primeira_revelacao?: number | null
          tempo_primeiro_evento?: number | null
          thumbnail?: string | null
          tipo_entrada: string
          tipo_gancho?: Database["public"]["Enums"]["tipo_gancho"] | null
          tipo_viral?: string | null
          titulo?: string | null
          updated_at?: string
          views?: number | null
          views_norm?: number | null
        }
        Update: {
          approved_for_global?: boolean
          avg_alignment_score?: number | null
          block_segmentation_version?: string | null
          codec?: string | null
          comments?: number | null
          comments_norm?: number | null
          confianca_estilo?: number | null
          confianca_segmento?: number | null
          created_at?: string
          created_by?: string | null
          cta_flow_break_score?: number | null
          cta_intrusion_score?: number | null
          cta_position_time?: number | null
          cta_text?: string | null
          cta_type?: string | null
          dataset_weight_pct?: number | null
          duracao?: number | null
          duracao_gancho?: number | null
          emocao_predominante?: Database["public"]["Enums"]["emocao"] | null
          engagement_percentile?: number | null
          engagement_percentile_display?: number | null
          engagement_rate?: number | null
          engagement_rate_log?: number | null
          engagement_rate_norm?: number | null
          engagement_rate_relative?: number | null
          estilo_visual?:
            | Database["public"]["Enums"]["video_estilo_visual"]
            | null
          estilo_visual_ia?: string | null
          first_impact_time?: number | null
          fps?: number | null
          gancho_detectado?: boolean | null
          hook_emotion_intensity?: number | null
          hook_emotion_verbal?: string | null
          hook_keywords?: Json | null
          hook_phrase_pattern?: string | null
          hook_text?: string | null
          hook_type_verbal?: string | null
          id?: string
          idioma?: string | null
          intensidade_emocional?:
            | Database["public"]["Enums"]["intensidade_emocional"]
            | null
          likes?: number | null
          likes_norm?: number | null
          loop_detectado?: boolean | null
          micro_turn_count?: number | null
          micro_turn_types?: Json | null
          narrative_progression_type?: string | null
          normalized_performance_score?: number | null
          numero_blocos?: number | null
          numero_frames?: number | null
          origem?: string | null
          payoff_emotion?: string | null
          payoff_text?: string | null
          payoff_type?: string | null
          performance_z_score?: number | null
          resolucao?: string | null
          segment_adjusted_score?: number | null
          segmento?: Database["public"]["Enums"]["video_segmento"] | null
          segmento_ia?: string | null
          status?: Database["public"]["Enums"]["processing_status"]
          tamanho?: number | null
          tempo_gancho?: number | null
          tempo_payoff?: number | null
          tempo_primeira_revelacao?: number | null
          tempo_primeiro_evento?: number | null
          thumbnail?: string | null
          tipo_entrada?: string
          tipo_gancho?: Database["public"]["Enums"]["tipo_gancho"] | null
          tipo_viral?: string | null
          titulo?: string | null
          updated_at?: string
          views?: number | null
          views_norm?: number | null
        }
        Relationships: []
      }
      viral_combination_patterns: {
        Row: {
          avg_confidence: number | null
          combination_text: string
          created_at: string
          dominant_block_types: string[] | null
          dominant_function: string
          emotional_intent: string | null
          id: string
          languages: string[] | null
          pattern_score: number | null
          sample_contexts: string[] | null
          total_occurrences: number | null
          updated_at: string
          videos_count: number | null
          word_count: number
        }
        Insert: {
          avg_confidence?: number | null
          combination_text: string
          created_at?: string
          dominant_block_types?: string[] | null
          dominant_function?: string
          emotional_intent?: string | null
          id?: string
          languages?: string[] | null
          pattern_score?: number | null
          sample_contexts?: string[] | null
          total_occurrences?: number | null
          updated_at?: string
          videos_count?: number | null
          word_count?: number
        }
        Update: {
          avg_confidence?: number | null
          combination_text?: string
          created_at?: string
          dominant_block_types?: string[] | null
          dominant_function?: string
          emotional_intent?: string | null
          id?: string
          languages?: string[] | null
          pattern_score?: number | null
          sample_contexts?: string[] | null
          total_occurrences?: number | null
          updated_at?: string
          videos_count?: number | null
          word_count?: number
        }
        Relationships: []
      }
      viral_emotional_patterns: {
        Row: {
          avg_intensity: number | null
          created_at: string
          emotional_sequence: string
          id: string
          pattern_score: number | null
          peak_positions: Json | null
          videos_count: number | null
        }
        Insert: {
          avg_intensity?: number | null
          created_at?: string
          emotional_sequence: string
          id?: string
          pattern_score?: number | null
          peak_positions?: Json | null
          videos_count?: number | null
        }
        Update: {
          avg_intensity?: number | null
          created_at?: string
          emotional_sequence?: string
          id?: string
          pattern_score?: number | null
          peak_positions?: Json | null
          videos_count?: number | null
        }
        Relationships: []
      }
      viral_lexicon_global: {
        Row: {
          created_at: string
          emotional_association: string | null
          frequency_by_position: Json | null
          frequency_total: number | null
          id: string
          narrative_position: string | null
          performance_weighted_score: number | null
          updated_at: string
          word: string
        }
        Insert: {
          created_at?: string
          emotional_association?: string | null
          frequency_by_position?: Json | null
          frequency_total?: number | null
          id?: string
          narrative_position?: string | null
          performance_weighted_score?: number | null
          updated_at?: string
          word: string
        }
        Update: {
          created_at?: string
          emotional_association?: string | null
          frequency_by_position?: Json | null
          frequency_total?: number | null
          id?: string
          narrative_position?: string | null
          performance_weighted_score?: number | null
          updated_at?: string
          word?: string
        }
        Relationships: []
      }
      viral_phrase_bank: {
        Row: {
          created_at: string
          emotional_trigger: string | null
          frequency_count: number | null
          id: string
          narrative_position: string | null
          performance_weight: number | null
          phrase_text: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          emotional_trigger?: string | null
          frequency_count?: number | null
          id?: string
          narrative_position?: string | null
          performance_weight?: number | null
          phrase_text: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          emotional_trigger?: string | null
          frequency_count?: number | null
          id?: string
          narrative_position?: string | null
          performance_weight?: number | null
          phrase_text?: string
          updated_at?: string
        }
        Relationships: []
      }
      viral_score_recalc_queue: {
        Row: {
          id: string
          processed: boolean
          requested_at: string
        }
        Insert: {
          id?: string
          processed?: boolean
          requested_at?: string
        }
        Update: {
          id?: string
          processed?: boolean
          requested_at?: string
        }
        Relationships: []
      }
      viral_sequence_patterns: {
        Row: {
          avg_peak_intensity: number | null
          created_at: string
          id: string
          occurrence_count: number | null
          pattern_score: number | null
          sequence_duration_avg: number | null
          sequence_emotion_flow: string | null
          sequence_structure: string
          videos_count: number | null
        }
        Insert: {
          avg_peak_intensity?: number | null
          created_at?: string
          id?: string
          occurrence_count?: number | null
          pattern_score?: number | null
          sequence_duration_avg?: number | null
          sequence_emotion_flow?: string | null
          sequence_structure: string
          videos_count?: number | null
        }
        Update: {
          avg_peak_intensity?: number | null
          created_at?: string
          id?: string
          occurrence_count?: number | null
          pattern_score?: number | null
          sequence_duration_avg?: number | null
          sequence_emotion_flow?: string | null
          sequence_structure?: string
          videos_count?: number | null
        }
        Relationships: []
      }
      viral_timing_patterns: {
        Row: {
          avg_acceleration: number | null
          avg_cut_density: number | null
          avg_pause_duration: number | null
          created_at: string
          id: string
          pattern_score: number | null
          timing_signature: string
          videos_count: number | null
        }
        Insert: {
          avg_acceleration?: number | null
          avg_cut_density?: number | null
          avg_pause_duration?: number | null
          created_at?: string
          id?: string
          pattern_score?: number | null
          timing_signature: string
          videos_count?: number | null
        }
        Update: {
          avg_acceleration?: number | null
          avg_cut_density?: number | null
          avg_pause_duration?: number | null
          created_at?: string
          id?: string
          pattern_score?: number | null
          timing_signature?: string
          videos_count?: number | null
        }
        Relationships: []
      }
      viral_verbal_patterns: {
        Row: {
          created_at: string
          cta_related: boolean | null
          dominant_emotion: string | null
          dominant_tone: string | null
          emotional_intent: string | null
          hook_related: boolean | null
          id: string
          linguistic_density_avg: number | null
          pattern_category: string | null
          pattern_score: number | null
          payoff_related: boolean | null
          phrase_structure: string
          recurrence_type: string | null
          sample_phrases: Json | null
          semantic_pressure_avg: number | null
          verbal_function: string | null
          verbal_position: string | null
          videos_count: number | null
        }
        Insert: {
          created_at?: string
          cta_related?: boolean | null
          dominant_emotion?: string | null
          dominant_tone?: string | null
          emotional_intent?: string | null
          hook_related?: boolean | null
          id?: string
          linguistic_density_avg?: number | null
          pattern_category?: string | null
          pattern_score?: number | null
          payoff_related?: boolean | null
          phrase_structure: string
          recurrence_type?: string | null
          sample_phrases?: Json | null
          semantic_pressure_avg?: number | null
          verbal_function?: string | null
          verbal_position?: string | null
          videos_count?: number | null
        }
        Update: {
          created_at?: string
          cta_related?: boolean | null
          dominant_emotion?: string | null
          dominant_tone?: string | null
          emotional_intent?: string | null
          hook_related?: boolean | null
          id?: string
          linguistic_density_avg?: number | null
          pattern_category?: string | null
          pattern_score?: number | null
          payoff_related?: boolean | null
          phrase_structure?: string
          recurrence_type?: string | null
          sample_phrases?: Json | null
          semantic_pressure_avg?: number | null
          verbal_function?: string | null
          verbal_position?: string | null
          videos_count?: number | null
        }
        Relationships: []
      }
      viral_visual_patterns: {
        Row: {
          alignment_type: string | null
          created_at: string
          frame_transition_pattern: string | null
          id: string
          pattern_score: number | null
          videos_count: number | null
          visual_signature: string
        }
        Insert: {
          alignment_type?: string | null
          created_at?: string
          frame_transition_pattern?: string | null
          id?: string
          pattern_score?: number | null
          videos_count?: number | null
          visual_signature: string
        }
        Update: {
          alignment_type?: string | null
          created_at?: string
          frame_transition_pattern?: string | null
          id?: string
          pattern_score?: number | null
          videos_count?: number | null
          visual_signature?: string
        }
        Relationships: []
      }
      viral_word_combinations: {
        Row: {
          approval_score: number | null
          approved_for_dna: boolean | null
          block_id: string | null
          block_type: string | null
          combination_text: string
          confidence_score: number | null
          created_at: string
          cross_video_count: number | null
          dominant_function: string
          emotional_intent: string | null
          emotional_score: number | null
          id: string
          impact_score: number | null
          language_code: string | null
          linked_micro_event: boolean | null
          linked_temporal_signal: boolean | null
          linked_visual_signal: boolean | null
          occurrence_count: number | null
          pattern_score: number | null
          sample_context: string | null
          semantic_coherence_score: number | null
          source_block_type: string | null
          updated_at: string
          video_id: string
          visual_temporal_confirmation_score: number | null
          word_count: number
        }
        Insert: {
          approval_score?: number | null
          approved_for_dna?: boolean | null
          block_id?: string | null
          block_type?: string | null
          combination_text: string
          confidence_score?: number | null
          created_at?: string
          cross_video_count?: number | null
          dominant_function?: string
          emotional_intent?: string | null
          emotional_score?: number | null
          id?: string
          impact_score?: number | null
          language_code?: string | null
          linked_micro_event?: boolean | null
          linked_temporal_signal?: boolean | null
          linked_visual_signal?: boolean | null
          occurrence_count?: number | null
          pattern_score?: number | null
          sample_context?: string | null
          semantic_coherence_score?: number | null
          source_block_type?: string | null
          updated_at?: string
          video_id: string
          visual_temporal_confirmation_score?: number | null
          word_count?: number
        }
        Update: {
          approval_score?: number | null
          approved_for_dna?: boolean | null
          block_id?: string | null
          block_type?: string | null
          combination_text?: string
          confidence_score?: number | null
          created_at?: string
          cross_video_count?: number | null
          dominant_function?: string
          emotional_intent?: string | null
          emotional_score?: number | null
          id?: string
          impact_score?: number | null
          language_code?: string | null
          linked_micro_event?: boolean | null
          linked_temporal_signal?: boolean | null
          linked_visual_signal?: boolean | null
          occurrence_count?: number | null
          pattern_score?: number | null
          sample_context?: string | null
          semantic_coherence_score?: number | null
          source_block_type?: string | null
          updated_at?: string
          video_id?: string
          visual_temporal_confirmation_score?: number | null
          word_count?: number
        }
        Relationships: []
      }
      visual_block_analysis: {
        Row: {
          animal_presence: boolean | null
          avg_visual_intensity_score: number | null
          block_id: string
          block_type: string
          confidence_score: number
          created_at: string
          data_source_type: string
          human_presence: boolean | null
          id: string
          main_action: string | null
          main_objects: Json | null
          origin_level: string
          representative_frame_path: string | null
          representative_timestamp: number | null
          scene_change_count: number | null
          scene_change_detected: boolean | null
          scene_description: string | null
          text_on_screen_presence: boolean | null
          updated_at: string
          video_id: string
          visual_emotion: string | null
          visual_intensity_level: string | null
        }
        Insert: {
          animal_presence?: boolean | null
          avg_visual_intensity_score?: number | null
          block_id: string
          block_type: string
          confidence_score?: number
          created_at?: string
          data_source_type?: string
          human_presence?: boolean | null
          id?: string
          main_action?: string | null
          main_objects?: Json | null
          origin_level?: string
          representative_frame_path?: string | null
          representative_timestamp?: number | null
          scene_change_count?: number | null
          scene_change_detected?: boolean | null
          scene_description?: string | null
          text_on_screen_presence?: boolean | null
          updated_at?: string
          video_id: string
          visual_emotion?: string | null
          visual_intensity_level?: string | null
        }
        Update: {
          animal_presence?: boolean | null
          avg_visual_intensity_score?: number | null
          block_id?: string
          block_type?: string
          confidence_score?: number
          created_at?: string
          data_source_type?: string
          human_presence?: boolean | null
          id?: string
          main_action?: string | null
          main_objects?: Json | null
          origin_level?: string
          representative_frame_path?: string | null
          representative_timestamp?: number | null
          scene_change_count?: number | null
          scene_change_detected?: boolean | null
          scene_description?: string | null
          text_on_screen_presence?: boolean | null
          updated_at?: string
          video_id?: string
          visual_emotion?: string | null
          visual_intensity_level?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "visual_block_analysis_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "video_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visual_block_analysis_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      visual_emotion_sequence: {
        Row: {
          confidence_score: number | null
          created_at: string
          dominant_transition: string | null
          emotion_sequence: Json | null
          id: string
          sequence_string: string | null
          transition_count: number | null
          updated_at: string
          video_id: string
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string
          dominant_transition?: string | null
          emotion_sequence?: Json | null
          id?: string
          sequence_string?: string | null
          transition_count?: number | null
          updated_at?: string
          video_id: string
        }
        Update: {
          confidence_score?: number | null
          created_at?: string
          dominant_transition?: string | null
          emotion_sequence?: Json | null
          id?: string
          sequence_string?: string | null
          transition_count?: number | null
          updated_at?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visual_emotion_sequence_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: true
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_audit_trail: { Args: never; Returns: undefined }
      cleanup_extraction_logs: { Args: never; Returns: undefined }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      process_viral_recalc_queue: { Args: never; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "member"
      data_origin_level: "raw" | "calculated"
      data_source_type:
        | "transcription"
        | "visual_detection"
        | "metadata_import"
        | "manual_entry"
        | "calculated"
        | "ai_extraction"
      emocao:
        | "curiosidade"
        | "surpresa"
        | "medo"
        | "tensao"
        | "alivio"
        | "expectativa"
        | "impacto"
      intensidade_emocional: "baixa" | "media" | "alta"
      processing_status: "pending" | "processing" | "completed" | "failed"
      tipo_bloco:
        | "hook"
        | "setup"
        | "desenvolvimento"
        | "tensao"
        | "revelacao"
        | "payoff"
        | "transicao"
        | "loop"
      tipo_gancho: "visual" | "texto" | "acao" | "pergunta"
      video_estilo_visual:
        | "filme"
        | "3d"
        | "live_action"
        | "animacao"
        | "cgi"
        | "stock_footage"
      video_segmento:
        | "meme"
        | "curiosidade"
        | "misterio"
        | "terror"
        | "historia_real"
        | "narrativa_biblica"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      app_role: ["admin", "member"],
      data_origin_level: ["raw", "calculated"],
      data_source_type: [
        "transcription",
        "visual_detection",
        "metadata_import",
        "manual_entry",
        "calculated",
        "ai_extraction",
      ],
      emocao: [
        "curiosidade",
        "surpresa",
        "medo",
        "tensao",
        "alivio",
        "expectativa",
        "impacto",
      ],
      intensidade_emocional: ["baixa", "media", "alta"],
      processing_status: ["pending", "processing", "completed", "failed"],
      tipo_bloco: [
        "hook",
        "setup",
        "desenvolvimento",
        "tensao",
        "revelacao",
        "payoff",
        "transicao",
        "loop",
      ],
      tipo_gancho: ["visual", "texto", "acao", "pergunta"],
      video_estilo_visual: [
        "filme",
        "3d",
        "live_action",
        "animacao",
        "cgi",
        "stock_footage",
      ],
      video_segmento: [
        "meme",
        "curiosidade",
        "misterio",
        "terror",
        "historia_real",
        "narrativa_biblica",
      ],
    },
  },
} as const
