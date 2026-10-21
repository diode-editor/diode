/**
 * Builds a self-extracting single-file binary (the makeself approach); the concatenation
 * format lives in `selfextract-format.mjs`.
 *
 * Why: on Intel macOS, injecting the SEA blob breaks Mach-O chained fixups, a segfault
 * before main() (#143, nodejs/node#62893). Here an untouched signed node from nodejs.org
 * is appended to a sh stub, with no Mach-O surgery and no codesign.
 *
 *     [ #!/bin/sh stub (scripts/selfextract-stub.sh) ][ payload.tar.gz ]
 *       payload = node + main.cjs + diode.bundle + lazy/*.cjs
 *
 * The stub unpacks the payload into `${XDG_CACHE_HOME:-~/.cache}/diode/<key>/` and runs
 * `exec node main.cjs "$@"`.
 *
 * Usage:
 *
 *     node scripts/build-selfextract.mjs [--target=<platform>-<arch>] [--node=host|<path>] [--out=<path>]
 *
 *   --target  payload platform (default: the host). darwin-x64 | darwin-arm64 | linux-x64 | linux-arm64
 *   --node    `host` takes process.execPath (fast, offline: local builds and e2e);
 *             a path takes that binary; by default the official tarball is downloaded.
 *   --out     output path (default <dist-dir>/diode)
 *   --dist-dir  build directory instead of `dist/` (e2e: a cache by hash, scripts/e2e-artifacts.mjs)
 *   --reuse-dist  reuse the already built `main.cjs` and bundles: tsup with `clean: true`
 *             would wipe the whole directory, including the SEA binary other runs may be executing.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

import { buildDistArtifacts } from "./build-dist.mjs";
import { LAZY_CHUNKS, lazyChunkAssetName } from "./build-lazy-chunks.mjs";
import { buildNodePtyBundle } from "./pack-node-pty.mjs";
import { resolveDiodeVersion } from "./resolve-version.mjs";
import { writeSelfExtract } from "./selfextract-format.mjs";
import { smokeTestBinary, smokeTestNodeMode } from "./smoke-binary.mjs";

/** In lockstep with `node-version` in `.github/workflows/build.yml`. */
const NODE_VERSION = "26.12.0";

const SUPPORTED_TARGETS = new Set(["darwin-x64", "darwin-arm64", "linux-x64", "linux-arm64"]);
const HOST_TARGET = `${process.platform}-${process.arch}`;

const root = resolve(import.meta.dirname, "..");

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const target = args.target ?? HOST_TARGET;
    if (!SUPPORTED_TARGETS.has(target)) {
        // Windows is left out on purpose: the stub is POSIX sh.
        throw new Error(`[selfextract] Unsupported target: ${target}. Supported: ${[...SUPPORTED_TARGETS].join(", ")}`);
    }

    const distDir = resolve(root, args.distDir ?? "dist");
    const outputPath = resolve(root, args.out ?? join(distDir, "diode"));
    const version = resolveDiodeVersion({ repoRoot: root });
    console.log(`[selfextract] target=${target} version=${version}`);

    const { mainJsPath, bundlePath, tsServerBundlePath, lazyChunks } = args.reuseDist
        ? existingDistArtifacts(distDir)
        : await buildDistArtifacts({ repoRoot: root, distDir });

    const nodeBinary = await resolveNodeBinary({ target, nodeOpt: args.node });

    const payload = buildPayload({ target, nodeBinary, mainJsPath, bundlePath, tsServerBundlePath, lazyChunks, distDir });

    const key = `${version}-${sha256(payload).slice(0, 12)}`;
    writeSelfExtract({ outputPath, payload, key });

    const sizeMb = (payload.length / 1024 / 1024).toFixed(1);
    console.log(`[selfextract] ${outputPath} (payload ${sizeMb} MB, cache key ${key})`);

    // The binary must actually start (#143).
    if (target === HOST_TARGET) {
        const reported = smokeTestBinary(outputPath, { cwd: root });
        smokeTestNodeMode(outputPath);
        console.log(`[selfextract] Smoke: ${outputPath} --version → ${reported}`);
        // Otherwise the payload unpacks into a directory that does not match its contents.
        if (reported !== version) {
            throw new Error(
                `[selfextract] Version mismatch: binary reports "${reported}", cache key built from "${version}".\n` +
                    `  Both sides must come from scripts/resolve-version.mjs.`,
            );
        }
    } else {
        console.log(`[selfextract] Smoke skipped: target ${target} != host ${HOST_TARGET}`);
    }
}

/** @param {string[]} argv */
function parseArgs(argv) {
    /** @type {{ target?: string, node?: string, out?: string, distDir?: string, reuseDist?: boolean }} */
    const args = {};
    for (const arg of argv) {
        if (arg === "--reuse-dist") {
            args.reuseDist = true;
            continue;
        }
        const match = /^--(target|node|out|dist-dir)=(.+)$/.exec(arg);
        if (!match) throw new Error(`[selfextract] Unknown argument: ${arg}`);
        args[match[1] === "dist-dir" ? "distDir" : match[1]] = match[2];
    }
    return args;
}

/**
 * @param {string} distDir
 * @returns {{ mainJsPath: string, bundlePath: string, tsServerBundlePath: string, lazyChunks: Array<{ asset: string, path: string }> }}
 */
function existingDistArtifacts(distDir) {
    const lazyChunks = LAZY_CHUNKS.map(({ id }) => {
        const asset = lazyChunkAssetName(id);
        return { asset, path: join(distDir, asset) };
    });
    const paths = {
        mainJsPath: join(distDir, "main.cjs"),
        bundlePath: join(distDir, "diode.bundle"),
        tsServerBundlePath: join(distDir, "ts-server.bundle"),
        tsServerDigestPath: join(distDir, "ts-server.bundle.sha256"),
    };
    for (const path of [...Object.values(paths), ...lazyChunks.map((c) => c.path)]) {
        if (!existsSync(path)) throw new Error(`[selfextract] --reuse-dist: missing ${path}; run npm run build:sea first`);
    }
    console.log(`[selfextract] reuse ${distDir} artifacts (no tsup)`);
    return { ...paths, lazyChunks };
}

/**
 * @param {{ target: string, nodeOpt: string | undefined }} params
 * @returns {Promise<string>}
 */
async function resolveNodeBinary({ target, nodeOpt }) {
    if (nodeOpt === "host") {
        if (target !== HOST_TARGET) {
            throw new Error(`[selfextract] --node=host requires --target=${HOST_TARGET} (got ${target})`);
        }
        console.log(`[selfextract] node: host ${process.execPath} (${process.version})`);
        return process.execPath;
    }
    if (nodeOpt !== undefined) {
        if (!existsSync(nodeOpt)) throw new Error(`[selfextract] --node path does not exist: ${nodeOpt}`);
        console.log(`[selfextract] node: ${nodeOpt}`);
        return nodeOpt;
    }
    return downloadNode({ target });
}

/**
 * @param {{ target: string }} params
 * @returns {Promise<string>}
 */
async function downloadNode({ target }) {
    const [platform, arch] = target.split("-");
    const name = `node-v${NODE_VERSION}-${platform}-${arch}`;
    const tarball = `${name}.tar.gz`;
    const baseUrl = `https://nodejs.org/dist/v${NODE_VERSION}`;

    const cacheDir = join(root, "dist", ".cache", "node");
    mkdirSync(cacheDir, { recursive: true });
    const nodePath = join(cacheDir, `node-${NODE_VERSION}-${target}`);
    if (existsSync(nodePath)) {
        console.log(`[selfextract] node: cached ${nodePath}`);
        return nodePath;
    }

    console.log(`[selfextract] node: downloading ${baseUrl}/${tarball}`);
    const [shasums, archive] = await Promise.all([fetchText(`${baseUrl}/SHASUMS256.txt`), fetchBuffer(`${baseUrl}/${tarball}`)]);

    // https is not enough: a corrupt or tampered download would silently ship in the release binary.
    const expected = findShasum(shasums, tarball);
    const actual = sha256(archive);
    if (actual !== expected) {
        throw new Error(`[selfextract] sha256 mismatch for ${tarball}:\n  expected ${expected}\n  actual   ${actual}`);
    }
    console.log(`[selfextract] node: sha256 OK (${actual.slice(0, 12)}…)`);

    const tmpDir = join(cacheDir, `.tmp-${target}`);
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    const archivePath = join(tmpDir, tarball);
    writeFileSync(archivePath, archive);
    execFileSync("tar", ["-xzf", archivePath, "-C", tmpDir, `${name}/bin/node`], { stdio: "inherit" });
    cpSync(join(tmpDir, name, "bin", "node"), nodePath);
    chmodSync(nodePath, 0o755);
    rmSync(tmpDir, { recursive: true, force: true });
    return nodePath;
}

/**
 * @param {{ target: string, nodeBinary: string, mainJsPath: string, bundlePath: string, tsServerBundlePath: string, lazyChunks: Array<{ asset: string, path: string }>, distDir: string }} params
 * @returns {Buffer}
 */
function buildPayload({ target, nodeBinary, mainJsPath, bundlePath, tsServerBundlePath, lazyChunks, distDir }) {
    const stageDir = join(distDir, ".selfextract", target);
    rmSync(stageDir, { recursive: true, force: true });
    mkdirSync(stageDir, { recursive: true });

    cpSync(nodeBinary, join(stageDir, "node"));
    chmodSync(join(stageDir, "node"), 0o755);
    cpSync(mainJsPath, join(stageDir, "main.cjs"));
    cpSync(bundlePath, join(stageDir, "diode.bundle"));
    // Next to main.cjs, where loadTsServer.ts (via entryDir()) and lazyModule.ts look for them.
    cpSync(tsServerBundlePath, join(stageDir, "ts-server.bundle"));
    cpSync(`${tsServerBundlePath}.sha256`, join(stageDir, "ts-server.bundle.sha256"));
    for (const { asset, path } of lazyChunks) {
        mkdirSync(dirname(join(stageDir, asset)), { recursive: true });
        cpSync(path, join(stageDir, asset));
    }

    // Self-extract is NOT SEA: loadNodePty.ts and loadRipgrep.ts take the dev require() path,
    // which resolves from main.cjs, hence node_modules in the payload.
    const { inputs: ptyInputs } = buildNodePtyBundle({ repoRoot: root });
    for (const { virtualPath, data } of ptyInputs) {
        const dest = join(stageDir, "node_modules", virtualPath);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, data);
        if (virtualPath.endsWith(".node") || virtualPath.endsWith("spawn-helper")) chmodSync(dest, 0o755);
    }

    stageRipgrep(stageDir);

    // The native code above comes from the HOST architecture; only node cross-builds legitimately, so warn instead of failing.
    if (target !== HOST_TARGET) {
        console.warn(
            `[selfextract] WARNING: target ${target} != host ${HOST_TARGET}: node-pty and ripgrep ` +
                `are staged from the host architecture, so this binary will not work on the target. ` +
                `Build on a native runner for the target.`,
        );
    }

    const payloadPath = join(stageDir, "..", `payload-${target}.tar.gz`);
    execFileSync("tar", ["-czf", payloadPath, "-C", stageDir, "."], {
        stdio: "inherit",
        // Otherwise bsdtar on macOS adds AppleDouble `._*` files to the archive.
        env: { ...process.env, COPYFILE_DISABLE: "1" },
    });
    return readFileSync(payloadPath);
}

/**
 * The @vscode/ripgrep resolver and the @vscode/ripgrep-<platform>-<arch> binary package.
 * @param {string} stageDir
 */
function stageRipgrep(stageDir) {
    const requireFromRoot = createRequire(join(root, "package.json"));
    const binaryName = process.platform === "win32" ? "rg.exe" : "rg";
    const platformName = `ripgrep-${process.platform}-${process.arch}`;

    // Package roots come from the binary path: `exports` in @vscode/ripgrep forbids resolving "./package.json".
    const rgBinaryPath = requireFromRoot.resolve(`@vscode/${platformName}/bin/${binaryName}`);
    const platformDir = dirname(dirname(rgBinaryPath)); // node_modules/@vscode/ripgrep-<platform>-<arch>
    const resolverDir = join(dirname(platformDir), "ripgrep"); // node_modules/@vscode/ripgrep

    const nodeModules = join(stageDir, "node_modules");
    cpSync(resolverDir, join(nodeModules, "@vscode", "ripgrep"), { recursive: true });
    cpSync(platformDir, join(nodeModules, "@vscode", platformName), { recursive: true });
    chmodSync(join(nodeModules, "@vscode", platformName, "bin", binaryName), 0o755);
}

/** @param {string} url */
async function fetchText(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`[selfextract] GET ${url} → ${response.status}`);
    return response.text();
}

/** @param {string} url */
async function fetchBuffer(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`[selfextract] GET ${url} → ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
}

/**
 * @param {string} shasums SHASUMS256.txt contents (lines "<sha>  <file>").
 * @param {string} fileName
 */
function findShasum(shasums, fileName) {
    for (const line of shasums.split("\n")) {
        const [sha, name] = line.trim().split(/\s+/);
        if (name === fileName) return sha;
    }
    throw new Error(`[selfextract] ${fileName} not found in SHASUMS256.txt`);
}

/** @param {Buffer | Uint8Array} data */
function sha256(data) {
    return createHash("sha256").update(data).digest("hex");
}

if (import.meta.url === `file://${process.argv[1]}`) {
    await main();
}
