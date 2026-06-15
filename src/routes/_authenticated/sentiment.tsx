import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/sentiment")({
  component: SentimentPage,
});

const SOURCES: { key: string; label: string; description: string }[] = [
  { key: "fear_greed", label: "Fear & Greed (Alternative.me)", description: "Indice di mercato. Gratuito, consigliato sempre attivo." },
  { key: "lunarcrush", label: "LunarCrush", description: "Galaxy Score, social volume. Richiede API key." },
  { key: "santiment", label: "Santiment", description: "On-chain + social. Richiede API key." },
  { key: "news", label: "Notizie", description: "Aggregatore news (opzionale)." },
];

function SentimentPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["settings", "sentiment"],
    queryFn: async () => {
      const { data, error } = await supabase.from("settings").select("id,enabled_sentiment_sources,sentiment_weights").maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [weights, setWeights] = useState<Record<string, string>>({});

  useEffect(() => {
    if (q.data) {
      setEnabled((q.data.enabled_sentiment_sources ?? {}) as Record<string, boolean>);
      const w = (q.data.sentiment_weights ?? {}) as Record<string, number>;
      const map: Record<string, string> = {};
      for (const k of Object.keys(w)) map[k] = String(w[k]);
      setWeights(map);
    }
  }, [q.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!q.data) throw new Error("Nessuna riga settings");
      const w: Record<string, number> = {};
      for (const k of Object.keys(weights)) {
        const n = Number(weights[k]);
        if (Number.isNaN(n)) throw new Error(`Peso non valido per ${k}`);
        w[k] = n;
      }
      const { error } = await supabase
        .from("settings")
        .update({ enabled_sentiment_sources: enabled, sentiment_weights: w })
        .eq("id", q.data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Sentiment salvato");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Errore"),
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sentiment</h1>
        <p className="text-sm text-muted-foreground">Accendi/spegni le fonti e regola il peso di ciascuna.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Fonti</CardTitle>
          <CardDescription>Se spegni tutto, il bot opera in modalità solo tecnica.</CardDescription>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <div className="space-y-3">
              {SOURCES.map((s) => (
                <Skeleton key={s.key} className="h-16 w-full" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {SOURCES.map((s) => (
                <div key={s.key} className="flex items-center justify-between gap-4 p-4 rounded-lg border border-border bg-card/50">
                  <div className="min-w-0">
                    <div className="font-medium">{s.label}</div>
                    <div className="text-xs text-muted-foreground">{s.description}</div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Peso</span>
                      <Input
                        type="number"
                        step="0.05"
                        min="0"
                        max="2"
                        className="w-20 h-8"
                        value={weights[s.key] ?? ""}
                        onChange={(e) => setWeights((m) => ({ ...m, [s.key]: e.target.value }))}
                      />
                    </div>
                    <Switch
                      checked={!!enabled[s.key]}
                      onCheckedChange={(v) => setEnabled((m) => ({ ...m, [s.key]: v }))}
                    />
                  </div>
                </div>
              ))}
              <div className="flex justify-end pt-2">
                <Button onClick={() => save.mutate()} disabled={save.isPending}>
                  {save.isPending ? "Salvo…" : "Salva sentiment"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
