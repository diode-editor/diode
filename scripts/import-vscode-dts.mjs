#!/usr/bin/env node
/**
 * Управляет `src/Extensions/Api/vscode.d.ts` — стадийной копией upstream
 * `microsoft/vscode:src/vscode-dts/vscode.d.ts`.
 *
 * Файл состоит из двух частей:
 *   1. ПРЕФИКС (человеческий): шапка + активный `declare module "vscode"` +
 *      глобальный `Thenable` + баннер + строка-сентинел. Активный модуль — это
 *      ДОСЛОВНО раскомментированные строки upstream (bounded member-level
 *      uncommenting разрешён). Меняется ТОЛЬКО снятием `// `.
 *   2. ДОРМАНТ (генерируемый): вся upstream-копия, каждая строка с `// `.
 *
 * Режимы:
 *   (без флагов)      — регенерировать дормант из запинненного тега и обновить
 *                       провенанс (tag/commit/permalink) в шапке. Активный
 *                       модуль не трогается. Требует сети (git clone).
 *   --check           — сверить, что дормант в файле байт-в-байт равен upstream
 *                       запинненного тега (drift guard). Требует сети. Exit 1 при дрейфе.
 *   --verify-active   — offline: убедиться, что каждая кодовая строка активного
 *                       модуля дословно присутствует в дормантной копии
 *                       (инвариант «меняется только раскомментированием»). Exit 1 иначе.
 *
 * Пин согласован с `src/Extensions/builtin/VSCODE_VERSION` — держите теги в лок-степе.
 *
 * Usage: node scripts/import-vscode-dts.mjs [--check | --verify-active] [--keep-clone]
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const VSCODE_TAG = "1.127.0";
const VSCODE_REPO = "https://github.com/microsoft/vscode.git";
const DTS_PATH = "src/vscode-dts/vscode.d.ts";

const repoRoot = resolve(import.meta.dirname, "..");
const targetFile = resolve(repoRoot, "src", "vscode-dts", "vscode.d.ts");

/** Строка-сентинел: всё, что ниже неё, — генерируемый дормант. */
const SENTINEL = "//@diode:begin-upstream-verbatim (генерируется scripts/import-vscode-dts.mjs — правьте только раскомментированием)";

// ---- comment / strip -------------------------------------------------------

const comment = (l) => (l === "" ? "//" : "// " + l);
/** Обратная к `comment`: снимает ровно один слой `// ` / `//`. */
const strip = (l) => (l.startsWith("// ") ? l.slice(3) : l === "//" ? "" : l);

// ---- upstream fetch --------------------------------------------------------

function fetchUpstream() {
	const scratch = mkdtempSync(join(tmpdir(), "vscode-dts-"));
	const cloneDir = join(scratch, "vscode");
	const keepClone = process.argv.includes("--keep-clone");
	try {
		console.error(`[dts] cloning microsoft/vscode@${VSCODE_TAG} (sparse, blobless)`);
		execFileSync("git", ["clone", "--depth", "1", "--filter=blob:none", "--sparse", "--branch", VSCODE_TAG, VSCODE_REPO, cloneDir], {
			stdio: ["ignore", "ignore", "inherit"],
		});
		execFileSync("git", ["-C", cloneDir, "sparse-checkout", "set", "--no-cone", DTS_PATH], { stdio: ["ignore", "ignore", "inherit"] });
		const text = readFileSync(join(cloneDir, DTS_PATH), "utf8");
		const sha = execFileSync("git", ["-C", cloneDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
		return { text, sha };
	} finally {
		if (!keepClone) rmSync(scratch, { recursive: true, force: true });
	}
}

/** Upstream, нормализованный к массиву строк без финального пустого элемента. */
function upstreamLines(text) {
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	if (lines.length && lines[lines.length - 1] === "") lines.pop();
	return lines;
}

// ---- file split ------------------------------------------------------------

function readTarget() {
	const lines = readFileSync(targetFile, "utf8").split("\n");
	const sentinelIdx = lines.findIndex((l) => l === SENTINEL);
	if (sentinelIdx === -1) throw new Error(`sentinel not found in ${targetFile}`);
	return { lines, sentinelIdx };
}

/** Строки активного модуля (между `declare module "vscode" {` и его закрывающей `}`). */
function activeModuleLines(lines) {
	const start = lines.findIndex((l) => l.startsWith("declare module "));
	if (start === -1) throw new Error("`declare module` not found");
	let depth = 0;
	for (let i = start; i < lines.length; i++) {
		for (const ch of lines[i]) {
			if (ch === "{") depth++;
			else if (ch === "}") depth--;
		}
		if (depth === 0) return lines.slice(start + 1, i);
	}
	throw new Error("unbalanced `declare module`");
}

/** Кодовые строки (без комментариев/пустых), trimmed — для сравнения. */
function codeLines(lines) {
	return lines
		.map((l) => l.trim())
		.filter((t) => t !== "" && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*"));
}

// ---- modes -----------------------------------------------------------------

function updateProvenance(prefix, sha) {
	const permalink = `https://github.com/microsoft/vscode/blob/${sha}/${DTS_PATH}`;
	return prefix.map((l) =>
		l
			.replace(/^(\s*\*\s*tag:\s*).*/, `$1${VSCODE_TAG}`)
			.replace(/^(\s*\*\s*commit:\s*).*/, `$1${sha}`)
			.replace(/^(\s*\*\s*permalink:\s*).*/, `$1${permalink}`),
	);
}

function regen() {
	const { lines, sentinelIdx } = readTarget();
	const { text, sha } = fetchUpstream();
	const prefix = updateProvenance(lines.slice(0, sentinelIdx + 1), sha);
	const dormant = upstreamLines(text).map(comment);
	writeFileSync(targetFile, [...prefix, ...dormant].join("\n") + "\n");
	console.error(`[dts] regenerated dormant (${dormant.length} lines) @ ${VSCODE_TAG} ${sha}`);
}

function check() {
	const { lines, sentinelIdx } = readTarget();
	const { text, sha } = fetchUpstream();
	const dormant = lines.slice(sentinelIdx + 1);
	while (dormant.length && dormant[dormant.length - 1] === "") dormant.pop();
	const got = dormant.map(strip);
	const want = upstreamLines(text);
	let firstDiff = -1;
	for (let i = 0; i < Math.max(got.length, want.length); i++) {
		if (got[i] !== want[i]) {
			firstDiff = i;
			break;
		}
	}
	const shaOk = lines.some((l) => l.includes(sha));
	if (firstDiff === -1 && got.length === want.length && shaOk) {
		console.error(`[dts] --check OK: dormant matches upstream @ ${VSCODE_TAG} ${sha}`);
		return;
	}
	if (!shaOk) console.error(`[dts] --check FAIL: header commit does not record ${sha}`);
	if (firstDiff !== -1)
		console.error(`[dts] --check FAIL: dormant differs from upstream at line ${firstDiff + 1}\n  file:     ${JSON.stringify(got[firstDiff])}\n  upstream: ${JSON.stringify(want[firstDiff])}`);
	else if (got.length !== want.length) console.error(`[dts] --check FAIL: dormant length ${got.length} vs upstream ${want.length}`);
	process.exit(1);
}

function verifyActive() {
	const { lines, sentinelIdx } = readTarget();
	const dormant = lines.slice(sentinelIdx + 1).map(strip);
	const dormantCode = new Map();
	for (const t of codeLines(dormant)) dormantCode.set(t, (dormantCode.get(t) ?? 0) + 1);
	const active = codeLines(activeModuleLines(lines));
	const offenders = [];
	const seen = new Map();
	for (const t of active) {
		const budget = dormantCode.get(t) ?? 0;
		const used = seen.get(t) ?? 0;
		if (used >= budget) offenders.push(t);
		else seen.set(t, used + 1);
	}
	if (offenders.length === 0) {
		console.error(`[dts] --verify-active OK: all ${active.length} active code lines are verbatim upstream`);
		return;
	}
	console.error(`[dts] --verify-active FAIL: ${offenders.length} active line(s) are NOT verbatim upstream:`);
	for (const o of offenders.slice(0, 20)) console.error(`   ${o}`);
	process.exit(1);
}

// ---- main ------------------------------------------------------------------

if (process.argv.includes("--check")) check();
else if (process.argv.includes("--verify-active")) verifyActive();
else regen();
