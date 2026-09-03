import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, "openclaw.plugin.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

test("the manifest declares the channel OpenClaw will look for", () => {
  assert.equal(manifest.id, "pingroom");
  assert.deepEqual(manifest.channels, ["pingroom"]);
  assert.ok(manifest.channelConfigs.pingroom.schema, "channels.pingroom needs its own schema");
  // configSchema validates plugins.entries.<id>.config — a different path.
  assert.equal(manifest.configSchema.additionalProperties, false);
  assert.equal(manifest.channelConfigs.pingroom.schema.additionalProperties, false);
  assert.equal(manifest.channelConfigs.pingroom.schema.properties.scopes, undefined);
  assert.ok(manifest.channelConfigs.pingroom.schema.properties.links.properties.latest_pings);
});

test("activation is declared explicitly", () => {
  // A plugin that omits onStartup is no longer startup-loaded, and /pingroom
  // connect has to exist before channels.pingroom is configured.
  assert.equal(manifest.activation.onStartup, true);
  assert.deepEqual(manifest.activation.onChannels, ["pingroom"]);
  assert.deepEqual(manifest.activation.onCommands, ["pingroom"]);
});

test("secrets are marked sensitive so no UI or log echoes them", () => {
  const hints = manifest.channelConfigs.pingroom.uiHints;
  assert.equal(hints.token.sensitive, true);
  assert.equal(hints["webhook.secret"].sensitive, true);
});

test("the entrypoints the host loads exist after a build", () => {
  for (const rel of [...pkg.openclaw.extensions, pkg.openclaw.setupEntry]) {
    assert.ok(existsSync(join(root, rel)), `${rel} is declared but missing`);
  }
});

test("the declared skill directory is present and is the real skill", () => {
  const [skillDir] = manifest.skills;
  const skillPath = join(root, skillDir, "SKILL.md");
  assert.ok(existsSync(skillPath), `${skillDir} is declared but missing — run npm run build`);
  const bundled = readFileSync(skillPath, "utf8");
  const canonical = readFileSync(join(root, "..", "skill", "SKILL.md"), "utf8");
  assert.equal(bundled, canonical, "the bundled skill drifted from ../skill");
  assert.match(bundled, /^name: pingroom$/m);
});

test("manifest and package versions agree", () => {
  assert.equal(manifest.version, pkg.version);
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
});

test("the runtime user agent carries the package version", async () => {
  const { PLUGIN_VERSION, USER_AGENT } = await import("../dist/constants.js");
  assert.equal(PLUGIN_VERSION, pkg.version);
  assert.equal(USER_AGENT, `pingroom-openclaw-plugin/${pkg.version}`);
});

test("it pins the OpenClaw contract it was built against", () => {
  assert.ok(pkg.openclaw.compat.pluginApi.startsWith(">="));
  assert.ok(pkg.peerDependencies.openclaw);
});
