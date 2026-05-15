import { useState, useEffect } from "react";
import Layout from "./components/Layout";
import DiscoveryPage from "./pages/DiscoveryPage";
import JobProgressPage from "./pages/JobProgressPage";
import DocumentsPage from "./pages/DocumentsPage";
import SettingsPage from "./pages/SettingsPage";

type Page = "discovery" | "documents" | "settings";

export default function App() {
  const [page, setPage] = useState<Page>("discovery");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const page = (e as CustomEvent<Page>).detail;
      setPage(page);
    };
    window.addEventListener("navigate", handler);
    return () => window.removeEventListener("navigate", handler);
  }, []);

  function handleJobStarted(jobId: string) {
    setActiveJobId(jobId);
  }

  function handleJobComplete() {
    setActiveJobId(null);
    setPage("documents");
  }

  if (activeJobId) {
    return (
      <JobProgressPage
        jobId={activeJobId}
        onComplete={handleJobComplete}
        onBack={() => setActiveJobId(null)}
      />
    );
  }

  return (
    <Layout currentPage={page} onNavigate={setPage}>
      {page === "discovery" && (
        <DiscoveryPage onJobStarted={handleJobStarted} />
      )}
      {page === "documents" && <DocumentsPage />}
      {page === "settings" && <SettingsPage />}
    </Layout>
  );
}
