import { type ReactNode, useEffect, useState } from "react";

export type Page =
  | "dashboard"
  | "discovery"
  | "documents"
  | "history"
  | "references"
  | "settings"
  | "prompts"
  | "update";

interface LayoutProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  children: ReactNode;
  breadcrumb?: string;
  status?: "ready" | "running" | "error";
  deepAnalysis?: boolean;
  onToggleDeepAnalysis?: () => void;
}

// ── Icons ─────────────────────────────────────────────────────────
const Icon = ({ d, size = 14 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const icons = {
  discovery: "M8 1.5A6.5 6.5 0 1 1 1.5 8 6.5 6.5 0 0 1 8 1.5zM10.5 10.5l3 3",
  documents: "M3 2h7l3 3v9H3V2zm7 0v3h3M6 7h5M6 9.5h5M6 12h3",
  history: "M8 3v5l3 2M8 1.5A6.5 6.5 0 1 0 14.5 8",
  settings: "M8 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0-3.5v2m0 9v2M3.5 3.5l1.4 1.4m5.2 5.2 1.4 1.4M1.5 8h2m9 0h2M3.5 12.5l1.4-1.4m5.2-5.2 1.4-1.4",
  prompts: "M2 3h12v2H2zM2 7h8v2H2zM2 11h10v2H2z",
  search: "M6.5 1.5A5 5 0 1 1 1.5 6.5a5 5 0 0 1 5-5zM10 10l4 4",
  check: "M2 8l4 4 8-7",
};

const SIDEBAR_GROUPS = [
  {
    label: "GENEL",
    items: [
      { id: "dashboard" as Page, label: "Dashboard", icon: "M2 9h5v5H2zM9 2h5v5H9zM9 9h5v5H9zM2 2h5v5H2z" },
    ],
  },
  {
    label: "PİPELİNE",
    items: [
      { id: "discovery" as Page, label: "Ekran Keşfi", icon: icons.discovery },
    ],
  },
  {
    label: "ÇIKTILAR",
    items: [
      { id: "documents" as Page, label: "Dökümanlar", icon: icons.documents, badgeKey: "docs" },
      { id: "history" as Page, label: "Geçmiş", icon: icons.history },
    ],
  },
  {
    label: "KAYNAKLAR",
    items: [
      { id: "references" as Page, label: "Referanslar", icon: "M2 3h12v2H2zM2 7h9v2H2zM2 11h7v2H2z" },
    ],
  },
  {
    label: "SİSTEM",
    items: [
      { id: "settings" as Page, label: "Ayarlar", icon: icons.settings },
      { id: "prompts" as Page, label: "Sistem Promptları", icon: icons.prompts },
      { id: "update" as Page, label: "Güncelleme", icon: "M8 2v8M5 7l3 3 3-3M2 13h12" },
    ],
  },
];

export default function Layout({
  currentPage,
  onNavigate,
  children,
  breadcrumb,
  status = "ready",
  deepAnalysis = false,
  onToggleDeepAnalysis,
}: LayoutProps) {
  const [docCount, setDocCount] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/documents")
      .then((r) => r.json())
      .then((docs: unknown[]) => setDocCount(docs.length))
      .catch(() => {});
  }, [currentPage]);

  const badgeValues: Record<string, number | null> = { docs: docCount };

  const breadcrumbSection = SIDEBAR_GROUPS.find((g) =>
    g.items.some((i) => i.id === currentPage)
  )?.label ?? "PİPELİNE";

  const breadcrumbLabel = SIDEBAR_GROUPS.flatMap((g) => g.items).find(
    (i) => i.id === currentPage
  )?.label ?? "";

  return (
    <div className="flex h-screen overflow-hidden bg-[#f4f4f5]">
      {/* ── Sidebar ──────────────────────────────────────────── */}
      <aside className="w-[196px] flex-shrink-0 bg-[#111112] flex flex-col h-full">
        {/* Brand */}
        <div className="px-4 pt-4 pb-3 flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center flex-shrink-0">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <polygon points="6,1 11,10 1,10" fill="white" fillOpacity=".85" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-white text-[13px] font-semibold leading-tight truncate">
              Doc Agent
            </p>
            <p className="text-white/30 text-[10px]">v2.0 · local</p>
          </div>
        </div>

        {/* Search */}
        <div className="px-3 pb-3">
          <div className="flex items-center gap-2 bg-white/[0.06] rounded-md px-2.5 py-1.5">
            <Icon d={icons.search} size={12} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Ara"
              className="flex-1 bg-transparent text-white/60 text-xs outline-none placeholder:text-white/30 min-w-0"
            />
            <kbd className="text-white/20 text-[10px] font-mono">⌘K</kbd>
          </div>
        </div>

        {/* Nav groups */}
        <nav className="flex-1 overflow-y-auto px-2 space-y-4 pb-2">
          {SIDEBAR_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="text-white/25 text-[10px] font-semibold tracking-widest px-2 mb-1">
                {group.label}
              </p>
              {group.items.map((item) => {
                const badge = "badgeKey" in item ? badgeValues[item.badgeKey as string] : null;
                const active = currentPage === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => onNavigate(item.id)}
                    className={`w-full flex items-center gap-2.5 px-2 py-[6px] rounded-md text-[13px] transition-all text-left ${
                      active
                        ? "bg-white/10 text-white"
                        : "text-white/45 hover:bg-white/[0.05] hover:text-white/75"
                    }`}
                  >
                    <span className={active ? "text-white/70" : "text-white/30"}>
                      <Icon d={item.icon} size={14} />
                    </span>
                    <span className="flex-1 truncate">{item.label}</span>
                    {badge !== null && badge > 0 && (
                      <span className="text-[10px] bg-white/10 text-white/50 px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                        {badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      {/* ── Main ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <div className="h-11 bg-white border-b border-gray-200 flex items-center px-5 gap-3 flex-shrink-0">
          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 text-[12px] text-gray-400 flex-1 min-w-0">
            <span>{breadcrumbSection.charAt(0) + breadcrumbSection.slice(1).toLowerCase()}</span>
            <span className="text-gray-300">/</span>
            <span className="text-gray-700 font-medium truncate">
              {breadcrumb ?? breadcrumbLabel}
            </span>
          </div>

          {/* Status */}
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${
              status === "running" ? "bg-amber-400 animate-pulse" :
              status === "error"   ? "bg-red-400" :
                                     "bg-green-400"
            }`} />
            <span className="text-[12px] text-gray-500">
              {status === "running" ? "Çalışıyor" : status === "error" ? "Hata" : "Hazır"}
            </span>
          </div>

          {/* Deep analysis toggle */}
          <button
            onClick={onToggleDeepAnalysis}
            className={`flex items-center gap-2 text-[12px] px-2.5 py-1 rounded-full border transition-all ${
              deepAnalysis
                ? "border-violet-300 bg-violet-50 text-violet-700"
                : "border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600"
            }`}
          >
            Derin Analiz
            <span className={`w-7 h-4 rounded-full relative transition-all ${deepAnalysis ? "bg-violet-500" : "bg-gray-200"}`}>
              <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-all ${deepAnalysis ? "left-3.5" : "left-0.5"}`} />
            </span>
          </button>

          {/* Settings shortcut */}
          <button
            onClick={() => onNavigate("settings")}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <Icon d={icons.settings} size={16} />
          </button>

          {/* Avatar */}
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-white text-[11px] font-semibold">
            A
          </div>
        </div>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
