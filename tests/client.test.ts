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
        url: 'Patient',
        params: {
          name: 'john',
          active: true,
        },
      }),
    );
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

  test('update should make a PUT request', async () => {
    const patient = { resourceType: 'Patient', id: '123', active: true };
    mockedAxios.request.mockResolvedValueOnce({
      data: patient,
    });

    const result = await client.update('Patient', '123', patient);

    expect(mockedAxios.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'PUT',
        url: 'Patient/123',
        data: patient,
      }),
    );
    expect(result).toEqual(patient);
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

    await client.update('Patient', '123', patient);

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
        params: {},
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

  test('should handle pagination errors gracefully', async () => {
    const bundle1: Bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      link: [{ relation: 'next', url: 'http://example.com/fhir/Patient?page=2' }],
      entry: [{ resource: { resourceType: 'Patient', id: '1' } }],
    };

    mockedAxios.request
      .mockResolvedValueOnce({ data: bundle1 })
      .mockRejectedValueOnce(new Error('Network error'));

    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

    const results = await client.search('Patient', {}, { fetchAll: true });

    expect(results).toHaveLength(1);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Failed to fetch next page',
      expect.any(Error),
    );

    consoleWarnSpy.mockRestore();
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
});
