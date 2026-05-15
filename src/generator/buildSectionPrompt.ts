import { GeneratedDocumentSection } from "./documentSections";

export function buildSectionPrompt(
  section: GeneratedDocumentSection,
  contextJson: string
): string {
  return `
You are a senior technical documentation specialist.

Generate ONLY the following section:

# ${section.title}

SECTION INSTRUCTION:
${section.instruction}

IMPORTANT RULES:

- Use ONLY the provided context.
- NEVER invent information.
- Documentation language must be Turkish.
- Keep markdown clean.
- Avoid duplicate explanations.
- If information is missing, write:
  "Doğrulama Gerekiyor"
- Do not generate unrelated sections.
- Return ONLY this section.

CONTEXT:
${contextJson}
`;
}