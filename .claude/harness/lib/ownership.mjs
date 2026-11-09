// Path ownership resolution used by the delegation guard and the harness CLI.
import path from 'node:path';
import { matchAny } from './glob.mjs';
import { unique } from './util.mjs';

export function createOwnership(h) {
  const cfg = h.ownership ?? { zones: [] };
  const groups = cfg.groups ?? {};
  const enabled = new Set(h.enabledAgents);
  const known = new Set(h.allAgents);

  function expand(owner, seen = new Set()) {
    if (owner.startsWith('@')) {
      return (groups[owner.slice(1)] ?? []).flatMap((o) => expand(o, seen));
    }
    if (owner === '*' || owner === 'main') return [owner];
    if (!known.has(owner) || enabled.has(owner)) return [owner];
    if (seen.has(owner)) return [];
    seen.add(owner);
    return (h.fallbacks[owner] ?? []).flatMap((o) => expand(o, seen));
  }

  function zoneFor(relPath) {
    for (const zone of cfg.zones ?? []) {
      if (matchAny(relPath, zone.paths) && !matchAny(relPath, zone.except ?? [])) return zone;
    }
    return { id: 'default', owners: cfg.default?.owners ?? ['*'] };
  }

  function sourceEquivalent(relPath) {
    const dir = path.posix.dirname(relPath);
    const base = path.posix.basename(relPath);
    if (dir.split('/').includes('__tests__')) {
      return path.posix.join(dir.split('/').filter((p) => p !== '__tests__').join('/'), base);
    }
    return path.posix.join(dir, base.replace(/\.(test|spec)(?=\.[a-z]+$)/, ''));
  }

  function resolve(relPath) {
    const zone = zoneFor(relPath);
    let owners = unique((zone.owners ?? []).flatMap((o) => expand(o)));
    const tf = cfg.testFiles;
    if (tf && matchAny(relPath, tf.patterns ?? [])) {
      const src = sourceEquivalent(relPath);
      const srcZone = src !== relPath ? zoneFor(src) : zone;
      const srcOwners = (srcZone.owners ?? []).flatMap((o) => expand(o));
      const extra = (tf.extraOwners ?? []).flatMap((o) => expand(o));
      owners = unique([...owners, ...srcOwners, ...extra]);
    }
    return { zone, owners };
  }

  function preferredOwner(owners) {
    return owners.find((o) => o !== 'main' && o !== '*') ?? owners[0] ?? 'a human';
  }

  function check(actor, relPath) {
    const { zone, owners } = resolve(relPath);
    const list = owners.join(', ') || 'nobody (human only)';
    if (owners.length === 0) {
      return {
        decision: 'deny',
        zone,
        owners,
        reason: `${relPath} is human-only (zone "${zone.id}"). ${zone.reason ?? ''}`.trim(),
      };
    }
    if (owners.includes('*')) return { decision: 'allow', zone, owners };
    if (actor === 'main') {
      // Harness files and, in the budget profile, every owned path: the orchestrator writes them
      // itself. Never an approval prompt: either allowed or denied with a reason.
      if (owners.includes('main')) return { decision: 'allow', zone, owners };
      const target = preferredOwner(owners);
      return {
        decision: 'deny',
        zone,
        owners,
        reason:
          `Delegation required: ${relPath} belongs to ${list} (zone "${zone.id}"). ` +
          `You are the orchestrator and must not write it yourself. Delegate with the Agent tool ` +
          `(subagent_type: "${target}") and a brief with Spec:, Task:, Deliverables: and acceptance checks.`,
      };
    }
    if (owners.includes(actor)) return { decision: 'allow', zone, owners };
    return {
      decision: 'deny',
      zone,
      owners,
      reason:
        `Out of scope for ${actor}: ${relPath} belongs to ${list} (zone "${zone.id}"). ` +
        `Do not work around this. Finish your own deliverables and list the needed change under ` +
        `"Follow-ups" in your Handoff so the orchestrator routes it to the owner.`,
    };
  }

  function zonesOwnedBy(agent) {
    return (cfg.zones ?? [])
      .filter((z) => (z.owners ?? []).flatMap((o) => expand(o)).includes(agent))
      .map((z) => ({ id: z.id, paths: z.paths }));
  }

  // Zones where the agent is the first (primary) owner after fallback expansion.
  function primaryZones(agent) {
    return (cfg.zones ?? [])
      .filter((z) => (z.owners ?? []).flatMap((o) => expand(o))[0] === agent)
      .map((z) => ({ id: z.id, paths: z.paths }));
  }

  return { resolve, check, zonesOwnedBy, primaryZones, expand };
}
