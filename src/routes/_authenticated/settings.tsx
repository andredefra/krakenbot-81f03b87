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
  {
    title: "Commissioni reali Kraken (v4 — usate anche dal backtest)",
    fields: [
      { key: "maker_fee_pct", label: "Maker fee", suffix: "%", help: "Default Kraken Pro: 0.25%" },
      { key: "taker_fee_pct", label: "Taker fee", suffix: "%", help: "Default Kraken Pro: 0.40% — il backtest USA questi valori" },
      { key: "slippage_pct", label: "Slippage stimato", suffix: "%", help: "Default 0.05% per lato" },
    ],
  },
  {
    title: "Bear-DCA (opzionale — default OFF, attivare solo dopo backtest)",
    fields: [
      { key: "bear_dca_fg_threshold", label: "Soglia Fear & Greed (deep fear)", help: "Default 22 — accumula sotto questo valore" },
      { key: "bear_dca_cap_pct", label: "Tetto allocazione DCA", suffix: "% del core", help: "Default 30%" },
      { key: "bear_dca_tranche_pct", label: "Dimensione tranche", suffix: "% capitale", help: "Default 5%" },
      { key: "bear_dca_interval_days", label: "Intervallo tra tranche", suffix: "giorni", help: "Default 14" },
    ],
  },
];

// AI-managed flags (core_only_mode, bear_dca_enabled, exclude_fiat_commodity)
// are NOT exposed here — they are decided automatically by the AI Supervisor
// (hourly cron) based on the active preset + market conditions.
// Read-only view available in /diagnostica.

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
      const patch: Record<string, number | string | boolean> = { timeframe };
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
  const storedPresetId = (q.data?.strategy_preset ?? null) as PresetId | null;
  const storedPreset = storedPresetId && storedPresetId !== "custom" ? getPreset(storedPresetId) : null;
  // Disallineato = il preset salvato in `strategy_preset` non corrisponde più ai valori effettivi
  const isMisaligned = !!storedPreset && currentPresetId === "custom";

  const applyPresetFn = useServerFn(applyStrategyPreset);
  const realign = useMutation({
    mutationFn: async () => {
      if (!storedPresetId || storedPresetId === "custom") throw new Error("Nessun preset da riallineare");
      await applyPresetFn({ data: { preset: storedPresetId } });
    },
    onSuccess: () => {
      toast.success(`Valori riallineati al preset ${storedPreset?.name ?? ""}`);
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Errore riallineamento"),
  });

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Impostazioni rischio</h1>
        <p className="text-sm text-muted-foreground">Parametri della <strong>Strategia v4 multi-asset</strong> (Core-Led 70/30 default Bilanciato, fee Kraken reali, Bear-DCA opzionale). Modificabili in qualsiasi momento.</p>
      </div>

      {q.data && (
        <Card className={isMisaligned ? "border-amber-500/60" : currentPresetId === "custom" ? "border-amber-500/50" : "border-primary/40"}>
          <CardContent className="py-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              {isMisaligned || currentPresetId === "custom"
                ? <AlertTriangle className="size-5 text-amber-500 shrink-0" />
                : <Sparkles className="size-5 text-primary shrink-0" />}
              <div>
                {isMisaligned ? (
                  <>
                    <div className="font-medium text-sm">
                      Preset disallineato: dichiarato <span className="text-primary">{storedPreset!.name}</span>
                      <Badge variant="outline" className="ml-2 border-amber-500/50 text-amber-500">valori modificati</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      I valori salvati non corrispondono più al preset {storedPreset!.name}. Riallineali per tornare al default v4.
                    </div>
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isMisaligned && (
                <Button
                  size="sm"
                  onClick={() => realign.mutate()}
                  disabled={realign.isPending}
                >
                  <RefreshCw className={`size-4 mr-1 ${realign.isPending ? "animate-spin" : ""}`} />
                  Riallinea al preset
                </Button>
              )}
              <Button asChild variant="outline" size="sm">
                <Link to="/strategia">Vai a Strategia →</Link>
              </Button>
            </div>
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

          <Card className="border-primary/30 bg-primary/5">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="size-4 text-primary" /> Interruttori strategici — gestiti dall'AI
              </CardTitle>
              <CardDescription>
                <strong>core_only_mode</strong>, <strong>bear_dca_enabled</strong> e <strong>exclude_fiat_commodity</strong> sono decisi automaticamente ogni ora dall'<em>AI Supervisor</em> in base al preset attivo (Conservative/Balanced/Aggressive) e alle condizioni di mercato live (regime macro, F&G, drawdown).
                Stato corrente e motivazione visibili in <Link to="/diagnostica" className="text-primary underline">Diagnostica</Link>.
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Timeframe</CardTitle>
              <CardDescription>v4 raccomandato: 4h o daily (meno rumore, meno fee).</CardDescription>
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
