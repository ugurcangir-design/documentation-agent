import { useState } from "react";
import ProgressView from "../components/ProgressView";
import { jobControl } from "../lib/api";

interface JobProgressPageProps {
  jobId: string;
  onComplete: () => void;
  onBack: () => void;
}

const DOC_STAGES = ["Bağlam", "Analiz", "Üretim", "Kalite", "Tamamlandı"];

export default function JobProgressPage({ jobId, onComplete, onBack }: JobProgressPageProps) {
  const [cancelling, setCancelling] = useState(false);

  async function cancel() {
    if (!confirm("Job'u durdurmak istediğinizden emin misiniz?")) return;
    setCancelling(true);
    try {
      await jobControl.cancel(jobId);
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="p-8 max-w-3xl mx-auto fade-in">
      <button
        onClick={onBack}
        className="text-sm text-fg3 hover:text-fg mb-6 flex items-center gap-1 transition-colors"
      >
        ← Geri
      </button>

      <div className="flex items-center gap-3 mb-1.5">
        <h1 className="text-2xl font-bold text-fg">Döküman Üretiliyor</h1>
      </div>
      <p className="text-fg3 mb-6 text-sm">
        Ekranlar analiz ediliyor ve Türkçe kullanıcı kılavuzları yazılıyor.
        {cancelling && " İptal isteği gönderildi…"}
      </p>

      <ProgressView
        streamUrl={`/api/jobs/${jobId}/stream`}
        stages={DOC_STAGES}
        onComplete={onComplete}
        onCancel={cancel}
        onPause={async () => { await jobControl.pause(jobId); }}
        onResume={async () => { await jobControl.resume(jobId); }}
      />

      <p className="text-[11px] text-fg3/70 mt-5 font-mono">Job ID: {jobId}</p>
    </div>
  );
}
