import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { AlertTriangle, Sparkles, RefreshCw } from "lucide-react";
import { detectPreset, getPreset, type PresetId } from "@/lib/strategy-presets";
import { applyStrategyPreset } from "@/lib/strategy.functions";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

type Section = {
  title: string;
  fields: { key: string; label: string; suffix?: string; help?: string }[];
};

const SECTIONS: Section[] = [
  {
    title: "Capitale e protezioni globali",
    fields: [
      { key: "capital_reference", label: "Capitale di riferimento", suffix: "USD" },
      { key: "kill_switch_floor", label: "Kill-switch (stop globale)", suffix: "USD", help: "Bot spento se il valore scende sotto" },
      { key: "daily_loss_limit_pct", label: "Limite perdita giornaliero", suffix: "%" },
    ],
  },
  {
    title: "Filtri universo (cancelli liquidità)",
    fields: [
      { key: "min_volume_24h", label: "Volume 24h minimo", suffix: "USD", help: "Solo asset con almeno questo volume diventano eleggibili" },
      { key: "max_spread_pct", label: "Spread massimo", suffix: "%", help: "Spread bid-ask oltre cui l'asset viene escluso" },
      { key: "min_listing_age_days", label: "Età minima dalla quotazione", suffix: "giorni" },
    ],
  },
  {
    title: "Satellite — gestione posizione",
    fields: [
      { key: "max_satellite_positions", label: "Max posizioni satellite" },
      { key: "risk_per_trade_pct", label: "Rischio per trade", suffix: "%", help: "% del portafoglio a rischio in caso di stop colpito" },
      { key: "stop_atr_mult", label: "Moltiplicatore ATR per lo stop", help: "Stop = max(stop_min, mult × ATR)" },
      { key: "stop_min_pct", label: "Stop minimo (floor)", suffix: "%" },
      { key: "trailing_activate_pct", label: "Trailing — attivazione a", suffix: "%" },
      { key: "trailing_gap_pct", label: "Trailing — gap dal massimo", suffix: "%" },
      { key: "take_profit_pct", label: "Take-profit parziale", suffix: "%" },
      { key: "min_target_pct", label: "Target minimo per aprire", suffix: "%" },
    ],
  },
  {
    title: "Disciplina commissioni",
    fields: [
      { key: "monthly_trade_cap", label: "Tetto trade satellite / mese" },
      { key: "cooldown_hours", label: "Cooldown stesso asset", suffix: "h" },
    ],
  },
  {
    title: "Regime e sentiment",
    fields: [
      { key: "macro_ma_period", label: "Periodo media macro (BTC)", suffix: "giorni" },
      { key: "mid_ma_period", label: "Periodo media medio (BTC)", suffix: "giorni" },
      { key: "fg_greed_cap", label: "Fear & Greed cap (gate satellite)" },
    ],
  },
];

const ALL_FIELDS = SECTIONS.flatMap((s) => s.fields);

function SettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["settings", "full"],
    queryFn: async () => {
      const { data, error } = await supabase.from("settings").select("*").maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [form, setForm] = useState<Record<string, string>>({});
  const [timeframe, setTimeframe] = useState("4h");

  useEffect(() => {
    if (q.data) {
      const next: Record<string, string> = {};
      for (const f of ALL_FIELDS) next[f.key] = String((q.data as Record<string, unknown>)[f.key] ?? "");
      setForm(next);
      setTimeframe(q.data.timeframe ?? "4h");
    }
  }, [q.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!q.data) throw new Error("Nessuna riga settings");
      const patch: Record<string, number | string> = { timeframe };
      for (const f of ALL_FIELDS) {
        const n = Number(form[f.key]);
        if (Number.isNaN(n)) throw new Error(`Valore non valido: ${f.label}`);
        patch[f.key] = n;
      }
      const merged = { ...(q.data as Record<string, unknown>), ...patch };
      const newPreset = detectPreset(merged);
      patch.strategy_preset = newPreset;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await supabase.from("settings").update(patch as any).eq("id", q.data.id);
      if (error) throw error;
      return newPreset;
    },
    onSuccess: (newPreset) => {
      const presetName = getPreset(newPreset).name;
      toast.success(
        newPreset === "custom"
          ? "Impostazioni salvate — preset impostato su Custom"
          : `Impostazioni salvate — preset: ${presetName}`,
      );
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Errore salvataggio"),
  });

  const currentPresetId = q.data ? detectPreset(q.data as Record<string, unknown>) : "balanced";
  const currentPreset = getPreset(currentPresetId);

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Impostazioni rischio</h1>
        <p className="text-sm text-muted-foreground">Parametri della Strategia v2 (Core-Satellite). Modificabili in qualsiasi momento.</p>
      </div>

      {q.data && (
        <Card className={currentPresetId === "custom" ? "border-amber-500/50" : "border-primary/40"}>
          <CardContent className="py-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              {currentPresetId === "custom"
                ? <AlertTriangle className="size-5 text-amber-500 shrink-0" />
                : <Sparkles className="size-5 text-primary shrink-0" />}
              <div>
                <div className="font-medium text-sm">
                  Preset attivo: <span className="text-primary">{currentPreset.name}</span>
                  {currentPresetId === "custom" && (
                    <Badge variant="outline" className="ml-2 border-amber-500/50 text-amber-500">Custom</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {currentPresetId === "custom"
                    ? "Valori modificati a mano — non corrispondono a nessun preset"
                    : currentPreset.tagline}
                </div>
              </div>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/strategia">Vai a Strategia →</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {q.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : (
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          {SECTIONS.map((sec) => (
            <Card key={sec.title}>
              <CardHeader>
                <CardTitle className="text-base">{sec.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {sec.fields.map((f) => (
                    <div key={f.key} className="space-y-1.5">
                      <Label htmlFor={f.key}>
                        {f.label}
                        {f.suffix && <span className="text-muted-foreground"> ({f.suffix})</span>}
                      </Label>
                      <Input
                        id={f.key}
                        type="number"
                        step="any"
                        value={form[f.key] ?? ""}
                        onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                      />
                      {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Timeframe</CardTitle>
              <CardDescription>v2 raccomandato: 4h o daily (meno rumore).</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-w-xs space-y-1.5">
                <Label htmlFor="timeframe">Timeframe segnali</Label>
                <Input id="timeframe" value={timeframe} onChange={(e) => setTimeframe(e.target.value)} placeholder="4h" />
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Salvo…" : "Salva impostazioni"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
