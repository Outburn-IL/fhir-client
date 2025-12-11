import { FhirVersion } from './types';

export function normalizeFhirVersion(version: FhirVersion): string {
  switch (version) {
    case '3.0.1':
    case '3.0':
    case 'R3':
      return '3.0';
    case '4.0.1':
    case '4.0':
    case 'R4':
      return '4.0';
    case '5.0.0':
    case '5.0':
    case 'R5':
      return '5.0';
    default:
      throw new Error(`Unsupported FHIR version: ${version}`);
  }
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
