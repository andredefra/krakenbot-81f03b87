import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatUsd, formatPct, pnlClass } from "@/lib/format";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TrendingUp, TrendingDown, Activity, Gauge } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const snapshotsQuery = useQuery({
    queryKey: ["portfolio_snapshots", "recent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("portfolio_snapshots")
        .select("ts,total_value,cash_value,positions_value,realized_pnl_day")
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
        <CardHeader>
          <CardTitle>Andamento del portafoglio</CardTitle>
        </CardHeader>
        <CardContent>
          {snapshotsQuery.isLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : snapshots.length < 2 ? (
            <div className="h-72 grid place-items-center text-sm text-muted-foreground">
              Nessuno snapshot ancora — il motore creerà i dati a ogni ciclo cron.
            </div>
          ) : (
            <div className="h-72 -ml-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={snapshots} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="pv" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="ts"
                    tickFormatter={(v) => new Date(v).toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}
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
                    labelFormatter={(v) => new Date(v as string).toLocaleString("it-IT")}
                    formatter={(v: number) => [formatUsd(v), "Totale"]}
                  />
                  <Area type="monotone" dataKey="total_value" stroke="var(--color-chart-1)" strokeWidth={2} fill="url(#pv)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
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
