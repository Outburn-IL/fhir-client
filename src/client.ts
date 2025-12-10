import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { LRUCache } from 'lru-cache';
import {
  Bundle,
  CapabilityStatement,
  FhirClientConfig,
  Resource,
  SearchParams,
} from './types';
import { mergeSearchParams, normalizeFhirVersion } from './utils';

export class FhirClient {
  private client: AxiosInstance;
  private config: FhirClientConfig;
  private cache?: LRUCache<string, Record<string, unknown>>;

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

    const response: AxiosResponse<T> = await this.client.request(config);

    if (this.cache && config.method?.toLowerCase() === 'get' && !noCache) {
      this.cache.set(cacheKey!, response.data as Record<string, unknown>);
    }

    return response.data;
  }

  async read<T extends Resource = Resource>(
    resourceType: string,
    id: string,
    options?: { noCache?: boolean },
  ): Promise<T> {
    return this.request<T>(
      {
        method: 'GET',
        url: `${resourceType}/${id}`,
      },
      options?.noCache,
    );
  }

  async getCapabilities(): Promise<CapabilityStatement> {
    return this.request<CapabilityStatement>({
      method: 'GET',
      url: 'metadata',
    });
  }

  async processTransaction<T extends Resource = Resource>(
    bundle: Bundle<T>,
  ): Promise<Bundle<T>> {
    if (bundle.resourceType !== 'Bundle') {
      throw new Error(
        `processTransaction requires a Bundle resource, got ${bundle.resourceType}`,
      );
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

  async processBatch<T extends Resource = Resource>(
    bundle: Bundle<T>,
  ): Promise<Bundle<T>> {
    if (bundle.resourceType !== 'Bundle') {
      throw new Error(
        `processBatch requires a Bundle resource, got ${bundle.resourceType}`,
      );
    }
    if (bundle.type !== 'batch') {
      throw new Error(
        `processBatch requires a Bundle of type 'batch', got '${bundle.type}'`,
      );
    }
    return this.request<Bundle<T>>({
      method: 'POST',
      url: '',
      data: bundle,
    });
  }

  async create<T extends Resource = Resource>(
    resourceType: string,
    resource: T,
  ): Promise<T> {
    return this.request<T>({
      method: 'POST',
      url: resourceType,
      data: resource,
    });
  }

  async update<T extends Resource = Resource>(
    resourceType: string,
    id: string,
    resource: T,
  ): Promise<T> {
    return this.request<T>({
      method: 'PUT',
      url: `${resourceType}/${id}`,
      data: resource,
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
    options?: {
      fetchAll?: boolean;
      maxResults?: number;
      asPost?: boolean;
      noCache?: boolean;
    },
  ): Promise<Bundle<T> | T[]> {
    let url = resourceTypeOrQuery;
    let searchParams: Record<string, string | number | boolean | (string | number | boolean)[]> = {};

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
      response = await this.request<Bundle<T>>(
        {
          method: 'POST',
          url: searchUrl,
          data: new URLSearchParams(
            Object.entries(searchParams).map(([key, value]) => [
              key,
              String(value),
            ]),
          ).toString(),
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
        options?.noCache,
      );
    } else {
      // Standard GET search
      response = await this.request<Bundle<T>>(
        {
          method: 'GET',
          url,
          params: searchParams,
        },
        options?.noCache,
      );
    }

    if (options?.fetchAll) {
      const maxResults = options.maxResults ?? this.config.maxFetchAllResults ?? 10000;
      return this.fetchAllPages(response, maxResults);
    }

    return response;
  }

  private async fetchAllPages<T extends Resource>(
    initialBundle: Bundle<T>,
    maxResults: number,
  ): Promise<T[]> {
    const results: T[] = [];
    let currentBundle = initialBundle;

    if (currentBundle.entry) {
      results.push(
        ...currentBundle.entry
          .map((e) => e.resource)
          .filter((r): r is T => !!r),
      );
    }

    if (results.length > maxResults) {
      throw new Error(
        `Maximum result limit (${maxResults}) exceeded. Narrow down your search or increase maxFetchAllResults.`,
      );
    }

    while (
      currentBundle.link &&
      currentBundle.link.some((l) => l.relation === 'next')
    ) {
      const nextLink = currentBundle.link.find((l) => l.relation === 'next');
      if (!nextLink || !nextLink.url) break;
      
      const nextUrl = nextLink.url;
      
      currentBundle = await this.request<Bundle<T>>({
        method: 'GET',
        url: nextUrl,
      });

      if (currentBundle.entry) {
        results.push(
          ...currentBundle.entry
            .map((e) => e.resource)
            .filter((r): r is T => !!r),
        );
      }

      if (results.length > maxResults) {
        throw new Error(
          `Maximum result limit (${maxResults}) exceeded. Use pagination or increase maxFetchAllResults config.`,
        );
      }
    }

    return results;
  }
}
