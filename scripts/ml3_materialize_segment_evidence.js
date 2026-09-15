import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inventoryCloud } from './ml3/inventorySources.js';
import { canonicalJson } from './ml3/inventoryCore.js';
import { materializeCloudEvidence } from './ml3/rawEvidenceMaterializer.js';
import { selectFrozenInventorySessions } from './ml3/segmentFilter.js';

export function parseArgs(args) {
  const options = { inventory: null, output: null, sessionId: null };
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--inventory') options.inventory = args[++index];
    else if (args[index] === '--output') options.output = args[++index];
    else if (args[index] === '--session') options.sessionId = args[++index];
    else throw new Error(`UNKNOWN_ARGUMENT:${args[index]}`);
  }
  if (!options.inventory || !options.output || !options.sessionId) {
    throw new Error('USAGE: npm run ml3:segment:evidence -- --inventory <path> --session <uuid> --output <path>');
  }
  return options;
}

export async function main(args = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(args);
  const inventoryPath = path.resolve(options.inventory);
  const outputPath = path.resolve(options.output);
  if (inventoryPath.toLowerCase() === outputPath.toLowerCase())
    throw new Error('OUTPUT_MUST_NOT_OVERWRITE_INVENTORY');
  const artifact = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));

  // Validate the immutable freeze and UUID before opening a database connection.
  selectFrozenInventorySessions(artifact, { sessionId: options.sessionId });
  const readCloud = dependencies.inventoryCloud ?? inventoryCloud;
  const cloudResult = await readCloud({
    sessionId: options.sessionId,
    materializeRawSamples: true
  });
  let evidence;
  try {
    evidence = materializeCloudEvidence(artifact, {
      sessionId: options.sessionId,
      cloudResult
    });
  } finally {
    cloudResult.samplesBySession?.clear?.();
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, canonicalJson(evidence), 'utf8');
  console.log(JSON.stringify({
    evidenceVersion: evidence.evidenceVersion,
    sessionId: evidence.sessionId,
    lineageStratum: evidence.lineageStratum,
    evidenceSha256: evidence.evidenceSha256,
    databaseRead: evidence.databaseRead,
    summary: evidence.summary,
    acceptedIntervals: evidence.acceptedIntervals.length,
    rejectedIntervals: evidence.rejectedIntervals.length,
    finalTrainingDataset: false
  }, null, 2));
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
