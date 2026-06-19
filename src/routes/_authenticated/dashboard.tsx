import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { formatUsd, formatPct, pnlClass } from "@/lib/format";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TrendingUp, TrendingDown, Compass, Activity, Gauge, AlertCircle } from "lucide-react";
import { useActiveMode } from "@/hooks/use-active-mode";
import { getDiagnostics } from "@/lib/diagnostics.functions";
import { getLivePortfolio } from "@/lib/portfolio.functions";
import { PortfolioPieChart } from "@/components/dashboard/PortfolioPieChart";

type Timeframe = "1H" | "1D" | "1M" | "3M" | "1Y" | "ALL";
const TIMEFRAMES: { key: Timeframe; label: string; ms: number | null }[] = [
  { key: "1H", label: "1H", ms: 60 * 60 * 1000 },
  { key: "1D", label: "1G", ms: 24 * 60 * 60 * 1000 },
  { key: "1M", label: "1M", ms: 30 * 24 * 60 * 60 * 1000 },
  { key: "3M", label: "3M", ms: 90 * 24 * 60 * 60 * 1000 },
  { key: "1Y", label: "1A", ms: 365 * 24 * 60 * 60 * 1000 },
  { key: "ALL", label: "Tutto", ms: null },
];

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { mode } = useActiveMode();
  const [timeframe, setTimeframe] = useState<Timeframe>("1D");
  const snapshotsQuery = useQuery({
    queryKey: ["portfolio_snapshots", "recent", mode],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("portfolio_snapshots")
        .select("ts,total_value,cash_value,positions_value,realized_pnl_day")
        .eq("mode", mode)
        .order("ts", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []).slice().reverse();
    },
  });

  const fgQuery = useQuery({
    queryKey: ["sentiment", "fear_greed", "latest"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sentiment_snapshots")
        .select("ts,score,raw")
        .eq("source", "fear_greed")
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const fetchDiag = useServerFn(getDiagnostics);
  const diagQuery = useQuery({
    queryKey: ["diagnostics", "dashboard"],
    queryFn: () => fetchDiag(),
    refetchInterval: 60_000,
  });

  const fetchPortfolio = useServerFn(getLivePortfolio);
  const portfolioQuery = useQuery({
    queryKey: ["live-portfolio", mode],
    queryFn: () => fetchPortfolio(),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    const channel = supabase
      .channel("dashboard-portfolio")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "portfolio_snapshots" },
        () => snapshotsQuery.refetch(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const snapshots = snapshotsQuery.data ?? [];
  const latest = snapshots[snapshots.length - 1];
  const dayAgo = findClosest(snapshots, 24 * 60 * 60 * 1000);
  const weekAgo = findClosest(snapshots, 7 * 24 * 60 * 60 * 1000);
  const dayDelta = latest && dayAgo ? latest.total_value - dayAgo.total_value : null;
  const dayDeltaPct = latest && dayAgo && dayAgo.total_value > 0 ? ((latest.total_value - dayAgo.total_value) / dayAgo.total_value) * 100 : null;
  const weekDelta = latest && weekAgo ? latest.total_value - weekAgo.total_value : null;
  const weekDeltaPct = latest && weekAgo && weekAgo.total_value > 0 ? ((latest.total_value - weekAgo.total_value) / weekAgo.total_value) * 100 : null;

  const fgRaw = (fgQuery.data?.raw ?? null) as { classification?: string } | null;
  const fgLabel = fgRaw?.classification ?? "—";

  const diag = diagQuery.data;
  const macroOn = diag?.macro.regime === "risk-on";
  const mesoOn = diag?.meso.regime === "risk-on";
  const coreAssets = diag ? Object.entries(diag.core.targetWeights).map(([a, w]) => `${a} ${Math.round((w as number) * 100)}%`).join(" / ") : "";
  const eligibleCount = diag?.universe.filter((u) => u.eligible).length ?? 0;
  const universeEmpty = diag?.hasSnapshot && eligibleCount === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Stato attuale del portafoglio e del motore (v3 Core-Led + Satellite + Bear-DCA)</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        <KpiCard
          title="Valore portafoglio"
          icon={<Gauge className="size-4" />}
          value={formatUsd(latest?.total_value ?? null)}
          loading={snapshotsQuery.isLoading}
        />
        <KpiCard
          title="Variazione 24h"
          icon={dayDelta && dayDelta >= 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
          value={dayDelta === null ? "—" : formatUsd(dayDelta, { signed: true })}
          sub={dayDeltaPct === null ? undefined : formatPct(dayDeltaPct, { signed: true })}
          valueClass={pnlClass(dayDelta)}
          loading={snapshotsQuery.isLoading}
        />
        <KpiCard
          title="Variazione 7g"
          icon={weekDelta && weekDelta >= 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
          value={weekDelta === null ? "—" : formatUsd(weekDelta, { signed: true })}
          sub={weekDeltaPct === null ? undefined : formatPct(weekDeltaPct, { signed: true })}
          valueClass={pnlClass(weekDelta)}
          loading={snapshotsQuery.isLoading}
        />
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Macro → Core</CardTitle>
            <Compass className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {diagQuery.isLoading ? (
              <Skeleton className="h-7 w-28" />
            ) : !diag?.hasSnapshot ? (
              <div className="text-sm text-muted-foreground">—</div>
            ) : (
              <>
                <Badge variant="outline" className={macroOn ? "bg-green-500/15 text-green-500 border-green-500/30" : "bg-red-500/15 text-red-500 border-red-500/30"}>
                  ● {macroOn ? "RISK-ON" : "RISK-OFF"}
                </Badge>
                <div className="text-xs text-muted-foreground mt-2" title={diag.macro.reason ?? ""}>
                  Core: {diag.core.invested ? `INVESTITO (${coreAssets})` : "IN STABLE"}
                </div>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Meso → Satellite</CardTitle>
            <Activity className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {diagQuery.isLoading ? (
              <Skeleton className="h-7 w-28" />
            ) : !diag?.hasSnapshot ? (
              <div className="text-sm text-muted-foreground">—</div>
            ) : (
              <>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge variant="outline" className={mesoOn ? "bg-green-500/15 text-green-500 border-green-500/30" : "bg-red-500/15 text-red-500 border-red-500/30"}>
                    ● {mesoOn ? "RISK-ON" : "RISK-OFF"}
                  </Badge>
                  {diag.bearDca.active && (
                    <Badge variant="outline" className="bg-blue-500/15 text-blue-400 border-blue-500/30 text-xs">
                      ● ACCUMULO IN CORSO
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-2" title={diag.meso.reason ?? ""}>
                  {diag.settings?.core_only_mode ? "Core-only" : `Satellite ${diag.satellite.open}/${diag.satellite.max}`} · F&G {fgQuery.data?.score != null ? Math.round(fgQuery.data.score) : "—"} {fgLabel !== "—" ? `(${fgLabel})` : ""}
                  {diag.bearDca.active && diag.bearDca.capUsd > 0 && (
                    <> · DCA ${Math.round(diag.bearDca.deployedUsd)}/${Math.round(diag.bearDca.capUsd)}</>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {diag && diag.totalFeesUsd > 0 && (
        <div className="text-xs text-muted-foreground">
          Fee Kraken totali pagate (tutte le posizioni): <span className="font-medium text-foreground">{formatUsd(diag.totalFeesUsd)}</span>
        </div>
      )}

      {universeEmpty && (
        <div className="flex items-center gap-2 text-sm text-amber-500 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2">
          <AlertCircle className="size-4" />
          Universo dinamico vuoto — il satellite usa il fallback statico. Controlla lo scanner.
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-2 flex-wrap">
          <CardTitle>Andamento del portafoglio</CardTitle>
          <div className="inline-flex rounded-md border border-border bg-muted/30 p-0.5">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.key}
                onClick={() => setTimeframe(tf.key)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                  timeframe === tf.key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {snapshotsQuery.isLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : (
            <ChartView snapshots={snapshots} timeframe={timeframe} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ChartView({ snapshots, timeframe }: { snapshots: { ts: string; total_value: number }[]; timeframe: Timeframe }) {
  const tf = TIMEFRAMES.find((t) => t.key === timeframe)!;

  const { data, domain, ticks } = useMemo(() => {
    const now = Date.now();
    const allPoints = snapshots.map((s) => ({ t: new Date(s.ts).getTime(), total_value: s.total_value }));
    let start: number;
    if (tf.ms === null) {
      start = allPoints.length > 0 ? allPoints[0].t : now - 24 * 60 * 60 * 1000;
    } else {
      start = now - tf.ms;
    }
    const filtered = allPoints.filter((p) => p.t >= start);
    const tickCount = 6;
    const step = (now - start) / (tickCount - 1);
    const ticks = Array.from({ length: tickCount }, (_, i) => Math.round(start + step * i));
    return { data: filtered, domain: [start, now] as [number, number], ticks };
  }, [snapshots, tf.ms]);

  if (snapshots.length === 0) {
    return (
      <div className="h-72 grid place-items-center text-sm text-muted-foreground text-center px-4">
        Nessuno snapshot ancora — il motore creerà i dati a ogni ciclo cron.
      </div>
    );
  }

  const showTime = timeframe === "1H" || timeframe === "1D";
  const showYear = timeframe === "1Y" || timeframe === "ALL";
  const tickFmt = (v: number) => {
    const d = new Date(v);
    if (showTime) return d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
    if (showYear) return d.toLocaleDateString("it-IT", { month: "short", year: "numeric" });
    return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
  };

  return (
    <div className="h-72 -ml-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="pv" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.45} />
              <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={domain}
            ticks={ticks}
            tickFormatter={tickFmt}
            stroke="var(--color-muted-foreground)"
            fontSize={11}
          />
          <YAxis
            tickFormatter={(v) => `$${Number(v).toFixed(0)}`}
            stroke="var(--color-muted-foreground)"
            fontSize={11}
            width={56}
          />
          <Tooltip
            contentStyle={{
              background: "var(--color-popover)",
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(v) => new Date(v as number).toLocaleString("it-IT")}
            formatter={(v: number) => [formatUsd(v), "Totale"]}
          />
          <Area type="monotone" dataKey="total_value" stroke="var(--color-chart-1)" strokeWidth={2} fill="url(#pv)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function findClosest(arr: { ts: string; total_value: number }[], msAgo: number) {
  if (arr.length === 0) return null;
  const target = Date.now() - msAgo;
  let best = arr[0];
  let bestDiff = Math.abs(new Date(best.ts).getTime() - target);
  for (const s of arr) {
    const d = Math.abs(new Date(s.ts).getTime() - target);
    if (d < bestDiff) {
      best = s;
      bestDiff = d;
    }
  }
  return best;
}

function KpiCard(props: {
  title: string;
  value: string;
  sub?: string;
  icon?: React.ReactNode;
  valueClass?: string;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{props.title}</CardTitle>
        <div className="text-muted-foreground">{props.icon}</div>
      </CardHeader>
      <CardContent>
        {props.loading ? (
          <Skeleton className="h-7 w-28" />
        ) : (
          <>
            <div className={`text-2xl font-semibold tabular ${props.valueClass ?? ""}`}>{props.value}</div>
            {props.sub && <div className="text-xs text-muted-foreground mt-1 tabular">{props.sub}</div>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
