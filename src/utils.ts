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
  params?: Record<string, any>,
): Record<string, any> {
  const urlParams = new URLSearchParams(query);
  const merged: Record<string, any> = {};

  // Add params from query string
  urlParams.forEach((value: string, key: string) => {
    if (merged[key]) {
      if (Array.isArray(merged[key])) {
        merged[key].push(value);
      } else {
        merged[key] = [merged[key], value];
      }
    } else {
      merged[key] = value;
    }
  });

  // Add explicit params
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (merged[key]) {
        if (Array.isArray(merged[key])) {
          if (Array.isArray(value)) {
            merged[key].push(...value);
          } else {
            merged[key].push(value);
          }
        } else {
          if (Array.isArray(value)) {
            merged[key] = [merged[key], ...value];
          } else {
            merged[key] = [merged[key], value];
          }
        }
      } else {
        merged[key] = value;
      }
    });
  }

  return merged;
}
