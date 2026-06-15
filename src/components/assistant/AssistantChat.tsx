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
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setToken(data.session?.access_token ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setToken(session?.access_token ?? null);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const historyQ = useQuery({
    queryKey: ["chat-history"],
    queryFn: () => getChatHistory(),
  });

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        headers: () => (token ? { Authorization: `Bearer ${token}` } : {}),
      }),
    [token],
  );

  const { messages, sendMessage, status, setMessages, stop } = useChat({
    id: CHAT_ID,
    transport,
    onError: (err) => toast.error(err.message ?? "Errore chat"),
  });

  const loadedRef = useRef(false);
  useEffect(() => {
    if (!loadedRef.current && historyQ.data?.messages) {
      setMessages(historyQ.data.messages as UIMessage[]);
      loadedRef.current = true;
    }
  }, [historyQ.data, setMessages]);

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

  const isStreaming = status === "submitted" || status === "streaming";

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
