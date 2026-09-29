#!/usr/bin/env node
/**
 * Packaging audit — the same gate the camera SDK runs as `yarn package:check`.
 *
 * The bridge never ships a licensed binary: the Nosmai AAR is host-supplied
 * (36 MB, and stale the moment a new SDK build lands), the iOS framework comes
 * from the effects SDK's pod, and licence keys are per-application. A packaging
 * mistake here would publish one of those to a registry, which is not something
 * you can take back. So this fails the build rather than warning.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const pathModule = require('node:path');

// Extensions and names that must never appear in the tarball, with the reason
// each one is banned — the reason is what makes a failure actionable.
const FORBIDDEN = [
  [/\.aar$/i, 'Android SDK binary — host-supplied, never bundled'],
  [/\.(framework|xcframework)\//i, 'iOS SDK binary — comes from the effects SDK / Agora pods'],
  [/\.nosmai$/i, 'effect package — licensed content'],
  [/\.(jks|keystore|p12|mobileprovision|cer|pem|key)$/i, 'signing or key material'],
  [/(^|\/)\.env/i, 'environment file — may hold credentials'],
  [/(^|\/)Pods\//i, 'CocoaPods install output'],
  [/(^|\/)(build|\.gradle|\.cxx)\//i, 'build output'],
  [/(^|\/)node_modules\//i, 'dependencies'],
  [/__tests__\//i, 'tests do not belong in the published package'],
  [/\.(tflite|onnx|mlmodel|mlmodelc)$/i, 'model file — licensed content'],
];

let out;
const npmCache = fs.mkdtempSync(pathModule.join(os.tmpdir(), 'nosmai-npm-cache-'));
try {
  // --ignore-scripts: `npm pack` would otherwise run `prepare` (bob build),
  // whose progress output lands on stdout and corrupts the JSON. The audit is
  // about what the CURRENT tree would publish, so building first is the
  // caller's job — `yarn check` runs `prepare` immediately before this.
  out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, npm_config_cache: npmCache },
  });
} catch (e) {
  console.error('package:check — `npm pack --dry-run` failed:', e.message);
  if (e.stderr) console.error(String(e.stderr).trim());
  fs.rmSync(npmCache, { recursive: true, force: true });
  process.exit(1);
} finally {
  fs.rmSync(npmCache, { recursive: true, force: true });
}

const files = (JSON.parse(out)[0]?.files ?? []).map((f) => f.path);
if (files.length === 0) {
  console.error('package:check — npm reported an empty package; refusing to pass.');
  process.exit(1);
}

const violations = [];
for (const path of files) {
  for (const [pattern, reason] of FORBIDDEN) {
    if (pattern.test(path)) violations.push({ path, reason });
  }
}

// A key can also be pasted into an otherwise innocent source file.
const KEY_SHAPED = [
  /(NOSMAI|AGORA)_(LICENSE|API|APP)_?(KEY|SECRET|ID|TOKEN)\s*[:=]\s*['"][^'"]{16,}/i,
  // A Nosmai licence key literal, wherever it is assigned.
  /['"]NOSMAI-[A-Za-z0-9-]{16,}['"]/,
  // An Agora App ID literal (32 hex) next to anything named appId.
  /appId\s*[:=]\s*['"][0-9a-f]{32}['"]/i,
];
for (const path of files) {
  if (!/\.(ts|tsx|js|jsx|json|kt|java|m|mm|h|cpp|gradle|podspec)$/i.test(path)) continue;
  let text;
  try {
    text = fs.readFileSync(path, 'utf8');
  } catch {
    continue;
  }
  if (KEY_SHAPED.some((re) => re.test(text))) {
    violations.push({ path, reason: 'looks like a committed licence key or secret' });
  }
}

if (violations.length > 0) {
  console.error(`package:check FAILED — ${violations.length} violation(s):\n`);
  for (const v of violations) console.error(`  ${v.path}\n    ${v.reason}`);
  process.exit(1);
}

console.log(`package:check passed (${files.length} files).`);
