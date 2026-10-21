/**
 * Сборка самораспаковывающегося однофайлового бинаря (makeself-подход); формат
 * склейки — `selfextract-format.mjs`.
 *
 * Зачем: на Intel macOS инъекция SEA-блоба портит Mach-O chained fixups — segfault
 * до main() (#143, nodejs/node#62893). Здесь нетронутый подписанный node с
 * nodejs.org приклеивается к sh-стабу — без хирургии над Mach-O и без codesign.
 *
 *     [ #!/bin/sh стаб (scripts/selfextract-stub.sh) ][ payload.tar.gz ]
 *       payload = node + main.cjs + diode.bundle + lazy/*.cjs
 *
 * Стаб распаковывает payload в `${XDG_CACHE_HOME:-~/.cache}/diode/<key>/` и делает
 * `exec node main.cjs "$@"`.
 *
 * Использование:
 *
 *     node scripts/build-selfextract.mjs [--target=<platform>-<arch>] [--node=host|<path>] [--out=<path>]
 *
 *   --target  платформа payload'а (по умолчанию — хост). darwin-x64 | darwin-arm64 | linux-x64 | linux-arm64
 *   --node    `host` — взять process.execPath (быстро, без сети: локальные сборки и e2e);
 *             путь — взять указанный бинарь; по умолчанию — скачать официальный тарбол.
 *   --out     путь результата (по умолчанию <dist-dir>/diode)
 *   --dist-dir  каталог сборки вместо `dist/` (e2e — кэш по хешу, scripts/e2e-artifacts.mjs)
 *   --reuse-dist  взять уже собранные `main.cjs` и бандлы: tsup с `clean: true`
 *             стёр бы весь каталог — с SEA-бинарём, который могут исполнять соседи.
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

/** В лок-степе с `node-version` в `.github/workflows/build.yml`. */
const NODE_VERSION = "26.12.0";

const SUPPORTED_TARGETS = new Set(["darwin-x64", "darwin-arm64", "linux-x64", "linux-arm64"]);
const HOST_TARGET = `${process.platform}-${process.arch}`;

const root = resolve(import.meta.dirname, "..");

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const target = args.target ?? HOST_TARGET;
    if (!SUPPORTED_TARGETS.has(target)) {
        // Windows сюда не заводится сознательно: стаб — POSIX sh.
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

    // Бинарь обязан реально стартовать (#143).
    if (target === HOST_TARGET) {
        const reported = smokeTestBinary(outputPath, { cwd: root });
        smokeTestNodeMode(outputPath);
        console.log(`[selfextract] Smoke: ${outputPath} --version → ${reported}`);
        // Иначе распаковка идёт в каталог, не соответствующий содержимому payload'а.
        if (reported !== version) {
            throw new Error(
                `[selfextract] Version mismatch: binary reports "${reported}", cache key built from "${version}".\n` +
                    `  Обе стороны обязаны идти из scripts/resolve-version.mjs.`,
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
        if (!existsSync(path)) throw new Error(`[selfextract] --reuse-dist: нет ${path} — сначала npm run build:sea`);
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

    // https мало: битая или подменённая загрузка уехала бы в релизный бинарь молча.
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
    // Рядом с main.cjs: так их ищут loadTsServer.ts (через entryDir()) и lazyModule.ts.
    cpSync(tsServerBundlePath, join(stageDir, "ts-server.bundle"));
    cpSync(`${tsServerBundlePath}.sha256`, join(stageDir, "ts-server.bundle.sha256"));
    for (const { asset, path } of lazyChunks) {
        mkdirSync(dirname(join(stageDir, asset)), { recursive: true });
        cpSync(path, join(stageDir, asset));
    }

    // Self-extract — НЕ SEA: loadNodePty.ts и loadRipgrep.ts идут dev-путём
    // require(), который резолвит от main.cjs, — отсюда node_modules в payload'е.
    const { inputs: ptyInputs } = buildNodePtyBundle({ repoRoot: root });
    for (const { virtualPath, data } of ptyInputs) {
        const dest = join(stageDir, "node_modules", virtualPath);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, data);
        if (virtualPath.endsWith(".node") || virtualPath.endsWith("spawn-helper")) chmodSync(dest, 0o755);
    }

    stageRipgrep(stageDir);

    // Натив выше — с архитектуры ХОСТА; легальный кросс — только node, поэтому не падаем.
    if (target !== HOST_TARGET) {
        console.warn(
            `[selfextract] WARNING: target ${target} != host ${HOST_TARGET} — node-pty и ripgrep ` +
                `стейджатся с архитектуры хоста, такой бинарь на таргете работать не будет. ` +
                `Собирайте на нативном раннере таргета.`,
        );
    }

    const payloadPath = join(stageDir, "..", `payload-${target}.tar.gz`);
    execFileSync("tar", ["-czf", payloadPath, "-C", stageDir, "."], {
        stdio: "inherit",
        // Без этого bsdtar на macOS насыпает в архив AppleDouble-файлы `._*`.
        env: { ...process.env, COPYFILE_DISABLE: "1" },
    });
    return readFileSync(payloadPath);
}

/**
 * Резолвер @vscode/ripgrep и пакет с бинарём @vscode/ripgrep-<platform>-<arch>.
 * @param {string} stageDir
 */
function stageRipgrep(stageDir) {
    const requireFromRoot = createRequire(join(root, "package.json"));
    const binaryName = process.platform === "win32" ? "rg.exe" : "rg";
    const platformName = `ripgrep-${process.platform}-${process.arch}`;

    // Корни пакетов — из пути бинаря: `exports` в @vscode/ripgrep запрещает резолвить "./package.json".
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
 * @param {string} shasums Содержимое SHASUMS256.txt (строки «<sha>  <файл>»).
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
