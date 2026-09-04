// Emit the ClawHub-publishable copy of the OpenClaw skill.
//
// The skill has one home — openclaw/skill — and that copy carries the
// `shared-body:start/end` markers, which knowledge/tools/audit-knowledge.mjs
// needs to prove the region it shares with skills/cli/skills/pingroom-cli is
// byte-identical. Those markers must stay in source.
//
// They must NOT ship to ClawHub. Its skillSpector scanner reads an HTML comment
// naming another skill's SKILL.md path as two separate attacks — "Prompt
// Injection: hidden instructions were detected in comments or invisible text"
// (0.70) and "Agent Snooping: skill enumerates or reads other installed skills"
// (0.80). Both quote the marker verbatim. They were two of the six issues
// behind the HIGH / DO_NOT_INSTALL score on 1.0.0.
//
// So: source keeps the markers for the lockstep check, the npm plugin keeps a
// byte-identical copy (openclaw/plugin/scripts/sync-skill.mjs, pinned by
// test/manifest.test.mjs), and ClawHub gets this derived copy with every HTML
// comment removed. Nothing is hand-maintained, so the three cannot drift.
//
// Usage: node scripts/build-clawhub-skill.mjs
//   then: clawhub skill publish openclaw/.clawhub/pingroom --owner pingroom ...
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "..", "openclaw", "skill");
const target = join(here, "..", "openclaw", ".clawhub", "pingroom");

/** Strip HTML comments, then collapse the blank-line run they leave behind. */
function stripComments(markdown) {
  return markdown
    .replace(/<!--[\s\S]*?-->\n?/g, "")
    .replace(/\n{3,}/g, "\n\n");
}

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });

let stripped = 0;
for (const file of walk(target)) {
  if (!file.endsWith(".md")) continue;
  const before = readFileSync(file, "utf8");
  const after = stripComments(before);
  if (after === before) continue;
  writeFileSync(file, after);
  stripped += 1;
  process.stdout.write(`  stripped comments → ${relative(target, file)}\n`);
}

// A marker reaching ClawHub is the whole failure this script exists to stop, so
// fail the build rather than publish one.
const leaked = walk(target).filter((f) => readFileSync(f, "utf8").includes("<!--"));
if (leaked.length > 0) {
  process.stderr.write(`HTML comments survived in: ${leaked.join(", ")}\n`);
  process.exit(1);
}

process.stdout.write(`clawhub skill → ${target} (${stripped} file(s) rewritten)\n`);
