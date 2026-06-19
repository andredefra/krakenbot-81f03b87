import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, ArrowLeft, RefreshCw } from "lucide-react";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatUsd } from "@/lib/format";
import type { PortfolioResult, PortfolioClassSlice, AssetClass } from "@/lib/portfolio.functions";

const CLASS_LABELS: Record<AssetClass, string> = {
  crypto: "Crypto",
  stocks: "Azioni",
  futures: "Futures",
  forex: "Forex",
  cash: "Cash",
};

const CLASS_COLORS: Record<AssetClass, string> = {
  crypto: "var(--color-chart-1)",
  stocks: "var(--color-chart-2)",
  futures: "var(--color-chart-3)",
  forex: "var(--color-chart-4)",
  cash: "var(--color-chart-5)",
};

const ITEM_PALETTE = [
  "var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)",
  "var(--color-chart-4)", "var(--color-chart-5)",
  "#8b5cf6", "#06b6d4", "#f97316", "#84cc16", "#ec4899",
];

type Props = {
  data: PortfolioResult | undefined;
  loading: boolean;
  onRefresh: () => void;
};

export function PortfolioPieChart({ data, loading, onRefresh }: Props) {
  const [drillClass, setDrillClass] = useState<AssetClass | null>(null);

  const pieData = useMemo(() => {
    if (!data || !data.ok) return [];
    if (drillClass) {
      const slice = data.classes.find((c) => c.assetClass === drillClass);
      return (slice?.items ?? []).filter((i) => i.valueUsd > 0).map((i, idx) => ({
        name: i.symbol,
        value: i.valueUsd,
        color: ITEM_PALETTE[idx % ITEM_PALETTE.length],
        sub: i.priceUsd != null ? `${i.qty.toLocaleString("it-IT", { maximumFractionDigits: 6 })} @ ${formatUsd(i.priceUsd)}` : `${i.qty}`,
      }));
    }
    return data.classes.filter((c) => c.valueUsd > 0).map((c) => ({
      name: CLASS_LABELS[c.assetClass],
      value: c.valueUsd,
      color: CLASS_COLORS[c.assetClass],
      classKey: c.assetClass,
      sub: `${c.items.length} ${c.items.length === 1 ? "asset" : "asset"}`,
    }));
  }, [data, drillClass]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-2 flex-wrap">
        <div>
          <CardTitle className="flex items-center gap-2">
            Composizione portafoglio
            {data?.ok && (
              <Badge variant="outline" className={data.source === "kraken-live" ? "bg-green-500/15 text-green-500 border-green-500/30" : "bg-amber-500/15 text-amber-500 border-amber-500/30"}>
                {data.source === "kraken-live" ? "● LIVE Kraken" : "● PAPER simulato"}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            {drillClass
              ? <>Dettaglio: <strong>{CLASS_LABELS[drillClass]}</strong> · clicca "Indietro" per tornare alla vista generale</>
              : "Vista per asset class. Clicca uno spicchio per il dettaglio."}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {drillClass && (
            <Button variant="outline" size="sm" onClick={() => setDrillClass(null)}>
              <ArrowLeft className="size-4" /> Indietro
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-72 w-full" />
        ) : !data ? (
          <EmptyState message="Caricamento dati portfolio…" />
        ) : !data.ok ? (
          <PortfolioError data={data} />
        ) : pieData.length === 0 ? (
          <EmptyState message={data.source === "paper" ? "Portfolio paper vuoto. L'engine non ha ancora aperto posizioni." : "Nessun saldo trovato sul conto Kraken."} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%" cy="50%"
                    innerRadius={50} outerRadius={95}
                    paddingAngle={2}
                    onClick={(d) => {
                      if (!drillClass && (d as { classKey?: AssetClass }).classKey) {
                        setDrillClass((d as { classKey: AssetClass }).classKey);
                      }
                    }}
                    style={{ cursor: drillClass ? "default" : "pointer" }}
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} stroke="var(--color-background)" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-popover)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8, fontSize: 12,
                    }}
                    formatter={(v: number, _n, ctx) => [`${formatUsd(v)} (${((v / data.totalValueUsd) * 100).toFixed(1)}%)`, ctx.payload.name]}
                  />
                  <Legend verticalAlign="bottom" height={28} wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Totale</div>
              <div className="text-3xl font-semibold tabular-nums">{formatUsd(data.totalValueUsd)}</div>
              <div className="text-xs text-muted-foreground">
                aggiornato {new Date(data.fetchedAt).toLocaleString("it-IT")}
              </div>
              <div className="space-y-1 mt-3">
                {pieData.map((p, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-between text-sm rounded-md px-2 py-1.5 ${!drillClass && (p as { classKey?: AssetClass }).classKey ? "cursor-pointer hover:bg-muted/50" : ""}`}
                    onClick={() => {
                      if (!drillClass && (p as { classKey?: AssetClass }).classKey) {
                        setDrillClass((p as { classKey: AssetClass }).classKey);
                      }
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="size-2.5 rounded-sm" style={{ background: p.color }} />
                      <span className="font-medium">{p.name}</span>
                      <span className="text-xs text-muted-foreground">{p.sub}</span>
                    </div>
                    <div className="tabular-nums">{formatUsd(p.value)} <span className="text-xs text-muted-foreground">({((p.value / data.totalValueUsd) * 100).toFixed(1)}%)</span></div>
                  </div>
                ))}
              </div>
              {data.warnings.length > 0 && (
                <div className="text-xs text-amber-500 mt-2">
                  {data.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="h-72 grid place-items-center text-sm text-muted-foreground text-center px-4">
      {message}
    </div>
  );
}

function PortfolioError({ data }: { data: Extract<PortfolioResult, { ok: false }> }) {
  return (
    <div className="rounded-md border border-red-500/40 bg-red-500/5 p-4 space-y-2">
      <div className="flex items-start gap-2">
        <AlertCircle className="size-5 text-red-500 mt-0.5" />
        <div className="flex-1">
          <div className="font-semibold text-red-500">
            Impossibile recuperare il saldo da Kraken
          </div>
          <div className="text-sm mt-1">{data.error.message}</div>
          {data.error.hint && (
            <div className="text-sm text-amber-400 mt-2">💡 {data.error.hint}</div>
          )}
          <div className="text-xs text-muted-foreground mt-2">
            Codice: <code>{data.error.code}</code>
            {data.error.httpStatus ? ` · HTTP ${data.error.httpStatus}` : ""}
          </div>
        </div>
      </div>
      <div className="text-xs text-muted-foreground border-t border-border pt-2">
        ⚠️ <strong>Non viene mostrato alcun valore di portafoglio</strong> finché non risolvi l'errore.
        Un bot di trading non deve mai mostrare numeri simulati come reali.
      </div>
    </div>
  );
}

export default PortfolioPieChart;
