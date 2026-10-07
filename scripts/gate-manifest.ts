import { readFileSync } from 'node:fs';
import { z } from 'zod';

/** Coverage required to close one roadmap requirement (Pxx-Inn). */
export const requirementSchema = z.object({
  kind: z.enum(['deterministic', 'native', 'live']),
  /** Tokens that must appear in the full name of at least one passing vitest test each. */
  tests: z.array(z.string().min(1)),
  /** Scenario tags from docs/validation.md (BAT-, MEM-, HAND-, GH-) that must appear in passing vitest tests. */
  scenarios: z.array(z.string().regex(/^(?:BAT|MEM|HAND|GH)-\d{2}$/)),
  /** Tokens that must appear in the identifier of at least one passing XCUITest each. */
  native: z.array(z.string().min(1)),
  /** Globs over build/evidence/*.json; each needs one fresh file with status passed (blocked is reported as blocked). */
  smokes: z.array(z.string().min(1)),
  /** Documents that must contain "Esito: passed" and a fresh "Commit:" line. */
  attestations: z.array(z.string().min(1)),
}).strict();

export const manifestSchema = z.object({
  version: z.literal(1),
  description: z.string(),
  scopes: z.record(z.string(), z.array(z.string().regex(/^P\d{2}$/))),
  freshnessPaths: z.array(z.string().min(1)),
  requirements: z.record(z.string().regex(/^P\d{2}-I\d{2}$/), requirementSchema),
}).strict();

export type Requirement = z.infer<typeof requirementSchema>;
export type Manifest = z.infer<typeof manifestSchema>;

export function deriveKind(requirement: Pick<Requirement, 'native' | 'smokes' | 'attestations'>): Requirement['kind'] {
  if (requirement.smokes.length || requirement.attestations.length) return 'live';
  if (requirement.native.length) return 'native';
  return 'deterministic';
}

/** Parse and validate the manifest; a declared kind that contradicts its lists is a configuration error. */
export function parseManifest(text: string): Manifest {
  const manifest = manifestSchema.parse(JSON.parse(text));
  for (const [id, requirement] of Object.entries(manifest.requirements)) {
    if (!requirement.tests.length && !requirement.scenarios.length && !requirement.native.length && !requirement.smokes.length && !requirement.attestations.length)
      throw new Error(`Manifest ${id}: nessuna copertura richiesta`);
    const derived = deriveKind(requirement);
    if (derived !== requirement.kind) throw new Error(`Manifest ${id}: kind ${requirement.kind} ma le liste implicano ${derived}`);
  }
  return manifest;
}

export function loadManifest(path = 'scripts/gate-manifest.json'): Manifest {
  return parseManifest(readFileSync(path, 'utf8'));
}

/** Every `**Pxx-Inn:` marker in the roadmap, deduplicated and sorted. */
export function roadmapRequirementIds(roadmap: string): string[] {
  return [...new Set([...roadmap.matchAll(/\*\*(P\d{2}-I\d{2}):/g)].map(match => match[1]!))].sort();
}

/** Requirements present in one place but not the other. Both lists must be empty for the gate to run. */
export function compareWithRoadmap(manifest: Manifest, roadmapIds: string[]) {
  const manifestIds = Object.keys(manifest.requirements);
  return {
    missingInManifest: roadmapIds.filter(id => !manifestIds.includes(id)),
    unknownInManifest: manifestIds.filter(id => !roadmapIds.includes(id)),
  };
}

export function phasesForScope(manifest: Manifest, scope: string): string[] {
  if (/^P\d{2}$/.test(scope)) return [scope];
  if (scope === 'all') return [...new Set(Object.values(manifest.scopes).flat())];
  const phases = manifest.scopes[scope];
  if (!phases) throw new Error(`Scope sconosciuto: ${scope}`);
  return phases;
}
