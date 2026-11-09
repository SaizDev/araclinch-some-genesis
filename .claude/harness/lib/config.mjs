// Loads config.json + catalog.json and computes the effective harness state:
// which modules are enabled, the merged policies and the active agent roster.
import path from 'node:path';
import { HARNESS_DIR, readJson, deepMerge } from './util.mjs';

export const PROFILES = ['budget'];
export const DEFAULT_PROFILE = 'budget';

function envList(value) {
  return (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadHarness(root, env = process.env) {
  const base = path.join(root, HARNESS_DIR);
  const config = readJson(path.join(base, 'config.json'), {});
  const catalog = readJson(path.join(base, 'catalog.json'), { modules: [], profiles: {}, modelPresets: {} });
  const ownership = readJson(path.join(base, 'ownership.json'), { zones: [] });

  const profileName = PROFILES.includes(config.profile) ? config.profile : DEFAULT_PROFILE;
  const profile = catalog.profiles?.[profileName] ?? {};
  const modules = new Map(catalog.modules.map((m) => [m.id, m]));

  const enabled = new Map();
  for (const m of catalog.modules) {
    enabled.set(m.id, Boolean(m.required) || (m.profiles ?? []).includes(profileName));
  }
  for (const id of config.overrides?.enable ?? []) if (modules.has(id)) enabled.set(id, true);
  for (const id of config.overrides?.disable ?? []) {
    const m = modules.get(id);
    if (m && !m.required) enabled.set(id, false);
  }

  // Human-only escape hatches: environment variables set when launching `claude`.
  for (const short of envList(env.HARNESS_DISABLE)) {
    const id = short.includes('.') ? short : `check.${short}`;
    if (enabled.has(id)) enabled.set(id, false);
  }

  let policies = deepMerge(config.policies ?? {}, profile.policies ?? {});
  policies = deepMerge(policies, config.policyOverrides ?? {});
  if (env.HARNESS_SPEC_GATE) policies = deepMerge(policies, { specGate: { mode: env.HARNESS_SPEC_GATE } });
  if (env.HARNESS_OWNERSHIP) policies = deepMerge(policies, { ownership: { mode: env.HARNESS_OWNERSHIP } });
  if (env.HARNESS_REVIEW_GATE === 'off') policies = deepMerge(policies, { stopGate: { reviewAfterCodeChange: false } });

  const agentModules = catalog.modules.filter((m) => m.kind === 'agent');
  const enabledAgents = agentModules.filter((m) => enabled.get(m.id)).map((m) => m.name);
  const fallbacks = Object.fromEntries(agentModules.map((m) => [m.name, m.fallback ?? []]));

  const isOn = (id) => enabled.get(id) === true;
  const checkOn = (checkId) => isOn(`check.${checkId}`);

  return {
    root,
    config,
    catalog,
    ownership,
    profileName,
    profile,
    modules,
    enabled,
    policies,
    enabledAgents,
    allAgents: agentModules.map((m) => m.name),
    fallbacks,
    isOn,
    checkOn,
  };
}

export function modelFor(h, agentName) {
  const presetName = h.config.modelPreset ?? (h.profileName === 'budget' ? 'budget' : 'balanced');
  const preset = h.catalog.modelPresets?.[presetName] ?? { models: {} };
  return preset.models?.[agentName] ?? preset.models?.['*'] ?? 'inherit';
}

// Resolve dotted paths such as "stack.supabase.projectRef" against the config.
export function configValue(config, dotted) {
  return dotted.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), config);
}
