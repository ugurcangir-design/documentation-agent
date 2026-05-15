import type { ReactNode } from "react";

type Page = "discovery" | "documents" | "settings";

interface LayoutProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  children: ReactNode;
}

const navItems: { id: Page; label: string; icon: string }[] = [
  { id: "discovery", label: "Ekran Keşfi", icon: "⬡" },
  { id: "documents", label: "Döküman Kütüphanesi", icon: "▤" },
];

export default function Layout({ currentPage, onNavigate, children }: LayoutProps) {
  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-60 bg-[#0f1117] flex flex-col flex-shrink-0">
        {/* Brand */}
        <div className="px-5 py-5 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center flex-shrink-0">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 11L5 4L7 8L9 5.5L12 11H2Z" fill="white" fillOpacity="0.9"/>
                <circle cx="10" cy="3.5" r="1.5" fill="white" fillOpacity="0.7"/>
              </svg>
            </div>
            <div>
              <p className="text-white text-sm font-semibold leading-tight">Analysis Studio</p>
              <p className="text-white/40 text-xs">Doc Agent v2</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          <p className="text-white/30 text-[10px] font-semibold uppercase tracking-wider px-3 mb-2">
            İş Akışı
          </p>
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all ${
                currentPage === item.id
                  ? "bg-white/10 text-white font-medium"
                  : "text-white/50 hover:bg-white/[0.06] hover:text-white/80"
              }`}
            >
              <span className="text-base leading-none opacity-70">{item.icon}</span>
              <span>{item.label}</span>
              {currentPage === item.id && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-400" />
              )}
            </button>
          ))}
        </nav>

        {/* Bottom */}
        <div className="px-3 py-3 border-t border-white/[0.06] space-y-0.5">
          <button
            onClick={() => onNavigate("settings")}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all ${
              currentPage === "settings"
                ? "bg-white/10 text-white font-medium"
                : "text-white/40 hover:bg-white/[0.06] hover:text-white/70"
            }`}
          >
            <span className="text-base leading-none">⚙</span>
            <span>Ayarlar</span>
          </button>
          <div className="px-3 pt-2">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <p className="text-white/25 text-xs">localhost:3000</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto min-w-0">
        {children}
      </main>
    </div>
  );
}
