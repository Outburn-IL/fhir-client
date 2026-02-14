export default async function globalTeardown() {
  console.log('Tests complete. HAPI FHIR server left running for next test run.');
  console.log('To stop manually: docker stop fhir-client-test-hapi');
  console.log('            - OR: npm run docker:stop');
}
