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
  timeout: 30000, // Optional: Request timeout in ms (default: 30000)
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

// Bypass cache and fetch fresh data from server
const freshPatient = await client.read('Patient', '123', { noCache: true });
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

// Fetch all pages (with safeguard to prevent OOM)
const allPatients = await client.search('Patient', { active: true }, { fetchAll: true });

// Override the default max limit for this search
const manyPatients = await client.search('Patient', {}, { fetchAll: true, maxResults: 50000 });

// Search via POST with form-urlencoded (useful for long query strings or server requirements)
const postResults = await client.search('Patient', { name: 'John' }, { asPost: true });

// Bypass cache and fetch fresh data from server
const freshData = await client.search('Patient', { _id: '123' }, { noCache: true });

// Combine options
const freshAllPatients = await client.search(
  'Patient',
  { active: true },
  { fetchAll: true, noCache: true, asPost: true }
);
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

### Process Batch

```typescript
// Process a batch bundle
const batchBundle = {
  resourceType: 'Bundle',
  type: 'batch',
  entry: [
    {
      request: {
        method: 'GET',
        url: 'Patient/123',
      },
    },
    {
      request: {
        method: 'GET',
        url: 'Patient/456',
      },
    },
  ],
};

const response = await client.processBatch(batchBundle);
console.log(response.type); // 'batch-response'
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

## Search Options

The `search` method accepts an optional third parameter with the following options:

### `fetchAll`
Automatically fetches all pages of results by following `next` links in the Bundle. Returns an array of resources instead of a Bundle.

```typescript
const allPatients = await client.search('Patient', { active: true }, { fetchAll: true });
// Returns: Patient[] instead of Bundle
```

### `maxResults`
Maximum number of resources to fetch when using `fetchAll`. Overrides the client-level `maxFetchAllResults` config for this specific search.

```typescript
const patients = await client.search('Patient', {}, { fetchAll: true, maxResults: 5000 });
```

### `asPost`
Use HTTP POST with `application/x-www-form-urlencoded` instead of GET. Useful when:
- Query strings are too long for GET requests
- Server requires POST for search operations
- Working with servers that have URL length limitations

```typescript
const results = await client.search('Patient', { name: 'John' }, { asPost: true });
// POSTs to: Patient/_search with form data
```

### `noCache`
Bypass the cache and fetch fresh data from the server, even if a cached response exists.

```typescript
const freshData = await client.search('Patient', { _id: '123' }, { noCache: true });
```

All options can be combined as needed.

## Configuration

### Timeout

All HTTP requests have a configurable timeout to prevent indefinite waiting:

```typescript
const client = new FhirClient({
  baseUrl: 'https://hapi.fhir.org/baseR4',
  fhirVersion: 'R4',
  timeout: 30000, // Default: 30000ms (30 seconds)
});
```

If a request takes longer than the specified timeout, it will be aborted and throw an error. You can customize this value based on your server's expected response times.

### Fetch All Results Limit

To prevent out-of-memory (OOM) errors when using `fetchAll: true`, the client enforces a maximum limit on the number of resources that can be fetched:

```typescript
const client = new FhirClient({
  baseUrl: 'https://hapi.fhir.org/baseR4',
  fhirVersion: 'R4',
  maxFetchAllResults: 10000, // Default: 10000 resources
});
```

When the limit is exceeded, an error is thrown. You can:
- Increase `maxFetchAllResults` in the client configuration (applies to all searches)
- Override the limit per-search using the `maxResults` option (see Search examples above)
- Use regular pagination instead of `fetchAll` for very large result sets

## Caching
The FHIR client includes built-in caching using an LRU (Least Recently Used) cache. Caching significantly improves performance by storing responses from GET requests and reusing them for identical subsequent requests.

### How It Works

- **Only GET requests are cached**: `read()`, `search()`, and `getCapabilities()` operations are cached. Mutations (`create`, `update`, `delete`) are never cached.
- **Cache key**: Each request is cached based on the full request configuration (URL, query parameters, headers).
- **Automatic eviction**: Items are automatically removed when:
  - The TTL (time-to-live) expires
  - The cache reaches its maximum size and needs to make room for new items (LRU policy)

### Caching Configuration Options

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

## Testing

The project includes both unit tests and integration tests.

### Unit Tests

Run unit tests with coverage:

```bash
npm test
```

Unit tests are located in `tests/` and provide comprehensive coverage of the client's functionality using mocked HTTP responses.

### Integration Tests

Integration tests run against a real HAPI FHIR R4 server using Docker Compose. They verify the client works correctly with an actual FHIR server.

**Prerequisites:**
- Docker and Docker Compose installed and running
- Port 8080 available

**Run integration tests:**

```bash
npm run test:integration
```

**Run all tests (unit + integration):**

```bash
npm run test:all
```

Integration tests cover:
- Server metadata and capabilities
- CRUD operations on Patient, Encounter, and Observation resources
- Pagination with fetchAll (tests with 250+ resources)
- Bundle operations (transaction and batch)
- Error handling

For more details, see [tests/integration/README.md](tests/integration/README.md).

## License
MIT  
© Outburn Ltd. 2022–2025. All Rights Reserved.

---

## Disclaimer
This project is part of the [FUME](https://github.com/Outburn-IL/fume-community) open-source initiative and intended for use in FHIR tooling and development environments.
