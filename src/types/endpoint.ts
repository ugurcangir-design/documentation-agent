export interface Endpoint {
  sourceSwagger: string;
  serviceName: string;

  method: string;
  path: string;

  summary?: string;

  tags?: string[];

  operationId?: string;
}