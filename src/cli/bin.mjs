#!/usr/bin/env node
// The installed `gatehouse` command. Loads the TypeScript entry through tsx, which works the same
// on every platform, unlike a TypeScript file named directly in a shebang line.
import { register } from 'tsx/esm/api';

register();
const { main } = await import('./gatehouse.ts');
await main();
