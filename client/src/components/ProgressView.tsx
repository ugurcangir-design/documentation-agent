import { useEffect, useRef, useState } from "react";
import type { JobEvent } from "../types";

interface ProgressViewProps {
  streamUrl: string;
  total?: number;
  onComplete?: () => void;
  /** Terminal HATA (failed/cancelled) olduğunda çağrılır — çağıran tarafın
   *  "çalışıyor" durumunu sıfırlayıp yeniden denemeye izin vermesi için. */
  onError?: (message: string) => void;
  onCancel?: () => void;
  onPause?: () => Promise<void> | void;
  onResume?: () => Promise<void> | void;
}

export default function ProgressView({
  streamUrl,
  total = 0,
  onComplete,
  onError,
  onCancel,
  onPause,
  onResume,
}: ProgressViewProps) {
  const [logs, setLogs] = useState<string[]>([]);
  const [current, setCurrent] = useState(0);
  const [done, setDone] = useState(false);
  const [endedWithError, setEndedWithError] = useState(false);
  const [paused, setPaused] = useState(false);
  const [waitDismissed, setWaitDismissed] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const endedRef = useRef(false);

  useEffect(() => {
    endedRef.current = false;
    const es = new EventSource(streamUrl);

    es.onmessage = (e) => {
      const event = JSON.parse(e.data as string) as JobEvent;

      // Tek ekran hatası (non-terminal) → log'da görünür işaretle ama
      // stream'i KAPATMA; job diğer ekranlarla devam eder.
      const prefix = event.type === "error" ? "⚠ " : "";
      setLogs((prev) => [...prev, prefix + event.message]);

      if (event.current !== undefined) setCurrent(event.current);

      // Pause/resume signals from the server
      if (typeof event.message === "string") {
        if (event.message.startsWith("⏸")) setPaused(true);
        if (event.message.startsWith("▶")) {
          setPaused(false);
          setWaitDismissed(false);
        }
      }

      // Yalnız TERMINAL olaylar stream'i kapatır. "error" tek-ekran
      // hatasıdır (job sürer) — burada job'ı bitmiş sayma.
      if (event.type === "complete" || event.type === "failed" || event.type === "cancelled") {
        setDone(true);
        endedRef.current = true;
        es.close();
        if (event.type === "complete") {
          onComplete?.();
        } else {
          setEndedWithError(true);
          onError?.(event.message || "İşlem başarısız oldu");
        }
      }
    };

    es.onerror = () => {
      // Terminal olay zaten geldiyse (normal kapanış) bir şey yapma.
      if (endedRef.current) return;
      endedRef.current = true;
      setLogs((prev) => [...prev, "Bağlantı kesildi."]);
      setDone(true);
      setEndedWithError(true);
      es.close();
      // Çağıran "çalışıyor" durumunu sıfırlasın — aksi halde ekran takılır.
      onError?.("Sunucuyla bağlantı kesildi. İşlem durdu — yeniden deneyin.");
    };

    return () => es.close();
  }, [streamUrl]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  async function handlePause() {
    if (!onPause) return;
    setActionBusy(true);
    try { await onPause(); }
    finally { setActionBusy(false); }
  }

  async function handleResume() {
    if (!onResume) return;
    setActionBusy(true);
    try { await onResume(); }
    finally { setActionBusy(false); }
  }

  const pct = total > 0 ? Math.min(100, (current / total) * 100) : done ? 100 : 0;

  return (
    <div className="space-y-3">
      {/* Progress bar + actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[180px] bg-gray-200 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all duration-300 ${
              paused ? "bg-amber-400" : "bg-blue-500"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-sm text-gray-500 w-12 text-right">{Math.round(pct)}%</span>

        {!done && !paused && onPause && (
          <button
            onClick={handlePause}
            disabled={actionBusy}
            className="px-3 py-1 text-xs text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-50 disabled:opacity-50"
            title="Bir sonraki kontrol noktasında duraklat"
          >
            ⏸ Durdur
          </button>
        )}

        {!done && onCancel && (
          <button
            onClick={onCancel}
            className="px-3 py-1 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
            title="Tamamen iptal et"
          >
            İptal
          </button>
        )}
      </div>

      {/* Paused notice with two distinct actions */}
      {paused && !done && !waitDismissed && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center justify-between gap-3">
          <div className="text-[13px] text-amber-800">
            ⏸ Job duraklatıldı. Devam etmek istediğinde aşağıdaki butona bas; sonra karar vermek istersen "Bekle" diyebilirsin.
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={handleResume}
              disabled={actionBusy}
              className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              ▶ Devam Et
            </button>
            <button
              onClick={() => setWaitDismissed(true)}
              className="px-3 py-1.5 text-xs border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50"
            >
              Bekle
            </button>
          </div>
        </div>
      )}

      {/* When user chose 'Bekle', show a compact resume button so they can still come back */}
      {paused && !done && waitDismissed && (
        <button
          onClick={handleResume}
          className="px-3 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          ▶ Devam Et
        </button>
      )}

      {/* Log */}
      <div
        ref={logRef}
        className="bg-gray-900 rounded-lg p-4 h-48 overflow-y-auto text-sm font-mono"
      >
        {logs.map((line, i) => (
          <div key={i} className={paused && i === logs.length - 1 ? "text-amber-300" : "text-green-400"}>
            {line}
          </div>
        ))}
        {!done && !paused && <div className="text-gray-500 animate-pulse">▌</div>}
        {paused && <div className="text-amber-400">⏸ duraklatıldı</div>}
      </div>

      {done && !endedWithError && (
        <p className="text-sm text-green-600 font-medium">✓ Tamamlandı</p>
      )}
      {done && endedWithError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-[13px] text-red-800">
          <div className="font-semibold mb-0.5">✗ Job tamamlanmadı</div>
          <div>
            {total > 0
              ? `${current}/${total} ekran üretildi. Tamamlanan dokümanlar Dökümanlar sayfasında. `
              : `Üretim sonlanmadan kesildi. `}
            Eksik ekranları yeniden üretmek için <strong>Geçmiş</strong> sayfasındaki
            "⟳ Eksikleri Üret" düğmesini kullanın — tamamlananlar yeniden ödenmez.
          </div>
        </div>
      )}
    </div>
  );
}
