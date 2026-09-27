// Metro-Konfiguration für das pnpm-Monorepo.
// Seit Expo SDK 52 erkennt `expo/metro-config` Monorepos selbst (watchFolders und
// nodeModulesPaths werden aus dem Workspace-Root abgeleitet). Die Workspace-Pakete
// `@werkstatt/contracts` und `@werkstatt/design-tokens` liefern TypeScript-Quellen,
// die Metro wie App-Code über Babel übersetzt. Mit `node-linker=hoisted` (.npmrc) liegt
// ein flaches `node_modules` im Repo-Root, daher sind keine weiteren Einstellungen nötig.
// Doku: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

module.exports = config;
