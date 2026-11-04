/**
 * Davranış kanıtı veri modeli (Faz 0 — docs/PLAN-davranis-kesfi.md).
 *
 * Keşif sırasında deterministik olarak toplanan network/form/DOM kanıtı
 * (`StateEvidence`) ve bunlardan türetilen/referanslarla doğrulanan davranış
 * kuralları (`BehaviorFact`). Tüm alanlar OPSİYONEL eklenir → eski
 * screens.json / cache kayıtları aynen çalışır.
 */

/** Keşifte yakalanan tek bir aynı-origin XHR/fetch isteği (değerler maskeli). */
export interface NetRequest {
  method: string;
  /** API host'u (ör. api.example.com / app-bff.example.com). Sayfa origin'inden farklı
   *  olabilir — BFF/API genelde ayrı alt alan adındadır. */
  host?: string;
  /** Yalnız path (origin yok). */
  path: string;
  /** Query parametreleri — anahtar KORUNUR, hassas değer maskelenir. */
  query: Record<string, string>;
  /** JSON gövde varsa üst düzey anahtarları (değerler ASLA tutulmaz). */
  bodyKeys?: string[];
  status?: number;
  resourceType?: string;
}

/** Bir ekran state'ine (görsel) bağlı yapısal kanıt. */
export interface StateEvidence {
  /** Bu state'i üreten etkileşimden hemen sonra tetiklenen istekler. */
  requests?: NetRequest[];
  /** Test verisiyle doldurulan alanlar: etiket → değer (maskeli). */
  formValues?: Record<string, string>;
  /** Ekran görüntüsünden anlaşılmayan DOM gerçekleri (zorunlu alan, disabled…). */
  domFacts?: string[];
}

export type BehaviorKind =
  | "filter-precedence"   // A doluysa B isteğe dahil edilmez
  | "filter-combine"      // filtreler birlikte (AND) gönderilir
  | "required-field"      // boş arama / zorunlu alan davranışı
  | "sort"
  | "pagination"
  | "validation"
  | "navigation"
  | "other";

export type BehaviorSource = "observed" | "reference" | "both";

export interface BehaviorRef {
  /** brd | confluence | jira_task | process_analysis | manual … */
  type: string;
  id: string;
  title?: string;
}

/** Kılavuza girecek, kanıtlı ve kaynaklı davranış kuralı. */
export interface BehaviorFact {
  id: string;
  screenPath: string;
  kind: BehaviorKind;
  /** Kullanıcı diliyle Türkçe kural cümlesi. */
  statement: string;
  evidence: {
    stateLabels?: string[];
    requests?: NetRequest[];
    /** Kısa teknik not (ör. istek diff'i). */
    note?: string;
  };
  source: BehaviorSource;
  refs?: BehaviorRef[];
  confidence: "high" | "medium" | "low";
  /** Gözlem ile referans çelişiyorsa true — kılavuzda uyarı basılır. */
  conflict?: boolean;
}
