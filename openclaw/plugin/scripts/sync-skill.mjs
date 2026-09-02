// The plugin ships the OpenClaw skill so installing one teaches the agent the
// other. The skill has exactly one home — ../skill — and this copies it in at
// build time; test/skill-sync.test.mjs asserts the copy is byte-identical.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "..", "..", "skill");
const target = join(here, "..", "skills", "pingroom");

rmSync(target, { recursive: true, force: true });
mkdirSync(dirname(target), { recursive: true });
cpSync(source, target, { recursive: true });
process.stdout.write(`synced skill → ${target}\n`);
