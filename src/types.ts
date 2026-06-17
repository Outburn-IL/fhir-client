import { Bundle, FhirVersion, Resource } from '@outburn/types';

export interface FhirClientConfig {
  baseUrl: string;
  fhirVersion: FhirVersion;
  auth?: {
    username?: string;
    password?: string;
    // Future: token, etc.
  };
  headers?: Record<string, string>;
  timeout?: number; // Request timeout in milliseconds (default: 30000)
  cache?: {
    enable: boolean;
    max?: number; // Max items
    ttl?: number; // Time to live in ms
  };
  maxFetchAllResults?: number; // Maximum number of resources to fetch when using fetchAll (default: 10000)
}

export interface SearchParams {
  [key: string]: string | number | boolean | (string | number | boolean)[];
}

export type SearchTransform<TResource extends Resource = Resource, TResult = TResource> = (
  resource: TResource,
  mode: string | undefined,
  index: number,
  entry: NonNullable<Bundle<TResource>['entry']>[number],
) => TResult | undefined | Promise<TResult | undefined>;

type SearchOptionsBase = {
  maxResults?: number;
  asPost?: boolean;
  noCache?: boolean;
};

export type SearchOptions<TResource extends Resource = Resource, TResult = TResource> =
  | (SearchOptionsBase & {
      fetchAll?: false;
      transform?: never;
    })
  | (SearchOptionsBase & {
      fetchAll: boolean;
      transform?: never;
    })
  | (SearchOptionsBase & {
      fetchAll: true;
      transform?: SearchTransform<TResource, TResult>;
    });

/**
 * Response wrapper returned by `readWithResponse()` and `conditionalRead()`.
 * Exposes HTTP status, headers, and (when present) the parsed resource body.
 */
export interface FhirResponse<T> {
  /** HTTP status code (e.g. 200, 304, 404, 410). */
  status: number;
  /** Response headers (lower-cased keys). */
  headers: Record<string, string | undefined>;
  /** Parsed resource body. Present for 200 (and 201), absent for 304/404/410. */
  resource?: T;
}

/**
 * Options accepted by `readWithResponse()`.
 */
export interface ReadWithResponseOptions {
  /** Bypass the internal LRU cache. */
  noCache?: boolean;
  /** Per-request HTTP headers (e.g. `If-None-Match`, `If-Modified-Since`). */
  headers?: Record<string, string>;
}

/**
 * Condition descriptor for `conditionalRead()`.
 */
export interface ConditionalReadCondition {
  /** Resource `meta.versionId` – will be sent as `If-None-Match: W/"<versionId>"`. */
  versionId?: string;
  /** FHIR instant (`meta.lastUpdated`, ISO 8601) – will be sent as `If-Modified-Since`. */
  lastUpdated?: string;
}

/**
 * Typed error thrown for non-recoverable HTTP failures (e.g. 401, 403, 500).
 * Carries the HTTP status, response headers, and (if available) the OperationOutcome body.
 */
export class FhirClientError extends Error {
  /** HTTP status code. */
  status: number;
  /** Response headers (lower-cased keys). */
  headers: Record<string, string | undefined>;
  /** OperationOutcome body returned by the server, if any. */
  operationOutcome?: unknown;
  /** Request metadata for diagnostic purposes. */
  request?: { method: string; url: string; resourceType?: string; id?: string };

  constructor(
    message: string,
    status: number,
    headers: Record<string, string | undefined>,
    operationOutcome?: unknown,
    request?: { method: string; url: string; resourceType?: string; id?: string },
  ) {
    super(message);
    this.name = 'FhirClientError';
    this.status = status;
    this.headers = headers;
    this.operationOutcome = operationOutcome;
    this.request = request;
  }
}
