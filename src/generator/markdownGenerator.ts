import { FeatureContext } from "../types/featureContext";

export function generateTechnicalMarkdown(
  context: FeatureContext
): string {
  const lines: string[] = [];

  lines.push(`# ${context.featureName}`);
  lines.push("");

  lines.push("## Overview");
  lines.push("");
  lines.push(
    `Technical documentation generated for feature: ${context.featureName}`
  );
  lines.push("");

  lines.push("## Related BRD Sections");
  lines.push("");

  context.relatedSections.slice(0, 10).forEach((result) => {
    lines.push(`### ${result.section.title}`);
    lines.push("");
    lines.push(`Relevance Score: ${result.score}`);
    lines.push("");
    lines.push(result.section.content.substring(0, 1000));
    lines.push("");
  });

  lines.push("## Related Endpoints");
  lines.push("");

  context.relatedEndpoints.slice(0, 20).forEach((result) => {
    lines.push(
      `- [${result.endpoint.method}] ${result.endpoint.path}`
    );

    lines.push(
      `  Service: ${result.endpoint.serviceName}`
    );

    lines.push(
      `  Summary: ${result.endpoint.summary || "-"}`
    );

    lines.push("");
  });

  lines.push("## Open Questions");
  lines.push("");
  lines.push(
    "- Backend implementation details could not be verified."
  );
  lines.push(
    "- Validation rules should be confirmed with development team."
  );
  lines.push(
    "- Authorization/role controls should be verified."
  );

  return lines.join("\n");
}