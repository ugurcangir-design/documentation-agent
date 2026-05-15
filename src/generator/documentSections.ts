export interface GeneratedDocumentSection {
  id: string;

  title: string;

  instruction: string;
}

export const DOCUMENT_SECTIONS: GeneratedDocumentSection[] = [
  {
    id: "overview",
    title: "Overview",
    instruction:
      "Feature'ın genel amacını ve sistem içindeki rolünü açıkla.",
  },

  {
    id: "business-context",
    title: "Business Context",
    instruction:
      "İş ihtiyaçlarını ve operasyonel amacı açıkla.",
  },

  {
    id: "user-flow",
    title: "User Flow",
    instruction:
      "Kullanıcı veya operasyon akışını açıkla.",
  },

  {
    id: "related-apis",
    title: "Related APIs",
    instruction:
      "Endpoint ilişkilerini ve API davranışlarını açıkla.",
  },

  {
    id: "service-relationships",
    title: "Service Relationships",
    instruction:
      "Servis bağımlılıklarını ve veri akışını açıkla.",
  },

  {
    id: "business-rules",
    title: "Business Rules",
    instruction:
      "Sadece context tarafından desteklenen iş kurallarını açıkla.",
  },

  {
    id: "error-cases",
    title: "Error / Validation Cases",
    instruction:
      "Hata durumlarını ve validasyon kurallarını açıkla.",
  },

  {
    id: "open-questions",
    title: "Open Questions",
    instruction:
      "Eksik veya doğrulanması gereken noktaları listele.",
  },
];