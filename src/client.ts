import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { LRUCache } from 'lru-cache';
import { Bundle, CapabilityStatement, Resource } from '@outburn/types';
import {
  FhirClientConfig,
  FhirClientError,
  FhirResponse,
  ReadWithResponseOptions,
  ConditionalReadCondition,
  SearchParams,
  SearchOptions,
  SearchTransform,
} from './types';
import { mergeSearchParams, normalizeFhirVersion, formatWeakEtag, toHttpDate } from './utils';

export class FhirClient {
  private client: AxiosInstance;
  private config: FhirClientConfig;
  private cache?: LRUCache<string, Record<string, unknown>>;

  private static readonly sensitiveHeaderNames = new Set([
    'authorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',
  ]);

  private toFhirClientError(
    error: unknown,
    config: AxiosRequestConfig,
    requestMeta?: { resourceType?: string; id?: string },
  ): FhirClientError | undefined {
    if (!axios.isAxiosError(error)) {
      return undefined;
    }

    const status = error.response?.status ?? 0;
    const headers = error.response ? this.extractHeaders(error.response, true) : {};
    const data = error.response?.data;
    const operationOutcome =
      data &&
      typeof data === 'object' &&
      (data as Record<string, unknown>).resourceType === 'OperationOutcome'
        ? data
        : undefined;

    return new FhirClientError(
      status > 0 ? `FHIR request failed with status ${status}` : `FHIR request failed: ${error.message}`,
      status,
      headers,
      operationOutcome,
      {
        method: config.method ?? 'GET',
        url: config.url ?? '',
        resourceType: requestMeta?.resourceType,
        id: requestMeta?.id,
      },
    );
  }

  constructor(config: FhirClientConfig) {
    this.config = config;
    const fhirVersion = normalizeFhirVersion(config.fhirVersion);
    const headers: Record<string, string> = {
      Accept: `application/fhir+json; fhirVersion=${fhirVersion}`,
      ...config.headers,
    };

    if (config.auth) {
      // Basic Auth is handled by Axios auth config or header
      // We'll use Axios auth config if provided, or manual header
      if (config.auth.username && config.auth.password) {
        // Axios handles this automatically if passed in config
      }
    }

    this.client = axios.create({
      baseURL: config.baseUrl,
      headers,
      timeout: config.timeout ?? 30000, // Default 30 seconds
      auth:
        config.auth?.username && config.auth?.password
          ? {
              username: config.auth.username,
              password: config.auth.password,
            }
          : undefined,
    });

    if (config.cache?.enable) {
      this.cache = new LRUCache({
        max: config.cache.max || 100,
        ttl: config.cache.ttl || 1000 * 60 * 5, // 5 minutes default
      });
    }
  }

  private async request<T = unknown>(
    config: AxiosRequestConfig,
    noCache = false,
    requestMeta?: { resourceType?: string; id?: string },
  ): Promise<T> {
    const cacheKey = this.cache ? JSON.stringify(config) : null;

    if (this.cache && config.method?.toLowerCase() === 'get' && !noCache) {
      const cached = this.cache.get(cacheKey!);
      if (cached) {
        return cached as T;
      }
    }

    // Ensure Content-Type is set for mutation requests
    if (
      ['post', 'put', 'patch'].includes(config.method?.toLowerCase() || '') &&
      !config.headers?.['Content-Type']
    ) {
      const fhirVersion = normalizeFhirVersion(this.config.fhirVersion);
      config.headers = {
        ...config.headers,
        'Content-Type': `application/fhir+json; fhirVersion=${fhirVersion}`,
      };
    }

    try {
      const response: AxiosResponse<T> = await this.client.request(config);

      if (this.cache && config.method?.toLowerCase() === 'get' && !noCache) {
        this.cache.set(cacheKey!, response.data as Record<string, unknown>);
      }

      return response.data;
    } catch (error) {
      const normalizedError = this.toFhirClientError(error, config, requestMeta);
      if (normalizedError) {
        throw normalizedError;
      }
      throw error;
    }
  }

  /**
   * Low-level helper that returns a full {@link FhirResponse} instead of just
   * the body.  Does **not** throw for 304 / 404 / 410.
   */
  private async requestWithResponse<T = unknown>(
    config: AxiosRequestConfig,
    noCache = false,
    requestMeta?: { resourceType?: string; id?: string },
  ): Promise<FhirResponse<T>> {
    const cacheKey = this.cache ? JSON.stringify(config) : null;

    if (this.cache && config.method?.toLowerCase() === 'get' && !noCache) {
      const cached = this.cache.get(cacheKey!);
      if (cached) {
        return { status: 200, headers: {}, resource: cached as T };
      }
    }

    try {
      const response: AxiosResponse<T> = await this.client.request({
        ...config,
        // Tell Axios not to reject on any status so we can handle 304/404/410
        validateStatus: (status: number) =>
          (status >= 200 && status < 300) || status === 304 || status === 404 || status === 410,
      });

      const headers = this.extractHeaders(response);

      if (response.status === 304 || response.status === 404 || response.status === 410) {
        return { status: response.status, headers, resource: undefined };
      }

      // Cache on success
      if (this.cache && config.method?.toLowerCase() === 'get' && !noCache) {
        this.cache.set(cacheKey!, response.data as Record<string, unknown>);
      }

      return { status: response.status, headers, resource: response.data };
    } catch (err) {
      const normalizedError = this.toFhirClientError(err, config, requestMeta);
      if (normalizedError) {
        throw normalizedError;
      }
      throw err;
    }
  }

  /**
   * Extract response headers into a plain Record with lower-cased keys.
   */
  private extractHeaders(
    response: AxiosResponse,
    redactSensitive = false,
  ): Record<string, string | undefined> {
    const headers: Record<string, string | undefined> = {};
    if (response.headers) {
      for (const [key, value] of Object.entries(response.headers)) {
        const normalizedKey = key.toLowerCase();
        if (redactSensitive && FhirClient.sensitiveHeaderNames.has(normalizedKey)) {
          continue;
        }

        headers[normalizedKey] = typeof value === 'string' ? value : undefined;
      }
    }
    return headers;
  }

  getBaseUrl(): string {
    return this.config.baseUrl;
  }

  async read<T extends Resource = Resource>(
    resourceType: string,
    id: string,
    options?: { noCache?: boolean; headers?: Record<string, string> },
  ): Promise<T> {
    return this.request<T>(
      {
        method: 'GET',
        url: `${resourceType}/${id}`,
        headers: options?.headers,
      },
      options?.noCache,
      { resourceType, id },
    );
  }

  /**
   * Like {@link read} but returns a {@link FhirResponse} wrapper that exposes
   * the HTTP status code and response headers.  Does **not** throw for
   * `304 Not Modified`, `404 Not Found`, or `410 Gone`.
   *
   * This is the primary API for implementing conditional reads / polling.
   */
  async readWithResponse<T = unknown>(
    resourceType: string,
    id: string,
    options?: ReadWithResponseOptions,
  ): Promise<FhirResponse<T>> {
    const normalizedHeaders =
      options?.headers && Object.keys(options.headers).length > 0 ? options.headers : undefined;
    return this.requestWithResponse<T>(
      {
        method: 'GET',
        url: `${resourceType}/${id}`,
        headers: normalizedHeaders,
      },
      options?.noCache,
      { resourceType, id },
    );
  }

  /**
   * Convenience helper that builds the appropriate conditional-read headers
   * (`If-None-Match` / `If-Modified-Since`) from cached version metadata and
   * delegates to {@link readWithResponse}.
   *
   * Precedence:
   * 1. If `condition.versionId` is present → sends `If-None-Match: W/"<versionId>"`.
   * 2. Else if `condition.lastUpdated` is a valid ISO instant → sends `If-Modified-Since`.
   * 3. Otherwise performs an unconditional read.
   */
  async conditionalRead<T = unknown>(
    resourceType: string,
    id: string,
    condition: ConditionalReadCondition,
    options?: { noCache?: boolean },
  ): Promise<FhirResponse<T>> {
    const headers: Record<string, string> = {};

    if (condition.versionId) {
      headers['If-None-Match'] = formatWeakEtag(condition.versionId);
    } else if (condition.lastUpdated) {
      const httpDate = toHttpDate(condition.lastUpdated);
      if (httpDate) {
        headers['If-Modified-Since'] = httpDate;
      }
    }

    const normalizedHeaders = Object.keys(headers).length > 0 ? headers : undefined;

    return this.readWithResponse<T>(resourceType, id, {
      noCache: options?.noCache,
      headers: normalizedHeaders,
    });
  }

  async getCapabilities(): Promise<CapabilityStatement> {
    return this.request<CapabilityStatement>({
      method: 'GET',
      url: 'metadata',
    });
  }

  async processTransaction<T extends Resource = Resource>(bundle: Bundle<T>): Promise<Bundle<T>> {
    if (bundle.resourceType !== 'Bundle') {
      throw new Error(`processTransaction requires a Bundle resource, got ${bundle.resourceType}`);
    }
    if (bundle.type !== 'transaction') {
      throw new Error(
        `processTransaction requires a Bundle of type 'transaction', got '${bundle.type}'`,
      );
    }
    return this.request<Bundle<T>>({
      method: 'POST',
      url: '',
      data: bundle,
    });
  }

  async processBatch<T extends Resource = Resource>(bundle: Bundle<T>): Promise<Bundle<T>> {
    if (bundle.resourceType !== 'Bundle') {
      throw new Error(`processBatch requires a Bundle resource, got ${bundle.resourceType}`);
    }
    if (bundle.type !== 'batch') {
      throw new Error(`processBatch requires a Bundle of type 'batch', got '${bundle.type}'`);
    }
    return this.request<Bundle<T>>({
      method: 'POST',
      url: '',
      data: bundle,
    });
  }

  async create<T extends Resource = Resource>(resourceType: string, resource: T): Promise<T> {
    return this.request<T>({
      method: 'POST',
      url: resourceType,
      data: resource,
    });
  }

  async update<T extends Resource = Resource>(
    resource: T,
    options?: { headers?: Record<string, string> },
  ): Promise<T> {
    if (!resource.resourceType) {
      throw new Error('Resource must have a resourceType property');
    }
    if (!resource.id) {
      throw new Error('Resource must have an id property for update operation');
    }
    return this.request<T>({
      method: 'PUT',
      url: `${resource.resourceType}/${resource.id}`,
      data: resource,
      headers: options?.headers,
    });
  }

  async delete(resourceType: string, id: string): Promise<void> {
    await this.request({
      method: 'DELETE',
      url: `${resourceType}/${id}`,
    });
  }

  async search<T extends Resource = Resource>(
    resourceTypeOrQuery: string,
    params?: SearchParams,
    options?: SearchOptions<T> & { fetchAll?: false },
  ): Promise<Bundle<T>>;

  async search<T extends Resource = Resource>(
    resourceTypeOrQuery: string,
    params: SearchParams | undefined,
    options: SearchOptions<T> & { fetchAll: true; transform?: undefined },
  ): Promise<T[]>;

  async search<T extends Resource = Resource, TResult = T>(
    resourceTypeOrQuery: string,
    params: SearchParams | undefined,
    options: SearchOptions<T, TResult> & { fetchAll: true; transform: SearchTransform<T, TResult> },
  ): Promise<TResult[]>;

  async search<T extends Resource = Resource, TResult = T>(
    resourceTypeOrQuery: string,
    params?: SearchParams,
    options?: SearchOptions<T, TResult>,
  ): Promise<Bundle<T> | TResult[]> {
    const transform = options?.transform;
    if (typeof transform !== 'undefined') {
      if (!options?.fetchAll) {
        throw new Error('The transform option is only supported when fetchAll is true.');
      }

      if (typeof transform !== 'function') {
        throw new Error('The transform option must be a function.');
      }
    }

    let url = resourceTypeOrQuery;
    let searchParams: Record<string, string | number | boolean | (string | number | boolean)[]> =
      {};

    // Check if resourceTypeOrQuery contains a query string
    const queryIndex = resourceTypeOrQuery.indexOf('?');
    if (queryIndex !== -1) {
      const queryPart = resourceTypeOrQuery.substring(queryIndex + 1);
      url = resourceTypeOrQuery.substring(0, queryIndex);
      searchParams = mergeSearchParams(queryPart, params);
    } else {
      searchParams = params || {};
    }

    let response: Bundle<T>;

    if (options?.asPost) {
      // FHIR search via POST with _search endpoint and form-urlencoded
      const searchUrl = url.includes('/_search') ? url : `${url}/_search`;

      // IMPORTANT: We manually construct URLSearchParams instead of using axios's `params` option
      // because axios doesn't support FHIR's array serialization format.
      // FHIR requires: identifier=val1&identifier=val2 (duplicate keys for AND semantics)
      // Axios produces: identifier[]=val1&identifier[]=val2 or identifier=val1,val2
      // Using URLSearchParams.append() gives us the correct FHIR format.
      const formParams = new URLSearchParams();
      Object.entries(searchParams).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          value.forEach((v) => formParams.append(key, String(v)));
        } else {
          formParams.append(key, String(value));
        }
      });

      response = await this.request<Bundle<T>>(
        {
          method: 'POST',
          url: searchUrl,
          data: formParams.toString(),
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
        options?.noCache,
      );
    } else {
      // Standard GET search
      // IMPORTANT: We manually construct the URL instead of using axios's `params` option
      // because axios doesn't support FHIR's array serialization format.
      // FHIR requires: identifier=val1&identifier=val2 (duplicate keys for AND semantics)
      // Axios produces: identifier[]=val1&identifier[]=val2 or identifier=val1,val2
      // Using URLSearchParams.append() gives us the correct FHIR format.
      const queryParams = new URLSearchParams();
      Object.entries(searchParams).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          value.forEach((v) => queryParams.append(key, String(v)));
        } else {
          queryParams.append(key, String(value));
        }
      });

      response = await this.request<Bundle<T>>(
        {
          method: 'GET',
          url: queryParams.toString() ? `${url}?${queryParams.toString()}` : url,
        },
        options?.noCache,
      );
    }

    if (options?.fetchAll) {
      const maxResults = options.maxResults ?? this.config.maxFetchAllResults ?? 10000;
      return this.fetchAllPages(response, maxResults, transform);
    }

    return response;
  }

  private async fetchAllPages<T extends Resource, TResult = T>(
    initialBundle: Bundle<T>,
    maxResults: number,
    transform?: SearchTransform<T, TResult>,
  ): Promise<TResult[]> {
    const results: TResult[] = [];
    let currentBundle = initialBundle;
    let rawResourceCount = 0;

    const maxResultsError = () =>
      new Error(
        `Maximum result limit (${maxResults}) exceeded. Narrow down your search or increase maxFetchAllResults.`,
      );

    const appendBundleEntries = async (bundle: Bundle<T>) => {
      for (const entry of bundle.entry || []) {
        const resource = entry.resource;
        if (!resource) {
          continue;
        }

        if (rawResourceCount >= maxResults) {
          throw maxResultsError();
        }

        const currentIndex = rawResourceCount;
        rawResourceCount += 1;

        if (transform) {
          const transformed = await transform(resource, entry.search?.mode, currentIndex, entry);
          if (typeof transformed !== 'undefined') {
            results.push(transformed);
          }
        } else {
          results.push(resource as unknown as TResult);
        }
      }
    };

    await appendBundleEntries(currentBundle);

    while (currentBundle.link && currentBundle.link.some((l) => l.relation === 'next')) {
      const nextLink = currentBundle.link.find((l) => l.relation === 'next');
      if (!nextLink || !nextLink.url) break;

      const nextUrl = nextLink.url;

      currentBundle = await this.request<Bundle<T>>({
        method: 'GET',
        url: nextUrl,
      });

      await appendBundleEntries(currentBundle);
    }

    return results;
  }

  async toLiteral(
    resourceTypeOrQuery: string,
    params?: SearchParams,
    options?: Pick<SearchOptions, 'asPost' | 'noCache'>,
  ): Promise<string> {
    const bundle = (await this.search<Resource>(resourceTypeOrQuery, params, {
      ...options,
      fetchAll: false,
    })) as Bundle<Resource>;

    // Filter for entries with search.mode === 'match' to exclude OperationOutcome and other informational entries
    const matchEntries = (bundle.entry || []).filter(
      (entry) => !entry.search || entry.search.mode === 'match',
    );

    if (matchEntries.length === 0) {
      throw new Error('Search returned no match');
    }

    if (matchEntries.length > 1) {
      throw new Error(
        `Search returned multiple matches (${matchEntries.length}), criteria not selective enough`,
      );
    }

    const resource = matchEntries[0].resource;
    if (!resource?.resourceType || !resource?.id) {
      throw new Error('Server returned malformed resource without resourceType or id');
    }

    return `${resource.resourceType}/${resource.id}`;
  }

  async resourceId(
    resourceTypeOrQuery: string,
    params?: SearchParams,
    options?: Pick<SearchOptions, 'asPost' | 'noCache'>,
  ): Promise<string> {
    const literal = await this.toLiteral(resourceTypeOrQuery, params, options);
    const id = literal.split('/')[1];
    return id;
  }

  async resolve<T extends Resource = Resource>(
    literalOrQuery: string,
    params?: SearchParams,
    options?: Pick<SearchOptions, 'asPost' | 'noCache'>,
  ): Promise<T> {
    // Check if it's a literal reference (resourceType/id format)
    const literalPattern = /^[A-Z][a-zA-Z]+\/[A-Za-z0-9-.]+$/;

    if (literalPattern.test(literalOrQuery) && !params) {
      // It's a literal reference, perform a read
      const [resourceType, id] = literalOrQuery.split('/');
      return this.read<T>(resourceType, id, options);
    }

    // It's a search query, resolve to single resource
    const bundle = (await this.search<T>(literalOrQuery, params, {
      ...options,
      fetchAll: false,
    })) as Bundle<T>;

    // Filter for entries with search.mode === 'match' to exclude OperationOutcome and other informational entries
    const matchEntries = (bundle.entry || []).filter(
      (entry) => !entry.search || entry.search.mode === 'match',
    );

    if (matchEntries.length === 0) {
      throw new Error('Search returned no match');
    }

    if (matchEntries.length > 1) {
      throw new Error('Search returned multiple matches, criteria not selective enough');
    }

    const resource = matchEntries[0].resource;
    if (!resource) {
      throw new Error('Server returned bundle entry without resource');
    }

    return resource;
  }
}
