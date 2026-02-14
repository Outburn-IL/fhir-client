import { execSync } from 'child_process';
import * as path from 'path';

const FHIR_BASE_URL = 'http://localhost:8083/fhir';

async function waitForHapiReady (baseUrl: string, opts?: { maxAttempts?: number; delayMs?: number; timeoutMs?: number }) {
  const maxAttempts = opts?.maxAttempts ?? 60;
  const delayMs = opts?.delayMs ?? 2000;
  const timeoutMs = opts?.timeoutMs ?? 5000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(`${baseUrl}/metadata`, { signal: controller.signal });
      clearTimeout(timeout);

      if (response.ok) {
        return;
      }
    } catch {
      // Server not ready yet
    }

    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  throw new Error('HAPI FHIR server failed to start within timeout');
}

export default async function globalSetup () {
  console.log('Checking HAPI FHIR server status...');

  try {
    const response = await fetch(`${FHIR_BASE_URL}/metadata`);
    if (response.ok) {
      console.log('HAPI FHIR server is already running and healthy!');
      return;
    }
  } catch {
    // Server not running or not ready
  }

  console.log('Starting HAPI FHIR server...');
  const composeFile = path.join(__dirname, 'docker-compose.yml');
  execSync(`docker compose -f "${composeFile}" up -d`, {
    stdio: 'inherit',
    cwd: __dirname
  });

  console.log('Waiting for HAPI FHIR server to be ready...');
  await waitForHapiReady(FHIR_BASE_URL, { maxAttempts: 60, delayMs: 2000 });
  await new Promise(resolve => setTimeout(resolve, 2000));
}
