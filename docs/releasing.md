# Release checklist

1. Clean install and full gate:

   ```bash
   nvm use
   corepack yarn install --immutable
   corepack yarn validate
   ```

2. Run the physical-device rows in [`testing.md`](testing.md) for every platform being
   claimed. A compile is not a runtime pass.

3. Confirm the published effects SDK version exports
   `+[NosmaiCameraSdk setLiveStreamFrameCallback:]`, and set the
   `@nosmai/react-native-effects-sdk` peer range to that version or later.

4. Re-verify the vendored Agora headers if the `react-native-agora` peer range moves:
   the `IMediaEngine` vtable and `ExternalVideoFrame` layout must match the Agora SDK that
   react-native-agora pins (`cpp/third_party/agora`, see `CONTRACT.md`).

5. Make sure nothing licensed or personal is tracked:

   ```bash
   git ls-files | grep -Ei '\.(aar|xcframework|nosmai|keystore|jks|p12)$|credentials\.local|local\.properties'   # must be empty
   git grep -nE 'NOSMAI-[A-Za-z0-9-]{16,}|DEVELOPMENT_TEAM = [A-Z0-9]{10}'                                        # must be empty
   ```

6. Update `CHANGELOG.md` and set the same SemVer in `package.json` and the Git tag
   (`vX.Y.Z`). Inspect the tarball:

   ```bash
   corepack yarn package:check
   npm pack --dry-run
   ```

7. Publish only after the repository URL and tag exist:

   ```bash
   npm publish --access public
   ```
