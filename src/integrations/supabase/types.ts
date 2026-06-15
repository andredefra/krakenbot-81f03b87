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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      chat_messages: {
        Row: {
          created_at: string
          id: string
          message_id: string
          parts: Json
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message_id: string
          parts?: Json
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message_id?: string
          parts?: Json
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      events_log: {
        Row: {
          component: string
          created_at: string
          id: string
          level: Database["public"]["Enums"]["event_level"]
          message: string
          mode: Database["public"]["Enums"]["trade_mode"]
          payload: Json | null
          ts: string
          user_id: string
        }
        Insert: {
          component: string
          created_at?: string
          id?: string
          level?: Database["public"]["Enums"]["event_level"]
          message: string
          mode?: Database["public"]["Enums"]["trade_mode"]
          payload?: Json | null
          ts?: string
          user_id: string
        }
        Update: {
          component?: string
          created_at?: string
          id?: string
          level?: Database["public"]["Enums"]["event_level"]
          message?: string
          mode?: Database["public"]["Enums"]["trade_mode"]
          payload?: Json | null
          ts?: string
          user_id?: string
        }
        Relationships: []
      }
      fx_rates: {
        Row: {
          base: string
          created_at: string
          id: string
          quote: string
          rate: number
          rate_date: string
        }
        Insert: {
          base: string
          created_at?: string
          id?: string
          quote: string
          rate: number
          rate_date: string
        }
        Update: {
          base?: string
          created_at?: string
          id?: string
          quote?: string
          rate?: number
          rate_date?: string
        }
        Relationships: []
      }
      infra_costs: {
        Row: {
          amount_cents: number
          category: string
          created_at: string
          currency: string
          end_date: string | null
          id: string
          name: string
          notes: string | null
          recurrence: string
          start_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_cents: number
          category?: string
          created_at?: string
          currency?: string
          end_date?: string | null
          id?: string
          name: string
          notes?: string | null
          recurrence?: string
          start_date: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          category?: string
          created_at?: string
          currency?: string
          end_date?: string | null
          id?: string
          name?: string
          notes?: string | null
          recurrence?: string
          start_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      portfolio_snapshots: {
        Row: {
          cash_value: number
          created_at: string
          id: string
          mode: Database["public"]["Enums"]["trade_mode"]
          positions_value: number
          realized_pnl_day: number
          total_value: number
          ts: string
          user_id: string
        }
        Insert: {
          cash_value: number
          created_at?: string
          id?: string
          mode?: Database["public"]["Enums"]["trade_mode"]
          positions_value: number
          realized_pnl_day?: number
          total_value: number
          ts?: string
          user_id: string
        }
        Update: {
          cash_value?: number
          created_at?: string
          id?: string
          mode?: Database["public"]["Enums"]["trade_mode"]
          positions_value?: number
          realized_pnl_day?: number
          total_value?: number
          ts?: string
          user_id?: string
        }
        Relationships: []
      }
      positions: {
        Row: {
          asset: string
          closed_at: string | null
          created_at: string
          current_price: number | null
          entry_price: number
          entry_value: number
          exit_price: number | null
          exit_reason: string | null
          exit_value: number | null
          id: string
          kraken_order_id: string | null
          mode: Database["public"]["Enums"]["trade_mode"]
          open_reason: string | null
          opened_at: string
          pnl: number | null
          pnl_pct: number | null
          qty: number
          side: Database["public"]["Enums"]["position_side"]
          status: Database["public"]["Enums"]["position_status"]
          stop_price: number | null
          trailing_high: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          asset: string
          closed_at?: string | null
          created_at?: string
          current_price?: number | null
          entry_price: number
          entry_value: number
          exit_price?: number | null
          exit_reason?: string | null
          exit_value?: number | null
          id?: string
          kraken_order_id?: string | null
          mode?: Database["public"]["Enums"]["trade_mode"]
          open_reason?: string | null
          opened_at?: string
          pnl?: number | null
          pnl_pct?: number | null
          qty: number
          side?: Database["public"]["Enums"]["position_side"]
          status?: Database["public"]["Enums"]["position_status"]
          stop_price?: number | null
          trailing_high?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          asset?: string
          closed_at?: string | null
          created_at?: string
          current_price?: number | null
          entry_price?: number
          entry_value?: number
          exit_price?: number | null
          exit_reason?: string | null
          exit_value?: number | null
          id?: string
          kraken_order_id?: string | null
          mode?: Database["public"]["Enums"]["trade_mode"]
          open_reason?: string | null
          opened_at?: string
          pnl?: number | null
          pnl_pct?: number | null
          qty?: number
          side?: Database["public"]["Enums"]["position_side"]
          status?: Database["public"]["Enums"]["position_status"]
          stop_price?: number | null
          trailing_high?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sentiment_snapshots: {
        Row: {
          created_at: string
          id: string
          raw: Json | null
          scope: string
          score: number | null
          source: string
          ts: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          raw?: Json | null
          scope?: string
          score?: number | null
          source: string
          ts?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          raw?: Json | null
          scope?: string
          score?: number | null
          source?: string
          ts?: string
          user_id?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          asset_universe: Json
          capital_reference: number
          created_at: string
          daily_loss_limit_pct: number
          enabled_sentiment_sources: Json
          id: string
          is_running: boolean
          kill_switch_floor: number
          loss_carryforward_cents: number
          max_position_pct: number
          max_positions: number
          min_target_pct: number
          mode: Database["public"]["Enums"]["trade_mode"]
          paper_fee_bps: number
          sentiment_weights: Json
          stop_loss_pct: number
          take_profit_pct: number
          tax_country: string
          tax_reserve_cents: number
          timeframe: string
          trailing_activate_pct: number
          trailing_gap_pct: number
          updated_at: string
          user_id: string
        }
        Insert: {
          asset_universe?: Json
          capital_reference?: number
          created_at?: string
          daily_loss_limit_pct?: number
          enabled_sentiment_sources?: Json
          id?: string
          is_running?: boolean
          kill_switch_floor?: number
          loss_carryforward_cents?: number
          max_position_pct?: number
          max_positions?: number
          min_target_pct?: number
          mode?: Database["public"]["Enums"]["trade_mode"]
          paper_fee_bps?: number
          sentiment_weights?: Json
          stop_loss_pct?: number
          take_profit_pct?: number
          tax_country?: string
          tax_reserve_cents?: number
          timeframe?: string
          trailing_activate_pct?: number
          trailing_gap_pct?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          asset_universe?: Json
          capital_reference?: number
          created_at?: string
          daily_loss_limit_pct?: number
          enabled_sentiment_sources?: Json
          id?: string
          is_running?: boolean
          kill_switch_floor?: number
          loss_carryforward_cents?: number
          max_position_pct?: number
          max_positions?: number
          min_target_pct?: number
          mode?: Database["public"]["Enums"]["trade_mode"]
          paper_fee_bps?: number
          sentiment_weights?: Json
          stop_loss_pct?: number
          take_profit_pct?: number
          tax_country?: string
          tax_reserve_cents?: number
          timeframe?: string
          trailing_activate_pct?: number
          trailing_gap_pct?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      trade_fees: {
        Row: {
          cost: number | null
          created_at: string
          currency: string
          fee_cents: number
          id: string
          kraken_trade_id: string
          pair: string | null
          position_id: string | null
          raw: Json | null
          traded_at: string
          user_id: string
          volume: number | null
        }
        Insert: {
          cost?: number | null
          created_at?: string
          currency?: string
          fee_cents: number
          id?: string
          kraken_trade_id: string
          pair?: string | null
          position_id?: string | null
          raw?: Json | null
          traded_at: string
          user_id: string
          volume?: number | null
        }
        Update: {
          cost?: number | null
          created_at?: string
          currency?: string
          fee_cents?: number
          id?: string
          kraken_trade_id?: string
          pair?: string | null
          position_id?: string | null
          raw?: Json | null
          traded_at?: string
          user_id?: string
          volume?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "trade_fees_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      event_level: "info" | "warn" | "error"
      position_side: "long"
      position_status: "open" | "closed"
      trade_mode: "paper" | "live"
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
      event_level: ["info", "warn", "error"],
      position_side: ["long"],
      position_status: ["open", "closed"],
      trade_mode: ["paper", "live"],
    },
  },
} as const
