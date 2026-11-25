import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface PackageManifest {
  engines?: {
    node?: string;
  };
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(projectRoot, 'package.json');

function readManifest(): PackageManifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest;
}

function dependencySpec(manifest: PackageManifest, name: string): string {
  return (
    manifest.dependencies?.[name] ??
    manifest.devDependencies?.[name] ??
    ''
  );
}

function emittedFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? emittedFiles(path) : [path];
  });
}

// Feature: ticketops-api, Task 6.8: pruebas de configuración, compilación y scripts

describe('project configuration and scripts', () => {
  it('requires the supported Node.js runtime, pnpm, and approved dependencies', () => {
    const manifest = readManifest();
    const dependencies = [
      'express',
      'zod',
      'vitest',
      'fast-check',
      'supertest',
      'eslint',
      'typescript',
    ];

    expect(manifest.engines?.node).toMatch(/^>=\s*20(?:\.\d+){0,2}$/);
    expect(manifest.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
    expect(existsSync(join(projectRoot, 'pnpm-lock.yaml'))).toBe(true);

    for (const dependency of dependencies) {
      expect(dependencySpec(manifest, dependency), dependency).not.toBe('');
    }

    expect(dependencySpec(manifest, 'typescript')).toMatch(
      /^~?5\.9\.\d+$/,
    );
    expect(dependencySpec(manifest, 'typescript')).not.toMatch(/^7(?:\.|$)/);

    const scripts = Object.values(manifest.scripts ?? {});
    expect(scripts.join('\n')).not.toMatch(/\b(?:npm|yarn)\b/);
  });

  it('defines reproducible pnpm scripts for start, build, test, and lint', () => {
    const scripts = readManifest().scripts ?? {};

    expect(scripts.start).toBe('node dist/server.js');
    expect(scripts.build).toMatch(/\btsc\b/);
    expect(scripts.test).toBe('vitest run');
    expect(scripts.test).not.toMatch(/--watch|--ui|vitest\s+(?!run\b)/);
    expect(scripts.lint).toMatch(/\beslint\b/);
    expect(scripts.lint).toMatch(/src\/\*\*\/\*\.ts/);
  });

  it('exposes the compiled server entry point without test output', () => {
    const scripts = readManifest().scripts ?? {};
    const distPath = join(projectRoot, 'dist');

    expect(scripts.build).toMatch(/\btsc\b/);
    expect(existsSync(join(distPath, 'server.js'))).toBe(true);
    expect(emittedFiles(distPath).filter((path) => /\.test\.js$/.test(path))).toEqual(
      [],
    );
  });

  it('configures lint to execute ESLint over the TypeScript project', () => {
    const lintScript = readManifest().scripts?.lint ?? '';

    expect(lintScript).toMatch(/^eslint\b/);
    expect(lintScript).toMatch(/src\/\*\*\/\*\.ts/);
  });
});
