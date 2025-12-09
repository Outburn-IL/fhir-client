import { FhirClient } from '../../src/client';
import { Bundle, CapabilityStatement, Resource, JsonValue } from '../../src/types';

const FHIR_BASE_URL = 'http://localhost:8080/fhir';

// Helper type for Patient resources in tests
interface PatientName {
  family?: string;
  given?: string[];
}

type Patient = Resource & {
  name?: PatientName[];
  gender?: string;
};

describe('FHIR Client Integration Tests', () => {
  let client: FhirClient;

  beforeAll(() => {
    client = new FhirClient({
      baseUrl: FHIR_BASE_URL,
      fhirVersion: 'R4',
    });
  });

  describe('Server Metadata', () => {
    let capabilityStatement: CapabilityStatement;

    it('should retrieve CapabilityStatement from metadata endpoint', async () => {
      capabilityStatement = await client.getCapabilities();
      
      expect(capabilityStatement).toBeDefined();
      expect(capabilityStatement.resourceType).toBe('CapabilityStatement');
    });

    it('should have FHIR version 4.0.1', async () => {
      if (!capabilityStatement) {
        capabilityStatement = await client.getCapabilities();
      }
      
      expect(capabilityStatement.fhirVersion).toBe('4.0.1');
    });

    it('should support update-as-create', async () => {
      if (!capabilityStatement) {
        capabilityStatement = await client.getCapabilities();
      }
      
      // Check if the server supports update (which includes update-as-create)
      const restConfig = capabilityStatement.rest?.[0];
      expect(restConfig).toBeDefined();
      
      // HAPI FHIR supports update interactions on Patient resources
      const patientResource = restConfig?.resource?.find(r => r.type === 'Patient');
      const hasUpdateInteraction = patientResource?.interaction?.some(i => i.code === 'update');
      
      expect(hasUpdateInteraction).toBe(true);
    });
  });

  describe('Patient Resource Operations', () => {
    const patientId = 'test-patient-1';
    
    it('should create a Patient using update-as-create (PUT)', async () => {
      const patient = {
        resourceType: 'Patient',
        id: patientId,
        name: [{
          family: 'Doe',
          given: ['John'],
        }],
        gender: 'male',
        birthDate: '1980-01-01',
      };

      const result = await client.update('Patient', patientId, patient);
      
      expect(result).toBeDefined();
      expect(result.resourceType).toBe('Patient');
      expect(result.id).toBe(patientId);
      expect(result.name?.[0]?.family).toBe('Doe');
    });

    it('should read the created Patient', async () => {
      const patient = await client.read<Patient>('Patient', patientId);
      
      expect(patient).toBeDefined();
      expect(patient.resourceType).toBe('Patient');
      expect(patient.id).toBe(patientId);
      expect(patient.name?.[0]?.family).toBe('Doe');
    });

    it('should update the Patient', async () => {
      const patient = await client.read<Patient>('Patient', patientId);
      
      // Update the patient's given name
      if (patient.name && patient.name[0]) {
        patient.name[0].given = ['Jane'];
      }
      
      const updated = await client.update<Patient>('Patient', patientId, patient);
      
      expect(updated.name?.[0]?.given?.[0]).toBe('Jane');
    });

    it('should search for Patient resources', async () => {
      const result = await client.search<Resource>('Patient', {
        family: 'Doe',
      });
      
      expect(result).toBeDefined();
      expect((result as Bundle).resourceType).toBe('Bundle');
      expect((result as Bundle).entry).toBeDefined();
      expect((result as Bundle).entry!.length).toBeGreaterThan(0);
    });

    it('should delete the Patient', async () => {
      await client.delete('Patient', patientId);
      
      // Verify deletion by trying to read
      await expect(client.read('Patient', patientId)).rejects.toThrow();
    });
  });

  describe('Encounter Resource Operations', () => {
    const encounterId = 'test-encounter-1';
    const patientId = 'test-patient-encounter';

    beforeAll(async () => {
      // Create a patient first
      const patient = {
        resourceType: 'Patient',
        id: patientId,
        name: [{
          family: 'Smith',
          given: ['Bob'],
        }],
      };
      await client.update('Patient', patientId, patient);
    });

    afterAll(async () => {
      // Cleanup
      try {
        await client.delete('Encounter', encounterId);
      } catch (e) {
        // Ignore if already deleted
      }
      try {
        await client.delete('Patient', patientId);
      } catch (e) {
        // Ignore if already deleted
      }
    });

    it('should create an Encounter using update-as-create', async () => {
      const encounter = {
        resourceType: 'Encounter',
        id: encounterId,
        status: 'finished',
        class: {
          system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
          code: 'AMB',
        },
        subject: {
          reference: `Patient/${patientId}`,
        },
      };

      const result = await client.update('Encounter', encounterId, encounter);
      
      expect(result).toBeDefined();
      expect(result.resourceType).toBe('Encounter');
      expect(result.id).toBe(encounterId);
      expect(result.status).toBe('finished');
    });

    it('should read the created Encounter', async () => {
      const encounter = await client.read('Encounter', encounterId);
      
      expect(encounter).toBeDefined();
      expect(encounter.resourceType).toBe('Encounter');
      expect(encounter.id).toBe(encounterId);
    });

    it('should search for Encounter resources', async () => {
      const result = await client.search<Resource>('Encounter', {
        patient: patientId,
      });
      
      expect(result).toBeDefined();
      expect((result as Bundle).resourceType).toBe('Bundle');
      expect((result as Bundle).entry).toBeDefined();
      expect((result as Bundle).entry!.length).toBeGreaterThan(0);
    });
  });

  describe('Observation Resource Operations', () => {
    const observationId = 'test-observation-1';
    const patientId = 'test-patient-observation';

    beforeAll(async () => {
      // Create a patient first
      const patient = {
        resourceType: 'Patient',
        id: patientId,
        name: [{
          family: 'Johnson',
          given: ['Alice'],
        }],
      };
      await client.update('Patient', patientId, patient);
    });

    afterAll(async () => {
      // Cleanup
      try {
        await client.delete('Observation', observationId);
      } catch (e) {
        // Ignore if already deleted
      }
      try {
        await client.delete('Patient', patientId);
      } catch (e) {
        // Ignore if already deleted
      }
    });

    it('should create an Observation using update-as-create', async () => {
      const observation = {
        resourceType: 'Observation',
        id: observationId,
        status: 'final',
        code: {
          coding: [{
            system: 'http://loinc.org',
            code: '29463-7',
            display: 'Body Weight',
          }],
        },
        subject: {
          reference: `Patient/${patientId}`,
        },
        valueQuantity: {
          value: 70,
          unit: 'kg',
          system: 'http://unitsofmeasure.org',
          code: 'kg',
        },
      };

      const result = await client.update('Observation', observationId, observation);
      
      expect(result).toBeDefined();
      expect(result.resourceType).toBe('Observation');
      expect(result.id).toBe(observationId);
      expect(result.status).toBe('final');
    });

    it('should read the created Observation', async () => {
      const observation = await client.read('Observation', observationId);
      
      expect(observation).toBeDefined();
      expect(observation.resourceType).toBe('Observation');
      expect(observation.id).toBe(observationId);
    });

    it('should search for Observation resources', async () => {
      const result = await client.search<Resource>('Observation', {
        patient: patientId,
      });
      
      expect(result).toBeDefined();
      expect((result as Bundle).resourceType).toBe('Bundle');
      expect((result as Bundle).entry).toBeDefined();
      expect((result as Bundle).entry!.length).toBeGreaterThan(0);
    });
  });

  describe('Pagination (fetchAll)', () => {
    const patientIdPrefix = 'pagination-test-patient';
    const numberOfPatients = 250; // More than the max page size of 200

    beforeAll(async () => {
      console.log(`Creating ${numberOfPatients} patients for pagination test...`);
      
      // Create patients in batches using transaction bundles
      const batchSize = 50;
      for (let i = 0; i < numberOfPatients; i += batchSize) {
        const entries = [];
        for (let j = i; j < Math.min(i + batchSize, numberOfPatients); j++) {
          const patientId = `${patientIdPrefix}-${j}`;
          entries.push({
            request: {
              method: 'PUT',
              url: `Patient/${patientId}`,
            },
            resource: {
              resourceType: 'Patient',
              id: patientId,
              name: [{
                family: 'PaginationTest',
                given: [`Patient${j}`],
              }],
              identifier: [{
                system: 'http://test.com/pagination',
                value: `pagination-test-${j}`,
              }],
            },
          });
        }

        const bundle: Bundle = {
          resourceType: 'Bundle',
          type: 'transaction',
          entry: entries,
        };

        await client.processTransaction(bundle);
      }
      
      console.log(`Created ${numberOfPatients} patients successfully`);
    });

    afterAll(async () => {
      console.log('Cleaning up pagination test patients...');
      
      // Delete all test patients
      const batchSize = 50;
      for (let i = 0; i < numberOfPatients; i += batchSize) {
        const entries = [];
        for (let j = i; j < Math.min(i + batchSize, numberOfPatients); j++) {
          const patientId = `${patientIdPrefix}-${j}`;
          entries.push({
            request: {
              method: 'DELETE',
              url: `Patient/${patientId}`,
            },
          });
        }

        const bundle: Bundle = {
          resourceType: 'Bundle',
          type: 'transaction',
          entry: entries,
        };

        try {
          await client.processTransaction(bundle);
        } catch (e) {
          // Ignore errors during cleanup
        }
      }
      
      console.log('Cleanup completed');
    });

    it('should fetch all pages and return exactly the created number of resources', async () => {
      const results = await client.search<Resource>('Patient', {
        identifier: 'http://test.com/pagination|',
      }, { fetchAll: true });
      
      expect(Array.isArray(results)).toBe(true);
      expect((results as Resource[]).length).toBe(numberOfPatients);
      
      // Verify all resources are of type Patient
      const allPatients = (results as Resource[]).every(r => r.resourceType === 'Patient');
      expect(allPatients).toBe(true);
      
      // Verify no duplicates
      const ids = (results as Resource[]).map(r => r.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(numberOfPatients);
    });

    it('should fetch all pages and return correct resources with family name filter', async () => {
      const results = await client.search<Resource>('Patient', {
        family: 'PaginationTest',
      }, { fetchAll: true });
      
      expect(Array.isArray(results)).toBe(true);
      expect((results as Patient[]).length).toBeGreaterThanOrEqual(numberOfPatients);
      
      // Verify all have the correct family name
      const allCorrectFamily = (results as Patient[]).every(r => 
        r.name?.[0]?.family === 'PaginationTest'
      );
      expect(allCorrectFamily).toBe(true);
    });

    it('should return a Bundle when fetchAll is false', async () => {
      const result = await client.search<Resource>('Patient', {
        identifier: 'http://test.com/pagination|',
      }, { fetchAll: false });
      
      expect((result as Bundle).resourceType).toBe('Bundle');
      expect((result as Bundle).entry).toBeDefined();
      expect((result as Bundle).entry!.length).toBeLessThanOrEqual(200); // Max page size
      
      // Should have a next link since there are more than 200 resources
      const hasNextLink = (result as Bundle).link?.some(l => l.relation === 'next');
      expect(hasNextLink).toBe(true);
    });
  });

  describe('Bundle Operations', () => {
    it('should process a transaction bundle', async () => {
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'transaction',
        entry: [
          {
            request: {
              method: 'PUT',
              url: 'Patient/transaction-test-1',
            },
            resource: {
              resourceType: 'Patient',
              id: 'transaction-test-1',
              name: [{
                family: 'Transaction',
                given: ['Test1'],
              }],
            },
          },
          {
            request: {
              method: 'PUT',
              url: 'Patient/transaction-test-2',
            },
            resource: {
              resourceType: 'Patient',
              id: 'transaction-test-2',
              name: [{
                family: 'Transaction',
                given: ['Test2'],
              }],
            },
          },
        ],
      };

      const result = await client.processTransaction(bundle);
      
      expect(result).toBeDefined();
      expect(result.resourceType).toBe('Bundle');
      expect(result.type).toBe('transaction-response');
      expect(result.entry).toBeDefined();
      expect(result.entry!.length).toBe(2);

      // Cleanup
      await client.delete('Patient', 'transaction-test-1');
      await client.delete('Patient', 'transaction-test-2');
    });

    it('should process a batch bundle', async () => {
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'batch',
        entry: [
          {
            request: {
              method: 'PUT',
              url: 'Patient/batch-test-1',
            },
            resource: {
              resourceType: 'Patient',
              id: 'batch-test-1',
              name: [{
                family: 'Batch',
                given: ['Test1'],
              }],
            },
          },
          {
            request: {
              method: 'GET',
              url: 'Patient/batch-test-1',
            },
          },
        ],
      };

      const result = await client.processBatch(bundle);
      
      expect(result).toBeDefined();
      expect(result.resourceType).toBe('Bundle');
      expect(result.type).toBe('batch-response');
      expect(result.entry).toBeDefined();
      expect(result.entry!.length).toBe(2);

      // Cleanup
      await client.delete('Patient', 'batch-test-1');
    });
  });

  describe('Create Operation (POST)', () => {
    it('should create a Patient using POST', async () => {
      const patient = {
        resourceType: 'Patient',
        name: [{
          family: 'PostTest',
          given: ['CreateTest'],
        }],
        gender: 'female',
      };

      const result = await client.create<Patient>('Patient', patient);
      
      expect(result).toBeDefined();
      expect(result.resourceType).toBe('Patient');
      expect(result.id).toBeDefined();
      expect(result.name?.[0]?.family).toBe('PostTest');

      // Cleanup
      if (result.id) {
        await client.delete('Patient', result.id);
      }
    });
  });

  describe('Error Handling', () => {
    it('should throw error when reading non-existent resource', async () => {
      await expect(
        client.read('Patient', 'non-existent-id-12345')
      ).rejects.toThrow();
    });
  });
});
