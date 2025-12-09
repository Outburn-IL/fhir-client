# Integration Tests

This directory contains integration tests for the FHIR client that run against a real HAPI FHIR server.

## Prerequisites

- Node.js and npm installed
- Docker and Docker Compose installed and running
- Port 8080 available (used by HAPI FHIR server)

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. The integration tests will automatically:
   - Start a HAPI FHIR R4 server using Docker Compose
   - Wait for the server to be ready (polls the metadata endpoint)
   - Verify the server is configured correctly (FHIR version 4.0.1, update-as-create enabled)
   - Run all integration tests
   - Clean up and stop the Docker containers

## Running the Tests

Run integration tests only:
```bash
npm run test:integration
```

Run both unit and integration tests:
```bash
npm run test:all
```

## Test Coverage

The integration tests cover:

1. **Server Metadata**
   - Retrieving CapabilityStatement
   - Verifying FHIR version 4.0.1
   - Confirming update-as-create support

2. **Resource Operations** (Patient, Encounter, Observation)
   - Create using update-as-create (PUT with ID)
   - Read resources
   - Update resources
   - Search for resources
   - Delete resources

3. **Pagination (fetchAll)**
   - Creates 250 Patient resources (more than max page size of 200)
   - Tests fetchAll functionality to retrieve all pages
   - Verifies correct count, no duplicates, and correct resource types
   - Tests both with and without fetchAll option

4. **Bundle Operations**
   - Transaction bundles
   - Batch bundles

5. **Create Operations**
   - POST operations (server-assigned IDs)

6. **Error Handling**
   - Non-existent resource reads
   - Non-existent resource deletes

## Configuration

### HAPI FHIR Server Configuration

The server is configured via `hapi.application.yaml`:
- FHIR Version: R4
- Database: In-memory H2
- Update-as-create: Enabled
- Default page size: 20
- Max page size: 200

### Docker Compose

The `docker-compose.yml` file defines:
- HAPI FHIR server (latest image)
- Port mapping: 8080:8080
- Health check on metadata endpoint
- Volume mount for configuration

## Timeout

Integration tests have a 2-minute timeout per test to accommodate:
- Docker container startup
- Server initialization
- Large data operations (e.g., creating 250 resources)

## Troubleshooting

### Port Already in Use
If port 8080 is already in use, stop any running containers:
```bash
docker-compose -f tests/integration/docker-compose.yml down
```

### Docker Not Running
Ensure Docker Desktop (or Docker daemon) is running before executing tests.

### Tests Timeout
If tests timeout during server startup:
1. Check Docker logs: `docker logs fhir-client-test-hapi`
2. Increase `MAX_RETRIES` or `RETRY_INTERVAL` in `setup.ts`
3. Ensure your system has enough resources for Docker

### Cleanup
To manually clean up Docker containers:
```bash
cd tests/integration
docker-compose down -v
```
