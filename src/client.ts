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
  private cache?: LRUCache<string, any>;

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

  private async request<T = any>(config: AxiosRequestConfig): Promise<T> {
    const cacheKey = this.cache ? JSON.stringify(config) : null;

    if (this.cache && config.method?.toLowerCase() === 'get') {
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

    if (this.cache && config.method?.toLowerCase() === 'get') {
      this.cache.set(cacheKey!, response.data);
    }

    return response.data;
  }

  async read<T extends Resource = Resource>(
    resourceType: string,
    id: string,
  ): Promise<T> {
    return this.request<T>({
      method: 'GET',
      url: `${resourceType}/${id}`,
    });
  }

  async getCapabilities(): Promise<CapabilityStatement> {
    return this.request<CapabilityStatement>({
      method: 'GET',
      url: 'metadata',
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
    options?: { fetchAll?: boolean },
  ): Promise<Bundle<T> | T[]> {
    let url = resourceTypeOrQuery;
    let searchParams: Record<string, any> = {};

    // Check if resourceTypeOrQuery contains a query string
    const queryIndex = resourceTypeOrQuery.indexOf('?');
    if (queryIndex !== -1) {
      const queryPart = resourceTypeOrQuery.substring(queryIndex + 1);
      url = resourceTypeOrQuery.substring(0, queryIndex);
      searchParams = mergeSearchParams(queryPart, params);
    } else {
      searchParams = params || {};
    }

    const response = await this.request<Bundle<T>>({
      method: 'GET',
      url,
      params: searchParams,
    });

    if (options?.fetchAll) {
      return this.fetchAllPages(response);
    }

    return response;
  }

  private async fetchAllPages<T extends Resource>(
    initialBundle: Bundle<T>,
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

    while (
      currentBundle.link &&
      currentBundle.link.some((l) => l.relation === 'next')
    ) {
      const nextLink = currentBundle.link.find((l) => l.relation === 'next');
      if (!nextLink || !nextLink.url) break;

      // We need to handle the next link. It might be a full URL or relative.
      // Axios handles full URLs in request config 'url' if it overrides baseURL?
      // Actually, if we pass a full URL to axios with a baseURL set, axios might behave differently depending on implementation.
      // But usually, if the URL is absolute, axios uses it.
      
      // However, we need to be careful about authentication and headers.
      // The `request` method uses `this.client` which has the baseURL and headers.
      // If we pass a full URL, we should ensure it works.
      
      try {
        // We use the raw client to avoid double-processing headers if they are already in the client config,
        // but we need to ensure we use the `request` wrapper for caching if we want caching on pages (maybe not needed for fetchAll).
        // But `request` wrapper adds Content-Type which is not needed for GET, but it also handles caching.
        // Let's use `request` but we need to handle the URL correctly.
        
        // If nextLink.url is absolute, we can pass it.
        // But we need to strip the baseURL if we want to use the same client instance cleanly, OR just pass the full URL.
        
        const nextUrl = nextLink.url;
        
        // If we use this.request, we need to pass the config.
        // If nextUrl is absolute, we can set it as url.
        
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
      } catch (e) {
        console.warn('Failed to fetch next page', e);
        break;
      }
    }

    return results;
  }
}
