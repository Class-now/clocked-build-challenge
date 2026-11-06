import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
  buildCommand: string;
  outputDirectory: string;
  functions: Record<string, unknown>;
  rewrites: { source: string; destination: string }[];
};

/** Vercel tries rewrites in order, each source matching the whole path. */
function destinationFor(path: string): string | undefined {
  for (const { source, destination } of config.rewrites) {
    const match = new RegExp(`^${source}$`).exec(path);
    if (match) return destination.replace('$1', match[1] ?? '');
  }
  return undefined;
}

describe('vercel.json', () => {
  it('builds the page into dist and serves the api folder as functions', () => {
    expect(config.buildCommand).toBe('npm run build:web');
    expect(config.outputDirectory).toBe('dist');
    expect(Object.keys(config.functions)).toEqual(['api/*.ts']);
  });

  it('routes /api/* to the functions', () => {
    expect(destinationFor('/api/review')).toBe('/api/review');
    expect(destinationFor('/api/scenarios')).toBe('/api/scenarios');
  });

  it('routes everything else to the page', () => {
    for (const path of ['/', '/anything', '/a/b/c', '/apis']) expect(destinationFor(path)).toBe('/index.html');
  });
});
