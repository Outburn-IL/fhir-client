# Draft Release Notes: Issue 97 Search Transform

`@outburn/fhir-client` now supports `search(..., { fetchAll: true, transform })` for sequential per-resource projection and filtering during paginated searches.

The transformer runs for each encountered `Bundle.entry[].resource`, including `_include` and `_revinclude` resources, and receives `(resource, mode, index, entry)`.

Returning `undefined` filters that item out of the final array, while thrown or rejected transformer failures still fail the overall search immediately.

This is an additive feature for `fetchAll` users. Existing bundle-returning searches are unchanged.

Compatibility notes for `fetchAll` users:

- `transform` is only valid with `fetchAll: true`.
- `maxResults` still counts raw fetched resources before transform filtering.
- Non-callable `transform` values are rejected.