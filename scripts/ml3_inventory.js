#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInventory, canonicalJson, mergeSessions } from './ml3/inventoryCore.js';
import {
  documentedKnownSessions,
  fetchPublicSessionMetadata,
  inventoryCloud,
  inventoryLocalJsonl,
  inventoryValidationArtifacts
} from './ml3/inventorySources.js';

function usage() {
  return `Usage: node scripts/ml3_inventory.js [options]

Options:
  --source <local|cloud|all>  Sources to inventory (default: all)
  --session <uuid-or-local>   Emit only one session
  --output <path>             JSON output (default: artifacts/ml3_dataset_inventory.json)
  --no-public-api             Skip read-only metadata enrichment for known UUIDs
  --help                      Show this help

DATABASE_URL is read only from the process environment and is never printed.`;
}

export function parseArgs(argv) {
  const options = { source: 'all', output: 'artifacts/ml3_dataset_inventory.json', publicApi: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help') options.help = true;
    else if (arg === '--no-public-api') options.publicApi = false;
    else if (['--source', '--session', '--output'].includes(arg)) {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`MISSING_VALUE:${arg}`);
      options[arg.slice(2)] = argv[++i];
    } else throw new Error(`UNKNOWN_ARGUMENT:${arg}`);
  }
  if (!['local', 'cloud', 'all'].includes(options.source)) throw new Error('SOURCE_INVALID');
  return options;
}

export async function createInventory(options, dependencies = {}) {
  const cwd = dependencies.cwd ?? process.cwd();
  const sessions = [];
  const sourceStatus = [];
  const includeLocal = options.source === 'local' || options.source === 'all';
  const includeCloud = options.source === 'cloud' || options.source === 'all';

  if (includeLocal) {
    const local = (dependencies.inventoryLocalJsonl ?? inventoryLocalJsonl)({ cwd, roots: dependencies.localRoots });
    sessions.push(...local.sessions); sourceStatus.push(local.status);
    sourceStatus.push({
      source: 'HISTORICAL_TELEMETRY_FILES', status: 'NOT_FOUND_ADDITIONAL',
      note: 'No additional distinct raw telemetry payload was found beyond the SHA-256-deduplicated local JSONL source.'
    });
    const artifacts = (dependencies.inventoryValidationArtifacts ?? inventoryValidationArtifacts)({ cwd });
    sessions.push(...artifacts.sessions); sourceStatus.push(artifacts.status);
  }

  const documented = (dependencies.documentedKnownSessions ?? documentedKnownSessions)();
  sessions.push(...documented);
  sourceStatus.push({
    source: 'DOCUMENTED_KNOWN_SESSIONS', status: 'AVAILABLE', sessions: documented.length,
    note: 'Known IDs establish provenance/classification, not raw-payload quality measurements.'
  });

  if (options.publicApi && (includeCloud || options.source === 'all')) {
    const candidates = mergeSessions(sessions).map(session => session.sessionId);
    const publicResult = await (dependencies.fetchPublicSessionMetadata ?? fetchPublicSessionMetadata)(candidates);
    sessions.push(...publicResult.sessions); sourceStatus.push(publicResult.status);
  } else sourceStatus.push({
    source: 'PUBLIC_SESSION_API', status: 'SKIPPED',
    note: options.publicApi ? 'Not part of local-only mode.' : 'Disabled by --no-public-api.'
  });

  if (includeCloud) {
    const cloud = await (dependencies.inventoryCloud ?? inventoryCloud)({ sessionId: options.session });
    sessions.push(...cloud.sessions); sourceStatus.push(cloud.status);
  } else sourceStatus.push({
    source: 'CLOUD_POSTGRES', status: 'SKIPPED', note: 'Not part of local-only mode.'
  });

  const filtered = options.session
    ? sessions.filter(session => session.sessionId === options.session || session.localCollectionSessionId === options.session)
    : sessions;
  return buildInventory({ sessions: filtered, sourceStatus });
}

export async function main({ argv = process.argv.slice(2), write = console.log } = {}) {
  const options = parseArgs(argv);
  if (options.help) { write(usage()); return null; }
  const inventory = await createInventory(options);
  const outputPath = path.resolve(options.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, canonicalJson(inventory), 'utf8');
  const summary = inventory.canonicalInventory.summary;
  write(`ML3_INVENTORY_SCHEMA_VERSION=${inventory.canonicalInventory.inventorySchemaVersion}`);
  write(`ML3_INVENTORY_CANONICAL_SHA256=${inventory.canonicalSha256}`);
  write(`SESSIONS=${summary.sessionCount} BATCHES=${summary.batchCount} SAMPLES=${summary.sampleCount} HOURS=${summary.hours}`);
  for (const source of inventory.canonicalInventory.sourceStatus)
    write(`${source.source}=${source.status}${source.code ? ` (${source.code})` : ''}`);
  write(`OUTPUT=${path.relative(process.cwd(), outputPath).replaceAll('\\', '/')}`);
  return inventory;
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) main().catch(error => {
  console.error(`ML3_INVENTORY_FAILED=${String(error?.message || 'UNKNOWN').replace(/[^A-Z0-9:_-]/gi, '_')}`);
  process.exitCode = 1;
});
