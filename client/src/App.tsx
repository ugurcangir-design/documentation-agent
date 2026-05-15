import { useState, useEffect } from "react";
import type { Page } from "./components/Layout";
import Layout from "./components/Layout";
import { ToastProvider } from "./components/Toast";
import { useHeartbeat } from "./hooks/useHeartbeat";
import DashboardPage from "./pages/DashboardPage";
import DiscoveryPage from "./pages/DiscoveryPage";
import JobProgressPage from "./pages/JobProgressPage";
import DocumentsPage from "./pages/DocumentsPage";
import SettingsPage from "./pages/SettingsPage";
import ReferencesPage from "./pages/ReferencesPage";
import PromptsPage from "./pages/PromptsPage";
import HistoryPage from "./pages/HistoryPage";

function AppInner() {
  const [page, setPage] = useState<Page>("dashboard");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [deepAnalysis, setDeepAnalysis] = useState(false);

  useHeartbeat();

  useEffect(() => {
    const handler = (e: Event) => {
      const p = (e as CustomEvent<Page>).detail;
      setPage(p);
    };
    window.addEventListener("navigate", handler);
    return () => window.removeEventListener("navigate", handler);
  }, []);

  if (activeJobId) {
    return (
      <JobProgressPage
        jobId={activeJobId}
        onComplete={() => { setActiveJobId(null); setPage("documents"); }}
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
      {page === "discovery" && <DiscoveryPage onJobStarted={setActiveJobId} deepAnalysis={deepAnalysis} />}
      {page === "documents" && <DocumentsPage />}
      {page === "history" && <HistoryPage />}
      {page === "references" && <ReferencesPage />}
      {page === "settings" && <SettingsPage />}
      {page === "prompts" && <PromptsPage />}
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
