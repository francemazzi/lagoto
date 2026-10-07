import { cpSync } from 'node:fs';
cpSync('runtime/migrations', 'dist/runtime/migrations', { recursive: true });
cpSync('runtime/compatibility.json', 'dist/runtime/compatibility.json');
