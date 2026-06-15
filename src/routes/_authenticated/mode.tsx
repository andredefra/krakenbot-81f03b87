import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { AlertTriangle, FileText } from "lucide-react";
import { generatePaperGoLiveReport } from "@/lib/reports.functions";

export const Route = createFileRoute("/_authenticated/mode")({
  component: ModePage,
});

function ModePage() {
  const qc = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const generate = useServerFn(generatePaperGoLiveReport);

  const q = useQuery({
    queryKey: ["settings", "mode"],
    queryFn: async () => {
      const { data, error } = await supabase.from("settings").select("id,mode,is_running").maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const toggleRunning = useMutation({
    mutationFn: async (v: boolean) => {
      if (!q.data) throw new Error("settings non trovata");
      const { error } = await supabase.from("settings").update({ is_running: v }).eq("id", q.data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Stato aggiornato");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Errore"),
  });

  const goLive = useMutation({
    mutationFn: () => generate({ data: {} as never }),
    onSuccess: (res) => {
      toast.success(
        `LIVE attivo · report Paper generato (P&L ${res.summary.pnl.toFixed(2)} USD). Trovi il PDF nei Log.`,
        { duration: 8000 },
      );
      setConfirmOpen(false);
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["events_log"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Errore go-live"),
  });

  const isLive = q.data?.mode === "live";

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Modalità</h1>
        <p className="text-sm text-muted-foreground">Controllo principale del bot</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Stato motore</CardTitle>
          <CardDescription>Quando ON, il cron eseguirà il ciclo ogni 5 minuti.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {q.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <div className="flex items-center justify-between p-4 rounded-lg border border-border bg-card/50">
              <div>
                <div className="font-medium">Bot in esecuzione</div>
                <div className="text-xs text-muted-foreground">
                  {q.data?.is_running ? "Il motore eseguirà il prossimo ciclo cron." : "Il motore è fermo. Nessun trade verrà aperto o chiuso."}
                </div>
              </div>
              <Switch
                checked={!!q.data?.is_running}
                onCheckedChange={(v) => toggleRunning.mutate(v)}
                disabled={toggleRunning.isPending}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Modalità di trading
            {q.data && (
              <Badge variant="outline" className="text-xs uppercase">
                {q.data.mode}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>Paper = ordini simulati. Live = ordini reali su Kraken.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isLive ? (
            <>
              <div className="flex items-center justify-between p-4 rounded-lg border border-[color:var(--paper)]/30 bg-[color:var(--paper)]/5">
                <div>
                  <div className="font-medium text-[color:var(--paper)]">PAPER — attivo</div>
                  <div className="text-xs text-muted-foreground">Ordini simulati. Validazione e taratura parametri.</div>
                </div>
              </div>

              <div className="p-4 rounded-lg border border-dashed border-border bg-muted/30">
                <div className="flex items-center gap-3 mb-3">
                  <AlertTriangle className="size-5 text-[color:var(--live)]" />
                  <div className="font-medium">GO LIVE</div>
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  Il passaggio a Live separa definitivamente i dati Paper da quelli Live e genera un <strong>PDF di archivio</strong> della Fase Paper (visibile nei Log).
                  Da questo momento Dashboard, Posizioni e Storico mostreranno solo dati Live.
                </p>
                <Button variant="destructive" onClick={() => setConfirmOpen(true)} disabled={goLive.isPending}>
                  {goLive.isPending ? "Generazione report…" : "Passa a LIVE"}
                </Button>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between p-4 rounded-lg border border-[color:var(--live)]/30 bg-[color:var(--live)]/5">
              <div>
                <div className="font-medium text-[color:var(--live)]">LIVE — attivo</div>
                <div className="text-xs text-muted-foreground">
                  I dati Paper sono congelati. Usa il filtro "Archivio Paper" sulle pagine per consultarli.
                </div>
              </div>
              <FileText className="size-5 text-muted-foreground" />
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confermi il passaggio a LIVE?</AlertDialogTitle>
            <AlertDialogDescription>
              Verrà generato un report PDF con tutti i dati della Fase Paper (P&L, drawdown, win-rate, equity, parametri).
              Lo troverai allegato a un nuovo evento nei <strong>Log</strong>.
              Dopo il passaggio a Live le pagine del cruscotto mostreranno solo i nuovi dati Live.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={goLive.isPending}>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                goLive.mutate();
              }}
              disabled={goLive.isPending}
            >
              {goLive.isPending ? "Generazione…" : "Sì, passa a LIVE"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
