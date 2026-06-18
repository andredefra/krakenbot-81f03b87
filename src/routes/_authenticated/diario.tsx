import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listReports } from "@/lib/ai-supervisor.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, AlertTriangle, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/_authenticated/diario")({
  component: DiarioPage,
});

function DiarioPage() {
  const fetchReports = useServerFn(listReports);
  const q = useQuery({
    queryKey: ["ai-reports"],
    queryFn: () => fetchReports({ data: { limit: 30 } }),
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Sparkles className="size-6 text-primary" /> Diario AI
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cosa ha osservato l'AI Supervisor — ora per ora. Nessuna modifica viene mai applicata da sola.
          </p>
        </div>
      </div>

      {q.isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 w-full" />)}</div>
      ) : (q.data ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Nessun report ancora. Il cron orario genererà il primo a breve.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {(q.data ?? []).map((r) => {
            const market = r.market_snapshot as Record<string, unknown> | null;
            const self = r.self_snapshot as Record<string, unknown> | null;
            const anomalies = (r.anomalies as string[]) ?? [];
            const propCount = (r.proposals_generated as string[] | null)?.length ?? 0;
            return (
              <Card key={r.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <CardTitle className="text-base">
                        {new Date(r.created_at).toLocaleString("it-IT")}
                      </CardTitle>
                      <CardDescription className="text-xs">{r.period}</CardDescription>
                    </div>
                    <div className="flex gap-2">
                      {propCount > 0 && (
                        <Link to="/proposte">
                          <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/30 hover:bg-blue-500/25">
                            {propCount} proposta/e <ExternalLink className="size-3 ml-1" />
                          </Badge>
                        </Link>
                      )}
                      {anomalies.length > 0 && (
                        <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/30">
                          <AlertTriangle className="size-3 mr-1" /> {anomalies.length} anomalia/e
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p className="leading-relaxed">{r.narrative}</p>

                  {anomalies.length > 0 && (
                    <div className="bg-amber-500/5 border border-amber-500/20 rounded-md p-3">
                      <div className="text-xs font-medium text-amber-500 mb-1">Anomalie</div>
                      <ul className="list-disc list-inside space-y-1 text-xs">
                        {anomalies.map((a, i) => <li key={i}>{a}</li>)}
                      </ul>
                    </div>
                  )}

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <Mini label="Macro" value={(market?.macro_regime as string) ?? "—"} />
                    <Mini label="F&G" value={market?.fg_value != null ? `${market.fg_value}` : "—"} />
                    <Mini label="BTC vs SMA200" value={market?.btc_vs_sma200_pct != null ? `${market.btc_vs_sma200_pct}%` : "—"} />
                    <Mini label="Preset" value={(self?.preset as string) ?? "—"} />
                    <Mini label="Trade 30g" value={`${self?.closed_trades_30d ?? 0}`} />
                    <Mini label="Win rate" value={self?.win_rate_30d_pct != null ? `${self.win_rate_30d_pct}%` : "—"} />
                    <Mini label="PF 30g" value={`${self?.profit_factor_30d ?? "—"}`} />
                    <Mini label="DD 30g" value={self?.drawdown_30d_pct != null ? `${self.drawdown_30d_pct}%` : "—"} />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/30 rounded px-2 py-1.5 border border-border">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
