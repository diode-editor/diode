#!/usr/bin/env node
/**
 * Extension survey: the top of Open VSX by downloads plus the real records of our registry, parsed
 * for the VS Code API they touch. The result is committed as `docs/extensions/survey.json` and feeds
 * `npm run api-matrix` (docs/extensions/README.md). Needs the network, so no gate runs it.
 *
 * Extension code is only parsed, never executed. Downloads live in a cache outside the repository;
 * a `.vsix` is dropped once parsed and the per-version parse result stays, so a rerun is cheap.
 *
 *   node scripts/ext-survey.mjs [--top 200] [--cache <dir>] [--out <file>]
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parseArgs } from "node:util";

import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

import yauzl from "yauzl";

import { analyzeSource, loadSurface, toMembers } from "./ext-survey-analyze.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
export const SURVEY_PATH = join(repoRoot, "docs", "extensions", "survey.json");

const OPEN_VSX = "https://open-vsx.org/api";
const REGISTRY = "https://diode-editor.github.io/registry/v1/index.json";
const PAGE_SIZE = 100;
const CONCURRENCY = 4;
/** A larger single file is a data blob or a bundled runtime, not extension code worth a parse. */
const MAX_JS_BYTES = 64 * 1024 * 1024;
const JS_FILE = /\.(?:js|cjs|mjs)$/;
/** Bump when the analyzer changes what it finds: older per-version parse results are ignored. */
const ANALYZER_VERSION = 2;
/** Deep minified expressions overflow the default stack of the recursive walker. */
const DEEP_STACK_MB = 512;

async function fetchJson(url) {
    for (let attempt = 1; ; attempt++) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
            if (response.status === 404) return null;
            if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
            return await response.json();
        } catch (error) {
            if (attempt >= 4) throw new Error(`${url}: ${String(error)}`);
            await new Promise((done) => setTimeout(done, attempt * 2000));
        }
    }
}

async function download(url, target) {
    for (let attempt = 1; ; attempt++) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(15 * 60_000) });
            if (!response.ok || response.body === null) throw new Error(`HTTP ${String(response.status)}`);
            await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
            return;
        } catch (error) {
            if (attempt >= 4) throw new Error(`${url}: ${String(error)}`);
            await new Promise((done) => setTimeout(done, attempt * 2000));
        }
    }
}

/** Calls `visit(path, buffer)` for the manifest and every JavaScript file of the extension. */
export function readVsix(vsixPath, visit) {
    return new Promise((done, fail) => {
        yauzl.open(vsixPath, { lazyEntries: true }, (openError, zip) => {
            if (openError !== null) {
                fail(openError);
                return;
            }
            zip.on("error", fail);
            zip.on("end", done);
            zip.on("entry", (entry) => {
                const name = entry.fileName;
                const wanted = name === "extension/package.json" || (name.startsWith("extension/") && JS_FILE.test(name));
                if (!wanted || entry.uncompressedSize > MAX_JS_BYTES) {
                    zip.readEntry();
                    return;
                }
                zip.openReadStream(entry, (streamError, stream) => {
                    if (streamError !== null) {
                        fail(streamError);
                        return;
                    }
                    const chunks = [];
                    stream.on("data", (chunk) => chunks.push(chunk));
                    stream.on("error", fail);
                    stream.on("end", () => {
                        visit(name, Buffer.concat(chunks));
                        zip.readEntry();
                    });
                });
            });
            zip.readEntry();
        });
    });
}

/** A theme or a pack has no entry point, so no code to survey. */
export const hasCode = (manifest) => typeof manifest.main === "string" || typeof manifest.browser === "string";

/** The same analysis on a thread with a deep stack. */
function analyzeDeep(source, name) {
    return new Promise((done, fail) => {
        const worker = new Worker(import.meta.filename, { workerData: { source, name }, resourceLimits: { stackSizeMb: DEEP_STACK_MB } });
        worker.once("message", (result) => done(result));
        worker.once("error", fail);
    });
}

/** Parses one `.vsix`. A file that overflows even the deep stack counts as not analyzed, not as a failure. */
export async function analyzeVsix(vsixPath, surface) {
    let manifest = null;
    let apiFound = false;
    let unparsed = 0;
    const paths = new Set();
    const overflowed = [];
    const take = (result) => {
        apiFound ||= result.apiFound;
        for (const path of result.paths) paths.add(path);
    };
    await readVsix(vsixPath, (name, buffer) => {
        if (name === "extension/package.json") {
            manifest = JSON.parse(buffer.toString("utf8").replace(/^\uFEFF/, ""));
            return;
        }
        try {
            take(analyzeSource(buffer.toString("utf8"), name));
        } catch {
            overflowed.push({ name, source: buffer.toString("utf8") });
        }
    });
    for (const { name, source } of overflowed) {
        try {
            take(await analyzeDeep(source, name));
        } catch {
            unparsed++;
        }
    }
    if (manifest === null) throw new Error(`${vsixPath}: no extension/package.json`);
    const { members, unknown } = toMembers(paths, surface);
    return {
        hasCode: hasCode(manifest),
        apiFound,
        unparsedFiles: unparsed,
        members,
        unknownMembers: unknown,
        contributes: Object.keys(manifest.contributes ?? {}).sort(),
        activationEvents: [...(manifest.activationEvents ?? [])].sort(),
    };
}

/** Open VSX ids in download order, without repeats: the search lists one row per platform build. */
export function uniqueIds(rows) {
    const seen = new Set();
    const ids = [];
    for (const row of rows) {
        const id = `${row.namespace}.${row.name}`;
        if (!seen.has(id)) {
            seen.add(id);
            ids.push({ namespace: row.namespace, name: row.name });
        }
    }
    return ids;
}

async function* openVsxTop() {
    for (let offset = 0; ; offset += PAGE_SIZE) {
        const page = await fetchJson(`${OPEN_VSX}/-/search?sortBy=downloadCount&sortOrder=desc&size=${String(PAGE_SIZE)}&offset=${String(offset)}`);
        const rows = page?.extensions ?? [];
        if (rows.length === 0) return;
        yield* uniqueIds(rows);
    }
}

async function surveyOne({ namespace, name }, cacheDir, surface, today) {
    const detail = await fetchJson(`${OPEN_VSX}/${namespace}/${name}`);
    if (detail === null || detail.files?.download === undefined) return null;
    const id = `${namespace}.${name}`;
    const parsedPath = join(cacheDir, `${id}@${detail.version}.json`);
    let parsed = null;
    if (existsSync(parsedPath)) {
        const cached = JSON.parse(readFileSync(parsedPath, "utf8"));
        if (cached.analyzerVersion === ANALYZER_VERSION) parsed = cached;
    }
    if (parsed === null) {
        const vsix = join(cacheDir, `${id}@${detail.version}.vsix`);
        try {
            await download(detail.files.download, vsix);
            parsed = { analyzerVersion: ANALYZER_VERSION, date: today, ...(await analyzeVsix(vsix, surface)) };
        } finally {
            rmSync(vsix, { force: true });
        }
        writeFileSync(parsedPath, JSON.stringify(parsed));
    }
    const { analyzerVersion: _version, ...rest } = parsed;
    return { id, version: detail.version, downloads: detail.downloadCount ?? 0, ...rest };
}

export function sortSurvey(extensions) {
    return [...extensions].sort((a, b) => b.downloads - a.downloads || a.id.localeCompare(b.id, "en"));
}

async function main() {
    const { values } = parseArgs({
        options: {
            top: { type: "string", default: "200" },
            cache: { type: "string", default: join(homedir(), ".cache", "diode", "ext-survey") },
            out: { type: "string", default: SURVEY_PATH },
        },
    });
    const top = Number(values.top);
    mkdirSync(values.cache, { recursive: true });
    const surface = loadSurface();
    const today = new Date().toISOString().slice(0, 10);
    const results = new Map();
    const failures = [];
    let skipped = 0;

    const process1 = async (ref, inRegistry) => {
        const id = `${ref.namespace}.${ref.name}`;
        try {
            const entry = await surveyOne(ref, values.cache, surface, today);
            if (entry === null) {
                failures.push(`${id}: not on Open VSX`);
                return false;
            }
            if (!entry.hasCode && !inRegistry) {
                skipped++;
                return false;
            }
            const { hasCode: code, ...rest } = entry;
            if (code) results.set(id, { ...rest, inRegistry });
            console.log(`${id} ${code ? `${String(entry.members.length)} members` : "no code"}`);
            return code;
        } catch (error) {
            failures.push(`${id}: ${String(error)}`);
            return false;
        }
    };

    const registry = await fetchJson(REGISTRY);
    const registryRefs = (registry?.extensions ?? []).map((e) => ({ namespace: e.publisher, name: e.name }));
    const registryIds = new Set(registryRefs.map((r) => `${r.namespace}.${r.name}`.toLowerCase()));

    let taken = 0;
    const source = openVsxTop();
    const workers = Array.from({ length: CONCURRENCY }, async () => {
        for (;;) {
            if (taken >= top) return;
            const { value: ref, done } = await source.next();
            if (done) return;
            const isRegistry = registryIds.has(`${ref.namespace}.${ref.name}`.toLowerCase());
            if (await process1(ref, isRegistry)) taken++;
        }
    });
    await Promise.all(workers);
    // Workers in flight overshoot the limit by a few: the tail of the ranking goes back out.
    for (const extra of sortSurvey([...results.values()]).slice(top)) results.delete(extra.id);
    const topCount = results.size;

    for (const ref of registryRefs) {
        const id = `${ref.namespace}.${ref.name}`;
        if (!results.has(id)) await process1(ref, true);
    }

    const extensions = sortSurvey([...results.values()]);
    writeFileSync(values.out, `${JSON.stringify({ schemaVersion: 1, date: today, top, topWithCode: topCount, skippedWithoutCode: skipped, failures: failures.sort(), extensions }, null, 1)}\n`);
    console.log(`${String(extensions.length)} extensions (${String(topCount)} from the top), ${String(skipped)} without code, ${String(failures.length)} failed`);
    for (const failure of failures) console.error(failure);
}

if (!isMainThread) {
    parentPort.postMessage(analyzeSource(workerData.source, workerData.name));
} else if (process.argv[1] === import.meta.filename) {
    await main();
}
