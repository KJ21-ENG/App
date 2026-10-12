import {readFileSync, existsSync} from 'node:fs';
import assert from 'node:assert/strict';

const mode = process.argv[2];
const sources = ['src/index.ts', 'src/feature.ts', 'scripts/check.mjs'];
assert(['lint', 'format', 'react-compiler'].includes(mode), 'Unknown fixture check');
const paths = mode === 'lint' ? process.argv.slice(3) : sources;
assert(paths.length > 0, 'No fixture inputs');
for (const path of paths) {
    assert(existsSync(path), `Missing fixture input: ${path}`);
    const text = readFileSync(path, 'utf8');
    assert(text.endsWith('\n') && !text.includes('\r') && !text.includes('\t'), `Fixture style: ${path}`);
    assert(!text.split('\n').some(line => / +$/.test(line)), `Fixture whitespace: ${path}`);
}
if (mode === 'react-compiler') {
    assert.equal(process.argv[3], 'check-changed');
    assert(readFileSync('src/index.ts', 'utf8').includes('console.log(usedFeature())'));
}
console.log(`Synthetic fixture ${mode} checks passed; this verifies workflow plumbing only.`);
