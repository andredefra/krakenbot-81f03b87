import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, CheckCircle2, XCircle, AlertCircle, Activity } from "lucide-react";
import { getDiagnostics, type CandidateRow } from "@/lib/diagnostics.functions";

export const Route = createFileRoute("/_authenticated/diagnostica")({
  component: DiagnosticaPage,
});

function DiagnosticaPage() {
  const fetchFn = useServerFn(getDiagnostics);
  const q = useQuery({
    queryKey: ["diagnostics"],
    queryFn: () => fetchFn(),
    refetchOnWindowFocus: false,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Diagnostica engine</h1>
          <p className="text-sm text-muted-foreground">Cosa sta facendo (o non facendo) il bot in questo momento</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={`size-4 ${q.isFetching ? "animate-spin" : ""}`} />
          Aggiorna
        </Button>
      </div>

      {q.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : !q.data ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Errore caricamento diagnostica</CardContent></Card>
      ) : !q.data.hasSnapshot ? (
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <AlertCircle className="size-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Nessun snapshot diagnostica disponibile.</p>
            <p className="text-xs text-muted-foreground">L'engine scrive qui dopo il primo ciclo (max 5 min se il bot è avviato).</p>
          </CardContent>
        </Card>
      ) : (
        <Diag data={q.data} />
      )}
    </div>
  );
}

function Diag({ data }: { data: NonNullable<ReturnType<typeof getDiagnostics>> extends Promise<infer R> ? R : never }) {
  const riskOn = data.regime === "risk-on";
  return (
    <>
      {/* Regime card */}
      <Card className={riskOn ? "border-green-500/40" : "border-red-500/40"}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Activity className="size-5" />
                Regime di mercato
              </CardTitle>
              <CardDescription>Aggiornato: {data.cycleAt ? new Date(data.cycleAt).toLocaleString("it-IT") : "—"}</CardDescription>
            </div>
            <Badge className={riskOn ? "bg-green-500/15 text-green-500 border-green-500/30" : "bg-red-500/15 text-red-500 border-red-500/30"} variant="outline">
              {riskOn ? "● RISK-ON" : "● RISK-OFF"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Kpi label="BTC" value={data.btcLast?.toLocaleString("it-IT", { maximumFractionDigits: 0 }) ?? "—"} suffix="USD" />
          <Kpi label="BTC SMA50" value={data.btcSma50?.toLocaleString("it-IT", { maximumFractionDigits: 0 }) ?? "—"} suffix="USD" />
          <Kpi label="Fear & Greed" value={data.fgValue?.toString() ?? "—"} suffix={data.fgLabel ?? ""} />
          <Kpi label="Posizioni aperte" value={`${data.openPositions} / ${data.settings?.max_positions ?? "?"}`} />
          <div className="col-span-2 md:col-span-4 text-sm bg-muted/30 rounded-md px-3 py-2 border border-border">
            <span className="font-medium">Motivo: </span>{data.regimeReason ?? "—"}
          </div>
        </CardContent>
      </Card>

      {/* Bot status */}
      <Card>
        <CardHeader><CardTitle className="text-base">Stato bot</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Kpi label="Running" value={data.settings?.is_running ? "Sì" : "No"} />
          <Kpi label="Modalità" value={data.settings?.mode?.toUpperCase() ?? "—"} />
          <Kpi label="Preset" value={data.settings?.strategy_preset ?? "—"} />
          <Kpi label="Filtro regime" value={data.settings?.regime_filter ?? "—"} />
        </CardContent>
      </Card>

      {/* Candidates */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Candidati valutati nell'ultimo ciclo</CardTitle>
          <CardDescription>Per ogni asset i filtri applicati e il motivo per cui non è stato aperto</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {data.candidates.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Nessun candidato valutato</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 border-b border-border">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Asset</th>
                    <th className="text-right px-4 py-2 font-medium">Prezzo</th>
                    <th className="text-right px-4 py-2 font-medium">SMA20</th>
                    <th className="text-right px-4 py-2 font-medium">SMA50</th>
                    <th className="text-center px-4 py-2 font-medium">Trend</th>
                    <th className="text-left px-4 py-2 font-medium">Esito / motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {data.candidates.map((c: CandidateRow) => (
                    <tr key={c.asset} className="border-b border-border/50 last:border-0">
                      <td className="px-4 py-2 font-medium">{c.asset}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{c.price?.toLocaleString("it-IT", { maximumFractionDigits: 4 }) ?? "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{c.sma20?.toLocaleString("it-IT", { maximumFractionDigits: 4 }) ?? "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{c.sma50?.toLocaleString("it-IT", { maximumFractionDigits: 4 }) ?? "—"}</td>
                      <td className="px-4 py-2 text-center">{c.trendOk ? <CheckCircle2 className="size-4 text-green-500 inline" /> : <XCircle className="size-4 text-muted-foreground inline" />}</td>
                      <td className="px-4 py-2">
                        {c.opened ? (
                          <Badge className="bg-green-500/15 text-green-500 border-green-500/30" variant="outline">APERTA</Badge>
                        ) : (
                          <span className="text-muted-foreground">{c.reasonSkipped ?? "—"}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {data.lastEngineMessage && (
        <Card>
          <CardHeader><CardTitle className="text-base">Ultimo evento engine</CardTitle></CardHeader>
          <CardContent>
            <div className="text-sm">{data.lastEngineMessage}</div>
            <div className="text-xs text-muted-foreground mt-1">{data.lastEngineAt ? new Date(data.lastEngineAt).toLocaleString("it-IT") : ""}</div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

function Kpi({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">
        {value}
        {suffix && <span className="text-xs text-muted-foreground ml-1">{suffix}</span>}
      </div>
    </div>
  );
}
