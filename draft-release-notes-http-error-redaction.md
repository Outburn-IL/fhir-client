# Draft Release Notes: HTTP Error Redaction

`@outburn/fhir-client` now normalizes HTTP transport failures from its main public API surface to `FhirClientError` instead of leaking raw Axios errors.

This hardens security and privacy behavior by preventing request config, nested auth objects, and similar Axios internals from surfacing through serialized error payloads.

This is a bug-fix level change for the package API: the supported error shape is the existing `FhirClientError` contract.

Consumers that were inspecting Axios-specific fields on thrown errors should switch to the safe `FhirClientError` fields (`status`, `headers`, `operationOutcome`, and `request`).
