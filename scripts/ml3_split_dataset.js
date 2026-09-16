import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalJson } from './ml3/inventoryCore.js';
import { splitCanonicalDataset } from './ml3/datasetSplitter.js';

export function parseArgs(args) {
  const options = { dataset: null, output: null };
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--dataset') options.dataset = args[++index];
    else if (args[index] === '--output') options.output = args[++index];
    else throw new Error(`UNKNOWN_ARGUMENT:${args[index]}`);
  }
  if (!options.dataset || !options.output)
    throw new Error('USAGE: npm run ml3:split -- --dataset <path> --output <path>');
  return options;
}

export function main(args = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(args);
  const datasetPath = path.resolve(options.dataset);
  const outputPath = path.resolve(options.output);
  if (datasetPath.toLowerCase() === outputPath.toLowerCase())
    throw new Error('OUTPUT_MUST_NOT_OVERWRITE_INPUT');
  if (!fs.existsSync(datasetPath)) throw new Error('CANONICAL_DATASET_ARTIFACT_MISSING');
  const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
  const manifest = splitCanonicalDataset(dataset, {
    expectedDataset: dependencies.expectedDataset
  });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, canonicalJson(manifest), 'utf8');
  console.log(JSON.stringify({
    splitManifestVersion: manifest.splitManifestVersion,
    sourceDatasetSha256: manifest.sourceDatasetSha256,
    splitManifestSha256: manifest.splitManifestSha256,
    lineageStratum: manifest.lineage.lineageStratum,
    rowCounts: manifest.summary.rowCounts,
    groupCounts: manifest.summary.groupCounts,
    coveragePercent: manifest.summary.coveragePercent,
    leakageChecks: manifest.leakageChecks,
    evaluationScope: manifest.evaluationScope
  }, null, 2));
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
