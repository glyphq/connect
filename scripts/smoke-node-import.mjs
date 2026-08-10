import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		...options,
	});
	if (result.status !== 0) {
		throw new Error(
			`${command} ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
		);
	}
	return result.stdout.trim();
}

const root = process.cwd();
const temp = await mkdtemp(join(tmpdir(), "glyph-connect-smoke-"));

try {
	const packJson = run("npm", ["pack", "--json"], { cwd: root });
	const [packed] = JSON.parse(packJson);
	if (!packed?.filename) throw new Error("npm pack did not return a tarball filename");
	const tarball = join(root, packed.filename);

	await writeFile(
		join(temp, "package.json"),
		JSON.stringify({ type: "module", private: true, dependencies: {} }, null, 2),
	);
	run("npm", ["install", "--silent", tarball], { cwd: temp });

	const smoke = join(temp, "smoke.mjs");
	await writeFile(
		smoke,
		`import * as glyph from "@glyph-oss/connect";\n` +
			`if (typeof glyph.createNonce !== "function") throw new Error("missing createNonce export");\n` +
			`if (typeof glyph.relayCallbackUrl !== "function") throw new Error("missing relayCallbackUrl export");\n` +
			`console.log("node esm import ok", Object.keys(glyph).length);\n`,
	);
	const output = run(process.execPath, [smoke], { cwd: temp });
	console.log(output);

	await rm(tarball, { force: true });
} finally {
	await rm(temp, { recursive: true, force: true });
}
