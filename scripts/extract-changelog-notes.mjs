#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2] ?? process.env.VERSION;
if (!version) {
	console.error("usage: node scripts/extract-changelog-notes.mjs <version>");
	process.exit(1);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const changelogPath = resolve(scriptDir, "..", "CHANGELOG.md");
const changelog = readFileSync(changelogPath, "utf8");
const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const heading = new RegExp(`^##\\s+${escapedVersion}\\s*$`, "m");
const match = heading.exec(changelog);

if (!match) {
	console.log(`Release ${version}`);
	process.exit(0);
}

const rest = changelog.slice(match.index + match[0].length).replace(/^\r?\n/, "");
const nextHeading = /^##\s+/m.exec(rest);
const notes = (nextHeading ? rest.slice(0, nextHeading.index) : rest).trim();

console.log(notes || `Release ${version}`);
