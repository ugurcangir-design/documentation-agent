import { useEffect } from "react";

export function useHeartbeat() {
  useEffect(() => {
    const send = () => {
      fetch("/api/heartbeat", { method: "POST" }).catch(() => {});
    };

    send();
    const interval = setInterval(send, 10_000);

    const beforeUnload = () => {
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/shutdown");
      }
    };
    window.addEventListener("beforeunload", beforeUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);
}
