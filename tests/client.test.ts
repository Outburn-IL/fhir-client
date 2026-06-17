/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from 'axios';
import { FhirClient } from '../src/client';
import { FhirClientError } from '../src/types';
import { Bundle } from '@outburn/types';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const createAxiosError = ({
  message = 'Request failed',
  status,
  data,
  headers = {},
  extra = {},
}: {
  message?: string;
  status?: number;
  data?: unknown;
  headers?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}) => {
  const error = new Error(message) as Error & {
    isAxiosError: boolean;
    response?: {
      status: number;
      data?: unknown;
      headers?: Record<string, unknown>;
    };
  } & Record<string, unknown>;

  error.isAxiosError = true;
  if (typeof status === 'number') {
    error.response = { status, data, headers };
  }

  Object.assign(error, extra);
  return error;
};

describe('FhirClient', () => {
  let client: FhirClient;

  beforeEach(() => {
    mockedAxios.create.mockReturnThis();
    mockedAxios.request.mockResolvedValue({ data: {} });
    mockedAxios.isAxiosError.mockImplementation((value) => Boolean((value as any)?.isAxiosError));

    client = new FhirClient({
      baseUrl: 'http://example.com/fhir',
      fhirVersion: 'R4',
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('getBaseUrl should return the configured baseUrl', () => {
    expect(client.getBaseUrl()).toBe('http://example.com/fhir');
  });

  test('read should make a GET request', async () => {
    mockedAxios.request.mockResolvedValueOnce({
      data: { resourceType: 'Patient', id: '123' },
    });

    const result = await client.read('Patient', '123');

    expect(mockedAxios.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: 'Patient/123',
      }),
    );
    expect(result).toEqual({ resourceType: 'Patient', id: '123' });
  });

  test('getCapabilities should make a GET request to metadata endpoint', async () => {
    const capabilityStatement = {
      resourceType: 'CapabilityStatement',
      status: 'active',
      date: '2023-01-01',
      kind: 'instance',
      fhirVersion: '4.0.1',
      format: ['json'],
    };
    mockedAxios.request.mockResolvedValueOnce({
      data: capabilityStatement,
    });

    const result = await client.getCapabilities();

    expect(mockedAxios.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: 'metadata',
      }),
    );
    expect(result).toEqual(capabilityStatement);
  });

  test('search should handle query strings and params', async () => {
    mockedAxios.request.mockResolvedValueOnce({
      data: { resourceType: 'Bundle', entry: [] },
    });

    await client.search('Patient?name=john', { active: true });

    expect(mockedAxios.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: expect.stringContaining('Patient?'),
      }),
    );

    const callUrl = mockedAxios.request.mock.calls[0][0].url;
    expect(callUrl).toContain('name=john');
    expect(callUrl).toContain('active=true');
  });

  test('search with fetchAll should follow pagination links', async () => {
    const bundle1: Bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      link: [{ relation: 'next', url: 'http://example.com/fhir/Patient?page=2' }],
      entry: [{ resource: { resourceType: 'Patient', id: '1' } }],
    };
    const bundle2: Bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      entry: [{ resource: { resourceType: 'Patient', id: '2' } }],
    };

    mockedAxios.request
      .mockResolvedValueOnce({ data: bundle1 })
      .mockResolvedValueOnce({ data: bundle2 });

    const results = await client.search('Patient', {}, { fetchAll: true });

    expect(results).toHaveLength(2);
    expect(results).toEqual([
      { resourceType: 'Patient', id: '1' },
      { resourceType: 'Patient', id: '2' },
    ]);
    expect(mockedAxios.request).toHaveBeenCalledTimes(2);
  });

  test('search with fetchAll and transform should process entries in order across pages', async () => {
    const bundle1: Bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      link: [{ relation: 'next', url: 'http://example.com/fhir/Patient?page=2' }],
      entry: [
        {
          resource: { resourceType: 'Patient', id: '1' },
          search: { mode: 'match' },
        },
      ],
    };
    const bundle2: Bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      entry: [
        {
          resource: { resourceType: 'Observation', id: '2' },
          search: { mode: 'include' },
        },
        {
          resource: { resourceType: 'Patient', id: '3' },
          search: { mode: 'match' },
        },
      ],
    };

    mockedAxios.request
      .mockResolvedValueOnce({ data: bundle1 })
      .mockResolvedValueOnce({ data: bundle2 });

    const results = await client.search('Patient', {}, {
      fetchAll: true,
      transform: (resource, mode, index, entry) => ({
        id: resource.id,
        mode,
        index,
        entryId: entry.resource?.id,
      }),
    });

    expect(results).toEqual([
      { id: '1', mode: 'match', index: 0, entryId: '1' },
      { id: '2', mode: 'include', index: 1, entryId: '2' },
      { id: '3', mode: 'match', index: 2, entryId: '3' },
    ]);
  });

  test('search with fetchAll and async transform should filter undefined results', async () => {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      entry: Array.from({ length: 3 }, (_, i) => ({
        resource: { resourceType: 'Patient', id: `${i + 1}` },
      })),
    };

    mockedAxios.request.mockResolvedValueOnce({ data: bundle });

    const callOrder: string[] = [];
    const results = await client.search('Patient', {}, {
      fetchAll: true,
      transform: async (resource) => {
        callOrder.push(`start-${resource.id}`);
        await Promise.resolve();
        callOrder.push(`end-${resource.id}`);
        return resource.id === '2' ? undefined : resource.id;
      },
    });

    expect(results).toEqual(['1', '3']);
    expect(callOrder).toEqual(['start-1', 'end-1', 'start-2', 'end-2', 'start-3', 'end-3']);
  });

  test('create should make a POST request', async () => {
    const patient = { resourceType: 'Patient', name: [{ family: 'Doe' }] };
    mockedAxios.request.mockResolvedValueOnce({
      data: { ...patient, id: '123' },
    });

    const result = await client.create('Patient', patient);

    expect(mockedAxios.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: 'Patient',
        data: patient,
      }),
    );
    expect(result).toEqual({ ...patient, id: '123' });
  });

  test('processTransaction should POST bundle to root', async () => {
    const transactionBundle: Bundle = {
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
            name: [{ family: 'Doe' }],
          },
        },
      ],
    };

    const responseBundle: Bundle = {
      resourceType: 'Bundle',
      type: 'transaction-response',
      entry: [
        {
          response: {
            status: '201 Created',
            location: 'Patient/123',
          },
        },
      ],
    };

    mockedAxios.request.mockResolvedValueOnce({
      data: responseBundle,
    });

    const result = await client.processTransaction(transactionBundle);

    expect(mockedAxios.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: '',
        data: transactionBundle,
      }),
    );
    expect(result).toEqual(responseBundle);
  });

  test('processTransaction should throw error for non-Bundle resource', async () => {
    const notABundle: any = {
      resourceType: 'Patient',
      id: '123',
    };

    await expect(client.processTransaction(notABundle)).rejects.toThrow(
      'processTransaction requires a Bundle resource, got Patient',
    );
  });

  test('processTransaction should throw error for non-transaction Bundle type', async () => {
    const searchBundle: Bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      entry: [],
    };

    await expect(client.processTransaction(searchBundle)).rejects.toThrow(
      "processTransaction requires a Bundle of type 'transaction', got 'searchset'",
    );
  });

  test('processTransaction should throw error for batch Bundle type', async () => {
    const batchBundle: Bundle = {
      resourceType: 'Bundle',
      type: 'batch',
      entry: [],
    };

    await expect(client.processTransaction(batchBundle)).rejects.toThrow(
      "processTransaction requires a Bundle of type 'transaction', got 'batch'",
    );
  });

  test('processBatch should POST bundle to root', async () => {
    const batchBundle: Bundle = {
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

    const responseBundle: Bundle = {
      resourceType: 'Bundle',
      type: 'batch-response',
      entry: [
        {
          response: {
            status: '200 OK',
          },
          resource: {
            resourceType: 'Patient',
            id: '123',
          },
        },
        {
          response: {
            status: '200 OK',
          },
          resource: {
            resourceType: 'Patient',
            id: '456',
          },
        },
      ],
    };

    mockedAxios.request.mockResolvedValueOnce({
      data: responseBundle,
    });

    const result = await client.processBatch(batchBundle);

    expect(mockedAxios.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: '',
        data: batchBundle,
      }),
    );
    expect(result).toEqual(responseBundle);
  });

  test('processBatch should throw error for non-Bundle resource', async () => {
    const notABundle: any = {
      resourceType: 'Patient',
      id: '123',
    };

    await expect(client.processBatch(notABundle)).rejects.toThrow(
      'processBatch requires a Bundle resource, got Patient',
    );
  });

  test('processBatch should throw error for non-batch Bundle type', async () => {
    const searchBundle: Bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      entry: [],
    };

    await expect(client.processBatch(searchBundle)).rejects.toThrow(
      "processBatch requires a Bundle of type 'batch', got 'searchset'",
    );
  });

  test('processBatch should throw error for transaction Bundle type', async () => {
    const transactionBundle: Bundle = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: [],
    };

    await expect(client.processBatch(transactionBundle)).rejects.toThrow(
      "processBatch requires a Bundle of type 'batch', got 'transaction'",
    );
  });

  test('update should make a PUT request', async () => {
    const patient = { resourceType: 'Patient', id: '123', active: true };
    mockedAxios.request.mockResolvedValueOnce({
      data: patient,
    });

    const result = await client.update(patient);

    expect(mockedAxios.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'PUT',
        url: 'Patient/123',
        data: patient,
      }),
    );
    expect(result).toEqual(patient);
  });

  test('update should forward per-request headers', async () => {
    const patient = { resourceType: 'Patient', id: '123', active: true };
    mockedAxios.request.mockResolvedValueOnce({
      data: patient,
    });

    await client.update(patient, {
      headers: {
        'If-Match': 'W/"7"',
        'X-Request-Id': 'abc-123',
      },
    });

    expect(mockedAxios.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'PUT',
        url: 'Patient/123',
        headers: expect.objectContaining({
          'If-Match': 'W/"7"',
          'X-Request-Id': 'abc-123',
          // update() goes through the mutation request path, so Content-Type should be ensured
          'Content-Type': expect.stringContaining('application/fhir+json'),
        }),
      }),
    );
  });

  test('update should not overwrite explicit Content-Type header', async () => {
    const patient = { resourceType: 'Patient', id: '123', active: true };
    mockedAxios.request.mockResolvedValueOnce({
      data: patient,
    });

    await client.update(patient, {
      headers: {
        'Content-Type': 'application/custom+json',
      },
    });

    expect(mockedAxios.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'PUT',
        url: 'Patient/123',
        headers: expect.objectContaining({
          'Content-Type': 'application/custom+json',
        }),
      }),
    );
  });

  test('update should throw error if resourceType is missing', async () => {
    const patient = { id: '123', active: true } as any;

    await expect(client.update(patient)).rejects.toThrow(
      'Resource must have a resourceType property',
    );
  });

  test('update should throw error if id is missing', async () => {
    const patient = { resourceType: 'Patient', active: true } as any;

    await expect(client.update(patient)).rejects.toThrow(
      'Resource must have an id property for update operation',
    );
  });

  test('delete should make a DELETE request', async () => {
    mockedAxios.request.mockResolvedValueOnce({ data: {} });

    await client.delete('Patient', '123');

    expect(mockedAxios.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'DELETE',
        url: 'Patient/123',
      }),
    );
  });

  test('should handle auth with username and password', () => {
    new FhirClient({
      baseUrl: 'http://example.com/fhir',
      fhirVersion: 'R4',
      auth: {
        username: 'testuser',
        password: 'testpass',
      },
    });

    expect(mockedAxios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: {
          username: 'testuser',
          password: 'testpass',
        },
      }),
    );
  });

  test('should handle custom headers', () => {
    new FhirClient({
      baseUrl: 'http://example.com/fhir',
      fhirVersion: 'R4',
      headers: {
        'X-Custom-Header': 'custom-value',
      },
    });

    expect(mockedAxios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Custom-Header': 'custom-value',
        }),
      }),
    );
  });

  test('should enable cache when configured', async () => {
    const clientWithCache = new FhirClient({
      baseUrl: 'http://example.com/fhir',
      fhirVersion: 'R4',
      cache: {
        enable: true,
        max: 50,
        ttl: 30000,
      },
    });

    mockedAxios.request.mockResolvedValueOnce({
      data: { resourceType: 'Patient', id: '123' },
    });

    // First call
    await clientWithCache.read('Patient', '123');
    expect(mockedAxios.request).toHaveBeenCalledTimes(1);

    // Second call should use cache
    await clientWithCache.read('Patient', '123');
    expect(mockedAxios.request).toHaveBeenCalledTimes(1); // Still 1 because cached
  });

  test('should bypass cache for read when noCache is true', async () => {
    const clientWithCache = new FhirClient({
      baseUrl: 'http://example.com/fhir',
      fhirVersion: 'R4',
      cache: { enable: true },
    });

    const patient1 = { resourceType: 'Patient', id: '123', name: [{ family: 'Doe' }] };
    const patient2 = { resourceType: 'Patient', id: '123', name: [{ family: 'Smith' }] };

    mockedAxios.request
      .mockResolvedValueOnce({ data: patient1 })
      .mockResolvedValueOnce({ data: patient2 });

    // First call - should cache
    const result1 = await clientWithCache.read('Patient', '123');
    expect(result1).toBe(patient1);

    // Second call with noCache - should bypass cache and get fresh data
    const result2 = await clientWithCache.read('Patient', '123', { noCache: true });
    expect(result2).toBe(patient2);
    expect(mockedAxios.request).toHaveBeenCalledTimes(2);
  });

  test('should not cache non-GET requests', async () => {
    const clientWithCache = new FhirClient({
      baseUrl: 'http://example.com/fhir',
      fhirVersion: 'R4',
      cache: {
        enable: true,
      },
    });

    const patient = { resourceType: 'Patient', name: [{ family: 'Doe' }] };
    mockedAxios.request
      .mockResolvedValueOnce({ data: { ...patient, id: '123' } })
      .mockResolvedValueOnce({ data: { ...patient, id: '456' } });

    await clientWithCache.create('Patient', patient);
    await clientWithCache.create('Patient', patient);

    expect(mockedAxios.request).toHaveBeenCalledTimes(2);
  });

  test('should set Content-Type header for POST requests', async () => {
    const patient = { resourceType: 'Patient', name: [{ family: 'Doe' }] };
    mockedAxios.request.mockResolvedValueOnce({
      data: { ...patient, id: '123' },
    });

    await client.create('Patient', patient);

    expect(mockedAxios.request).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/fhir+json; fhirVersion=4.0',
        }),
      }),
    );
  });

  test('should set Content-Type header for PUT requests', async () => {
    const patient = { resourceType: 'Patient', id: '123', active: true };
    mockedAxios.request.mockResolvedValueOnce({ data: patient });

    await client.update(patient);

    expect(mockedAxios.request).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/fhir+json; fhirVersion=4.0',
        }),
      }),
    );
  });

  test('should handle search without params', async () => {
    mockedAxios.request.mockResolvedValueOnce({
      data: { resourceType: 'Bundle', entry: [] },
    });

    await client.search('Patient');

    expect(mockedAxios.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: 'Patient',
      }),
    );
  });

  test('should handle search with fetchAll when bundle has no entries', async () => {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
    };

    mockedAxios.request.mockResolvedValueOnce({ data: bundle });

    const results = await client.search('Patient', {}, { fetchAll: true });

    expect(results).toEqual([]);
  });

  test('should handle pagination with missing url in next link', async () => {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      link: [{ relation: 'next', url: '' }],
      entry: [{ resource: { resourceType: 'Patient', id: '1' } }],
    };

    mockedAxios.request.mockResolvedValueOnce({ data: bundle });

    const results = await client.search('Patient', {}, { fetchAll: true });

    expect(results).toHaveLength(1);
    expect(mockedAxios.request).toHaveBeenCalledTimes(1);
  });

  test('should throw error when pagination fails', async () => {
    const bundle1: Bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      link: [{ relation: 'next', url: 'http://example.com/fhir/Patient?page=2' }],
      entry: [{ resource: { resourceType: 'Patient', id: '1' } }],
    };

    mockedAxios.request
      .mockResolvedValueOnce({ data: bundle1 })
      .mockRejectedValueOnce(new Error('Network error'));

    await expect(client.search('Patient', {}, { fetchAll: true })).rejects.toThrow('Network error');
  });

  test('should normalize Axios pagination failures to FhirClientError', async () => {
    const bundle1: Bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      link: [{ relation: 'next', url: 'http://example.com/fhir/Patient?page=2' }],
      entry: [{ resource: { resourceType: 'Patient', id: '1' } }],
    };

    mockedAxios.request
      .mockResolvedValueOnce({ data: bundle1 })
      .mockRejectedValueOnce(
        createAxiosError({
          status: 502,
          data: { resourceType: 'OperationOutcome', issue: [{ severity: 'error' }] },
          headers: { 'content-type': 'application/fhir+json' },
        }),
      );

    await expect(client.search('Patient', {}, { fetchAll: true })).rejects.toMatchObject({
      name: 'FhirClientError',
      status: 502,
      request: { method: 'GET', url: 'http://example.com/fhir/Patient?page=2' },
    });
  });

  test('should throw error when fetchAll exceeds maxResults config', async () => {
    const clientWithLimit = new FhirClient({
      baseUrl: 'http://example.com/fhir',
      fhirVersion: 'R4',
      maxFetchAllResults: 5,
    });

    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      entry: Array.from({ length: 10 }, (_, i) => ({
        resource: { resourceType: 'Patient', id: `${i + 1}` },
      })),
    };

    mockedAxios.request.mockResolvedValueOnce({ data: bundle });

    await expect(clientWithLimit.search('Patient', {}, { fetchAll: true })).rejects.toThrow(
      'Maximum result limit (5) exceeded',
    );
  });

  test('should throw error when fetchAll exceeds maxResults option', async () => {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      entry: Array.from({ length: 10 }, (_, i) => ({
        resource: { resourceType: 'Patient', id: `${i + 1}` },
      })),
    };

    mockedAxios.request.mockResolvedValueOnce({ data: bundle });

    await expect(client.search('Patient', {}, { fetchAll: true, maxResults: 5 })).rejects.toThrow(
      'Maximum result limit (5) exceeded',
    );
  });

  test('should throw error when pagination exceeds maxResults', async () => {
    const bundle1: Bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      link: [{ relation: 'next', url: 'http://example.com/fhir/Patient?page=2' }],
      entry: Array.from({ length: 5 }, (_, i) => ({
        resource: { resourceType: 'Patient', id: `${i + 1}` },
      })),
    };

    const bundle2: Bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      entry: Array.from({ length: 5 }, (_, i) => ({
        resource: { resourceType: 'Patient', id: `${i + 6}` },
      })),
    };

    mockedAxios.request
      .mockResolvedValueOnce({ data: bundle1 })
      .mockResolvedValueOnce({ data: bundle2 });

    await expect(client.search('Patient', {}, { fetchAll: true, maxResults: 8 })).rejects.toThrow(
      'Maximum result limit (8) exceeded',
    );
  });

  test('should enforce maxResults before transform filtering', async () => {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      entry: Array.from({ length: 3 }, (_, i) => ({
        resource: { resourceType: 'Patient', id: `${i + 1}` },
      })),
    };

    mockedAxios.request.mockResolvedValueOnce({ data: bundle });

    await expect(
      client.search('Patient', {}, {
        fetchAll: true,
        maxResults: 2,
        transform: () => undefined,
      }),
    ).rejects.toThrow('Maximum result limit (2) exceeded');
  });

  test('should reject transform when fetchAll is false', async () => {
    await expect(
      client.search('Patient', {}, { fetchAll: false, transform: (() => 'x') as never } as any),
    ).rejects.toThrow('The transform option is only supported when fetchAll is true.');
  });

  test('should reject transform when fetchAll is omitted', async () => {
    await expect(client.search('Patient', {}, { transform: (() => 'x') as never } as any)).rejects.toThrow(
      'The transform option is only supported when fetchAll is true.',
    );
  });

  test('should reject non-callable transform', async () => {
    await expect(
      client.search('Patient', {}, { fetchAll: true, transform: 'nope' } as any),
    ).rejects.toThrow('The transform option must be a function.');
  });

  test('should fail fast when transform throws', async () => {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      entry: [
        { resource: { resourceType: 'Patient', id: '1' } },
        { resource: { resourceType: 'Patient', id: '2' } },
      ],
    };

    mockedAxios.request.mockResolvedValueOnce({ data: bundle });

    const transform = jest.fn((resource: { id?: string }) => {
      if (resource.id === '2') {
        throw new Error('transform failed');
      }

      return resource.id;
    });

    await expect(client.search('Patient', {}, { fetchAll: true, transform })).rejects.toThrow(
      'transform failed',
    );
    expect(transform).toHaveBeenCalledTimes(2);
  });

  test('should use POST with _search endpoint when asPost is true', async () => {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      entry: [{ resource: { resourceType: 'Patient', id: '1' } }],
    };

    mockedAxios.request.mockResolvedValueOnce({ data: bundle });

    await client.search('Patient', { name: 'John', active: true }, { asPost: true });

    expect(mockedAxios.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: 'Patient/_search',
        headers: expect.objectContaining({
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
        data: expect.stringContaining('name=John'),
      }),
    );
  });

  test('should use existing _search in URL when asPost is true', async () => {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      entry: [],
    };

    mockedAxios.request.mockResolvedValueOnce({ data: bundle });

    await client.search('Patient/_search', { name: 'Jane' }, { asPost: true });

    expect(mockedAxios.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: 'Patient/_search',
      }),
    );
  });

  test('should handle array values in POST search parameters', async () => {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      entry: [],
    };

    mockedAxios.request.mockResolvedValueOnce({ data: bundle });

    await client.search(
      'Patient',
      {
        identifier: ['http://hospital.org/mrn|123', 'http://national-id.gov/ssn|456'],
        active: true,
      },
      { asPost: true },
    );

    expect(mockedAxios.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: 'Patient/_search',
        headers: expect.objectContaining({
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
        // Should contain multiple identifier parameters, not a comma-separated string
        data: expect.stringMatching(
          /identifier=http%3A%2F%2Fhospital.*identifier=http%3A%2F%2Fnational|identifier=http%3A%2F%2Fnational.*identifier=http%3A%2F%2Fhospital/,
        ),
      }),
    );

    // Verify it doesn't use comma-separated format
    const callData = mockedAxios.request.mock.calls[0][0].data;
    expect(callData).not.toContain(
      'identifier=http://hospital.org/mrn|123,http://national-id.gov/ssn|456',
    );
  });

  test('should handle array values in GET search parameters', async () => {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      entry: [],
    };

    mockedAxios.request.mockResolvedValueOnce({ data: bundle });

    await client.search('Patient', {
      identifier: ['http://hospital.org/mrn|123', 'http://national-id.gov/ssn|456'],
      active: true,
    });

    expect(mockedAxios.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        // URL should contain multiple identifier parameters
        url: expect.stringMatching(
          /\?.*identifier=http%3A%2F%2Fhospital.*identifier=http%3A%2F%2Fnational|identifier=http%3A%2F%2Fnational.*identifier=http%3A%2F%2Fhospital/,
        ),
      }),
    );

    // Verify it doesn't use bracket notation or comma-separated format
    const callUrl = mockedAxios.request.mock.calls[0][0].url;
    expect(callUrl).not.toContain('identifier[]=');
    expect(callUrl).not.toContain(
      'identifier=http://hospital.org/mrn|123,http://national-id.gov/ssn|456',
    );
  });

  test('should bypass cache when noCache is true', async () => {
    const clientWithCache = new FhirClient({
      baseUrl: 'http://example.com/fhir',
      fhirVersion: 'R4',
      cache: { enable: true },
    });

    const bundle1: Bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      entry: [{ resource: { resourceType: 'Patient', id: '1' } }],
    };

    const bundle2: Bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      entry: [{ resource: { resourceType: 'Patient', id: '2' } }],
    };

    mockedAxios.request
      .mockResolvedValueOnce({ data: bundle1 })
      .mockResolvedValueOnce({ data: bundle2 });

    // First call - should cache
    const result1 = await clientWithCache.search('Patient', { name: 'John' });
    expect(result1).toBe(bundle1);

    // Second call with noCache - should bypass cache and get fresh data
    const result2 = await clientWithCache.search('Patient', { name: 'John' }, { noCache: true });
    expect(result2).toBe(bundle2);
    expect(mockedAxios.request).toHaveBeenCalledTimes(2);
  });

  test('should handle FHIR version R3', () => {
    new FhirClient({
      baseUrl: 'http://example.com/fhir',
      fhirVersion: 'R3',
    });

    expect(mockedAxios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/fhir+json; fhirVersion=3.0',
        }),
      }),
    );
  });

  test('should handle FHIR version R5', () => {
    new FhirClient({
      baseUrl: 'http://example.com/fhir',
      fhirVersion: 'R5',
    });

    expect(mockedAxios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/fhir+json; fhirVersion=5.0',
        }),
      }),
    );
  });

  test('should handle FHIR version 3.0.2', () => {
    new FhirClient({
      baseUrl: 'http://example.com/fhir',
      fhirVersion: '3.0.2',
    });

    expect(mockedAxios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/fhir+json; fhirVersion=3.0',
        }),
      }),
    );
  });

  test('should handle FHIR version 4.0.1', () => {
    new FhirClient({
      baseUrl: 'http://example.com/fhir',
      fhirVersion: '4.0.1',
    });

    expect(mockedAxios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/fhir+json; fhirVersion=4.0',
        }),
      }),
    );
  });

  test('should handle FHIR version 5.0.0', () => {
    new FhirClient({
      baseUrl: 'http://example.com/fhir',
      fhirVersion: '5.0.0',
    });

    expect(mockedAxios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/fhir+json; fhirVersion=5.0',
        }),
      }),
    );
  });

  describe('toLiteral', () => {
    test('should return literal reference for single match', async () => {
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'searchset',
        entry: [
          {
            resource: { resourceType: 'Patient', id: '123', name: [{ family: 'Doe' }] },
          },
        ],
      };

      mockedAxios.request.mockResolvedValueOnce({ data: bundle });

      const literal = await client.toLiteral('Patient', { name: 'Doe' });

      expect(literal).toBe('Patient/123');
    });

    test('should throw error when no matches found', async () => {
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'searchset',
        entry: [],
      };

      mockedAxios.request.mockResolvedValueOnce({ data: bundle });

      await expect(client.toLiteral('Patient', { name: 'Unknown' })).rejects.toThrow(
        'Search returned no match',
      );
    });

    test('should throw error when multiple matches found', async () => {
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'searchset',
        entry: [
          { resource: { resourceType: 'Patient', id: '123' } },
          { resource: { resourceType: 'Patient', id: '456' } },
        ],
      };

      mockedAxios.request.mockResolvedValueOnce({ data: bundle });

      await expect(client.toLiteral('Patient', { name: 'Doe' })).rejects.toThrow(
        'Search returned multiple matches (2), criteria not selective enough',
      );
    });

    test('should ignore OperationOutcome entries and return match', async () => {
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'searchset',
        entry: [
          {
            resource: { resourceType: 'Patient', id: '123', name: [{ family: 'Doe' }] },
            search: { mode: 'match' },
          },
          {
            resource: { resourceType: 'OperationOutcome', issue: [] },
            search: { mode: 'outcome' },
          },
        ],
      };

      mockedAxios.request.mockResolvedValueOnce({ data: bundle });

      const literal = await client.toLiteral('Patient', { name: 'Doe' });

      expect(literal).toBe('Patient/123');
    });

    test('should throw error if server returns resource without id', async () => {
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'searchset',
        entry: [{ resource: { resourceType: 'Patient' } }],
      };

      mockedAxios.request.mockResolvedValueOnce({ data: bundle });

      await expect(client.toLiteral('Patient', { name: 'Doe' })).rejects.toThrow(
        'Server returned malformed resource without resourceType or id',
      );
    });

    test('should handle entries without search.mode as matches', async () => {
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'searchset',
        entry: [
          {
            resource: { resourceType: 'Patient', id: '123' },
            // No search.mode property
          },
        ],
      };

      mockedAxios.request.mockResolvedValueOnce({ data: bundle });

      const literal = await client.toLiteral('Patient', { name: 'Doe' });

      expect(literal).toBe('Patient/123');
    });

    test('should support asPost and noCache options', async () => {
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'searchset',
        entry: [{ resource: { resourceType: 'Patient', id: '123' } }],
      };

      mockedAxios.request.mockResolvedValueOnce({ data: bundle });

      const result = await client.toLiteral(
        'Patient',
        { name: 'Doe' },
        { asPost: true, noCache: true },
      );

      expect(result).toBe('Patient/123');
      // Verify the search was called (implementation details of how are internal)
      expect(mockedAxios.request).toHaveBeenCalled();
    });

    test('should handle query string in resourceTypeOrQuery parameter', async () => {
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'searchset',
        entry: [
          {
            resource: {
              resourceType: 'Practitioner',
              id: 'prac123',
              identifier: [{ value: '9999958892' }],
            },
            search: { mode: 'match' },
          },
        ],
      };

      mockedAxios.request.mockResolvedValueOnce({ data: bundle });

      const literal = await client.toLiteral('Practitioner?identifier=9999958892');

      expect(literal).toBe('Practitioner/prac123');
      const callArgs = mockedAxios.request.mock.calls[mockedAxios.request.mock.calls.length - 1][0];
      expect(callArgs.method).toBe('GET');
      expect(callArgs.url).toBe('Practitioner?identifier=9999958892');
    });

    test('should handle query string vs params object equivalently', async () => {
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'searchset',
        entry: [
          {
            resource: {
              resourceType: 'Practitioner',
              id: 'prac456',
              identifier: [{ value: '1234567890' }],
            },
            search: { mode: 'match' },
          },
        ],
      };

      // First call with query string
      mockedAxios.request.mockResolvedValueOnce({ data: bundle });
      const literal1 = await client.toLiteral('Practitioner?identifier=1234567890');
      const callArgs1 =
        mockedAxios.request.mock.calls[mockedAxios.request.mock.calls.length - 1][0];

      // Second call with params object
      mockedAxios.request.mockResolvedValueOnce({ data: bundle });
      const literal2 = await client.toLiteral('Practitioner', { identifier: '1234567890' });
      const callArgs2 =
        mockedAxios.request.mock.calls[mockedAxios.request.mock.calls.length - 1][0];

      // Both should return the same literal
      expect(literal1).toBe('Practitioner/prac456');
      expect(literal2).toBe('Practitioner/prac456');

      // Both should make the same HTTP request
      expect(callArgs1.method).toBe('GET');
      expect(callArgs2.method).toBe('GET');
      expect(callArgs1.url).toBe('Practitioner?identifier=1234567890');
      expect(callArgs2.url).toBe('Practitioner?identifier=1234567890');
    });
  });

  describe('resourceId', () => {
    test('should return only the id from literal reference', async () => {
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'searchset',
        entry: [{ resource: { resourceType: 'Patient', id: 'abc-123' } }],
      };

      mockedAxios.request.mockResolvedValueOnce({ data: bundle });

      const id = await client.resourceId('Patient', { identifier: 'http://test|123' });

      expect(id).toBe('abc-123');
    });

    test('should throw error when no matches found', async () => {
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'searchset',
        entry: [],
      };

      mockedAxios.request.mockResolvedValueOnce({ data: bundle });

      await expect(client.resourceId('Patient', { name: 'Unknown' })).rejects.toThrow(
        'Search returned no match',
      );
    });
  });

  describe('resolve', () => {
    test('should resolve using literal reference', async () => {
      const patient = { resourceType: 'Patient', id: '123', name: [{ family: 'Doe' }] };

      mockedAxios.request.mockResolvedValueOnce({ data: patient });

      const result = await client.resolve('Patient/123');

      expect(result).toEqual(patient);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: 'Patient/123',
        }),
      );
    });

    test('should resolve using search query', async () => {
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'searchset',
        entry: [
          {
            resource: { resourceType: 'Patient', id: '456', name: [{ family: 'Smith' }] },
          },
        ],
      };

      mockedAxios.request.mockResolvedValueOnce({ data: bundle });

      const result = await client.resolve('Patient', { identifier: 'http://test|456' });

      expect(result).toEqual(bundle.entry![0].resource);
    });

    test('should ignore OperationOutcome entries when resolving', async () => {
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'searchset',
        entry: [
          {
            resource: { resourceType: 'Patient', id: '789', name: [{ family: 'Johnson' }] },
            search: { mode: 'match' },
          },
          {
            resource: { resourceType: 'OperationOutcome', issue: [{ severity: 'information' }] },
            search: { mode: 'outcome' },
          },
        ],
      };

      mockedAxios.request.mockResolvedValueOnce({ data: bundle });

      const result = await client.resolve('Patient', { identifier: 'http://test|789' });

      expect(result.id).toBe('789');
      expect(result.resourceType).toBe('Patient');
    });

    test('should throw error if server returns entry without resource', async () => {
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'searchset',
        entry: [{ search: { mode: 'match' } }],
      };

      mockedAxios.request.mockResolvedValueOnce({ data: bundle });

      await expect(client.resolve('Patient', { name: 'Test' })).rejects.toThrow(
        'Server returned bundle entry without resource',
      );
    });

    test('should throw error when search returns no match', async () => {
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'searchset',
        entry: [],
      };

      mockedAxios.request.mockResolvedValueOnce({ data: bundle });

      await expect(client.resolve('Patient', { name: 'Unknown' })).rejects.toThrow(
        'Search returned no match',
      );
    });

    test('should throw error when search returns multiple matches', async () => {
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'searchset',
        entry: [
          { resource: { resourceType: 'Patient', id: '123' } },
          { resource: { resourceType: 'Patient', id: '456' } },
        ],
      };

      mockedAxios.request.mockResolvedValueOnce({ data: bundle });

      await expect(client.resolve('Patient', { name: 'Doe' })).rejects.toThrow(
        'Search returned multiple matches, criteria not selective enough',
      );
    });

    test('should distinguish between literal reference and query with slashes', async () => {
      const patient = { resourceType: 'Patient', id: '123' };

      mockedAxios.request.mockResolvedValueOnce({ data: patient });

      // This should be treated as a literal reference
      await client.resolve('Patient/123');

      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: 'Patient/123',
        }),
      );
    });

    test('should support noCache option with literal reference', async () => {
      const patient = { resourceType: 'Patient', id: '123' };

      mockedAxios.request.mockResolvedValueOnce({ data: patient });

      const result = await client.resolve('Patient/123', undefined, { noCache: true });

      expect(result).toEqual(patient);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: 'Patient/123',
        }),
      );
    });

    test('should throw FhirClientError when literal resolve request fails', async () => {
      mockedAxios.request.mockRejectedValueOnce(
        createAxiosError({
          status: 401,
          headers: { 'www-authenticate': 'Basic realm="FHIR"' },
        }),
      );

      await expect(client.resolve('Patient/123')).rejects.toMatchObject({
        name: 'FhirClientError',
        status: 401,
        request: { method: 'GET', url: 'Patient/123', resourceType: 'Patient', id: '123' },
      });
    });
  });

  describe('readWithResponse', () => {
    test('should return status 200 with parsed resource', async () => {
      const patient = { resourceType: 'Patient', id: '123' };
      mockedAxios.request.mockResolvedValueOnce({
        status: 200,
        data: patient,
        headers: { 'content-type': 'application/fhir+json', etag: 'W/"1"' },
      });

      const resp = await client.readWithResponse('Patient', '123');

      expect(resp.status).toBe(200);
      expect(resp.resource).toEqual(patient);
      expect(resp.headers).toBeDefined();
    });

    test('should return status 304 without throwing', async () => {
      mockedAxios.request.mockResolvedValueOnce({
        status: 304,
        data: '',
        headers: {},
      });

      const resp = await client.readWithResponse('Patient', '123', {
        headers: { 'If-None-Match': 'W/"1"' },
        noCache: true,
      });

      expect(resp.status).toBe(304);
      expect(resp.resource).toBeUndefined();
    });

    test('should return status 404 without throwing', async () => {
      mockedAxios.request.mockResolvedValueOnce({
        status: 404,
        data: { resourceType: 'OperationOutcome', issue: [] },
        headers: {},
      });

      const resp = await client.readWithResponse('Patient', 'unknown');

      expect(resp.status).toBe(404);
      expect(resp.resource).toBeUndefined();
    });

    test('should return status 410 without throwing', async () => {
      mockedAxios.request.mockResolvedValueOnce({
        status: 410,
        data: '',
        headers: {},
      });

      const resp = await client.readWithResponse('Patient', 'deleted');

      expect(resp.status).toBe(410);
      expect(resp.resource).toBeUndefined();
    });

    test('should send custom headers', async () => {
      const patient = { resourceType: 'Patient', id: '123' };
      mockedAxios.request.mockResolvedValueOnce({
        status: 200,
        data: patient,
        headers: {},
      });

      await client.readWithResponse('Patient', '123', {
        headers: { 'If-None-Match': 'W/"2"', 'X-Custom': 'test' },
        noCache: true,
      });

      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            'If-None-Match': 'W/"2"',
            'X-Custom': 'test',
          }),
        }),
      );
    });

    test('should throw FhirClientError for 500', async () => {
      mockedAxios.request.mockRejectedValueOnce(
        createAxiosError({
          status: 500,
          data: { resourceType: 'OperationOutcome', issue: [{ severity: 'error' }] },
          headers: { 'content-type': 'application/fhir+json' },
        }),
      );

      try {
        await client.readWithResponse('Patient', '123');
        throw new Error('expected error');
      } catch (err) {
        expect(err).toBeInstanceOf(FhirClientError);
        const fhirErr = err as FhirClientError;
        expect(fhirErr.status).toBe(500);
        expect(fhirErr.operationOutcome).toBeDefined();
        expect(fhirErr.request?.resourceType).toBe('Patient');
        expect(fhirErr.request?.id).toBe('123');
      }
    });

    test('should throw FhirClientError for 401', async () => {
      mockedAxios.request.mockRejectedValueOnce(
        createAxiosError({
          message: 'Unauthorized',
          status: 401,
          data: {},
          headers: {},
        }),
      );

      try {
        await client.readWithResponse('Patient', '123');
        throw new Error('expected error');
      } catch (err) {
        expect(err).toBeInstanceOf(FhirClientError);
        expect((err as FhirClientError).status).toBe(401);
      }
    });

    test('should extract response headers with lower-cased keys', async () => {
      mockedAxios.request.mockResolvedValueOnce({
        status: 200,
        data: { resourceType: 'Patient', id: '123' },
        headers: {
          ETag: 'W/"5"',
          'Content-Type': 'application/fhir+json',
          'Last-Modified': 'Sun, 08 Feb 2026 01:02:03 GMT',
        },
      });

      const resp = await client.readWithResponse('Patient', '123');

      expect(resp.headers['etag']).toBe('W/"5"');
      expect(resp.headers['content-type']).toBe('application/fhir+json');
      expect(resp.headers['last-modified']).toBe('Sun, 08 Feb 2026 01:02:03 GMT');
    });

    test('read should throw FhirClientError instead of raw Axios error', async () => {
      mockedAxios.request.mockRejectedValueOnce(
        createAxiosError({
          status: 401,
          data: { resourceType: 'OperationOutcome', issue: [{ severity: 'error' }] },
          headers: { 'content-type': 'application/fhir+json' },
        }),
      );

      await expect(client.read('Patient', '123')).rejects.toMatchObject({
        name: 'FhirClientError',
        status: 401,
        request: { method: 'GET', url: 'Patient/123', resourceType: 'Patient', id: '123' },
      });
    });

    test('search should throw FhirClientError when the request fails', async () => {
      mockedAxios.request.mockRejectedValueOnce(
        createAxiosError({
          status: 503,
          headers: { 'retry-after': '30' },
        }),
      );

      await expect(client.search('Patient', { active: true })).rejects.toMatchObject({
        name: 'FhirClientError',
        status: 503,
        headers: { 'retry-after': '30' },
        request: { method: 'GET', url: 'Patient?active=true' },
      });
    });

    test('read failures should not expose auth or raw Axios config fields', async () => {
      const authClient = new FhirClient({
        baseUrl: 'http://example.com/fhir',
        fhirVersion: 'R4',
        auth: {
          username: 'secret-user',
          password: 'secret-pass',
        },
      });

      mockedAxios.request.mockRejectedValueOnce(
        createAxiosError({
          status: 500,
          headers: { authorization: 'Basic dGVzdDp0ZXN0' },
          extra: {
            config: {
              auth: { username: 'secret-user', password: 'secret-pass' },
              headers: { authorization: 'Basic dGVzdDp0ZXN0' },
            },
          },
        }),
      );

      try {
        await authClient.read('Patient', '123');
        throw new Error('expected error');
      } catch (err) {
        expect(err).toBeInstanceOf(FhirClientError);
        const serialized = JSON.stringify(err);
        expect(serialized).not.toContain('secret-user');
        expect(serialized).not.toContain('secret-pass');
        expect(serialized).not.toContain('"auth"');
        expect(serialized).not.toContain('"config"');
        expect(serialized).not.toContain('Basic dGVzdDp0ZXN0');
      }
    });

    test('should bypass cache when noCache is true', async () => {
      const clientWithCache = new FhirClient({
        baseUrl: 'http://example.com/fhir',
        fhirVersion: 'R4',
        cache: { enable: true },
      });

      const patient = { resourceType: 'Patient', id: '123' };
      mockedAxios.request
        .mockResolvedValueOnce({ status: 200, data: patient, headers: {} })
        .mockResolvedValueOnce({ status: 200, data: { ...patient, active: true }, headers: {} });

      const resp1 = await clientWithCache.readWithResponse('Patient', '123');
      expect(resp1.resource).toEqual(patient);

      const resp2 = await clientWithCache.readWithResponse('Patient', '123', { noCache: true });
      expect(resp2.resource).toEqual({ ...patient, active: true });
      expect(mockedAxios.request).toHaveBeenCalledTimes(2);
    });
  });

  describe('conditionalRead', () => {
    test('should send If-None-Match when versionId is provided', async () => {
      mockedAxios.request.mockResolvedValueOnce({
        status: 304,
        data: '',
        headers: {},
      });

      const resp = await client.conditionalRead('Patient', '123', {
        versionId: '5',
      });

      expect(resp.status).toBe(304);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            'If-None-Match': 'W/"5"',
          }),
        }),
      );
    });

    test('should send If-Modified-Since when lastUpdated is provided', async () => {
      mockedAxios.request.mockResolvedValueOnce({
        status: 304,
        data: '',
        headers: {},
      });

      const resp = await client.conditionalRead('Patient', '123', {
        lastUpdated: '2026-02-08T01:02:03.456Z',
      });

      expect(resp.status).toBe(304);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            'If-Modified-Since': expect.stringContaining('GMT'),
          }),
        }),
      );
    });

    test('should prefer versionId over lastUpdated', async () => {
      mockedAxios.request.mockResolvedValueOnce({
        status: 304,
        data: '',
        headers: {},
      });

      await client.conditionalRead('Patient', '123', {
        versionId: '5',
        lastUpdated: '2026-02-08T01:02:03.456Z',
      });

      const calledHeaders = mockedAxios.request.mock.calls[0][0].headers as
        | Record<string, string>
        | undefined;
      expect(calledHeaders?.['If-None-Match']).toBe('W/"5"');
      expect(calledHeaders?.['If-Modified-Since']).toBeUndefined();
    });

    test('should not send conditional headers when no condition is provided', async () => {
      mockedAxios.request.mockResolvedValueOnce({
        status: 200,
        data: { resourceType: 'Patient', id: '123' },
        headers: {},
      });

      await client.conditionalRead('Patient', '123', {});

      const calledHeaders = mockedAxios.request.mock.calls[0][0].headers as
        | Record<string, string>
        | undefined;
      expect(calledHeaders?.['If-None-Match']).toBeUndefined();
      expect(calledHeaders?.['If-Modified-Since']).toBeUndefined();
    });

    test('should not send If-Modified-Since for invalid dates', async () => {
      mockedAxios.request.mockResolvedValueOnce({
        status: 200,
        data: { resourceType: 'Patient', id: '123' },
        headers: {},
      });

      await client.conditionalRead('Patient', '123', {
        lastUpdated: 'not-a-valid-date',
      });

      const calledHeaders = mockedAxios.request.mock.calls[0][0].headers as
        | Record<string, string>
        | undefined;
      expect(calledHeaders?.['If-Modified-Since']).toBeUndefined();
    });

    test('should support noCache option', async () => {
      const clientWithCache = new FhirClient({
        baseUrl: 'http://example.com/fhir',
        fhirVersion: 'R4',
        cache: { enable: true },
      });

      mockedAxios.request.mockResolvedValueOnce({
        status: 200,
        data: { resourceType: 'Patient', id: '123' },
        headers: {},
      });

      await clientWithCache.conditionalRead(
        'Patient',
        '123',
        { versionId: '1' },
        { noCache: true },
      );

      // Should have been called (not served from cache)
      expect(mockedAxios.request).toHaveBeenCalledTimes(1);
    });
  });

  describe('read with custom headers', () => {
    test('should pass per-request headers via read()', async () => {
      mockedAxios.request.mockResolvedValueOnce({
        data: { resourceType: 'Patient', id: '123' },
      });

      await client.read('Patient', '123', {
        headers: { 'X-Request-Id': 'abc' },
      });

      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Request-Id': 'abc',
          }),
        }),
      );
    });
  });

  describe('search with _lastUpdated', () => {
    test('should pass _lastUpdated parameter unchanged in GET search', async () => {
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'searchset',
        entry: [],
      };

      mockedAxios.request.mockResolvedValueOnce({ data: bundle });

      await client.search('StructureMap', {
        _lastUpdated: 'gt2026-02-08T01:02:03.456Z',
      });

      const callUrl = mockedAxios.request.mock.calls[0][0].url;
      expect(callUrl).toContain('_lastUpdated=gt2026-02-08T01%3A02%3A03.456Z');
    });

    test('should pass _lastUpdated parameter unchanged in POST search', async () => {
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'searchset',
        entry: [],
      };

      mockedAxios.request.mockResolvedValueOnce({ data: bundle });

      await client.search(
        'StructureMap',
        { _lastUpdated: 'gt2026-02-08T01:02:03.456Z' },
        { asPost: true },
      );

      const callData = mockedAxios.request.mock.calls[0][0].data;
      expect(callData).toContain('_lastUpdated=gt2026-02-08T01%3A02%3A03.456Z');
    });

    test('should pass params starting with _ through search unchanged', async () => {
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'searchset',
        entry: [],
      };

      mockedAxios.request.mockResolvedValueOnce({ data: bundle });

      await client.search('Patient', {
        _count: 10,
        _sort: '-_lastUpdated',
        _include: 'Patient:organization',
      });

      const callUrl = mockedAxios.request.mock.calls[0][0].url;
      expect(callUrl).toContain('_count=10');
      expect(callUrl).toContain('_sort=-_lastUpdated');
      expect(callUrl).toContain('_include=Patient%3Aorganization');
    });
  });
});
