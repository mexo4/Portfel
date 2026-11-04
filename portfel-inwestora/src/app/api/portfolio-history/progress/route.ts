import { getCurrentAuthenticatedUser } from "@/lib/server/auth";
import { getPortfolioHistoryProgress } from "@/lib/server/portfolio-history-progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const wait = (milliseconds: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const complete = () => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const timeout = setTimeout(complete, milliseconds);
    const onAbort = () => {
      clearTimeout(timeout);
      complete();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

export async function GET(request: Request) {
  const user = await getCurrentAuthenticatedUser();
  if (!user) {
    return Response.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  const progressId = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(progressId)) {
    return Response.json({ error: "Nieprawidłowy identyfikator postępu." }, { status: 400 });
  }
  const encoder = new TextEncoder();
  const streamAbortController = new AbortController();
  const abortStream = () => streamAbortController.abort();
  request.signal.addEventListener("abort", abortStream, { once: true });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const startedAt = Date.now();
      let lastMessage = "";
      try {
        while (!streamAbortController.signal.aborted && Date.now() - startedAt < 120_000) {
          const progress = getPortfolioHistoryProgress(progressId, user.id);
          if (progress) {
            const message = JSON.stringify(progress);
            if (message !== lastMessage) {
              controller.enqueue(encoder.encode(`data: ${message}\n\n`));
              lastMessage = message;
            }
            if (progress.done) break;
          }
          await wait(350, streamAbortController.signal);
        }
      } catch {
        // The client may leave the chart while the stream is open.
      } finally {
        try {
          controller.close();
        } catch {
          // A cancelled client already closed the stream.
        }
        request.signal.removeEventListener("abort", abortStream);
      }
    },
    cancel() {
      streamAbortController.abort();
      request.signal.removeEventListener("abort", abortStream);
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
