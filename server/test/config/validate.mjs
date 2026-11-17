import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { configSchema } from 'librechat-data-provider';

const file = process.argv[2];
const config = yaml.load(readFileSync(file, 'utf8'));
const result = configSchema.safeParse(config);
if (!result.success) {
  for (const issue of result.error.issues) {
    console.log(`FAIL ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

const dropped = [];
function walk(source, target, path) {
  if (source === null || typeof source !== 'object') {
    return;
  }
  for (const key of Object.keys(source)) {
    if (target === null || target === undefined || !(key in target)) {
      dropped.push(`${path}${key}`);
    } else {
      walk(source[key], target[key], `${path}${key}.`);
    }
  }
}
walk(config, result.data, '');
if (dropped.length > 0) {
  console.log(`FAIL keys ignored by the schema: ${dropped.join(', ')}`);
  process.exit(1);
}
console.log(`PASS ${file} is valid for version ${config.version} and every key is recognised`);
