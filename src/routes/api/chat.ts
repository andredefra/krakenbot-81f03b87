// POST /api/chat — streaming chat endpoint backed by Lovable AI Gateway.
import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, createIdGenerator, streamText, type UIMessage } from "ai";
import { verifyBearer } from "@/lib/assistant/auth.server";
import { createLovableAiGatewayProvider } from "@/lib/assistant/ai-gateway.server";
import { buildSystemPrompt } from "@/lib/assistant/system-prompt.server";
import { buildAssistantTools } from "@/lib/assistant/tools.server";

const generateAssistantId = createIdGenerator({ prefix: "asst", size: 16 });

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let auth;
        try {
          auth = await verifyBearer(request);
        } catch (resp) {
          if (resp instanceof Response) return resp;
          throw resp;
        }
        const { supabase, userId } = auth;

        const body = (await request.json()) as { messages?: UIMessage[] };
        const messages = Array.isArray(body.messages) ? body.messages : [];

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("LOVABLE_API_KEY missing", { status: 500 });

        // 1) Persist the latest user message SYNCHRONOUSLY before starting the
        // stream. Otherwise, in serverless runtimes the worker can be torn
        // down before onFinish completes and the message is lost.
        const lastUser = [...messages].reverse().find((m) => m.role === "user");
        if (lastUser) {
          const { error } = await supabase.from("chat_messages").upsert(
            {
              user_id: userId,
              message_id: lastUser.id,
              role: lastUser.role,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              parts: lastUser.parts as any,
            },
            { onConflict: "user_id,message_id" },
          );
          if (error) console.error("[chat persist user]", error);
        }

        const knownIds = new Set(messages.map((m) => m.id));

        const gateway = createLovableAiGatewayProvider(key);
        const model = gateway("google/gemini-3-flash-preview");

        const tools = buildAssistantTools(supabase, userId);

        const result = streamText({
          model,
          system: buildSystemPrompt(),
          tools,
          messages: await convertToModelMessages(messages),
          stopWhen: ({ steps }) => steps.length >= 12,
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages,
          // Give every assistant response a stable, unique id. Without this,
          // assistant rows are saved with an empty message_id and overwrite
          // each other via the (user_id, message_id) unique index.
          generateMessageId: generateAssistantId,
          onError: (error) => {
            console.error("[chat stream]", error);
            return error instanceof Error ? error.message : String(error);
          },
          // Await persistence inside the stream's flush so the worker stays
          // alive until the upsert completes. The AI SDK awaits onFinish
          // before closing the stream.
          onFinish: async ({ messages: finalMessages }) => {
            try {
              const newRows = finalMessages
                .filter((m) => !knownIds.has(m.id) && m.id)
                .map((m) => ({
                  user_id: userId,
                  message_id: m.id,
                  role: m.role,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  parts: m.parts as any,
                }));
              if (!newRows.length) return;
              const { error } = await supabase
                .from("chat_messages")
                .upsert(newRows, { onConflict: "user_id,message_id" });
              if (error) console.error("[chat persist assistant]", error);
            } catch (err) {
              console.error("[chat persist assistant] threw", err);
            }
          },
        });
      },
    },
  },
});
