module.exports = {
  root: true,
  extends: ['@react-native'],
  ignorePatterns: ['lib/', 'node_modules/', 'example/node_modules/'],
  parserOptions: {
    // The repository-level config files are plain Node scripts and do not have
    // their own Babel config. Source files still use the React Native parser
    // settings inherited above.
    requireConfigFile: false,
  },
  rules: {
    // The bridge's comments carry the invariants; long explanatory lines are
    // the point, not an accident.
    'max-len': 'off',
    'prettier/prettier': 'off',
    // `void somePromise()` is the deliberate fire-and-forget marker in event
    // handlers and effect cleanups, which must not return a Promise. It is used
    // as an expression there, so `allowAsStatement` does not cover it.
    'no-void': 'off',
  },
  overrides: [
    {
      files: ['*.ts', '*.tsx'],
      rules: {
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_' },
        ],
      },
    },
  ],
};
