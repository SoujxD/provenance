// Runs the API server (with --watch) and the Vite dev server together.
import { spawn } from 'node:child_process';
const run = (args) => spawn(process.execPath, args, { stdio: 'inherit' });
run(['--disable-warning=ExperimentalWarning', '--watch', 'src/server/index.ts']);
run(['node_modules/vite/bin/vite.js']);
