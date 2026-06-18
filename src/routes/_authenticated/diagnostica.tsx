import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, CheckCircle2, XCircle, AlertCircle, Activity, Layers, Compass, Droplets, Sparkles } from "lucide-react";
import { getDiagnostics, type CandidateRow, type UniverseRow, type DiagnosticsPayload } from "@/lib/diagnostics.functions";

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
          <h1 className="text-2xl font-semibold tracking-tight">Diagnostica engine v3</h1>
          <p className="text-sm text-muted-foreground">Regimi macro/meso, Core / Satellite / Bear-DCA, universo dinamico, fee Kraken reali</p>
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

function Diag({ data }: { data: DiagnosticsPayload }) {
  const macroOn = data.macro.regime === "risk-on";
  const mesoOn = data.meso.regime === "risk-on";

  return (
    <>
      {/* MACRO + Core */}
      <Card className={macroOn ? "border-green-500/40" : "border-red-500/40"}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Compass className="size-5" /> Regime MACRO → Core
              </CardTitle>
              <CardDescription>BTC vs SMA200. Governa il sleeve Core (BTC/ETH o stable). Aggiornato: {data.cycleAt ? new Date(data.cycleAt).toLocaleString("it-IT") : "—"}</CardDescription>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Badge className={macroOn ? "bg-green-500/15 text-green-500 border-green-500/30" : "bg-red-500/15 text-red-500 border-red-500/30"} variant="outline">
                {macroOn ? "● RISK-ON" : "● RISK-OFF"}
              </Badge>
              <Badge variant="outline" className="text-xs">
                {data.core.invested ? "Core: INVESTITO" : "Core: IN STABLE"}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Kpi label="BTC" value={data.btcLast?.toLocaleString("it-IT", { maximumFractionDigits: 0 }) ?? "—"} suffix="USD" />
          <Kpi label="BTC SMA200" value={data.btcSma200?.toLocaleString("it-IT", { maximumFractionDigits: 0 }) ?? "—"} suffix="USD" />
          <Kpi label="Capitale Core" value={data.core.coreCapitalUsd?.toLocaleString("it-IT", { maximumFractionDigits: 0 }) ?? "—"} suffix="USD" />
          <Kpi label="Asset Core" value={Object.keys(data.core.targetWeights).join(" / ") || "—"} />
          <div className="col-span-2 md:col-span-4 text-sm bg-muted/30 rounded-md px-3 py-2 border border-border">
            <span className="font-medium">Motivo: </span>{data.macro.reason ?? "—"}
          </div>

          {data.core.held.length > 0 && (
            <div className="col-span-2 md:col-span-4">
              <div className="text-xs text-muted-foreground mb-1">Composizione Core (target vs reale)</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 border-b border-border">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Asset</th>
                      <th className="text-right px-3 py-2 font-medium">Qty</th>
                      <th className="text-right px-3 py-2 font-medium">Valore USD</th>
                      <th className="text-right px-3 py-2 font-medium">Peso target</th>
                      <th className="text-right px-3 py-2 font-medium">Peso reale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.core.held.map((h) => (
                      <tr key={h.asset} className="border-b border-border/50 last:border-0">
                        <td className="px-3 py-2 font-medium">{h.asset}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{h.qty.toLocaleString("it-IT", { maximumFractionDigits: 6 })}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{h.value_usd.toLocaleString("it-IT", { maximumFractionDigits: 2 })}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{(h.weight_target * 100).toFixed(1)}%</td>
                        <td className="px-3 py-2 text-right tabular-nums">{(h.weight_actual * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* MESO + Satellite */}
      <Card className={mesoOn ? "border-green-500/40" : "border-red-500/40"}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Activity className="size-5" /> Regime MEDIO → Satellite
              </CardTitle>
              <CardDescription>BTC vs SMA50 + Fear & Greed. Governa SOLO il sleeve Satellite (momentum).</CardDescription>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Badge className={mesoOn ? "bg-green-500/15 text-green-500 border-green-500/30" : "bg-red-500/15 text-red-500 border-red-500/30"} variant="outline">
                {mesoOn ? "● RISK-ON" : "● RISK-OFF"}
              </Badge>
              <Badge variant="outline" className="text-xs">
                Satellite: {data.satellite.open} / {data.satellite.max}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Kpi label="BTC SMA50" value={data.btcSma50?.toLocaleString("it-IT", { maximumFractionDigits: 0 }) ?? "—"} suffix="USD" />
          <Kpi label="Fear & Greed" value={data.fgValue?.toString() ?? "—"} suffix={data.fgLabel ?? ""} />
          <Kpi label="Pos. satellite" value={`${data.satellite.open} / ${data.satellite.max}`} />
          <Kpi label="Preset" value={data.settings?.strategy_preset ?? "—"} />
          <div className="col-span-2 md:col-span-4 text-sm bg-muted/30 rounded-md px-3 py-2 border border-border">
            <span className="font-medium">Motivo: </span>{data.meso.reason ?? "—"}
          </div>
        </CardContent>
      </Card>

      {/* BEAR-DCA accumulator */}
      <Card className={data.bearDca.active ? "border-blue-500/40" : ""}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Droplets className="size-5" /> Bear-DCA accumulator
              </CardTitle>
              <CardDescription>
                Tranche BTC quando macro = risk-off e F&G &lt; {data.bearDca.fgThreshold}. Si liquida al ritorno risk-on.
              </CardDescription>
            </div>
            <div className="flex flex-col items-end gap-1">
              {!data.bearDca.enabled ? (
                <Badge variant="outline" className="text-xs">DISABILITATO</Badge>
              ) : data.bearDca.active ? (
                <Badge className="bg-blue-500/15 text-blue-500 border-blue-500/30" variant="outline">
                  ● ACCUMULO IN CORSO
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs">In attesa</Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Kpi label="Deployato" value={`$${data.bearDca.deployedUsd.toLocaleString("it-IT", { maximumFractionDigits: 0 })}`} />
          <Kpi label="Cap massimo" value={`$${data.bearDca.capUsd.toLocaleString("it-IT", { maximumFractionDigits: 0 })}`} suffix={`${data.bearDca.capPct}%`} />
          <Kpi label="Tranche aperte" value={data.bearDca.tranches.toString()} />
          <Kpi label="Ultima azione" value={data.bearDca.lastActionAt ? new Date(data.bearDca.lastActionAt).toLocaleString("it-IT") : "—"} />
        </CardContent>
      </Card>

      {/* AI Supervisor */}
      <Card className="border-primary/30">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="size-5 text-primary" /> AI Supervisor
              </CardTitle>
              <CardDescription>
                Decide ogni ora i 3 flag strategici (core_only_mode, bear_dca_enabled, exclude_fiat_commodity) in base al preset attivo + condizioni di mercato.
              </CardDescription>
            </div>
            <div className="flex flex-col items-end gap-1">
              {data.aiSupervisor.confidence ? (
                <Badge variant="outline" className={
                  data.aiSupervisor.confidence === "high" ? "bg-green-500/15 text-green-500 border-green-500/30" :
                  data.aiSupervisor.confidence === "medium" ? "bg-amber-500/15 text-amber-500 border-amber-500/30" :
                  "bg-muted text-muted-foreground"
                }>
                  Confidence: {data.aiSupervisor.confidence}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs">In attesa primo run</Badge>
              )}
              {data.aiSupervisor.changedFlags.length > 0 && (
                <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/30">
                  Ultimo ciclo: {data.aiSupervisor.changedFlags.length} flag cambiato/i
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <FlagRow label="Core-only" on={data.aiSupervisor.decision?.core_only_mode ?? !!data.settings?.core_only_mode} changed={data.aiSupervisor.changedFlags.includes("core_only_mode")} />
            <FlagRow label="Bear-DCA" on={data.aiSupervisor.decision?.bear_dca_enabled ?? !!data.settings?.bear_dca_enabled} changed={data.aiSupervisor.changedFlags.includes("bear_dca_enabled")} />
            <FlagRow label="Escludi fiat/oro" on={data.aiSupervisor.decision?.exclude_fiat_commodity ?? !!data.settings?.exclude_fiat_commodity} changed={data.aiSupervisor.changedFlags.includes("exclude_fiat_commodity")} />

          </div>
          {data.aiSupervisor.reasoning && (
            <div className="text-sm bg-muted/30 rounded-md px-3 py-2 border border-border">
              <span className="font-medium">Motivazione: </span>{data.aiSupervisor.reasoning}
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            Ultimo run: {data.aiSupervisor.lastRunAt ? new Date(data.aiSupervisor.lastRunAt).toLocaleString("it-IT") : "mai (cron orario)"}
          </div>
        </CardContent>
      </Card>

      {/* Bot status */}
      <Card>
        <CardHeader><CardTitle className="text-base">Stato bot</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Kpi label="Running" value={data.settings?.is_running ? "Sì" : "No"} />
          <Kpi label="Modalità" value={data.settings?.mode?.toUpperCase() ?? "—"} />
          <Kpi label="Max satellite" value={data.settings?.core_only_mode ? "CORE-ONLY" : (data.settings?.max_satellite_positions?.toString() ?? "—")} />
          <Kpi label="Pos. aperte" value={`${data.openPositions}`} />
          <Kpi label="Fee totali pagate" value={`$${data.totalFeesUsd.toLocaleString("it-IT", { maximumFractionDigits: 2 })}`} />
          <Kpi label="Preset" value={data.settings?.strategy_preset ?? "—"} />
          <Kpi label="Filtro fiat/oro" value={data.settings?.exclude_fiat_commodity ? "Attivo" : "Off"} />
          <Kpi label="Bear-DCA" value={data.settings?.bear_dca_enabled ? "On" : "Off"} />
        </CardContent>
      </Card>

      {/* Universo dinamico */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Layers className="size-4" /> Universo dinamico</CardTitle>
          <CardDescription>Asset Kraken filtrati per volume e spread. Sorgente: tabella <code>public.universe</code> (cron <code>universe-scanner</code>, ~2h).</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {data.universe.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Nessun asset eligible. Lo scanner non ha ancora popolato l'universo (usa fallback statico).
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 border-b border-border">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Asset</th>
                    <th className="text-right px-4 py-2 font-medium">Volume 24h</th>
                    <th className="text-right px-4 py-2 font-medium">Spread</th>
                    <th className="text-right px-4 py-2 font-medium">Età</th>
                    <th className="text-center px-4 py-2 font-medium">Eligible</th>
                  </tr>
                </thead>
                <tbody>
                  {data.universe.map((u: UniverseRow) => (
                    <tr key={u.asset} className="border-b border-border/50 last:border-0">
                      <td className="px-4 py-2 font-medium">{u.asset}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{u.volume_24h != null ? `$${Math.round(u.volume_24h).toLocaleString("it-IT")}` : "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{u.spread_pct != null ? `${u.spread_pct.toFixed(3)}%` : "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{u.age_days != null ? `${u.age_days}d` : "—"}</td>
                      <td className="px-4 py-2 text-center">{u.eligible ? <CheckCircle2 className="size-4 text-green-500 inline" /> : <XCircle className="size-4 text-muted-foreground inline" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Candidati satellite valutati */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Candidati satellite valutati nell'ultimo ciclo</CardTitle>
          <CardDescription>Solo asset dell'universo eligible. Mostra perché ognuno è stato (o non è stato) aperto.</CardDescription>
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

      {data.notes && (
        <Card><CardContent className="py-3 text-sm text-muted-foreground"><AlertCircle className="size-4 inline mr-2" />{data.notes}</CardContent></Card>
      )}

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

function FlagRow({ label, on, changed }: { label: string; on: boolean; changed: boolean }) {
  return (
    <div className={`flex items-center justify-between rounded-md border px-3 py-2 ${changed ? "border-blue-500/40 bg-blue-500/5" : "border-border bg-muted/20"}`}>
      <div className="text-sm font-medium">{label}</div>
      <div className="flex items-center gap-2">
        {changed && <span className="text-[10px] uppercase tracking-wide text-blue-400">cambiato</span>}
        <Badge variant="outline" className={on ? "bg-green-500/15 text-green-500 border-green-500/30" : "bg-muted text-muted-foreground"}>
          {on ? "ON" : "OFF"}
        </Badge>
      </div>
    </div>
  );
}
