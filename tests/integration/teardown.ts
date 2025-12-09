import { down } from 'docker-compose';
import * as path from 'path';

export default async function globalTeardown() {
  console.log('Stopping HAPI FHIR server...');
  
  const composeFilePath = path.join(__dirname, 'docker-compose.yml');
  const composeOptions = {
    cwd: path.dirname(composeFilePath),
    log: true,
  };
  
  try {
    await down(composeOptions);
    console.log('Docker containers stopped and removed');
  } catch (error) {
    console.error('Failed to stop integration test environment:', error);
    throw error;
  }
}
