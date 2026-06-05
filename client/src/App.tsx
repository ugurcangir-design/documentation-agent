import { useState, useEffect } from "react";
import type { Page } from "./components/Layout";
import Layout from "./components/Layout";
import { ToastProvider, useToast } from "./components/Toast";
import { useHeartbeat } from "./hooks/useHeartbeat";
import DashboardPage from "./pages/DashboardPage";
import DiscoveryPage from "./pages/DiscoveryPage";
import JobProgressPage from "./pages/JobProgressPage";
import DocumentsPage from "./pages/DocumentsPage";
import SettingsPage from "./pages/SettingsPage";
import ReferencesPage from "./pages/ReferencesPage";
import PromptsPage from "./pages/PromptsPage";
import HistoryPage from "./pages/HistoryPage";
import UpdatePage from "./pages/UpdatePage";
import KilavuzPage from "./pages/KilavuzPage";

function AppInner() {
  const [page, setPage] = useState<Page>("dashboard");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [lastCompletedDocJobId, setLastCompletedDocJobId] = useState<string | null>(null);
  const [deepAnalysis, setDeepAnalysis] = useState(false);
  const toast = useToast();

  useHeartbeat();

  useEffect(() => {
    const handler = (e: Event) => {
      const p = (e as CustomEvent<Page>).detail;
      setPage(p);
    };
    window.addEventListener("navigate", handler);
    return () => window.removeEventListener("navigate", handler);
  }, []);

  // CSRF guard 403 → tüm sayfalarda tutarlı, anlamlı bir toast.
  // Birden çok yerden tetiklense bile spam olmasın diye 4sn debounce.
  useEffect(() => {
    let lastShown = 0;
    const handler = () => {
      const now = Date.now();
      if (now - lastShown < 4000) return;
      lastShown = now;
      toast.show(
        "İstek engellendi (CSRF guard). DocAgent sekmesini yenileyip tekrar deneyin.",
        "error"
      );
    };
    window.addEventListener("docagent:csrf-blocked", handler);
    return () => window.removeEventListener("docagent:csrf-blocked", handler);
  }, [toast]);

  function handleDocJobComplete() {
    if (activeJobId) {
      setLastCompletedDocJobId(activeJobId);
      toast.show("✓ Döküman oluşturuldu — Dökümanlar sekmesinde açıldı", "success");
    }
    setActiveJobId(null);
    setPage("documents");
  }

  if (activeJobId) {
    return (
      <JobProgressPage
        jobId={activeJobId}
        onComplete={handleDocJobComplete}
        onBack={() => setActiveJobId(null)}
      />
    );
  }

  return (
    <Layout
      currentPage={page}
      onNavigate={setPage}
      deepAnalysis={deepAnalysis}
      onToggleDeepAnalysis={() => setDeepAnalysis((v) => !v)}
    >
      {page === "dashboard" && <DashboardPage />}
      {page === "discovery" && (
        <DiscoveryPage onJobStarted={setActiveJobId} deepAnalysis={deepAnalysis} />
      )}
      {page === "documents" && (
        <DocumentsPage
          autoSelectJobId={lastCompletedDocJobId}
          onAutoSelectConsumed={() => setLastCompletedDocJobId(null)}
        />
      )}
      {page === "history" && <HistoryPage />}
      {page === "references" && <ReferencesPage />}
      {page === "settings" && <SettingsPage />}
      {page === "prompts" && <PromptsPage />}
      {page === "update" && <UpdatePage />}
      {page === "kilavuz" && <KilavuzPage />}
    </Layout>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}
