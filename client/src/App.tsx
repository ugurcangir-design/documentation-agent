import { useState, useEffect } from "react";
import type { Page } from "./components/Layout";
import Layout from "./components/Layout";
import DiscoveryPage from "./pages/DiscoveryPage";
import JobProgressPage from "./pages/JobProgressPage";
import DocumentsPage from "./pages/DocumentsPage";
import SettingsPage from "./pages/SettingsPage";
import ReferencesPage from "./pages/ReferencesPage";
import PromptsPage from "./pages/PromptsPage";

export default function App() {
  const [page, setPage] = useState<Page>("discovery");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [deepAnalysis, setDeepAnalysis] = useState(false);

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
      {page === "discovery" && (
        <DiscoveryPage
          onJobStarted={setActiveJobId}
          deepAnalysis={deepAnalysis}
        />
      )}
      {page === "documents" && <DocumentsPage />}
      {page === "references" && <ReferencesPage />}
      {page === "settings" && <SettingsPage />}
      {page === "prompts" && <PromptsPage />}
    </Layout>
  );
}
