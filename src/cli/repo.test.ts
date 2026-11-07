import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const readme = read('README.md');
const pkg = JSON.parse(read('package.json'));

describe('README', () => {
  it('uses only commands that exist in package.json', () => {
    const run = [...readme.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]!);
    expect(run.length).toBeGreaterThan(0);
    for (const script of run) expect(pkg.scripts[script], script).toBeDefined();
    if (readme.includes('npm test')) expect(pkg.scripts.test).toBeDefined();
  });

  it('names a bin that exists, and every file it links to', () => {
    expect(existsSync(join(root, pkg.bin.gatehouse))).toBe(true);
    const links = [...readme.matchAll(/\]\(((?!https?:)[^)#]+)\)/g)].map((m) => m[1]!);
    expect(links.length).toBeGreaterThan(0);
    // The screenshot is a named placeholder until the review desk exists.
    for (const link of links.filter((l) => l !== 'docs/img/desk.png')) expect(existsSync(join(root, link)), link).toBe(true);
  });

  it('has the demo link, the screenshot and the measured results, with no placeholder left', () => {
    expect(readme).toContain('https://clocked-build-challenge.vercel.app');
    expect(readme).not.toContain('LIVE_DEMO_URL');
    expect(readme).toContain('docs/img/desk.png');
    expect(readme).not.toContain('EVAL_RESULTS');
    expect(readme).toContain('not an accuracy guarantee');
  });

  it('has a row for all nine endpoints and Pipeline', () => {
    for (const path of ['/script', '/extract', '/decide', '/rerank', '/pii', '/injection', '/grounding', '/compare', '/fill', '/pipeline']) {
      expect(readme, path).toMatch(new RegExp(`^\\| .*\`${path}\` \\|`, 'm'));
    }
  });

  it('shows the same hook settings as the sample file', () => {
    const block = /```json\n([\s\S]*?)```/.exec(readme.replaceAll('\r\n', '\n'))?.[1];
    expect(JSON.parse(block!)).toEqual(JSON.parse(read('examples/claude-settings.json')));
  });
});

describe('docs/how-it-uses-clocked.md', () => {
  it('has one section per endpoint', () => {
    const doc = read('docs/how-it-uses-clocked.md');
    for (const path of ['/script', '/extract', '/decide', '/rerank', '/pii', '/injection', '/grounding', '/compare', '/fill', '/pipeline']) {
      expect(doc, path).toMatch(new RegExp(`^## .*\`${path}\`$`, 'm'));
    }
  });
});

describe('repository files', () => {
  it('has an empty .env.example and an MIT license', () => {
    expect(read('.env.example').split(/\r?\n/).filter(Boolean)).toEqual(['CLOCKED_API_KEY=', 'GATEHOUSE_LIVE=']);
    expect(read('LICENSE')).toContain('Copyright (c) 2026 Gatehouse contributors');
  });

  it('runs CI on Node 22 with no secret', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('node-version: 22');
    expect(ci).toContain('npm run typecheck');
    expect(ci).toContain('npm test');
    expect(ci).not.toContain('secrets.');
  });
});
