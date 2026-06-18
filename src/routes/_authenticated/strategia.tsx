import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Shield, Scale, Flame, Settings as SettingsIcon, TrendingUp, RefreshCw, ChevronDown, Coins, LogIn, LogOut, ThumbsUp, ThumbsDown } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { PRESETS, type PresetId, type StrategyPreset } from "@/lib/strategy-presets";
import { applyStrategyPreset } from "@/lib/strategy.functions";
import { runBacktestFn } from "@/lib/backtest.functions";

export const Route = createFileRoute("/_authenticated/strategia")({
  component: StrategiaPage,
});

const ICONS: Record<PresetId, typeof Shield> = {
  conservative: Shield,
  balanced: Scale,
  aggressive: Flame,
  custom: SettingsIcon,
};

function StrategiaPage() {
  const qc = useQueryClient();
  const settingsQ = useQuery({
    queryKey: ["settings", "strategy"],
    queryFn: async () => {
      const { data, error } = await supabase.from("settings").select("*").maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const apply = useServerFn(applyStrategyPreset);
  const applyMut = useMutation({
    mutationFn: (preset: PresetId) => apply({ data: { preset: preset as "conservative" | "balanced" | "aggressive" } }),
    onSuccess: () => {
      toast.success("Preset v2 applicato — parametri e pesi sentiment aggiornati");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Errore"),
  });

  const [pending, setPending] = useState<PresetId | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Strategia</h1>
        <p className="text-sm text-muted-foreground">
          Strategia v2 <strong>Core-Satellite</strong> su universo Kraken dinamico. Cambia preset e i parametri della pagina Rischio (più i pesi sentiment) si riallineano.
          <span className="block mt-1 text-xs">⚠️ I trade già aperti mantengono i loro stop. Solo i nuovi useranno il preset.</span>
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {PRESETS.filter((p) => p.id !== "custom").map((p) => (
          <PresetCard
            key={p.id}
            preset={p}
            current={settingsQ.data?.strategy_preset === p.id}
            onApply={() => setPending(p.id)}
          />
        ))}
      </div>

      {settingsQ.data?.strategy_preset === "custom" && (
        <Card className="border-amber-500/40">
          <CardContent className="py-4 flex items-center justify-between">
            <div>
              <div className="font-medium">Stai usando parametri custom</div>
              <div className="text-xs text-muted-foreground">Hai modificato i valori a mano dalla pagina Rischio</div>
            </div>
            <Badge variant="outline">Custom</Badge>
          </CardContent>
        </Card>
      )}

      <BacktestSection />

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Applicare preset {pending && PRESETS.find((p) => p.id === pending)?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {pending && settingsQ.data && <DiffTable current={settingsQ.data} preset={PRESETS.find((p) => p.id === pending)!} />}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pending) {
                  applyMut.mutate(pending);
                  setPending(null);
                }
              }}
            >
              Applica
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PresetCard({ preset, current, onApply }: { preset: StrategyPreset; current: boolean; onApply: () => void }) {
  const Icon = ICONS[preset.id];
  const v = preset.values!;
  const coreSplit = v.core_satellite_split.core;
  return (
    <Card className={current ? "border-primary" : ""}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <Icon className="size-6 text-primary" />
          {current && <Badge>Attuale</Badge>}
        </div>
        <CardTitle className="mt-2">{preset.name}</CardTitle>
        <CardDescription>{preset.tagline}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Stat label="Core / Sat." value={`${Math.round(coreSplit * 100)}/${Math.round((1 - coreSplit) * 100)}`} />
          <Stat label="Max pos sat." value={v.max_satellite_positions.toString()} />
          <Stat label="Rischio/trade" value={`${v.risk_per_trade_pct}%`} />
          <Stat label="Target min" value={`+${v.min_target_pct}%`} />
          <Stat label="Trade/mese" value={`≤ ${v.monthly_trade_cap}`} />
          <Stat label="Cooldown" value={`${v.cooldown_hours}h`} />
        </div>
        <div className="flex gap-2 text-xs flex-wrap">
          <Badge variant="outline">Rischio {preset.risk}</Badge>
          <Badge variant="outline">Varianza {preset.variance}</Badge>
          <Badge variant="outline">F&amp;G ≤ {v.fg_greed_cap}</Badge>
        </div>
        <Button onClick={onApply} disabled={current} className="w-full" variant={current ? "outline" : "default"}>
          {current ? "Già attivo" : "Applica preset"}
        </Button>
        {preset.description && <PresetRecap d={preset.description} />}
      </CardContent>
    </Card>
  );
}

function PresetRecap({ d }: { d: NonNullable<StrategyPreset["description"]> }) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex w-full items-center justify-between text-xs text-muted-foreground hover:text-foreground transition py-1.5 border-t border-border/40">
        <span className="font-medium">Cosa prevede questa strategia</span>
        <ChevronDown className="size-3.5 group-data-[state=open]:rotate-180 transition" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-2 text-xs">
        <p className="text-muted-foreground leading-relaxed">{d.summary}</p>
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 font-medium"><Coins className="size-3.5" /> Asset</div>
          <div className="flex flex-wrap gap-1">
            {d.assets.map((a) => <Badge key={a} variant="secondary" className="text-[10px] font-normal">{a}</Badge>)}
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 font-medium"><LogIn className="size-3.5 text-green-500" /> Quando entra (satellite)</div>
          <ul className="space-y-0.5 text-muted-foreground pl-1">
            {d.entryRules.map((r) => <li key={r}>• {r}</li>)}
          </ul>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 font-medium"><LogOut className="size-3.5 text-red-500" /> Quando esce</div>
          <ul className="space-y-0.5 text-muted-foreground pl-1">
            {d.exitRules.map((r) => <li key={r}>• {r}</li>)}
          </ul>
        </div>
        <div className="grid grid-cols-1 gap-2 pt-1">
          <div className="flex items-start gap-1.5">
            <ThumbsUp className="size-3.5 text-green-500 shrink-0 mt-0.5" />
            <div><span className="font-medium">Ideale per:</span> <span className="text-muted-foreground">{d.idealFor}</span></div>
          </div>
          <div className="flex items-start gap-1.5">
            <ThumbsDown className="size-3.5 text-red-500 shrink-0 mt-0.5" />
            <div><span className="font-medium">Evita se:</span> <span className="text-muted-foreground">{d.avoidIf}</span></div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/40">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Drawdown atteso</div>
            <div className="font-medium tabular-nums">{d.expectedDrawdown}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Trade / mese</div>
            <div className="font-medium tabular-nums">{d.tradesPerMonth}</div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-border/40 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

function DiffTable({ current, preset }: { current: Record<string, unknown>; preset: StrategyPreset }) {
  const v = preset.values!;
  const coreSplit = v.core_satellite_split.core;
  const curSplit = ((current.core_satellite_split ?? {}) as { core?: number }).core;
  const rows: Array<{ label: string; cur: string; next: string; changed: boolean }> = [
    { label: "Core / Satellite", cur: curSplit != null ? `${Math.round(Number(curSplit) * 100)}/${Math.round((1 - Number(curSplit)) * 100)}` : "—", next: `${Math.round(coreSplit * 100)}/${Math.round((1 - coreSplit) * 100)}`, changed: Number(curSplit) !== coreSplit },
    diffRow("Max pos satellite", current.max_satellite_positions, v.max_satellite_positions),
    diffRow("Rischio per trade", current.risk_per_trade_pct, v.risk_per_trade_pct, "%"),
    diffRow("Stop ATR mult", current.stop_atr_mult, v.stop_atr_mult, "×"),
    diffRow("Stop min", current.stop_min_pct, v.stop_min_pct, "%"),
    diffRow("Trailing att.", current.trailing_activate_pct, v.trailing_activate_pct, "%"),
    diffRow("Trailing gap", current.trailing_gap_pct, v.trailing_gap_pct, "%"),
    diffRow("Take profit", current.take_profit_pct, v.take_profit_pct, "%"),
    diffRow("Target min", current.min_target_pct, v.min_target_pct, "%"),
    diffRow("Trade/mese", current.monthly_trade_cap, v.monthly_trade_cap),
    diffRow("Cooldown", current.cooldown_hours, v.cooldown_hours, "h"),
    diffRow("F&G cap", current.fg_greed_cap, v.fg_greed_cap),
    diffRow("Daily loss", current.daily_loss_limit_pct, v.daily_loss_limit_pct, "%"),
  ];
  return (
    <div className="mt-3 border border-border rounded-md overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-muted/30">
          <tr><th className="text-left px-3 py-2">Parametro</th><th className="text-right px-3 py-2">Attuale</th><th className="text-right px-3 py-2">Nuovo</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className={`border-t border-border/40 ${r.changed ? "bg-primary/5" : ""}`}>
              <td className="px-3 py-1.5">{r.label}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{r.cur}</td>
              <td className="px-3 py-1.5 text-right tabular-nums font-medium">{r.next}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function diffRow(label: string, cur: unknown, next: unknown, suffix = ""): { label: string; cur: string; next: string; changed: boolean } {
  return {
    label,
    cur: cur != null && cur !== "" ? `${cur}${suffix}` : "—",
    next: `${next}${suffix}`,
    changed: String(cur) !== String(next),
  };
}

// ============ Backtest section ============

function BacktestSection() {
  const [preset, setPreset] = useState<"conservative" | "balanced" | "aggressive">("balanced");
  const [years, setYears] = useState<1 | 3 | 5>(3);
  const [universe, setUniverse] = useState<"core" | "core_sleeve">("core_sleeve");
  const [startCapital, setStartCapital] = useState<number>(200);

  const run = useServerFn(runBacktestFn);
  const runMut = useMutation({
    mutationFn: () => run({ data: { preset, years, universe, startCapital } }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Errore backtest"),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2"><TrendingUp className="size-5" /> Backtest storico</CardTitle>
            <CardDescription>Strategia v3 vs BTC Buy &amp; Hold, DCA, Trend, Trend+BearDCA e S&amp;P 500</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Preset</label>
            <Select value={preset} onValueChange={(v) => setPreset(v as typeof preset)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="conservative">Conservativo</SelectItem>
                <SelectItem value="balanced">Bilanciato</SelectItem>
                <SelectItem value="aggressive">Aggressivo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Periodo</label>
            <Select value={String(years)} onValueChange={(v) => setYears(parseInt(v) as 1 | 3 | 5)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 anno</SelectItem>
                <SelectItem value="3">3 anni</SelectItem>
                <SelectItem value="5">5 anni</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Universo satellite</label>
            <Select value={universe} onValueChange={(v) => setUniverse(v as typeof universe)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="core">Solo ETH/SOL</SelectItem>
                <SelectItem value="core_sleeve">ETH/SOL + top alt liquide</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Capitale iniziale (€)</label>
            <input
              type="number"
              min={10}
              step={50}
              value={startCapital}
              onChange={(e) => setStartCapital(Math.max(10, Number(e.target.value) || 0))}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm tabular-nums"
            />
          </div>
          <div className="flex items-end">
            <Button onClick={() => runMut.mutate()} disabled={runMut.isPending} className="w-full">
              <RefreshCw className={`size-4 ${runMut.isPending ? "animate-spin" : ""}`} />
              {runMut.isPending ? "Calcolo…" : "Esegui backtest"}
            </Button>
          </div>
        </div>

        {runMut.isPending && <Skeleton className="h-80 w-full" />}

        {runMut.data && (
          <>
            <div className="h-80 bg-card/50 rounded-md p-2 border border-border">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={(() => {
                    const raw = runMut.data.equity as Array<{ date: string; strategy: number; btc: number; spx: number }>;
                    if (!raw.length) return [];
                    const s0 = raw[0].strategy || 1;
                    const b0 = raw[0].btc || 1;
                    const p0 = raw[0].spx || 1;
                    return raw.map((r) => ({
                      date: r.date,
                      strategy: (r.strategy / s0 - 1) * 100,
                      btc: (r.btc / b0 - 1) * 100,
                      spx: (r.spx / p0 - 1) * 100,
                    }));
                  })()}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={50} />
                  <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} tickFormatter={(v) => `${v.toFixed(0)}%`} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
                    formatter={(v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="strategy" stroke="#60a5fa" dot={false} strokeWidth={2.5} name="Strategia v3" isAnimationActive={false} />
                  <Line type="monotone" dataKey="btc" stroke="#f7931a" dot={false} strokeWidth={1.5} name="BTC Buy & Hold" isAnimationActive={false} />
                  <Line type="monotone" dataKey="dca" stroke="#a78bfa" dot={false} strokeWidth={1.5} name="BTC DCA" isAnimationActive={false} />
                  <Line type="monotone" dataKey="trendCore" stroke="#10b981" dot={false} strokeWidth={1.5} name="BTC Trend (SMA200)" isAnimationActive={false} strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="trendDca" stroke="#14b8a6" dot={false} strokeWidth={1.5} name="BTC Trend+BearDCA" isAnimationActive={false} strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="spx" stroke="#22c55e" dot={false} strokeWidth={1.5} name="S&P 500" isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {(() => {
              const final = (pct: number) => startCapital * (1 + pct / 100);
              const eur = (v: number) => v.toLocaleString("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
              const cls = (v: number) => v >= startCapital ? "text-[color:var(--profit)]" : "text-[color:var(--loss)]";
              const sV = final(runMut.data.strategyKpis.totalReturnPct);
              const bV = final(runMut.data.btcKpis.totalReturnPct);
              const dV = final(runMut.data.dcaKpis.totalReturnPct);
              const pV = final(runMut.data.spxKpis.totalReturnPct);
              return (
                <div className="text-sm bg-muted/30 border border-border rounded-md px-3 py-2 flex flex-wrap gap-x-6 gap-y-1">
                  <span className="text-muted-foreground">Da {eur(startCapital)} a:</span>
                  <span>Strategia <strong className={`tabular-nums ${cls(sV)}`}>{eur(sV)}</strong></span>
                  <span>BTC <strong className={`tabular-nums ${cls(bV)}`}>{eur(bV)}</strong></span>
                  <span>DCA <strong className={`tabular-nums ${cls(dV)}`}>{eur(dV)}</strong></span>
                  <span>S&amp;P 500 <strong className={`tabular-nums ${cls(pV)}`}>{eur(pV)}</strong></span>
                </div>
              );
            })()}

            {/* GO LIVE gate */}
            {(() => {
              const c = runMut.data.liveGateChecks;
              const items: Array<[string, boolean]> = [
                ["Profit Factor > 1.3", c.profitFactorOk],
                ["Sharpe > 0.8", c.sharpeOk],
                ["Sharpe ≥ DCA", c.beatsDcaSharpe],
                ["Max DD ≤ DCA", c.beatsDcaDrawdown],
              ];
              const pass = runMut.data.passesLiveGate;
              return (
                <div className={`rounded-md border p-3 ${pass ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"}`}>
                  <div className="text-sm font-medium mb-2">
                    {pass ? "✅ Cancello GO LIVE: PASSATO" : "⚠️ Cancello GO LIVE: NON passato"}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    {items.map(([label, ok]) => (
                      <div key={label} className="flex items-center gap-1.5">
                        <span className={ok ? "text-emerald-500" : "text-amber-500"}>{ok ? "✓" : "✗"}</span>
                        <span className={ok ? "" : "text-muted-foreground"}>{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <KpiCard title="Strategia v3" kpis={runMut.data.strategyKpis} highlight />
              <KpiCard title="BTC Buy & Hold" kpis={runMut.data.btcKpis} />
              <KpiCard title="BTC DCA" kpis={runMut.data.dcaKpis} />
              <KpiCard title="BTC Trend" kpis={runMut.data.trendCoreKpis} />
              <KpiCard title="BTC Trend+BearDCA" kpis={runMut.data.trendDcaKpis} />
              <KpiCard title="S&P 500" kpis={runMut.data.spxKpis} />
            </div>

            {(() => {
              const eq = runMut.data.equity as Array<{ date: string }>;
              const first = eq[0]?.date;
              const last = eq[eq.length - 1]?.date;
              if (!first || !last) return null;
              const reqYears = years;
              const actualYears = (new Date(last).getTime() - new Date(first).getTime()) / (365.25 * 86400_000);
              const truncated = actualYears < reqYears - 0.2;
              return (
                <p className="text-xs text-muted-foreground">
                  Storico effettivo: <span className="tabular-nums">{first}</span> → <span className="tabular-nums">{last}</span> (~{actualYears.toFixed(1)} anni)
                  {truncated && (
                    <span className="text-amber-500"> · Hai chiesto {reqYears} anni ma in DB c'è solo storico più breve.</span>
                  )}
                </p>
              );
            })()}

            <div className="text-xs text-muted-foreground border border-border/40 rounded-md p-3 space-y-1 bg-muted/20">
              <div className="font-medium text-foreground">Cosa è incluso nel calcolo (v2)</div>
              <div>• <strong>Allocazione Core-Satellite</strong>: il core (BTC/ETH) resta investito, lo sleeve satellite fa trading attivo solo per la quota satellite.</div>
              <div>• <strong>Filtro macro</strong>: se BTC scende sotto SMA{200}, il core esce in stablecoin (rientro al recupero).</div>
              <div>• <strong>Disciplina commissioni</strong>: target minimo {`+${runMut.data.preset === "conservative" ? 5 : runMut.data.preset === "aggressive" ? 3 : 4}%`}, cooldown e tetto trade mensile applicati.</div>
              <div>• <strong>Commissioni</strong>: 0.4% per lato (taker Kraken Pro), slippage 0.1% per lato.</div>
              <div>• <strong>Stop</strong>: max(stop_min, 2×ATR) come da preset; trailing e take-profit parziale applicati.</div>
              <div className="pt-1 opacity-80">Storico crypto: Binance (storico lungo) + Kraken OHLC recenti. S&amp;P 500: Yahoo/Stooq.</div>
            </div>

            {runMut.data.cached && (
              <p className="text-xs text-muted-foreground">📦 Risultato dalla cache (valido 24h)</p>
            )}
          </>
        )}

        {!runMut.data && !runMut.isPending && (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Premi "Esegui backtest" per simulare il preset sui dati storici.
            </CardContent>
          </Card>
        )}
      </CardContent>
    </Card>
  );
}

type KpisShape = { totalReturnPct: number; cagr: number; maxDrawdownPct: number; sharpe: number; sortino: number; trades: number; winRatePct: number; profitFactor: number };

function KpiCard({ title, kpis, highlight }: { title: string; kpis: KpisShape; highlight?: boolean }) {
  return (
    <Card className={highlight ? "border-primary/50" : ""}>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-1 text-xs">
        <Row label="Rendimento" value={`${kpis.totalReturnPct >= 0 ? "+" : ""}${kpis.totalReturnPct.toFixed(1)}%`} positive={kpis.totalReturnPct >= 0} />
        <Row label="CAGR" value={`${kpis.cagr >= 0 ? "+" : ""}${kpis.cagr.toFixed(1)}%`} />
        <Row label="Max DD" value={`${kpis.maxDrawdownPct.toFixed(1)}%`} negative />
        <Row label="Sharpe" value={kpis.sharpe.toFixed(2)} />
        {kpis.trades > 1 && <Row label="# Trade" value={kpis.trades.toString()} />}
        {kpis.trades > 1 && <Row label="Win rate" value={`${kpis.winRatePct.toFixed(0)}%`} />}
        {kpis.trades > 1 && <Row label="Profit factor" value={kpis.profitFactor.toFixed(2)} />}
      </CardContent>
    </Card>
  );
}

function Row({ label, value, positive, negative }: { label: string; value: string; positive?: boolean; negative?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium tabular-nums ${positive ? "text-green-500" : negative ? "text-red-500" : ""}`}>{value}</span>
    </div>
  );
}
