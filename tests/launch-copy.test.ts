import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

describe('copy del producto vigente', () => {
  it('identifica Anthropic y el contexto limitado del asistente en privacidad', () => {
    const privacy = source('app/privacidad/page.tsx');
    expect(privacy).toContain('Anthropic');
    expect(privacy).toContain('datos agregados');
  });
});
