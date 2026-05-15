import { useState, useEffect } from "react";

interface SettingsValues {
  ANTHROPIC_API_KEY: string;
  APP_BASE_URL: string;
  APP_USERNAME: string;
  APP_PASSWORD: string;
  CONFLUENCE_BASE_URL: string;
  CONFLUENCE_EMAIL: string;
  CONFLUENCE_API_TOKEN: string;
  CONFLUENCE_SPACE_KEY: string;
  CONFLUENCE_PARENT_PAGE_ID: string;
  MAX_DISCOVERY_DEPTH: string;
}

const DEFAULTS: SettingsValues = {
  ANTHROPIC_API_KEY: "",
  APP_BASE_URL: "",
  APP_USERNAME: "",
  APP_PASSWORD: "",
  CONFLUENCE_BASE_URL: "",
  CONFLUENCE_EMAIL: "",
  CONFLUENCE_API_TOKEN: "",
  CONFLUENCE_SPACE_KEY: "DOCS",
  CONFLUENCE_PARENT_PAGE_ID: "",
  MAX_DISCOVERY_DEPTH: "2",
};

export default function SettingsPage() {
  const [values, setValues] = useState<SettingsValues>(DEFAULTS);
  const [configured, setConfigured] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data: { values: Partial<SettingsValues>; configured: string[] }) => {
        setValues({ ...DEFAULTS, ...data.values });
        setConfigured(data.configured);
      })
      .catch(() => {});
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) throw new Error("Kayıt başarısız");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      setConfigured(
        Object.entries(values)
          .filter(([, v]) => !!v && !v.includes("••"))
          .map(([k]) => k)
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function set(key: keyof SettingsValues, val: string) {
    setValues((prev) => ({ ...prev, [key]: val }));
  }

  const isConfigured = (key: string) => configured.includes(key);

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Ayarlar</h1>
        <p className="text-gray-500 mt-1">
          API anahtarlarını ve bağlantı bilgilerini girin. Değerler{" "}
          <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">.env</code>{" "}
          dosyasına kaydedilir.
        </p>
      </div>

      <div className="space-y-6">
        {/* Claude */}
        <Section title="Claude API" icon="🤖">
          <Field
            label="Anthropic API Key"
            value={values.ANTHROPIC_API_KEY}
            onChange={(v) => set("ANTHROPIC_API_KEY", v)}
            type="password"
            placeholder="sk-ant-..."
            configured={isConfigured("ANTHROPIC_API_KEY")}
            required
          />
        </Section>

        {/* Target App */}
        <Section title="Hedef Uygulama" icon="🌐">
          <p className="text-xs text-gray-400 mb-3">
            Dökümanı yazılacak web uygulamasının URL ve giriş bilgileri
          </p>
          <Field
            label="Uygulama URL"
            value={values.APP_BASE_URL}
            onChange={(v) => set("APP_BASE_URL", v)}
            placeholder="https://uygulama.sirket.com"
            configured={isConfigured("APP_BASE_URL")}
            required
          />
          <Field
            label="Kullanıcı Adı / E-posta"
            value={values.APP_USERNAME}
            onChange={(v) => set("APP_USERNAME", v)}
            placeholder="kullanici@sirket.com"
            configured={isConfigured("APP_USERNAME")}
          />
          <Field
            label="Şifre"
            value={values.APP_PASSWORD}
            onChange={(v) => set("APP_PASSWORD", v)}
            type="password"
            placeholder="••••••••"
            configured={isConfigured("APP_PASSWORD")}
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Keşif Derinliği
            </label>
            <select
              value={values.MAX_DISCOVERY_DEPTH}
              onChange={(e) => set("MAX_DISCOVERY_DEPTH", e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="1">1 — Sadece ana sayfa linkleri</option>
              <option value="2">2 — 2 seviye derinlik (önerilen)</option>
              <option value="3">3 — 3 seviye derinlik</option>
            </select>
          </div>
        </Section>

        {/* Confluence */}
        <Section title="Confluence" icon="📘">
          <p className="text-xs text-gray-400 mb-3">
            Dökümanları yayınlamak için Atlassian Confluence bağlantısı
          </p>
          <Field
            label="Confluence URL"
            value={values.CONFLUENCE_BASE_URL}
            onChange={(v) => set("CONFLUENCE_BASE_URL", v)}
            placeholder="https://sirket.atlassian.net"
            configured={isConfigured("CONFLUENCE_BASE_URL")}
          />
          <Field
            label="E-posta"
            value={values.CONFLUENCE_EMAIL}
            onChange={(v) => set("CONFLUENCE_EMAIL", v)}
            placeholder="kullanici@sirket.com"
            configured={isConfigured("CONFLUENCE_EMAIL")}
          />
          <Field
            label="API Token"
            value={values.CONFLUENCE_API_TOKEN}
            onChange={(v) => set("CONFLUENCE_API_TOKEN", v)}
            type="password"
            placeholder="ATATT3x..."
            configured={isConfigured("CONFLUENCE_API_TOKEN")}
          />
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Space Key"
              value={values.CONFLUENCE_SPACE_KEY}
              onChange={(v) => set("CONFLUENCE_SPACE_KEY", v)}
              placeholder="DOCS"
              configured={isConfigured("CONFLUENCE_SPACE_KEY")}
            />
            <Field
              label="Üst Sayfa ID (opsiyonel)"
              value={values.CONFLUENCE_PARENT_PAGE_ID}
              onChange={(v) => set("CONFLUENCE_PARENT_PAGE_ID", v)}
              placeholder="123456"
              configured={isConfigured("CONFLUENCE_PARENT_PAGE_ID")}
            />
          </div>
        </Section>
      </div>

      {/* Save */}
      <div className="mt-8 flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
        >
          {saving ? "Kaydediliyor..." : "Kaydet"}
        </button>
        {saved && (
          <span className="text-sm text-green-600 font-medium">
            ✓ Ayarlar kaydedildi
          </span>
        )}
        {error && (
          <span className="text-sm text-red-600">{error}</span>
        )}
      </div>

      <p className="text-xs text-gray-400 mt-4">
        Şifreler ve API anahtarları sadece yerel{" "}
        <code className="bg-gray-100 px-1 py-0.5 rounded">.env</code>{" "}
        dosyasına kaydedilir. Değerler GitHub'a push edilmez.
      </p>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
        <span>{icon}</span>
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  configured,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  configured?: boolean;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1.5">
        {label}
        {required && <span className="text-red-400 text-xs">*</span>}
        {configured && (
          <span className="text-green-500 text-xs font-normal">✓ ayarlı</span>
        )}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}
