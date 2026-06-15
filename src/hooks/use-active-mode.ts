import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type TradeMode = "paper" | "live";

/**
 * Returns the currently active trading mode (paper/live).
 * Live-updates via Supabase realtime on the settings table.
 */
export function useActiveMode(): { mode: TradeMode; isLoading: boolean } {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["settings", "active-mode"],
    queryFn: async () => {
      const { data, error } = await supabase.from("settings").select("mode").maybeSingle();
      if (error) throw error;
      return (data?.mode ?? "paper") as TradeMode;
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("settings-active-mode")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "settings" },
        () => qc.invalidateQueries({ queryKey: ["settings", "active-mode"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  return { mode: q.data ?? "paper", isLoading: q.isLoading };
}
