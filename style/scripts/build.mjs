import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
cpSync('src/index.css', 'dist/index.css');
cpSync('src/index.js', 'dist/index.js');