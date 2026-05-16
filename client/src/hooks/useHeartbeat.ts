import { useEffect } from "react";

/**
 * Send a heartbeat to the server every 10s so it knows a browser tab
 * is alive. The server self-terminates after ~90s of no heartbeat —
 * see /api/heartbeat in src/server/app.ts.
 *
 * We intentionally do NOT send /api/shutdown on beforeunload. That
 * killed the server during a tab refresh because the unload fired
 * before the new page could establish its own heartbeat.
 */
export function useHeartbeat() {
  useEffect(() => {
    const send = () => {
      fetch("/api/heartbeat", { method: "POST" }).catch(() => {});
    };

    send();
    const interval = setInterval(send, 10_000);

    return () => clearInterval(interval);
  }, []);
}
