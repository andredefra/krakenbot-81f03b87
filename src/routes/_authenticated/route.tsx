import { createFileRoute, Link, Outlet, redirect, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  LineChart,
  History,
  Settings as SettingsIcon,
  Activity,
  Power,
  ScrollText,
  Bot,
  MessageCircle,
  Calculator,
  Stethoscope,
  Target,
  LogOut,
} from "lucide-react";
import { toast } from "sonner";
import { FloatingChat } from "@/components/assistant/FloatingChat";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/positions", label: "Posizioni aperte", icon: LineChart },
  { to: "/history", label: "Storico trade", icon: History },
  { to: "/bilancio", label: "Bilancio", icon: Calculator },
  { to: "/strategia", label: "Strategia", icon: Target },
  { to: "/settings", label: "Rischio", icon: SettingsIcon },
  { to: "/diagnostica", label: "Diagnostica", icon: Stethoscope },
  { to: "/sentiment", label: "Sentiment", icon: Activity },
  { to: "/mode", label: "Modalità", icon: Power },
  { to: "/logs", label: "Log", icon: ScrollText },
  { to: "/assistant", label: "Assistente", icon: MessageCircle },
] as const;

function AuthenticatedLayout() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const location = useLocation();

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("settings").select("mode,is_running").maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Realtime: re-render badge on settings update
  useEffect(() => {
    const channel = supabase
      .channel("settings-topbar")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "settings" },
        () => settingsQuery.refetch(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    toast.success("Disconnesso");
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* Sidebar */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="px-5 h-16 flex items-center gap-3 border-b border-sidebar-border">
          <div className="size-9 rounded-lg bg-primary/15 grid place-items-center">
            <Bot className="size-5 text-primary" />
          </div>
          <div>
            <div className="font-semibold leading-tight">Crypto Bot</div>
            <div className="text-xs text-muted-foreground">Cruscotto</div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map((item) => {
            const active = location.pathname === item.to;
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border space-y-2">
          <div className="text-xs text-muted-foreground truncate px-2">{user.email}</div>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={signOut}>
            <LogOut className="size-4" />
            Esci
          </Button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="h-16 border-b border-border bg-card/40 backdrop-blur flex items-center justify-between px-4 md:px-6">
          <MobileNav />
          <div className="flex items-center gap-2">
            {settingsQuery.isLoading ? (
              <Skeleton className="h-6 w-32" />
            ) : (
              <>
                <ModeBadge mode={settingsQuery.data?.mode ?? "paper"} />
                <RunningBadge running={settingsQuery.data?.is_running ?? false} />
              </>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>

      <FloatingChat />
    </div>
  );
}

function ModeBadge({ mode }: { mode: "paper" | "live" }) {
  if (mode === "live") {
    return (
      <Badge className="bg-[color:var(--live)]/15 text-[color:var(--live)] border border-[color:var(--live)]/30 hover:bg-[color:var(--live)]/15">
        ● LIVE
      </Badge>
    );
  }
  return (
    <Badge className="bg-[color:var(--paper)]/15 text-[color:var(--paper)] border border-[color:var(--paper)]/30 hover:bg-[color:var(--paper)]/15">
      ● PAPER
    </Badge>
  );
}

function RunningBadge({ running }: { running: boolean }) {
  if (running) {
    return (
      <Badge className="bg-[color:var(--running)]/15 text-[color:var(--running)] border border-[color:var(--running)]/30 hover:bg-[color:var(--running)]/15">
        RUNNING
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground border-border">
      STOPPED
    </Badge>
  );
}

function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <div className="md:hidden">
      <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)}>
        Menu
      </Button>
      {open && (
        <div className="absolute top-16 left-0 right-0 z-50 bg-card border-b border-border p-3 space-y-1 shadow-lg">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              className="block px-3 py-2 rounded-md text-sm hover:bg-accent"
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
