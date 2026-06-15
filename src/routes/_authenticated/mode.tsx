import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/mode")({
  component: ModePage,
});

function ModePage() {
  const qc = useQueryClient();
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
          <div className="flex items-center justify-between p-4 rounded-lg border border-[color:var(--paper)]/30 bg-[color:var(--paper)]/5">
            <div>
              <div className="font-medium text-[color:var(--paper)]">PAPER — attivo</div>
              <div className="text-xs text-muted-foreground">In Fase 1 il bot opera solo in paper. Validazione e taratura parametri.</div>
            </div>
          </div>

          <div className="p-4 rounded-lg border border-dashed border-border bg-muted/30">
            <div className="flex items-center gap-3 mb-3">
              <AlertTriangle className="size-5 text-muted-foreground" />
              <div className="font-medium">GO LIVE</div>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Il passaggio a Live con ordini reali su Kraken sarà sbloccato nella Fase 2 (con doppia conferma e size ridotta iniziale).
            </p>
            <Button disabled variant="destructive">In arrivo — Fase 2</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
