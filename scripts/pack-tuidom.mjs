#!/usr/bin/env node

// Упаковка tuidom/ в отдельный npm-пакет, не меняя разработку vexx: vexx
// продолжает импортировать tuidom по относительным .ts-путям, а пакет
// собирается снапшотом в staging-каталоге dist-tuidom/.
//
// Пайплайн: копия прод-исходников (без тестов/историй/бенчей/демок) →
// tsc-emit JS + .d.ts (rewriteRelativeImportExtensions переписывает .ts→.js
// в JS-выхлопе) → пост-проход по .d.ts (tsc расширения в декларациях не
// переписывает — без этого потребителю нужен TS ≥ 5.7) → генерация
// package.json/README/LICENSE → npm pack → smoke на голом node (без tsx).
//
// Запуск: node scripts/pack-tuidom.mjs [--publish] [--name tuidom]
//         [--license MIT] [--tag <dist-tag>] [--no-smoke]

import { execSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const repoRoot = resolve(import.meta.dirname, "..");

/** Файлы, которые в пакет не идут: тесты/истории/бенчи тянут src/, демки — top-level эффекты. */
const EXCLUDED_FILE = /\.(test|stories|bench)\.(ts|tsx)$/;

function run(cmd, cwd) {
    console.log(`> ${cmd}`);
    execSync(cmd, { stdio: "inherit", cwd });
}

/** @returns {string[]} относительные пути скопированных файлов */
function copyProductionSources(srcDir, outDir) {
    const copied = [];
    const walk = (rel) => {
        for (const entry of readdirSync(join(srcDir, rel), { withFileTypes: true })) {
            const entryRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
            if (entry.isDirectory()) {
                if (entryRel === "demos") continue;
                walk(entryRel);
            } else if (/\.tsx?$/.test(entry.name) && !EXCLUDED_FILE.test(entry.name)) {
                mkdirSync(join(outDir, rel), { recursive: true });
                cpSync(join(srcDir, entryRel), join(outDir, entryRel));
                copied.push(entryRel);
            }
        }
    };
    walk("");
    return copied;
}

function buildTsconfig(pkgName) {
    return {
        compilerOptions: {
            target: "ES2024",
            module: "Node16",
            moduleResolution: "Node16",
            // Разрешает emit при .ts-расширениях в импортах и переписывает их в .js.
            rewriteRelativeImportExtensions: true,
            allowImportingTsExtensions: true,
            noEmit: false,
            declaration: true,
            sourceMap: false,
            declarationMap: false,
            outDir: "./dist",
            rootDir: "./src",
            jsx: "react-jsx",
            jsxImportSource: pkgName,
            baseUrl: ".",
            // Только для typecheck: в рантайме "<pkg>/jsx-runtime" резолвится
            // self-reference'ом собранного пакета (name + exports).
            paths: {
                [`${pkgName}/jsx-runtime`]: ["./src/dom/jsx/jsx-runtime.ts"],
                [`${pkgName}/jsx-dev-runtime`]: ["./src/dom/jsx/jsx-runtime.ts"],
            },
            strict: true,
            verbatimModuleSyntax: true,
            esModuleInterop: true,
            skipLibCheck: true,
            types: ["node"],
        },
        include: ["src"],
    };
}

/** tsc не переписывает .ts-расширения в .d.ts — приводим декларации в симметрию с .js сами. */
function rewriteDtsExtensions(distDir) {
    const specifier = /(["'])(\.\.?\/[^"']*)\.tsx?\1/g;
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) walk(path);
            else if (entry.name.endsWith(".d.ts")) {
                const source = readFileSync(path, "utf8");
                const rewritten = source.replace(specifier, "$1$2.js$1");
                if (rewritten !== source) writeFileSync(path, rewritten);
                if (/(["'])(\.\.?\/[^"']*)\.tsx?\1/.test(rewritten)) {
                    throw new Error(`[pack-tuidom] ${path}: остался .ts-специфаер после переписывания`);
                }
            }
        }
    };
    walk(distDir);
}

function buildPackageJson({ pkgName, license }) {
    const template = JSON.parse(readFileSync(join(repoRoot, "scripts/tuidom-package.template.json"), "utf8"));
    return {
        name: pkgName,
        version: template.version,
        description: template.description,
        type: "module",
        license,
        repository: { type: "git", url: "git+https://github.com/tihonove/vexx.git", directory: "tuidom" },
        engines: template.engines,
        keywords: template.keywords,
        files: ["dist"],
        // TODO: sideEffects:false не ставим, пока top-level эффекты модулей не аудированы.
        exports: {
            "./jsx-runtime": "./dist/dom/jsx/jsx-runtime.js",
            "./jsx-dev-runtime": "./dist/dom/jsx/jsx-runtime.js",
            "./package.json": "./package.json",
            // Публичного API намеренно нет (API нестабилен) — экспонируем глубокие
            // пути как есть. "./*.js" страхует форму с расширением от dist/x.js.js.
            "./*.js": "./dist/*.js",
            "./*": "./dist/*.js",
        },
    };
}

function buildLicense(license) {
    const year = new Date().getFullYear();
    const holder = "Eugene Tihonov";
    if (license !== "MIT") {
        throw new Error(`[pack-tuidom] генерация текста лицензии ${license} не поддержана — добавь текст в скрипт`);
    }
    return `MIT License

Copyright (c) ${year} ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
}

/** Ставит tgz в чистый временный проект вне репо и рендерит кадр на голом node — доказывает валидность emit'а. */
function smokeTest(pkgName, tgzPath) {
    const dir = mkdtempSync(join(tmpdir(), "tuidom-smoke-"));
    try {
        writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module", private: true }));
        run(`npm install --no-audit --no-fund ${tgzPath}`, dir);
        writeFileSync(
            join(dir, "smoke.mjs"),
            `import { HeadlessCaptureBackend } from "${pkgName}/backend/headlessCaptureBackend";
import { Size } from "${pkgName}/common/geometryPromitives";
import { TuiApplication } from "${pkgName}/dom/tuiApplication";
import { BodyElement } from "${pkgName}/ui/body/bodyElement";
import { BoxElement } from "${pkgName}/ui/layout/boxElement";
// .tsx-модуль: доказывает, что self-reference "${pkgName}/jsx-runtime" резолвится на голом node.
import { MenuBarItemElement } from "${pkgName}/ui/menu/menuBarItemElement";

const backend = new HeadlessCaptureBackend(new Size(40, 10));
const app = new TuiApplication(backend);
const body = new BodyElement();
body.title = "smoke";
body.setContent(new BoxElement());
app.root = body;
app.run();
const frame = backend.captureFrame();
const ink = frame.cells.filter((c) => c.char !== " ").length;
if (frame.cols !== 40 || frame.rows !== 10 || ink === 0) {
    console.error("smoke FAILED: empty frame", { cols: frame.cols, rows: frame.rows, ink });
    process.exit(1);
}
console.log(\`smoke OK: \${ink} non-space cells, MenuBarItemElement=\${typeof MenuBarItemElement}\`);
`,
        );
        run("node smoke.mjs", dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

/** @returns {{ tgzPath: string }} */
export function buildTuidomPackage({ pkgName, license, smoke }) {
    const staging = join(repoRoot, "dist-tuidom");
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(join(staging, "src"), { recursive: true });

    const copied = copyProductionSources(join(repoRoot, "tuidom"), join(staging, "src"));
    console.log(`[pack-tuidom] Скопировано прод-файлов: ${copied.length}`);

    writeFileSync(join(staging, "tsconfig.build.json"), JSON.stringify(buildTsconfig(pkgName), null, 4));
    run(`npx tsc -p ${join(staging, "tsconfig.build.json")}`, repoRoot);
    rewriteDtsExtensions(join(staging, "dist"));

    const packageJson = buildPackageJson({ pkgName, license });
    writeFileSync(join(staging, "package.json"), JSON.stringify(packageJson, null, 4));
    const readme = readFileSync(join(repoRoot, "scripts/tuidom-README.template.md"), "utf8");
    writeFileSync(join(staging, "README.md"), readme.replaceAll("__PKG_NAME__", pkgName));
    writeFileSync(join(staging, "LICENSE"), buildLicense(license));

    run("npm pack", staging);
    const tgzPath = join(staging, `${pkgName.replace(/^@/, "").replace("/", "-")}-${packageJson.version}.tgz`);

    if (smoke) smokeTest(pkgName, tgzPath);
    return { tgzPath };
}

const { values: args } = parseArgs({
    options: {
        publish: { type: "boolean", default: false },
        name: { type: "string", default: "tuidom" },
        license: { type: "string", default: "MIT" },
        tag: { type: "string" },
        "no-smoke": { type: "boolean", default: false },
    },
});

const { tgzPath } = buildTuidomPackage({ pkgName: args.name, license: args.license, smoke: !args["no-smoke"] });
console.log(`\n[pack-tuidom] Пакет: ${tgzPath}`);

if (args.publish) {
    run(`npm publish ${tgzPath} --access public${args.tag ? ` --tag ${args.tag}` : ""}`, repoRoot);
} else {
    console.log("[pack-tuidom] Публикация: node scripts/pack-tuidom.mjs --publish [--tag alpha]");
}
