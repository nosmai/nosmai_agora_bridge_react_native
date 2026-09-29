# Contributing

## Setup

Use the Node version in `.nvmrc` and Yarn 4 through Corepack:

```bash
nvm use
corepack yarn install --immutable
corepack yarn validate
```

`validate` runs the library and example TypeScript, ESLint, the Bob build and the npm
tarball audit (`scripts/package-check.js`).

## Native builds

Nosmai and Agora binaries are licensed or third-party and are never committed: no AAR,
framework, `.nosmai` package, licence key, Agora App ID/token, signing team or keystore.
Local values live only in git-ignored files (`example/src/credentials.local.ts`,
`example/android/local.properties`) or on the build command line — see
[`example/README.md`](example/README.md).

The only vendored third-party code is Agora's public C++ headers in
`cpp/third_party/agora`, pinned to the react-native-agora release they were taken from.

## Pull requests

- Report Android and iOS results separately, with device, OS, Nosmai, Agora and
  react-native-agora versions.
- Do not weaken an invariant in [`CONTRACT.md`](CONTRACT.md) to hide a black or frozen
  stream; reproduce and document the failure first.
- Update [`CHANGELOG.md`](CHANGELOG.md) for user-visible changes.
