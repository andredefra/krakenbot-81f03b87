import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getChatHistory, clearChatHistory } from "@/lib/chat.functions";
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { PromptInput, PromptInputTextarea, PromptInputFooter, PromptInputSubmit } from "@/components/ai-elements/prompt-input";
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import { Bot, Trash2 } from "lucide-react";
import { toast } from "sonner";

const CHAT_ID = "main";

export function AssistantChat({ className }: { className?: string }) {
  const qc = useQueryClient();

  const historyQ = useQuery({
    queryKey: ["chat-history"],
    queryFn: () => getChatHistory(),
  });

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        headers: async (): Promise<Record<string, string>> => {
          const { data } = await supabase.auth.getSession();
          const t = data.session?.access_token;
          return t ? { Authorization: `Bearer ${t}` } : {};
        },
      }),
    [],
  );

  const { messages, sendMessage, status, setMessages, stop } = useChat({
    id: CHAT_ID,
    transport,
    onError: (err) => toast.error(err.message ?? "Errore chat"),
    onFinish: () => {
      // After the assistant finishes, refetch the persisted history so the
      // next mount (e.g. after navigating away) shows the latest exchange.
      qc.invalidateQueries({ queryKey: ["chat-history"] });
    },
  });

  // Sync persisted history into the chat whenever fresh data arrives AND we
  // are not actively streaming. A ref-gate would freeze the UI on the first
  // (possibly stale/empty) cache snapshot.
  const isStreaming = status === "submitted" || status === "streaming";
  useEffect(() => {
    if (isStreaming) return;
    const persisted = historyQ.data?.messages as UIMessage[] | undefined;
    if (!persisted) return;
    const sameLength = persisted.length === messages.length;
    const sameLast =
      sameLength &&
      (persisted[persisted.length - 1]?.id ?? "") ===
        (messages[messages.length - 1]?.id ?? "");
    if (sameLength && sameLast) return;
    setMessages(persisted);
  }, [historyQ.data, isStreaming, messages, setMessages]);

  const clear = useMutation({
    mutationFn: () => clearChatHistory({ data: {} }),
    onSuccess: () => {
      setMessages([]);
      qc.invalidateQueries({ queryKey: ["chat-history"] });
      toast.success("Cronologia cancellata");
    },
  });

  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);


  return (
    <div className={`flex flex-col h-full min-h-0 bg-background ${className ?? ""}`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="size-7 rounded-md bg-primary/15 grid place-items-center">
            <Bot className="size-4 text-primary" />
          </div>
          <div>
            <div className="text-sm font-semibold">Assistente</div>
            <div className="text-xs text-muted-foreground">Co-pilota del tuo bot</div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => clear.mutate()}
          disabled={clear.isPending || messages.length === 0}
          title="Cancella cronologia"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <Conversation className="flex-1 min-h-0">
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              icon={<Bot className="size-8 text-primary" />}
              title="Ciao Andrea"
              description="Chiedimi qualcosa: 'come va il portafoglio?', 'alza lo stop loss all'8%', 'spegni LunarCrush', 'chiudi la posizione XBT'…"
            />
          ) : (
            messages.map((m) => (
              <Message key={m.id} from={m.role}>
                <MessageContent>
                  {m.parts.map((part, i) => {
                    if (part.type === "text") {
                      return <MessageResponse key={i}>{part.text}</MessageResponse>;
                    }
                    if (part.type?.startsWith("tool-")) {
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      const tp = part as any;
                      return (
                        <Tool key={i} defaultOpen={false}>
                          <ToolHeader type={tp.type} state={tp.state} />
                          <ToolContent>
                            {tp.input ? <ToolInput input={tp.input} /> : null}
                            {tp.output !== undefined || tp.errorText ? (
                              <ToolOutput output={tp.output} errorText={tp.errorText} />
                            ) : null}
                          </ToolContent>
                        </Tool>
                      );
                    }
                    return null;
                  })}
                </MessageContent>
              </Message>
            ))
          )}
          {status === "submitted" && (
            <div className="px-4 py-2">
              <Shimmer>Sto pensando…</Shimmer>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t border-border p-3">
        <PromptInput
          onSubmit={(msg) => {
            const text = (msg.text ?? input).trim();
            if (!text) return;
            sendMessage({ text });
            setInput("");
            setTimeout(() => textareaRef.current?.focus(), 0);
          }}
        >
          <PromptInputTextarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Scrivi al tuo assistente…"
          />
          <PromptInputFooter className="justify-end">
            <PromptInputSubmit status={status} disabled={!input.trim() && !isStreaming} onStop={stop} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
