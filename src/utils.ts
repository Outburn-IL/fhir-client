import { FhirVersion } from '@outburn/types';

export function normalizeFhirVersion(version: FhirVersion): string {
  switch (version) {
    case '3.0.2':
    case '3.0':
    case 'R3':
    case 'STU3':
      return '3.0';
    case '4.0.1':
    case '4.0':
    case 'R4':
      return '4.0';
    case '4.3.0':
    case '4.3':
    case 'R4B':
      return '4.3';
    case '5.0.0':
    case '5.0':
    case 'R5':
      return '5.0';
    default:
      throw new Error(`Unsupported FHIR version: ${version}`);
  }
}

/**
 * Format a FHIR `meta.versionId` as a weak ETag suitable for `If-None-Match`.
 *
 * @example formatWeakEtag('3') => 'W/"3"'
 */
export function formatWeakEtag(versionId: string): string {
  return `W/"${versionId}"`;
}

/**
 * Convert a FHIR instant / ISO-8601 string to an HTTP-date (RFC 7231) suitable
 * for the `If-Modified-Since` header.
 *
 * Returns `undefined` if the input cannot be parsed into a valid date.
 */
export function toHttpDate(isoString: string): string | undefined {
  const date = new Date(isoString);
  if (Number.isNaN(date.valueOf())) {
    return undefined;
  }
  return date.toUTCString();
}

export function mergeSearchParams(
  query: string,
  params?: Record<string, string | number | boolean | (string | number | boolean)[]>,
): Record<string, string | number | boolean | (string | number | boolean)[]> {
  const urlParams = new URLSearchParams(query);
  const merged: Record<string, string | number | boolean | (string | number | boolean)[]> = {};

  // Add params from query string
  urlParams.forEach((value: string, key: string) => {
    const existing = merged[key];
    if (existing !== undefined) {
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        merged[key] = [existing, value];
      }
    } else {
      merged[key] = value;
    }
  });

  // Add explicit params
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      const existing = merged[key];
      if (existing !== undefined) {
        if (Array.isArray(existing)) {
          if (Array.isArray(value)) {
            existing.push(...value);
          } else {
            existing.push(value);
          }
        } else {
          if (Array.isArray(value)) {
            merged[key] = [existing, ...value];
          } else {
            merged[key] = [existing, value];
          }
        }
      } else {
        merged[key] = value;
      }
    });
  }

  return merged;
}
