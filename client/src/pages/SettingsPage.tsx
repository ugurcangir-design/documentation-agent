import { useState, useEffect } from "react";

interface SettingsValues {
  CLAUDE_BACKEND: string;
  CLAUDE_CLI_BIN: string;
  ANTHROPIC_API_KEY: string;
  APP_BASE_URL: string;
  APP_USERNAME: string;
  APP_PASSWORD: string;
  ATLASSIAN_OAUTH_CLIENT_ID: string;
  ATLASSIAN_OAUTH_CLIENT_SECRET: string;
  CONFLUENCE_BASE_URL: string;
  CONFLUENCE_EMAIL: string;
  CONFLUENCE_API_TOKEN: string;
  CONFLUENCE_SPACE_KEY: string;
  CONFLUENCE_PARENT_PAGE_ID: string;
  MAX_DISCOVERY_DEPTH: string;
}

const DEFAULTS: SettingsValues = {
  CLAUDE_BACKEND: "cli",
  CLAUDE_CLI_BIN: "claude",
  ANTHROPIC_API_KEY: "",
  APP_BASE_URL: "",
  APP_USERNAME: "",
  APP_PASSWORD: "",
  ATLASSIAN_OAUTH_CLIENT_ID: "",
  ATLASSIAN_OAUTH_CLIENT_SECRET: "",
  CONFLUENCE_BASE_URL: "",
  CONFLUENCE_EMAIL: "",
  CONFLUENCE_API_TOKEN: "",
  CONFLUENCE_SPACE_KEY: "DOCS",
  CONFLUENCE_PARENT_PAGE_ID: "",
  MAX_DISCOVERY_DEPTH: "0",
};

interface OAuthStatus {
  clientConfigured: boolean;
  connected: boolean;
  siteUrl: string | null;
  cloudId: string | null;
  scope: string | null;
  expiresAt: number | null;
  redirectUri: string;
}

export default function SettingsPage() {
  const [values, setValues] = useState<SettingsValues>(DEFAULTS);
  const [configured, setConfigured] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oauth, setOauth] = useState<OAuthStatus | null>(null);

  const refreshOauth = () => {
    fetch("/api/auth/atlassian/status")
      .then((r) => r.json())
      .then((d: OAuthStatus) => setOauth(d))
      .catch(() => {});
  };

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data: { values: Partial<SettingsValues>; configured: string[] }) => {
        setValues({ ...DEFAULTS, ...data.values });
        setConfigured(data.configured);
      })
      .catch(() => {});
    refreshOauth();
    const i = setInterval(refreshOauth, 5000);
    return () => clearInterval(i);
  }, []);

  async function connectAtlassian() {
    // Save credentials first so they're available server-side
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    window.open("/api/auth/atlassian/start", "_blank", "width=620,height=720");
  }

  async function disconnectAtlassian() {
    await fetch("/api/auth/atlassian/disconnect", { method: "POST" });
    refreshOauth();
  }

  async function testAtlassian() {
    setError(null);
    try {
      const r = await fetch("/api/auth/atlassian/test");
      const d = await r.json() as { ok?: boolean; error?: string; status?: number; body?: string; sampleSpaceCount?: number };
      if (d.ok) {
        setSaved(true); setTimeout(() => setSaved(false), 2500);
      } else {
        setError(`Test başarısız: ${d.error ?? `HTTP ${d.status} — ${d.body?.slice(0, 200)}`}`);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

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
        <Section title="Claude Backend" icon="🤖">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Çalışma Şekli</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                {
                  v: "cli",
                  label: "Claude CLI",
                  hint: "Claude Code'un yerel auth'unu kullanır. Subscription ile çalışır. (Önerilen)",
                },
                {
                  v: "api",
                  label: "Anthropic API",
                  hint: "ANTHROPIC_API_KEY ile direkt API. Pay-per-token.",
                },
              ].map((opt) => (
                <label
                  key={opt.v}
                  className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
                    values.CLAUDE_BACKEND === opt.v
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="claude_backend"
                    value={opt.v}
                    checked={values.CLAUDE_BACKEND === opt.v}
                    onChange={() => set("CLAUDE_BACKEND", opt.v)}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-800">{opt.label}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">{opt.hint}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {values.CLAUDE_BACKEND === "cli" ? (
            <>
              <Field
                label="Claude CLI Yolu"
                value={values.CLAUDE_CLI_BIN}
                onChange={(v) => set("CLAUDE_CLI_BIN", v)}
                placeholder="claude"
                configured={isConfigured("CLAUDE_CLI_BIN")}
              />
              <div className="bg-amber-50 border border-amber-200 text-amber-800 text-[11px] px-3 py-2 rounded-lg">
                Claude Code kurulu değilse:{" "}
                <code className="bg-amber-100 px-1 rounded">npm install -g @anthropic-ai/claude-code</code>
                . Komutun PATH'te olduğundan emin olun veya tam yolu girin (örn: <code className="bg-amber-100 px-1 rounded">/usr/local/bin/claude</code>).
              </div>
            </>
          ) : (
            <Field
              label="Anthropic API Key"
              value={values.ANTHROPIC_API_KEY}
              onChange={(v) => set("ANTHROPIC_API_KEY", v)}
              type="password"
              placeholder="sk-ant-..."
              configured={isConfigured("ANTHROPIC_API_KEY")}
              required
            />
          )}
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
              Keşif Modu
            </label>
            <select
              value={values.MAX_DISCOVERY_DEPTH}
              onChange={(e) => set("MAX_DISCOVERY_DEPTH", e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="0">Tek ekran — sadece verilen URL (önerilen)</option>
              <option value="1">1 seviye — verilen URL + sayfasındaki linkler</option>
              <option value="2">2 seviye — alt sayfalar dahil</option>
              <option value="3">3 seviye — derin tarama</option>
            </select>
            <p className="text-[11px] text-gray-400 mt-1">
              "Tek ekran" modunda agent sadece girilen URL'i ziyaret eder, içindeki tüm buton/alan/metin Claude Vision ile analiz edilir.
            </p>
          </div>
        </Section>

        {/* Atlassian OAuth */}
        <Section title="Atlassian (Confluence + Jira)" icon="📘">
          <p className="text-xs text-gray-400 mb-3">
            OAuth 2.0 ile bağlanın. Developer Console'da OAuth uygulaması oluşturun,
            redirect URI olarak <code className="bg-gray-100 px-1 rounded text-[11px]">{oauth?.redirectUri ?? "http://localhost:3000/api/auth/atlassian/callback"}</code> ekleyin.
          </p>

          {/* Connection status */}
          <div className={`rounded-lg border p-3 mb-3 ${
            oauth?.connected ? "bg-green-50 border-green-200" : "bg-gray-50 border-gray-200"
          }`}>
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-sm font-medium ${oauth?.connected ? "text-green-800" : "text-gray-600"}`}>
                  {oauth?.connected ? "✓ Bağlı" : "Bağlı değil"}
                </p>
                {oauth?.connected && (
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    Site: <code className="bg-white px-1 rounded">{oauth.siteUrl}</code>
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                {oauth?.connected ? (
                  <>
                    <button
                      onClick={testAtlassian}
                      className="px-3 py-1.5 text-xs border border-gray-200 text-gray-600 rounded-lg hover:bg-white"
                    >
                      Test Et
                    </button>
                    <button
                      onClick={disconnectAtlassian}
                      className="px-3 py-1.5 text-xs border border-red-200 text-red-600 rounded-lg hover:bg-red-50"
                    >
                      Bağlantıyı Kes
                    </button>
                  </>
                ) : (
                  <button
                    onClick={connectAtlassian}
                    disabled={!values.ATLASSIAN_OAUTH_CLIENT_ID || !values.ATLASSIAN_OAUTH_CLIENT_SECRET}
                    className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40"
                  >
                    Atlassian'a Bağlan
                  </button>
                )}
              </div>
            </div>
          </div>

          <Field
            label="OAuth Client ID"
            value={values.ATLASSIAN_OAUTH_CLIENT_ID}
            onChange={(v) => set("ATLASSIAN_OAUTH_CLIENT_ID", v)}
            placeholder="developer.atlassian.com/console/myapps/"
            configured={isConfigured("ATLASSIAN_OAUTH_CLIENT_ID")}
          />
          <Field
            label="OAuth Client Secret"
            value={values.ATLASSIAN_OAUTH_CLIENT_SECRET}
            onChange={(v) => set("ATLASSIAN_OAUTH_CLIENT_SECRET", v)}
            type="password"
            placeholder="••••••••••••"
            configured={isConfigured("ATLASSIAN_OAUTH_CLIENT_SECRET")}
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

          <details className="mt-2">
            <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">
              Eski API token yöntemi (OAuth yoksa fallback)
            </summary>
            <div className="mt-3 space-y-3 pl-3 border-l-2 border-gray-100">
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
            </div>
          </details>
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
  const isSecretConfigured = type === "password" && configured && !value;
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1.5">
        {label}
        {required && <span className="text-red-400 text-xs">*</span>}
        {configured && (
          <span className="text-green-500 text-xs font-normal">✓ kayıtlı</span>
        )}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={isSecretConfigured ? "Değiştirmek için yeni değer girin (boş bırakırsanız mevcut korunur)" : placeholder}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        autoComplete="off"
      />
    </div>
  );
}
