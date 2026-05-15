const { spawnSync } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const binName = process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder';
const electronBuilderBin = path.join(rootDir, 'node_modules', '.bin', binName);

const env = {
  ...process.env,
  HOME: rootDir,
  USERPROFILE: rootDir,
  ELECTRON_BUILDER_CACHE: path.join(rootDir, '.electron-builder-cache'),
  npm_config_devdir: path.join(rootDir, '.electron-gyp'),
  npm_config_cache: path.join(rootDir, '.npm-cache'),
};

const result = spawnSync(electronBuilderBin, ['install-app-deps'], {
  cwd: rootDir,
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

process.exit(result.status || 0);
