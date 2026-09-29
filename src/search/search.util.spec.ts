import { normalizeQuery } from './search.service.js';

describe('normalizeQuery', () => {
  it('makes equivalent queries share one cache key', () => {
    expect(normalizeQuery('  NestJS   Guards ')).toBe('nestjs guards');
    expect(normalizeQuery('nestjs\tguards\n')).toBe('nestjs guards');
  });
});
