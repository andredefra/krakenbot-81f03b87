// Server functions for strategy preset management — allineato a STRATEGIA v2.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { deriveSentimentWeights, getPreset, type PresetId } from "./strategy-presets";

const presetSchema = z.object({
  preset: z.enum(["conservative", "balanced", "aggressive"]),
});

export const applyStrategyPreset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => presetSchema.parse(d))
  .handler(async ({ data, context }) => {
    const preset = getPreset(data.preset as PresetId);
    if (!preset.values) throw new Error("Preset senza valori");
    const v = preset.values;

    // Read current enabled sources to recompute weights
    const { data: current } = await context.supabase
      .from("settings")
      .select("enabled_sentiment_sources")
      .eq("user_id", context.userId)
      .maybeSingle();
    const enabled = (current?.enabled_sentiment_sources ?? {}) as Record<string, boolean>;
    const sentiment_weights = deriveSentimentWeights(preset.id, enabled);

    const patch = {
      // legacy + new fields tutti scritti
      core_satellite_split: v.core_satellite_split,
      core_weights: v.core_weights,
      min_volume_24h: v.min_volume_24h,
      max_spread_pct: v.max_spread_pct,
      min_listing_age_days: v.min_listing_age_days,
      macro_ma_period: v.macro_ma_period,
      mid_ma_period: v.mid_ma_period,
      fg_greed_cap: v.fg_greed_cap,
      max_satellite_positions: v.max_satellite_positions,
      risk_per_trade_pct: v.risk_per_trade_pct,
      stop_atr_mult: v.stop_atr_mult,
      stop_min_pct: v.stop_min_pct,
      trailing_activate_pct: v.trailing_activate_pct,
      trailing_gap_pct: v.trailing_gap_pct,
      take_profit_pct: v.take_profit_pct,
      min_target_pct: v.min_target_pct,
      monthly_trade_cap: v.monthly_trade_cap,
      cooldown_hours: v.cooldown_hours,
      daily_loss_limit_pct: v.daily_loss_limit_pct,
      timeframe: v.timeframe,
      max_positions: v.max_positions,
      max_position_pct: v.max_position_pct,
      stop_loss_pct: v.stop_loss_pct,
      sentiment_weights,
      strategy_preset: preset.id,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await context.supabase
      .from("settings")
      .update(patch as any)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    await context.supabase.from("events_log").insert({
      user_id: context.userId,
      level: "info",
      component: "strategy",
      message: `Preset v2 applicato: ${preset.name}`,
    });
    return { ok: true, preset: preset.id };
  });

// ============================================================================
// Toggle sentiment source — ricalcola e salva i pesi derivati dal preset attivo.
// ============================================================================
const toggleSchema = z.object({
  enabled: z.record(z.string(), z.boolean()),
});

export const toggleSentimentSources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => toggleSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: current, error: rerr } = await context.supabase
      .from("settings")
      .select("strategy_preset")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (rerr) throw new Error(rerr.message);
    const presetId = (current?.strategy_preset ?? "balanced") as PresetId;
    const sentiment_weights = deriveSentimentWeights(presetId, data.enabled);
    const { error } = await context.supabase
      .from("settings")
      .update({
        enabled_sentiment_sources: data.enabled,
        sentiment_weights,
      })
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true, weights: sentiment_weights };
  });
