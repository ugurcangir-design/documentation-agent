import ProgressView from "../components/ProgressView";

interface JobProgressPageProps {
  jobId: string;
  onComplete: () => void;
  onBack: () => void;
}

export default function JobProgressPage({
  jobId,
  onComplete,
  onBack,
}: JobProgressPageProps) {
  return (
    <div className="p-8 max-w-2xl mx-auto">
      <button
        onClick={onBack}
        className="text-sm text-gray-500 hover:text-gray-700 mb-6 flex items-center gap-1"
      >
        ← Geri
      </button>

      <h1 className="text-2xl font-bold text-gray-900 mb-2">
        Döküman Oluşturuluyor
      </h1>
      <p className="text-gray-500 mb-6">
        Ekranlar analiz ediliyor ve dökümanlar yazılıyor. Lütfen bekleyin.
      </p>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <ProgressView
          streamUrl={`/api/jobs/${jobId}/stream`}
          onComplete={onComplete}
        />
      </div>

      <p className="text-xs text-gray-400 mt-4">
        Job ID: {jobId}
      </p>
    </div>
  );
}
