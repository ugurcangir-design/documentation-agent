import { Endpoint } from "../types/endpoint";

export function extractEndpoints(
  swagger: any,
  sourceSwagger: string
): Endpoint[] {
  const paths = swagger.paths || {};

  const serviceName = sourceSwagger
    .replace(".json", "")
    .replace("_api-docs", "");

  const endpoints: Endpoint[] = [];

  for (const pathKey of Object.keys(paths)) {
    const pathItem = paths[pathKey];

    for (const method of Object.keys(pathItem)) {
      const operation = pathItem[method];

      endpoints.push({
        sourceSwagger,
        serviceName,

        method: method.toUpperCase(),
        path: pathKey,

        summary: operation.summary || "",

        tags: operation.tags || [],

        operationId: operation.operationId || "",
      });
    }
  }

  return endpoints;
}