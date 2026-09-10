import fs from "fs";
import path from "path";

interface PromptCfg {
  role?: string;
  outputStructure?: string;
  instructions?: string;
  rules?: string[];
  language?: string;
  maxTokens?: number;
}

const PATH = path.join(process.cwd(), "data", "prompts", "config.json");

export function loadPromptConfig(key: string): PromptCfg {
  if (!fs.existsSync(PATH)) {
    // Sessiz düşme yerine uyar: dosya yoksa role/outputStructure/rules
    // ("uydurma yasak" dahil) tümü kaybolur, üretim kuralsız/yapısız devam eder.
    console.warn(`[promptConfig] Yapılandırma dosyası bulunamadı (${PATH}) — '${key}' için varsayılanlara düşülüyor, kritik kurallar/yapı devrede olmayabilir.`);
    return {};
  }
  const data = JSON.parse(fs.readFileSync(PATH, "utf-8")) as Record<string, PromptCfg>;
  if (!data[key]) {
    console.warn(`[promptConfig] '${key}' anahtarı yapılandırmada yok — varsayılanlara düşülüyor, kritik kurallar/yapı devrede olmayabilir.`);
  }
  return data[key] ?? {};
}

/**
 * Prompt yapılandırmasının üretim için sağlıklı olup olmadığını denetler.
 * Dosya/anahtar eksikse ya da kritik guardrail alanları (userManual çıktı
 * yapısı + kuralları, screenAnalysis talimatı) tanımsızsa sorunları döndürür.
 * documentationJob bunu job başında bir kez çağırır; sorun varsa doküman-başı
 * uyarı + canlı akışa bildirim düşer (sessiz kalite kaybını görünür yapar).
 */
export function checkPromptConfigHealth(): { ok: boolean; problems: string[] } {
  if (!fs.existsSync(PATH)) {
    return { ok: false, problems: [`Prompt yapılandırma dosyası bulunamadı (${PATH})`] };
  }
  let data: Record<string, PromptCfg>;
  try {
    data = JSON.parse(fs.readFileSync(PATH, "utf-8")) as Record<string, PromptCfg>;
  } catch (e) {
    return { ok: false, problems: [`Prompt yapılandırması ayrıştırılamadı: ${(e as Error).message}`] };
  }
  const problems: string[] = [];
  const um = data.userManual;
  if (!um || (!um.outputStructure && (!um.rules || um.rules.length === 0))) {
    problems.push("userManual promptu eksik (çıktı yapısı ve kurallar tanımsız — 'uydurma yasak' dahil kritik guardrail'ler devre dışı)");
  }
  const sa = data.screenAnalysis;
  if (!sa || !sa.instructions) {
    problems.push("screenAnalysis promptu eksik (analiz talimatı tanımsız — kapsam/nav dışlama kuralları düşebilir)");
  }
  return { ok: problems.length === 0, problems };
}

export function buildPromptHeader(cfg: PromptCfg): string {
  const parts: string[] = [];
  if (cfg.role) parts.push(cfg.role);
  return parts.join("\n");
}

export function buildPromptFooter(
  cfg: PromptCfg,
  opts: { skipStructure?: boolean } = {}
): string {
  const parts: string[] = [];
  // Sekme bölümleri için tam çıktı yapısı (tüm standart başlıklar) ATLANIR —
  // aksi halde her sekme 'Filtreler', 'Modallar', 'Sık Sorular' gibi standart
  // bölümleri yeniden üretiyor → tekrar + token israfı. Bu başlıklar genel
  // bakışa aittir.
  if (cfg.outputStructure && !opts.skipStructure) {
    parts.push(`Şu yapıyı kullan:\n\n${cfg.outputStructure}`);
  }
  if (cfg.rules && cfg.rules.length > 0) {
    parts.push(`Kurallar:\n${cfg.rules.map((r) => `- ${r}`).join("\n")}`);
  }
  return parts.join("\n\n");
}
