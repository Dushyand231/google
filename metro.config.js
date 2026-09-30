// Learn more: https://docs.expo.dev/guides/customizing-metro/
const path = require('node:path');

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const STUB = path.resolve(__dirname, 'src/lib/sqlite.web-stub.ts');

/**
 * expo-sqlite's web entry pulls in a wa-sqlite .wasm binary that the package
 * does not ship, which breaks `expo export --platform web` outright. The app
 * selects its in-memory store before ever touching expo-sqlite on web, so the
 * module is dead weight there. Swap it for a throwing stub on web only; native
 * platforms keep the real implementation and real persistence.
 */
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === 'expo-sqlite') {
    return { type: 'sourceFile', filePath: STUB };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
