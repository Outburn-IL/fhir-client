# FHIR Client
[![npm version](https://img.shields.io/npm/v/@outburn/fhir-client.svg)](https://www.npmjs.com/package/@outburn/fhir-client)

A modern, lightweight FHIR client for TypeScript/JavaScript with support for R3, R4, and R5.

## Features

- **Multi-version support**: R3, R4, R5.
- **TypeScript**: Fully typed.
- **Simple API**: `read`, `search`, `create`, `update`, `delete`.
- **Pagination**: Automatically fetch all pages of search results.
- **Caching**: Built-in configurable LRU caching.
- **Auth**: Basic Auth support (extensible).

## Installation

```bash
npm install @outburn/fhir-client
```

## Usage

### Initialization

```typescript
import { FhirClient } from '@outburn/fhir-client';

const client = new FhirClient({
  baseUrl: 'https://hapi.fhir.org/baseR4',
  fhirVersion: 'R4',
  auth: {
    username: 'user',
    password: 'password',
  },
  cache: {
    enable: true,
    ttl: 60000, // 1 minute
  },
});
```

### Read

```typescript
const patient = await client.read('Patient', '123');
console.log(patient);
```

### Get Capabilities

```typescript
// Fetch server capabilities (CapabilityStatement)
const capabilities = await client.getCapabilities();
console.log(capabilities.fhirVersion);
console.log(capabilities.format);
```

### Search

```typescript
// Simple search
const bundle = await client.search('Patient', { name: 'John' });

// Search with query string
const bundle2 = await client.search('Patient?active=true', { name: 'John' });

// Fetch all pages
const allPatients = await client.search('Patient', { active: true }, { fetchAll: true });
```

### Create

```typescript
const newPatient = await client.create('Patient', {
  resourceType: 'Patient',
  name: [{ family: 'Doe', given: ['John'] }],
});
```

### Process Transaction

```typescript
// Process a transaction bundle
const transactionBundle = {
  resourceType: 'Bundle',
  type: 'transaction',
  entry: [
    {
      request: {
        method: 'POST',
        url: 'Patient',
      },
      resource: {
        resourceType: 'Patient',
        name: [{ family: 'Doe', given: ['John'] }],
      },
    },
    {
      request: {
        method: 'PUT',
        url: 'Patient/123',
      },
      resource: {
        resourceType: 'Patient',
        id: '123',
        active: false,
      },
    },
  ],
};

const response = await client.processTransaction(transactionBundle);
console.log(response.type); // 'transaction-response'
```

### Update

```typescript
const updatedPatient = await client.update('Patient', '123', {
  resourceType: 'Patient',
  id: '123',
  active: false,
});
```

### Delete

```typescript
await client.delete('Patient', '123');
```

## Caching

The FHIR client includes built-in caching using an LRU (Least Recently Used) cache. Caching significantly improves performance by storing responses from GET requests and reusing them for identical subsequent requests.

### How It Works

- **Only GET requests are cached**: `read()`, `search()`, and `getCapabilities()` operations are cached. Mutations (`create`, `update`, `delete`) are never cached.
- **Cache key**: Each request is cached based on the full request configuration (URL, query parameters, headers).
- **Automatic eviction**: Items are automatically removed when:
  - The TTL (time-to-live) expires
  - The cache reaches its maximum size and needs to make room for new items (LRU policy)

### Configuration Options

#### Disabled (Default)

By default, caching is **disabled**. You must explicitly enable it:

```typescript
const client = new FhirClient({
  baseUrl: 'https://hapi.fhir.org/baseR4',
  fhirVersion: 'R4',
  // No cache config = caching disabled
});
```

#### Basic Caching (TTL Only)

Enable caching with just a time-to-live. Uses default max size of 100 items:

```typescript
const client = new FhirClient({
  baseUrl: 'https://hapi.fhir.org/baseR4',
  fhirVersion: 'R4',
  cache: {
    enable: true,
    ttl: 60000, // Items expire after 60 seconds (1 minute)
  },
});
```

**Defaults when `enable: true`**:
- `max`: 100 items
- `ttl`: 300000 ms (5 minutes)

#### Full Configuration (TTL + Max Size)

Configure both time-to-live and maximum cache size:

```typescript
const client = new FhirClient({
  baseUrl: 'https://hapi.fhir.org/baseR4',
  fhirVersion: 'R4',
  cache: {
    enable: true,
    max: 500,      // Store up to 500 items
    ttl: 120000,   // Items expire after 120 seconds (2 minutes)
  },
});
```

#### Minimal TTL Configuration

For very short-lived caches (e.g., during a single workflow):

```typescript
const client = new FhirClient({
  baseUrl: 'https://hapi.fhir.org/baseR4',
  fhirVersion: 'R4',
  cache: {
    enable: true,
    ttl: 10000, // 10 seconds
    max: 50,    // Small cache for temporary use
  },
});
```

#### Long-Lived Cache

For read-heavy applications with relatively stable data:

```typescript
const client = new FhirClient({
  baseUrl: 'https://hapi.fhir.org/baseR4',
  fhirVersion: 'R4',
  cache: {
    enable: true,
    ttl: 3600000,  // 1 hour
    max: 1000,     // Large cache size
  },
});
```

### Expected Behavior

```typescript
const client = new FhirClient({
  baseUrl: 'https://hapi.fhir.org/baseR4',
  fhirVersion: 'R4',
  cache: {
    enable: true,
    ttl: 60000,
    max: 100,
  },
});

// First call - hits the server
const patient1 = await client.read('Patient', '123');

// Second call within 60 seconds - returns cached result (no server request)
const patient2 = await client.read('Patient', '123');

// After 60 seconds - cache expired, hits the server again
await sleep(61000);
const patient3 = await client.read('Patient', '123');

// Different resource - hits the server (different cache key)
const patient4 = await client.read('Patient', '456');

// Mutations always hit the server (never cached)
await client.update('Patient', '123', updatedPatient); // Always hits server
await client.create('Patient', newPatient);            // Always hits server
await client.delete('Patient', '789');                 // Always hits server
```

## License
MIT  
© Outburn Ltd. 2022–2025. All Rights Reserved.

---

## Disclaimer
This project is part of the [FUME](https://github.com/Outburn-IL/fume-community) open-source initiative and intended for use in FHIR tooling and development environments.
