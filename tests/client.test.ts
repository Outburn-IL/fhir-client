/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from 'axios';
import { FhirClient } from '../src/client';
import { Bundle } from '../src/types';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('FhirClient', () => {
  let client: FhirClient;

  beforeEach(() => {
    mockedAxios.create.mockReturnThis();
    mockedAxios.request.mockResolvedValue({ data: {} });
    
    client = new FhirClient({
      baseUrl: 'http://example.com/fhir',
      fhirVersion: 'R4',
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
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
      "processTransaction requires a Bundle resource, got Patient",
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
      "processBatch requires a Bundle resource, got Patient",
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

  test('update should throw error if resourceType is missing', async () => {
    const patient = { id: '123', active: true } as any;

    await expect(client.update(patient)).rejects.toThrow(
      'Resource must have a resourceType property'
    );
  });

  test('update should throw error if id is missing', async () => {
    const patient = { resourceType: 'Patient', active: true } as any;

    await expect(client.update(patient)).rejects.toThrow(
      'Resource must have an id property for update operation'
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

    await expect(
      client.search('Patient', {}, { fetchAll: true })
    ).rejects.toThrow('Network error');
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

    await expect(
      clientWithLimit.search('Patient', {}, { fetchAll: true })
    ).rejects.toThrow('Maximum result limit (5) exceeded');
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

    await expect(
      client.search('Patient', {}, { fetchAll: true, maxResults: 5 })
    ).rejects.toThrow('Maximum result limit (5) exceeded');
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

    await expect(
      client.search('Patient', {}, { fetchAll: true, maxResults: 8 })
    ).rejects.toThrow('Maximum result limit (8) exceeded');
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
      })
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
      })
    );
  });

  test('should handle array values in POST search parameters', async () => {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      entry: [],
    };

    mockedAxios.request.mockResolvedValueOnce({ data: bundle });

    await client.search('Patient', { identifier: ['http://hospital.org/mrn|123', 'http://national-id.gov/ssn|456'], active: true }, { asPost: true });

    expect(mockedAxios.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: 'Patient/_search',
        headers: expect.objectContaining({
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
        // Should contain multiple identifier parameters, not a comma-separated string
        data: expect.stringMatching(/identifier=http%3A%2F%2Fhospital.*identifier=http%3A%2F%2Fnational|identifier=http%3A%2F%2Fnational.*identifier=http%3A%2F%2Fhospital/),
      })
    );
    
    // Verify it doesn't use comma-separated format
    const callData = mockedAxios.request.mock.calls[0][0].data;
    expect(callData).not.toContain('identifier=http://hospital.org/mrn|123,http://national-id.gov/ssn|456');
  });

  test('should handle array values in GET search parameters', async () => {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      entry: [],
    };

    mockedAxios.request.mockResolvedValueOnce({ data: bundle });

    await client.search('Patient', { identifier: ['http://hospital.org/mrn|123', 'http://national-id.gov/ssn|456'], active: true });

    expect(mockedAxios.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        // URL should contain multiple identifier parameters
        url: expect.stringMatching(/\?.*identifier=http%3A%2F%2Fhospital.*identifier=http%3A%2F%2Fnational|identifier=http%3A%2F%2Fnational.*identifier=http%3A%2F%2Fhospital/),
      })
    );
    
    // Verify it doesn't use bracket notation or comma-separated format
    const callUrl = mockedAxios.request.mock.calls[0][0].url;
    expect(callUrl).not.toContain('identifier[]=');
    expect(callUrl).not.toContain('identifier=http://hospital.org/mrn|123,http://national-id.gov/ssn|456');
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

  test('should handle FHIR version 3.0.1', () => {
    new FhirClient({
      baseUrl: 'http://example.com/fhir',
      fhirVersion: '3.0.1',
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
        'Search returned no match'
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
        'Search returned multiple matches (2), criteria not selective enough'
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
        'Server returned malformed resource without resourceType or id'
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

      const result = await client.toLiteral('Patient', { name: 'Doe' }, { asPost: true, noCache: true });

      expect(result).toBe('Patient/123');
      // Verify the search was called (implementation details of how are internal)
      expect(mockedAxios.request).toHaveBeenCalled();
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
        'Search returned no match'
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
        })
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
        'Server returned bundle entry without resource'
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
        'Search returned no match'
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
        'Search returned multiple matches, criteria not selective enough'
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
        })
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
        })
      );
    });
  });
});
