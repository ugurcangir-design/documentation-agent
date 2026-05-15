import { useEffect, useRef, useState } from "react";
import type { JobEvent } from "../types";

interface ProgressViewProps {
  streamUrl: string;
  total?: number;
  onComplete?: () => void;
}

export default function ProgressView({
  streamUrl,
  total = 0,
  onComplete,
}: ProgressViewProps) {
  const [logs, setLogs] = useState<string[]>([]);
  const [current, setCurrent] = useState(0);
  const [done, setDone] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource(streamUrl);

    es.onmessage = (e) => {
      const event = JSON.parse(e.data as string) as JobEvent;

      setLogs((prev) => [...prev, event.message]);

      if (event.current !== undefined) setCurrent(event.current);

      if (event.type === "complete" || event.type === "error") {
        setDone(true);
        es.close();
        if (event.type === "complete") onComplete?.();
      }
    };

    es.onerror = () => {
      setLogs((prev) => [...prev, "Bağlantı kesildi."]);
      es.close();
    };

    return () => es.close();
  }, [streamUrl]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  const pct = total > 0 ? Math.min(100, (current / total) * 100) : done ? 100 : 0;

  return (
    <div className="space-y-3">
      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-sm text-gray-500 w-12 text-right">
          {Math.round(pct)}%
        </span>
      </div>

      {/* Log window */}
      <div
        ref={logRef}
        className="bg-gray-900 rounded-lg p-4 h-48 overflow-y-auto text-sm font-mono"
      >
        {logs.map((line, i) => (
          <div key={i} className="text-green-400">
            {line}
          </div>
        ))}
        {!done && (
          <div className="text-gray-500 animate-pulse">▌</div>
        )}
      </div>

      {done && (
        <p className="text-sm text-green-600 font-medium">
          ✓ Tamamlandı
        </p>
      )}
    </div>
  );
}
