/* eslint-disable @typescript-eslint/no-unused-vars */
import { upAll } from 'docker-compose';
import * as path from 'path';
import axios from 'axios';

const FHIR_BASE_URL = 'http://localhost:8080/fhir';
const MAX_RETRIES = 60; // 60 retries with 2 second intervals = 2 minutes max
const RETRY_INTERVAL = 2000; // 2 seconds

async function pollMetadataEndpoint(): Promise<void> {
  console.log('Polling FHIR server metadata endpoint...');
  
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const response = await axios.get(`${FHIR_BASE_URL}/metadata`, {
        timeout: 5000,
      });
      
      if (response.data?.resourceType === 'CapabilityStatement') {
        const fhirVersion = response.data.fhirVersion;
        console.log(`FHIR server is ready! FHIR Version: ${fhirVersion}`);
        
        if (fhirVersion !== '4.0.1') {
          console.warn(`Warning: Expected FHIR version 4.0.1, got ${fhirVersion}`);
        }
        
        return;
      }
    } catch (error) {
      // Server not ready yet, continue polling
      if (i < MAX_RETRIES - 1) {
        await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
      }
    }
  }
  
  throw new Error('FHIR server did not respond with a valid CapabilityStatement within the timeout period');
}

export default async function globalSetup() {
  console.log('Starting HAPI FHIR server for integration tests...');
  
  const composeFilePath = path.join(__dirname, 'docker-compose.yml');
  const composeOptions = {
    cwd: path.dirname(composeFilePath),
    log: true,
  };
  
  try {
    await upAll(composeOptions);
    console.log('Docker containers started');
    
    // Wait for server to be ready
    await pollMetadataEndpoint();
    
    console.log('Integration test environment is ready!');
  } catch (error) {
    console.error('Failed to start integration test environment:', error);
    throw error;
  }
}
