export type FhirVersion =
  | '3.0.1'
  | '3.0'
  | 'R3'
  | '4.0.1'
  | '4.0'
  | 'R4'
  | '5.0.0'
  | '5.0'
  | 'R5';

export interface FhirClientConfig {
  baseUrl: string;
  fhirVersion: FhirVersion;
  auth?: {
    username?: string;
    password?: string;
    // Future: token, etc.
  };
  headers?: Record<string, string>;
  cache?: {
    enable: boolean;
    max?: number; // Max items
    ttl?: number; // Time to live in ms
  };
}

export interface SearchParams {
  [key: string]: string | number | boolean | (string | number | boolean)[];
}

export interface Resource {
  resourceType: string;
  id?: string;
  [key: string]: any;
}

export interface Bundle<T extends Resource = Resource> extends Resource {
  resourceType: 'Bundle';
  type: string;
  total?: number;
  link?: {
    relation: string;
    url: string;
  }[];
  entry?: {
    fullUrl?: string;
    resource?: T;
    search?: {
      mode?: string;
      score?: number;
    };
    request?: {
      method: string;
      url: string;
    };
    response?: {
      status: string;
      location?: string;
      etag?: string;
      lastModified?: string;
    };
  }[];
}

export interface CapabilityStatement extends Resource {
  resourceType: 'CapabilityStatement';
  status: string;
  date: string;
  kind: string;
  fhirVersion?: string;
  format: string[];
  rest?: {
    mode: string;
    resource?: {
      type: string;
      interaction?: {
        code: string;
      }[];
      searchParam?: {
        name: string;
        type: string;
        documentation?: string;
      }[];
    }[];
  }[];
}
