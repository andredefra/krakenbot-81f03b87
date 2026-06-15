import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Info } from "lucide-react";
import { deriveSentimentWeights, type PresetId } from "@/lib/strategy-presets";
import { toggleSentimentSources } from "@/lib/strategy.functions";

export const Route = createFileRoute("/_authenticated/sentiment")({
  component: SentimentPage,
});

const SOURCES: { key: string; label: string; description: string }[] = [
  { key: "fear_greed", label: "Fear & Greed (Alternative.me)", description: "Indice di mercato. Gratuito, gate di regime — consigliato sempre attivo." },
  { key: "lunarcrush", label: "LunarCrush", description: "Galaxy Score, social volume. Conferma sui trade satellite. Richiede API key." },
  { key: "santiment", label: "Santiment", description: "On-chain + social. Conferma sui trade satellite. Richiede API key." },
  { key: "news", label: "Notizie", description: "Aggregatore news (sperimentale)." },
];

function SentimentPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["settings", "sentiment"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("settings")
        .select("id,enabled_sentiment_sources,sentiment_weights,strategy_preset")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (q.data) setEnabled((q.data.enabled_sentiment_sources ?? {}) as Record<string, boolean>);
  }, [q.data]);

  const toggleFn = useServerFn(toggleSentimentSources);
  const saveMut = useMutation({
    mutationFn: (next: Record<string, boolean>) => toggleFn({ data: { enabled: next } }),
    onSuccess: () => {
      toast.success("Fonti aggiornate — pesi ricalcolati");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Errore"),
  });

  const presetId = (q.data?.strategy_preset ?? "balanced") as PresetId;
  // Preview locale dei pesi al cambio toggle (server farà la stessa cosa al salvataggio)
  const previewWeights = deriveSentimentWeights(presetId, enabled);

  const onToggle = (key: string, v: boolean) => {
    const next = { ...enabled, [key]: v };
    setEnabled(next);
    saveMut.mutate(next);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sentiment</h1>
        <p className="text-sm text-muted-foreground">
          Accendi/spegni le fonti. I pesi sono <strong>derivati automaticamente</strong> dal preset attivo (
          <span className="text-foreground">{presetId}</span>) e ribilanciati sulle sole sorgenti attive.
        </p>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="py-3 flex items-start gap-2 text-xs">
          <Info className="size-4 text-primary mt-0.5 shrink-0" />
          <div>
            <div className="font-medium text-foreground">Perché i pesi non sono più editabili?</div>
            <div className="text-muted-foreground mt-0.5">
              La Strategia v2 sceglie da sé l'intensità di ciascuna fonte in base al profilo di rischio.
              Conservativo → più peso al Fear &amp; Greed (gate forte). Aggressivo → più peso al social (cogliere momentum).
              Per cambiarli, cambia preset dalla pagina <strong>Strategia</strong>.
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fonti</CardTitle>
          <CardDescription>Se spegni tutto, il bot opera in modalità solo tecnica (nessun gate di sentiment).</CardDescription>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <div className="space-y-3">
              {SOURCES.map((s) => <Skeleton key={s.key} className="h-16 w-full" />)}
            </div>
          ) : (
            <div className="space-y-3">
              {SOURCES.map((s) => {
                const w = previewWeights[s.key] ?? 0;
                return (
                  <div key={s.key} className="flex items-center justify-between gap-4 p-4 rounded-lg border border-border bg-card/50">
                    <div className="min-w-0">
                      <div className="font-medium">{s.label}</div>
                      <div className="text-xs text-muted-foreground">{s.description}</div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Badge variant="outline" className="tabular-nums">
                        peso {(w * 100).toFixed(0)}%
                      </Badge>
                      <Switch
                        checked={!!enabled[s.key]}
                        disabled={saveMut.isPending}
                        onCheckedChange={(v) => onToggle(s.key, v)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
