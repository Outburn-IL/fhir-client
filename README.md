# fhir-client

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
npm install fhir-client
```

## Usage

### Initialization

```typescript
import { FhirClient } from 'fhir-client';

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

## License

MIT
