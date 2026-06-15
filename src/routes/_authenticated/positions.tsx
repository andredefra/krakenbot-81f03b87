import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { formatUsd, formatPct, formatNumber, pnlClass } from "@/lib/format";
import { useActiveMode } from "@/hooks/use-active-mode";

export const Route = createFileRoute("/_authenticated/positions")({
  component: PositionsPage,
});

function PositionsPage() {
  const { mode } = useActiveMode();
  const q = useQuery({
    queryKey: ["positions", "open", mode],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("positions")
        .select("*")
        .eq("status", "open")
        .eq("mode", mode)
        .order("opened_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });


  useEffect(() => {
    const channel = supabase
      .channel("positions-open")
      .on("postgres_changes", { event: "*", schema: "public", table: "positions" }, () => q.refetch())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Posizioni aperte</h1>
        <p className="text-sm text-muted-foreground">Trade attualmente in corso (paper o live)</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{q.data?.length ?? 0} posizioni aperte</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {q.isLoading ? (
            <div className="p-6 space-y-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (q.data?.length ?? 0) === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              Nessuna posizione aperta. Il motore aprirà trade quando i segnali sono validi.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead>Mod.</TableHead>
                    <TableHead className="text-right">Quantità</TableHead>
                    <TableHead className="text-right">Ingresso</TableHead>
                    <TableHead className="text-right">Attuale</TableHead>
                    <TableHead className="text-right">Valore</TableHead>
                    <TableHead className="text-right">uPnL</TableHead>
                    <TableHead className="text-right">Stop</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {q.data!.map((p) => {
                    const cur = Number(p.current_price ?? p.entry_price);
                    const value = cur * Number(p.qty);
                    const pnl = value - Number(p.entry_value);
                    const pnlPct = Number(p.entry_value) > 0 ? (pnl / Number(p.entry_value)) * 100 : 0;
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.asset}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{p.mode.toUpperCase()}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular">{formatNumber(Number(p.qty), 6)}</TableCell>
                        <TableCell className="text-right tabular">{formatUsd(Number(p.entry_price))}</TableCell>
                        <TableCell className="text-right tabular">{formatUsd(cur)}</TableCell>
                        <TableCell className="text-right tabular">{formatUsd(value)}</TableCell>
                        <TableCell className={`text-right tabular ${pnlClass(pnl)}`}>
                          {formatUsd(pnl, { signed: true })} <span className="text-xs opacity-80">({formatPct(pnlPct, { signed: true })})</span>
                        </TableCell>
                        <TableCell className="text-right tabular text-muted-foreground">{p.stop_price ? formatUsd(Number(p.stop_price)) : "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
