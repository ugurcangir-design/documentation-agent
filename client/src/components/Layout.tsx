import { type ReactNode, useEffect, useState } from "react";

export type Page =
  | "dashboard"
  | "discovery"
  | "documents"
  | "history"
  | "references"
  | "settings"
  | "prompts"
  | "update"
  | "kilavuz";

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
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);

const icons = {
  discovery: "M8 1.5A6.5 6.5 0 1 1 1.5 8 6.5 6.5 0 0 1 8 1.5zM10.5 10.5l3 3",
  documents: "M3 2h7l3 3v9H3V2zm7 0v3h3M6 7h5M6 9.5h5M6 12h3",
  history: "M8 3v5l3 2M8 1.5A6.5 6.5 0 1 0 14.5 8",
  settings:
    "M8 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0-3.5v2m0 9v2M3.5 3.5l1.4 1.4m5.2 5.2 1.4 1.4M1.5 8h2m9 0h2M3.5 12.5l1.4-1.4m5.2-5.2 1.4-1.4",
  prompts: "M2 3h12v2H2zM2 7h8v2H2zM2 11h10v2H2z",
  search: "M6.5 1.5A5 5 0 1 1 1.5 6.5a5 5 0 0 1 5-5zM10 10l4 4",
  sun: "M8 4.5A3.5 3.5 0 1 1 8 11.5 3.5 3.5 0 0 1 8 4.5zM8 .5v1.5M8 14v1.5M2.6 2.6l1 1M12.4 12.4l1 1M.5 8h1.5M14 8h1.5M2.6 13.4l1-1M12.4 3.6l1-1",
  moon: "M14 8.8A6 6 0 1 1 7.2 2 4.7 4.7 0 0 0 14 8.8z",
  menu: "M2 4h12M2 8h12M2 12h12",
  chevronL: "M10 3 5 8l5 5",
  chevronR: "M6 3l5 5-5 5",
};

const SIDEBAR_GROUPS = [
  {
    label: "GENEL",
    items: [
      {
        id: "dashboard" as Page,
        label: "Dashboard",
        icon: "M2 9h5v5H2zM9 2h5v5H9zM9 9h5v5H9zM2 2h5v5H2z",
      },
    ],
  },
  {
    label: "PİPELİNE",
    items: [{ id: "discovery" as Page, label: "Ekran Keşfi", icon: icons.discovery }],
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
  {
    label: "YARDIM",
    items: [
      { id: "kilavuz" as Page, label: "Kullanım Kılavuzu", icon: "M8 1.5A6.5 6.5 0 1 1 8 14.5 6.5 6.5 0 0 1 8 1.5zM8 7v4M8 5h.01" },
    ],
  },
];

type Theme = "dark" | "light";

function getInitialTheme(): Theme {
  const stored = localStorage.getItem("theme");
  return stored === "light" ? "light" : "dark";
}

function readAnalyst(): string {
  return localStorage.getItem("docagent_analyst") || "";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "A";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

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
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem("sidebar_collapsed") === "1"
  );
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("nav_groups") || "{}") as Record<string, boolean>;
    } catch {
      return {};
    }
  });
  const [analyst, setAnalyst] = useState<string>(readAnalyst);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("sidebar_collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    localStorage.setItem("nav_groups", JSON.stringify(openGroups));
  }, [openGroups]);

  useEffect(() => {
    setAnalyst(readAnalyst());
    fetch("/api/documents")
      .then((r) => r.json())
      .then((docs: unknown[]) => setDocCount(docs.length))
      .catch(() => {});
  }, [currentPage]);

  // Ayarlar sayfası analist adını güncelleyince sidebar da tazelensin.
  useEffect(() => {
    const onAnalyst = () => setAnalyst(readAnalyst());
    window.addEventListener("docagent:analyst", onAnalyst);
    return () => window.removeEventListener("docagent:analyst", onAnalyst);
  }, []);

  // İlk yüklemede backend'deki ANALYST_NAME'i localStorage'a senkronla (farklı
  // tarayıcı/ilk açılış için). localStorage anlık gösterim; backend kaynak.
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d: { values?: Record<string, string> }) => {
        const n = d.values?.["ANALYST_NAME"];
        if (n) {
          localStorage.setItem("docagent_analyst", n);
          setAnalyst(n);
        }
      })
      .catch(() => {});
  }, []);

  const badgeValues: Record<string, number | null> = { docs: docCount };
  const isGroupOpen = (label: string) => openGroups[label] !== false; // varsayılan açık
  const toggleGroup = (label: string) =>
    setOpenGroups((g) => ({ ...g, [label]: !(g[label] !== false) }));

  const breadcrumbSection =
    SIDEBAR_GROUPS.find((g) => g.items.some((i) => i.id === currentPage))?.label ?? "PİPELİNE";
  const breadcrumbLabel =
    SIDEBAR_GROUPS.flatMap((g) => g.items).find((i) => i.id === currentPage)?.label ?? "";
  const statusText =
    status === "running" ? "Çalışıyor" : status === "error" ? "Hata" : "Hazır";
  const analystDisplay = analyst || "Analist";

  return (
    <div className="relative flex h-screen overflow-hidden bg-app text-fg">
      {/* Fütüristik arka plan (tüm içeriğin arkasında) */}
      <div className="jarvis-bg" aria-hidden />

      {/* ── Sidebar ──────────────────────────────────────────── */}
      <aside
        className="relative z-10 flex-shrink-0 overflow-hidden bg-sidebar border-r border-sidebar-line transition-[width] duration-200 ease-out"
        style={{ width: collapsed ? 0 : 236 }}
      >
        <div className="w-[236px] h-full flex flex-col">
          {/* Brand */}
          <div className="px-3.5 py-3 border-b border-sidebar-line flex items-center gap-2.5">
            <div className="w-[28px] h-[28px] rounded-lg bg-gradient-to-br from-accent to-accent2 flex items-center justify-center flex-shrink-0 shadow-[0_0_16px_rgba(45,212,191,0.4)]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-on-accent">
                <polygon points="12 2 2 7 12 12 22 7 12 2" />
                <polyline points="2 17 12 22 22 17" />
                <polyline points="2 12 12 17 22 12" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-fg text-[13px] font-semibold leading-tight truncate">Doc Agent</p>
              <p className="text-fg3 text-[10px] font-mono mt-px">v2.0 · local</p>
            </div>
            <button
              onClick={() => setCollapsed(true)}
              title="Menüyü kapat"
              className="text-fg3 hover:text-fg hover:bg-surface2 rounded p-1 transition-colors"
            >
              <Icon d={icons.chevronL} size={14} />
            </button>
          </div>

          {/* Search */}
          <div className="px-3 py-2.5 border-b border-sidebar-line">
            <div className="flex items-center gap-2 bg-surface2 border border-line rounded-md px-2.5 py-1.5 focus-within:border-accent transition-colors">
              <span className="text-fg3">
                <Icon d={icons.search} size={12} />
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ara veya komut…"
                className="flex-1 bg-transparent text-fg text-[11.5px] outline-none placeholder:text-fg3 min-w-0"
              />
              <kbd className="text-fg3 text-[10px] font-mono bg-surface border border-line rounded px-1.5 leading-[15px]">
                ⌘K
              </kbd>
            </div>
          </div>

          {/* Nav groups */}
          <nav className="flex-1 overflow-y-auto px-2 py-1.5">
            {SIDEBAR_GROUPS.map((group) => {
              const open = isGroupOpen(group.label);
              const singleGeneral = group.items.length === 1 && group.label === "GENEL";
              return (
                <div key={group.label} className="mb-0.5">
                  {!singleGeneral && (
                    <button
                      onClick={() => toggleGroup(group.label)}
                      className="w-full flex items-center gap-1.5 px-2 pt-2.5 pb-1.5 text-fg3 hover:text-fg2 transition-colors"
                    >
                      <span className={`chevron ${open ? "open" : ""}`}>
                        <Icon d={icons.chevronR} size={9} />
                      </span>
                      <span className="section-label">{group.label}</span>
                    </button>
                  )}
                  {(open || singleGeneral) &&
                    group.items.map((item) => {
                      const badge =
                        "badgeKey" in item ? badgeValues[item.badgeKey as string] : null;
                      const active = currentPage === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => onNavigate(item.id)}
                          className={`relative w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md mb-px text-[12.5px] transition-colors text-left ${
                            active
                              ? "bg-surface2 text-fg"
                              : "text-fg2 hover:bg-surface2 hover:text-fg"
                          }`}
                        >
                          {active && (
                            <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-sm bg-accent shadow-[0_0_8px_rgba(45,212,191,0.7)]" />
                          )}
                          <span className={active ? "text-accent" : "text-fg3"}>
                            <Icon d={item.icon} size={14} />
                          </span>
                          <span className="flex-1 truncate">{item.label}</span>
                          {badge != null && badge > 0 && (
                            <span
                              className={`text-[10px] font-mono px-1.5 rounded-full min-h-[16px] inline-flex items-center ${
                                active ? "bg-accent-soft text-accent" : "bg-surface3 text-fg2"
                              }`}
                            >
                              {badge}
                            </span>
                          )}
                        </button>
                      );
                    })}
                </div>
              );
            })}
          </nav>

          {/* Analyst chip */}
          <div className="px-3 py-2.5 border-t border-sidebar-line">
            <button
              onClick={() => onNavigate("settings")}
              title="Analist adını Ayarlar'dan düzenle"
              className="w-full flex items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-surface2 transition-colors text-left"
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent to-accent2 flex items-center justify-center text-on-accent text-[11px] font-bold flex-shrink-0 shadow-[0_0_14px_rgba(45,212,191,0.35)]">
                {initials(analystDisplay)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-fg text-[12px] font-medium leading-tight truncate">{analystDisplay}</p>
                <p className="text-fg3 text-[10px] leading-tight truncate">Analist · Yerel</p>
              </div>
              <span className="text-fg3">
                <Icon d={icons.settings} size={13} />
              </span>
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main ─────────────────────────────────────────────── */}
      <div className="relative z-10 flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <div className="h-12 bg-surface/70 backdrop-blur border-b border-line flex items-center px-4 gap-3 flex-shrink-0">
          {/* Sidebar toggle */}
          <button
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Menüyü aç" : "Menüyü kapat"}
            className="text-fg2 hover:text-fg hover:bg-surface2 rounded-md p-1.5 transition-colors"
          >
            <Icon d={collapsed ? icons.menu : icons.chevronL} size={16} />
          </button>

          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 text-[11.5px] flex-1 min-w-0">
            <span className="text-fg3">
              {breadcrumbSection.charAt(0) + breadcrumbSection.slice(1).toLowerCase()}
            </span>
            <span className="text-fg3">/</span>
            <span className="text-fg font-medium truncate">{breadcrumb ?? breadcrumbLabel}</span>
          </div>

          {/* Status */}
          <div className="flex items-center gap-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full glow-dot ${
                status === "running"
                  ? "bg-amber-400 text-amber-400 animate-pulse"
                  : status === "error"
                  ? "bg-red-400 text-red-400"
                  : "bg-green-400 text-green-400"
              }`}
            />
            <span className="text-[11.5px] text-fg2">{statusText}</span>
          </div>

          <span className="w-px h-4 bg-line" />

          {/* Deep analysis toggle */}
          <button
            onClick={onToggleDeepAnalysis}
            className={`flex items-center gap-2 text-[11.5px] pl-3 pr-2.5 py-1 rounded-full border transition-colors ${
              deepAnalysis
                ? "border-accent bg-accent-soft text-accent"
                : "border-line text-fg2 hover:border-line-strong hover:text-fg"
            }`}
          >
            Derin Analiz
            <span
              className={`w-7 h-4 rounded-full relative transition-colors ${
                deepAnalysis ? "bg-accent" : "bg-surface3"
              }`}
            >
              <span
                className={`absolute top-0.5 w-3 h-3 rounded-full bg-surface shadow-sm transition-all ${
                  deepAnalysis ? "left-3.5" : "left-0.5"
                }`}
              />
            </span>
          </button>

          <span className="w-px h-4 bg-line" />

          {/* Theme toggle */}
          <button
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            title="Tema değiştir"
            className="text-fg3 hover:text-fg transition-colors"
          >
            <Icon d={theme === "dark" ? icons.sun : icons.moon} size={16} />
          </button>

          {/* Avatar */}
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-accent to-accent2 flex items-center justify-center text-on-accent text-[11px] font-semibold shadow-[0_0_12px_rgba(45,212,191,0.35)]">
            {initials(analystDisplay)}
          </div>
        </div>

        {/* Page content */}
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
