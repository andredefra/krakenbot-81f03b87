import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { AlertTriangle, Sparkles } from "lucide-react";
import { detectPreset, getPreset } from "@/lib/strategy-presets";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

const FIELDS: { key: string; label: string; suffix?: string; help?: string }[] = [
  { key: "capital_reference", label: "Capitale di riferimento", suffix: "USD" },
  { key: "kill_switch_floor", label: "Kill-switch (stop globale)", suffix: "USD", help: "Bot spento se il valore scende sotto" },
  { key: "max_positions", label: "Max posizioni contemporanee" },
  { key: "max_position_pct", label: "Dimensione max per posizione", suffix: "%" },
  { key: "stop_loss_pct", label: "Stop loss per trade", suffix: "%" },
  { key: "trailing_activate_pct", label: "Trailing — attivazione a", suffix: "%" },
  { key: "trailing_gap_pct", label: "Trailing — gap dal massimo", suffix: "%" },
  { key: "take_profit_pct", label: "Take-profit parziale", suffix: "%" },
  { key: "min_target_pct", label: "Target minimo per aprire", suffix: "%" },
  { key: "daily_loss_limit_pct", label: "Limite perdita giornaliero", suffix: "%" },
];

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
  const [timeframe, setTimeframe] = useState("1h");

  useEffect(() => {
    if (q.data) {
      const next: Record<string, string> = {};
      for (const f of FIELDS) next[f.key] = String((q.data as Record<string, unknown>)[f.key] ?? "");
      setForm(next);
      setTimeframe(q.data.timeframe ?? "1h");
    }
  }, [q.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!q.data) throw new Error("Nessuna riga settings");
      const patch: Record<string, number | string> = { timeframe };
      for (const f of FIELDS) {
        const n = Number(form[f.key]);
        if (Number.isNaN(n)) throw new Error(`Valore non valido: ${f.label}`);
        patch[f.key] = n;
      }
      // Detect preset: include unchanged fields (fg_greed_cap, regime_filter) from current row
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
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Impostazioni rischio</h1>
        <p className="text-sm text-muted-foreground">Parametri della strategia (modificabili in qualsiasi momento)</p>
      </div>

      {q.data && (
        <Card className={currentPresetId === "custom" ? "border-amber-500/50" : "border-primary/40"}>
          <CardContent className="py-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              {currentPresetId === "custom" ? (
                <AlertTriangle className="size-5 text-amber-500 shrink-0" />
              ) : (
                <Sparkles className="size-5 text-primary shrink-0" />
              )}
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

      <Card>
        <CardHeader>
          <CardTitle>Parametri</CardTitle>
          <CardDescription>
            Modificando un valore qui, se non corrisponde più a un preset, il sistema lo marcherà come <strong>Custom</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <form
              className="grid grid-cols-1 md:grid-cols-2 gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate();
              }}
            >
              {FIELDS.map((f) => (
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
              <div className="space-y-1.5">
                <Label htmlFor="timeframe">Timeframe segnali</Label>
                <Input id="timeframe" value={timeframe} onChange={(e) => setTimeframe(e.target.value)} placeholder="1h" />
                <p className="text-xs text-muted-foreground">Es. 1h o 4h. Swing, non scalping.</p>
              </div>
              <div className="md:col-span-2 flex justify-end pt-2">
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? "Salvo…" : "Salva impostazioni"}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
