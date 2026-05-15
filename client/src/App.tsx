import { useState } from "react";
import Layout from "./components/Layout";
import DiscoveryPage from "./pages/DiscoveryPage";
import JobProgressPage from "./pages/JobProgressPage";
import DocumentsPage from "./pages/DocumentsPage";

type Page = "discovery" | "documents";

export default function App() {
  const [page, setPage] = useState<Page>("discovery");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

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
    </Layout>
  );
}
