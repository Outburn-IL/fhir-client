import { FhirVersion } from '@outburn/types'

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

export interface SearchOptions {
  fetchAll?: boolean;
  maxResults?: number;
  asPost?: boolean;
  noCache?: boolean;
}
