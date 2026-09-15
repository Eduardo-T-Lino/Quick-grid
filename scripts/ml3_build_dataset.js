import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { materializeCanonicalDataset, validateEvidenceArtifact } from './ml3/datasetBuilder.js';
import { inventoryCloud } from './ml3/inventorySources.js';
import { canonicalJson } from './ml3/inventoryCore.js';
import { selectFrozenInventorySessions } from './ml3/segmentFilter.js';

export function parseArgs(args) {
  const options = { inventory: null, evidence: null, output: null };
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--inventory') options.inventory = args[++index];
    else if (args[index] === '--evidence') options.evidence = args[++index];
    else if (args[index] === '--output') options.output = args[++index];
    else throw new Error(`UNKNOWN_ARGUMENT:${args[index]}`);
  }
  if (!options.inventory || !options.evidence || !options.output)
    throw new Error('USAGE: npm run ml3:dataset -- --inventory <path> --evidence <path> --output <path>');
  return options;
}

function distinctPaths(paths) {
  return new Set(paths.map(value => path.resolve(value).toLowerCase())).size === paths.length;
}

export async function main(args = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(args);
  if (!distinctPaths([options.inventory, options.evidence, options.output]))
    throw new Error('OUTPUT_MUST_NOT_OVERWRITE_INPUT');
  const inventoryArtifact = JSON.parse(fs.readFileSync(path.resolve(options.inventory), 'utf8'));
  const evidence = JSON.parse(fs.readFileSync(path.resolve(options.evidence), 'utf8'));
  validateEvidenceArtifact(evidence);
  selectFrozenInventorySessions(inventoryArtifact, { sessionId: evidence.sessionId });

  const readCloud = dependencies.inventoryCloud ?? inventoryCloud;
  const cloudResult = await readCloud({
    sessionId: evidence.sessionId,
    materializeRawSamples: true
  });
  let dataset;
  try {
    dataset = materializeCanonicalDataset({ inventoryArtifact, evidence, cloudResult });
  } finally {
    cloudResult.samplesBySession?.clear?.();
  }

  const outputPath = path.resolve(options.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, canonicalJson(dataset), 'utf8');
  console.log(JSON.stringify({
    datasetVersion: dataset.datasetVersion,
    datasetSha256: dataset.datasetSha256,
    rows: dataset.summary.rowCount,
    lineageStratum: dataset.summary.lineageStratum,
    sourceEvidenceSha256: dataset.sourceEvidenceSha256,
    finalTrainingDataset: dataset.finalTrainingDataset,
    splitApplied: dataset.splitApplied
  }, null, 2));
  return dataset;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
