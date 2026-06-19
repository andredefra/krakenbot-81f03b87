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
import { Info, Plug, CheckCircle2, XCircle } from "lucide-react";
import { deriveSentimentWeights, type PresetId } from "@/lib/strategy-presets";
import { toggleSentimentSources } from "@/lib/strategy.functions";
import { getMarketDataStatus } from "@/lib/diagnostics.functions";

export const Route = createFileRoute("/_authenticated/sentiment")({
  component: SentimentPage,
});

const SOURCES: { key: string; label: string; description: string }[] = [
  { key: "fear_greed", label: "Fear & Greed (Alternative.me)", description: "Indice di mercato crypto. Gratuito, gate di regime — consigliato sempre attivo." },
  { key: "lunarcrush", label: "LunarCrush", description: "Galaxy Score, social volume crypto. Conferma sui trade satellite. Richiede API key." },
  { key: "santiment", label: "Santiment", description: "On-chain + social crypto. Conferma sui trade satellite. Richiede API key." },
  { key: "finnhub_news", label: "Finnhub News & Earnings", description: "Sentiment fondamentale stocks/xStocks (news, earnings, analyst rating). Richiede FINNHUB_API_KEY." },
  { key: "alpha_vantage_news", label: "Alpha Vantage News Sentiment", description: "Sentiment news stocks + forex (fallback / cross-check). Richiede ALPHA_VANTAGE_API_KEY." },
  { key: "news", label: "Notizie generiche", description: "Aggregatore news non specializzato (sperimentale)." },
];

type MarketDataRow = { key: string; label: string; description: string; configured: boolean };

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

  const fetchStatus = useServerFn(getMarketDataStatus);
  const statusQ = useQuery({
    queryKey: ["market-data-status"],
    queryFn: () => fetchStatus(),
    refetchOnWindowFocus: false,
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
  const previewWeights = deriveSentimentWeights(presetId, enabled);

  const onToggle = (key: string, v: boolean) => {
    const next = { ...enabled, [key]: v };
    setEnabled(next);
    saveMut.mutate(next);
  };

  const marketRows: MarketDataRow[] = [
    { key: "kraken", label: "Kraken", description: "Crypto prezzi + saldi + ordini reali. Richiede KRAKEN_API_KEY + KRAKEN_API_SECRET.", configured: !!statusQ.data?.kraken },
    { key: "finnhub", label: "Finnhub", description: "Prezzi stocks/xStocks (BHV4, AAPLx…) + forex primario.", configured: !!statusQ.data?.finnhub },
    { key: "alpha_vantage", label: "Alpha Vantage", description: "Forex (fallback) + stocks fallback quando Finnhub manca il simbolo.", configured: !!statusQ.data?.alphaVantage },
  ];

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sentiment & Fonti dati</h1>
        <p className="text-sm text-muted-foreground">
          Strategia v4 multi-asset. Le fonti sentiment hanno pesi <strong>derivati automaticamente</strong> dal preset attivo (
          <span className="text-foreground">{presetId}</span>) e ribilanciati sulle sole sorgenti attive. Le fonti dati di mercato sono infrastruttura (non toggle-abili).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Plug className="size-5" /> Fonti dati di mercato</CardTitle>
          <CardDescription>Stato delle API key per i prezzi reali. Senza queste, le rispettive classi d'asset restano in PAPER.</CardDescription>
        </CardHeader>
        <CardContent>
          {statusQ.isLoading ? (
            <div className="space-y-3">{marketRows.map((r) => <Skeleton key={r.key} className="h-16 w-full" />)}</div>
          ) : (
            <div className="space-y-3">
              {marketRows.map((r) => (
                <div key={r.key} className="flex items-center justify-between gap-4 p-4 rounded-lg border border-border bg-card/50">
                  <div className="min-w-0">
                    <div className="font-medium">{r.label}</div>
                    <div className="text-xs text-muted-foreground">{r.description}</div>
                  </div>
                  <div className="shrink-0">
                    {r.configured ? (
                      <Badge variant="outline" className="bg-green-500/15 text-green-500 border-green-500/30">
                        <CheckCircle2 className="size-3 mr-1" /> Configurato
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-red-500/15 text-red-500 border-red-500/30">
                        <XCircle className="size-3 mr-1" /> API key mancante
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="py-3 flex items-start gap-2 text-xs">
          <Info className="size-4 text-primary mt-0.5 shrink-0" />
          <div>
            <div className="font-medium text-foreground">Perché i pesi non sono editabili?</div>
            <div className="text-muted-foreground mt-0.5">
              La Strategia v4 deriva i pesi dal preset attivo. Fear &amp; Greed è anche il <strong>gate del Bear-DCA</strong> (sotto la soglia <code>bear_dca_fg_threshold</code>, default 22, accumula tranche BTC).
              LunarCrush/Santiment confermano i <strong>satellite crypto</strong>. Finnhub News e Alpha Vantage News forniscono il sentiment fondamentale per <strong>stocks/xStocks e forex</strong>.
              Per cambiare i pesi, cambia preset dalla pagina <strong>Strategia</strong>.
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fonti sentiment</CardTitle>
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
