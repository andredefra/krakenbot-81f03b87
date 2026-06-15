import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatUsd, formatPct, pnlClass } from "@/lib/format";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TrendingUp, TrendingDown, Activity, Gauge } from "lucide-react";
import { useActiveMode } from "@/hooks/use-active-mode";

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

  const regimeQuery = useQuery({
    queryKey: ["sentiment", "regime", "latest"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sentiment_snapshots")
        .select("ts,score,raw")
        .eq("source", "regime")
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
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

  const regimeRaw = (regimeQuery.data?.raw ?? null) as { label?: string } | null;
  const regimeLabel = regimeRaw?.label ?? (regimeQuery.data?.score === 1 ? "risk-on" : regimeQuery.data?.score === 0 ? "risk-off" : "—");
  const fgRaw = (fgQuery.data?.raw ?? null) as { classification?: string } | null;
  const fgLabel = fgRaw?.classification ?? "—";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Stato attuale del portafoglio e del motore</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
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
        <KpiCard
          title="Regime / F&G"
          icon={<Activity className="size-4" />}
          value={regimeLabel}
          sub={fgQuery.data?.score != null ? `F&G ${Math.round(fgQuery.data.score)} · ${fgLabel}` : "F&G —"}
          loading={fgQuery.isLoading || regimeQuery.isLoading}
        />
      </div>

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
  const filtered = useMemo(() => {
    if (tf.ms === null) return snapshots;
    const cutoff = Date.now() - tf.ms;
    return snapshots.filter((s) => new Date(s.ts).getTime() >= cutoff);
  }, [snapshots, tf.ms]);

  if (filtered.length < 2) {
    return (
      <div className="h-72 grid place-items-center text-sm text-muted-foreground text-center px-4">
        {snapshots.length < 2
          ? "Nessuno snapshot ancora — il motore creerà i dati a ogni ciclo cron."
          : `Pochi dati nell'intervallo ${tf.label}. Prova un timeframe più ampio.`}
      </div>
    );
  }

  const showTime = timeframe === "1H" || timeframe === "1D";
  const showYear = timeframe === "1Y" || timeframe === "ALL";
  const tickFmt = (v: string) => {
    const d = new Date(v);
    if (showTime) return d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
    if (showYear) return d.toLocaleDateString("it-IT", { month: "short", year: "2-digit" });
    return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
  };

  return (
    <div className="h-72 -ml-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={filtered} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="pv" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.45} />
              <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="ts"
            tickFormatter={tickFmt}
            stroke="var(--color-muted-foreground)"
            fontSize={11}
            minTickGap={40}
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
            labelFormatter={(v) => new Date(v as string).toLocaleString("it-IT")}
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
