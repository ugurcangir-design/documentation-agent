import { useEffect } from "react";

/**
 * Keeps the local server alive while a browser tab is open.
 *
 *  - Heartbeat every 10s → liveness signal.
 *  - On `pagehide` (fires on refresh AND on tab close, but NOT on
 *    merely backgrounding the tab) we send a `leave` beacon. The server
 *    then waits out a short grace period: on a refresh the reloaded
 *    page's heartbeat cancels the shutdown; on a real close nothing
 *    reconnects and the server exits.
 *  - Backgrounding / idling a tab never fires `pagehide`, so the app
 *    stays open while idle. On `visibilitychange` → visible and on
 *    `pageshow` we send an immediate heartbeat, so returning to a
 *    long-backgrounded tab instantly refreshes liveness.
 *
 * We deliberately do NOT shut the server down immediately on unload —
 * that historically killed the server during a refresh. The grace
 * period on the server side is what makes a refresh safe.
 */
export function useHeartbeat() {
  useEffect(() => {
    const send = () => {
      fetch("/api/heartbeat", {
        method: "POST",
        keepalive: true,
        headers: { "X-DocAgent": "1" },
      }).catch(() => {});
    };

    send();
    const interval = setInterval(send, 10_000);

    // sendBeacon is reliable during page unload — a normal fetch is not.
    const onPageHide = () => {
      navigator.sendBeacon("/api/heartbeat/leave");
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") send();
    };

    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onVisible);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(interval);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
