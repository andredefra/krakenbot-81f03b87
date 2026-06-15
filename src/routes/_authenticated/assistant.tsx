import { createFileRoute } from "@tanstack/react-router";
import { AssistantChat } from "@/components/assistant/AssistantChat";

export const Route = createFileRoute("/_authenticated/assistant")({
  component: AssistantPage,
});

function AssistantPage() {
  return (
    <div className="h-[calc(100vh-8rem)] -m-4 md:-m-6 rounded-none border border-border md:rounded-lg overflow-hidden">
      <AssistantChat />
    </div>
  );
}
