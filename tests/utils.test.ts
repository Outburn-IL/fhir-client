import { normalizeFhirVersion, mergeSearchParams } from '../src/utils';

describe('normalizeFhirVersion', () => {
  test('should normalize R3 to 3.0', () => {
    expect(normalizeFhirVersion('R3')).toBe('3.0');
  });

  test('should normalize 3.0 to 3.0', () => {
    expect(normalizeFhirVersion('3.0')).toBe('3.0');
  });

  test('should normalize 3.0.2 to 3.0', () => {
    expect(normalizeFhirVersion('3.0.2')).toBe('3.0');
  });

  test('should normalize STU3 to 3.0', () => {
    expect(normalizeFhirVersion('STU3')).toBe('3.0');
  });

  test('should normalize R4 to 4.0', () => {
    expect(normalizeFhirVersion('R4')).toBe('4.0');
  });

  test('should normalize 4.0 to 4.0', () => {
    expect(normalizeFhirVersion('4.0')).toBe('4.0');
  });

  test('should normalize 4.0.1 to 4.0', () => {
    expect(normalizeFhirVersion('4.0.1')).toBe('4.0');
  });

  test('should normalize 4.3.0 to 4.3', () => {
    expect(normalizeFhirVersion('4.3.0')).toBe('4.3');
  });

  test('should normalize 4.3 to 4.3', () => {
    expect(normalizeFhirVersion('4.3')).toBe('4.3');
  });

  test('should normalize R4B to 4.3', () => {
    expect(normalizeFhirVersion('R4B')).toBe('4.3');
  });

  test('should normalize R5 to 5.0', () => {
    expect(normalizeFhirVersion('R5')).toBe('5.0');
  });

  test('should normalize 5.0 to 5.0', () => {
    expect(normalizeFhirVersion('5.0')).toBe('5.0');
  });

  test('should normalize 5.0.0 to 5.0', () => {
    expect(normalizeFhirVersion('5.0.0')).toBe('5.0');
  });

  test('should throw error for unsupported version', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => normalizeFhirVersion('2.0' as any)).toThrow(
      'Unsupported FHIR version: 2.0',
    );
  });
});

describe('mergeSearchParams', () => {
  test('should parse query string into params', () => {
    const result = mergeSearchParams('name=John&active=true', undefined);
    expect(result).toEqual({
      name: 'John',
      active: 'true',
    });
  });

  test('should merge query string with explicit params', () => {
    const result = mergeSearchParams('name=John', { active: true });
    expect(result).toEqual({
      name: 'John',
      active: true,
    });
  });

  test('should handle duplicate keys in query string', () => {
    const result = mergeSearchParams('name=John&name=Jane', undefined);
    expect(result).toEqual({
      name: ['John', 'Jane'],
    });
  });

  test('should merge duplicate keys from query and params', () => {
    const result = mergeSearchParams('name=John', { name: 'Jane' });
    expect(result).toEqual({
      name: ['John', 'Jane'],
    });
  });

  test('should handle array values in params', () => {
    const result = mergeSearchParams('name=John', { name: ['Jane', 'Bob'] });
    expect(result).toEqual({
      name: ['John', 'Jane', 'Bob'],
    });
  });

  test('should handle array values in both query and params', () => {
    const result = mergeSearchParams('name=John&name=Alice', {
      name: ['Jane', 'Bob'],
    });
    expect(result).toEqual({
      name: ['John', 'Alice', 'Jane', 'Bob'],
    });
  });

  test('should handle single value merging with array', () => {
    const result = mergeSearchParams('name=John&name=Alice', { active: true });
    expect(result).toEqual({
      name: ['John', 'Alice'],
      active: true,
    });
  });

  test('should handle params with single value merging with existing array', () => {
    const result = mergeSearchParams('name=John&name=Alice', { name: 'Bob' });
    expect(result).toEqual({
      name: ['John', 'Alice', 'Bob'],
    });
  });

  test('should handle empty query string', () => {
    const result = mergeSearchParams('', { name: 'John' });
    expect(result).toEqual({
      name: 'John',
    });
  });

  test('should handle undefined params', () => {
    const result = mergeSearchParams('name=John', undefined);
    expect(result).toEqual({
      name: 'John',
    });
  });

  test('should handle empty params object', () => {
    const result = mergeSearchParams('name=John', {});
    expect(result).toEqual({
      name: 'John',
    });
  });

  test('should handle query string with duplicate parameter followed by more duplicates in query', () => {
    const result = mergeSearchParams('name=John&name=Jane&name=Bob', undefined);
    expect(result).toEqual({
      name: ['John', 'Jane', 'Bob'],
    });
  });

  test('should parse identifier query string correctly', () => {
    const result = mergeSearchParams('identifier=9999958892', undefined);
    expect(result).toEqual({
      identifier: '9999958892',
    });
  });
});
