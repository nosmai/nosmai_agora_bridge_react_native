const path = require('path');
const { getDefaultConfig } = require('@react-native/metro-config');

// The bridge is consumed from source (this repository's root); everything else,
// including @nosmai/react-native-effects-sdk and react-native-agora, comes from
// this app's node_modules. The root's own node_modules (dev installs) is blocked
// so there is never a second copy of React Native.
const bridgeRoot = path.resolve(__dirname, '..');
const esc = (p) => p.replace(/[/\\]/g, '[/\\\\]').replace(/\./g, '\\.');

const config = getDefaultConfig(__dirname);
config.watchFolders = [bridgeRoot];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];
config.resolver.extraNodeModules = {
  '@nosmai/react-native-agora-bridge': bridgeRoot,
};
// No 'import' here: @babel/runtime would then resolve its ESM helpers for
// require() calls ("_interopRequireDefault is not a function").
config.resolver.unstable_conditionNames = ['require', 'react-native', 'source'];
config.resolver.blockList = [
  new RegExp(`^${esc(bridgeRoot)}[/\\\\](node_modules|lib)[/\\\\].*`),
];

module.exports = config;
