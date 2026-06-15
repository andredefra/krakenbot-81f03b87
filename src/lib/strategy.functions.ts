// Server functions for strategy preset management.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { getPreset, type PresetId } from "./strategy-presets";

const presetSchema = z.object({
  preset: z.enum(["conservative", "balanced", "aggressive"]),
});

export const applyStrategyPreset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => presetSchema.parse(d))
  .handler(async ({ data, context }) => {
    const preset = getPreset(data.preset as PresetId);
    if (!preset.values) throw new Error("Preset senza valori");
    const patch = {
      ...preset.values,
      strategy_preset: preset.id,
    };
    const { error } = await context.supabase
      .from("settings")
      .update(patch)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    await context.supabase.from("events_log").insert({
      user_id: context.userId,
      level: "info",
      component: "strategy",
      message: `Preset applicato: ${preset.name}`,
    });
    return { ok: true, preset: preset.id };
  });
