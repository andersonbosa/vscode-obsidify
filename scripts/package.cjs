const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const outDir = path.join(root, 'build');
const outFile = path.join(outDir, `${pkg.name}-${pkg.version}.vsix`);
const vsceCli = path.join(root, 'node_modules', '@vscode', 'vsce', 'vsce');

fs.mkdirSync(outDir, { recursive: true });
execFileSync(process.execPath, [vsceCli, 'package', '--out', outFile], { cwd: root, stdio: 'inherit' });
