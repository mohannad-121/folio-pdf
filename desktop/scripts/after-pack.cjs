// electron-builder afterPack hook: make sure the Python sidecar is executable on macOS/Linux
// (permissions can get lost when artifacts move between CI steps).
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName === 'win32') return;
  const resources =
    electronPlatformName === 'darwin'
      ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : path.join(appOutDir, 'resources');
  const exe = path.join(resources, 'backend', 'folio-server');
  if (!fs.existsSync(exe)) throw new Error(`afterPack: sidecar missing at ${exe}`);
  fs.chmodSync(exe, 0o755);
  console.log(`  • afterPack: chmod 755 ${exe}`);
};
