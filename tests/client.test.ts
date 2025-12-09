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
});
