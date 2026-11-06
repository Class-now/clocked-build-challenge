// Regenerates the recordings module. Runs after `npm run record` and before every web build.
import { readFileSync, writeFileSync } from 'node:fs';
import { GENERATED_PATH, readRecordings, renderIndex } from '../src/server/recordingIndex.js';

const runs = readRecordings('recordings');
const source = renderIndex(runs);
if (readFileSync(GENERATED_PATH, 'utf8').replace(/\r\n/g, '\n') !== source) writeFileSync(GENERATED_PATH, source);
console.log(`Indexed ${runs.length} recording(s).`);
