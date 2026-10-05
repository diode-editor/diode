#!/usr/bin/env node
// Локальная проверка НЕОПУБЛИКОВАННОГО tuidom в diode: собрать пакеты движка
// из рабочего дерева tuidom и поставить их в node_modules diode вместо версий
// из реестра — не трогая package.json и package-lock.json.
//
//   npm run engine:link                  # TUIDOM_DIR или /workspaces/tuidom/tuidom
//   npm run engine:link -- --tuidom <dir>  # другой checkout/worktree tuidom
//   npm run engine:link -- --no-smoke    # без смоука движка на голом node (быстрее)
//   npm run engine:status                # что сейчас стоит в node_modules
//   npm run engine:unlink                # вернуть движок из реестра (npm ci)
//
// Почему только tgz, а не `npm link` / `file:` / симлинк: в репозитории tuidom
// `exports` пакетов указывают на `./src/*.ts`, на dist их подменяет только
// build-package.mjs на время `npm pack`. Симлинк отдал бы diode .ts-исходники:
// tsx это проглотит, а голый node, tsup и SEA-сборка — нет.
//
// Почему все пакеты ОДНОЙ командой: межпакетные зависимости движка — точные
// пины. Поставь elements отдельно — npm притащит под него вторую core из
// реестра, и instanceof/синглтоны между копиями сломаются.
//
// Правило проекта (AGENTS.md): на неопубликованную версию движка diode не
// завязываем — это только локальная проверка, в коммит она не попадает.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const PACKAGES = ["core", "elements", "terminal-backend", "headless-backend", "testing", "inspector"];
const LINK_DIR = ".engine-link";
const STAMP = path.join(LINK_DIR, "STAMP");
const MANIFESTS = ["package.json", "package-lock.json"];

function die(msg) {
    console.error(`engine-link: ${msg}`);
    process.exit(1);
}

function sh(cmd, args, opts = {}) {
    const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
    if (r.error) throw r.error;
    return r;
}

function must(cmd, args, opts = {}) {
    console.log(`> ${cmd} ${args.join(" ")}`);
    const r = sh(cmd, args, { stdio: "inherit", ...opts });
    if (r.status !== 0) die(`«${cmd} ${args.join(" ")}» завершился с кодом ${r.status}`);
}

function readJson(p) {
    return JSON.parse(readFileSync(p, "utf8"));
}

function manifestsClean() {
    return sh("git", ["diff", "--quiet", "--", ...MANIFESTS]).status === 0;
}

/** exports пакета указывают на dist/*.js, а не на src/*.ts. */
function exportsPointToDist(pkg) {
    const flat = JSON.stringify(pkg.exports ?? {});
    return flat.includes("./dist/") && !flat.includes(".ts");
}

function parseArgs(argv) {
    const opts = { cmd: argv[0], tuidom: process.env.TUIDOM_DIR ?? "/workspaces/tuidom/tuidom", smoke: true };
    for (let i = 1; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--tuidom") opts.tuidom = argv[++i] ?? "";
        else if (a.startsWith("--tuidom=")) opts.tuidom = a.slice("--tuidom=".length);
        else if (a === "--no-smoke") opts.smoke = false;
        else die(`неизвестный аргумент «${a}»`);
    }
    return opts;
}

function link(opts) {
    const tuidom = path.resolve(opts.tuidom);
    if (!existsSync(path.join(tuidom, "scripts", "build-package.mjs"))) {
        die(`${tuidom} — не checkout tuidom (нет scripts/build-package.mjs). Укажи --tuidom <dir> или TUIDOM_DIR.`);
    }
    if (!manifestsClean()) {
        die(`${MANIFESTS.join(" и ")} изменены. Подмена движка их не трогает и проверяет это по git diff —
закоммить или отложи свои правки манифестов, потом повтори.`);
    }
    const pkgJsonOf = (name) => path.join(tuidom, "packages", name, "package.json");
    for (const name of PACKAGES) {
        if (exportsPointToDist(readJson(pkgJsonOf(name)))) {
            die(`${pkgJsonOf(name)}: exports уже указывают на dist — похоже, прошлая сборка упала
до восстановления. Верни файл (git -C ${tuidom} checkout -- packages/${name}/package.json) и повтори.`);
        }
    }

    const sha = sh("git", ["-C", tuidom, "rev-parse", "HEAD"]).stdout.trim();
    const dirty = sh("git", ["-C", tuidom, "status", "--porcelain", "--", "packages"]).stdout.trim() !== "";

    // Сборка + pack (+ смоук на голом node) — штатным скриптом движка.
    must("npm", ["run", "pack", ...(opts.smoke ? [] : ["--", "--no-smoke"])], { cwd: tuidom });

    for (const name of PACKAGES) {
        if (exportsPointToDist(readJson(pkgJsonOf(name)))) {
            die(`после сборки ${pkgJsonOf(name)} остался с dist-exports — восстанови его в tuidom.`);
        }
    }

    rmSync(LINK_DIR, { recursive: true, force: true });
    mkdirSync(LINK_DIR, { recursive: true });
    const tgz = [];
    let version;
    for (const name of PACKAGES) {
        const pkg = readJson(pkgJsonOf(name));
        version = pkg.version;
        const file = `tuidom-${name}-${pkg.version}.tgz`;
        const src = path.join(tuidom, file);
        if (!existsSync(src)) die(`нет ${src} после npm run pack`);
        cpSync(src, path.join(LINK_DIR, file));
        tgz.push(path.join(LINK_DIR, file));
    }

    must("npm", ["install", "--no-save", "--no-audit", "--no-fund", ...tgz.map((t) => `./${t}`)]);

    // --- Проверки: подмена ровно та, какой задумана ---
    if (!manifestsClean()) {
        sh("git", ["checkout", "--", ...MANIFESTS]);
        die(`npm install изменил ${MANIFESTS.join("/")} — вернул из git. Подмена в node_modules осталась,
но лучше откатить её: npm run engine:unlink.`);
    }
    const copies = sh("npm", ["ls", "@tuidom/core", "--all", "--parseable"])
        .stdout.split("\n")
        .filter((l) => l.endsWith(`${path.sep}@tuidom${path.sep}core`));
    if (new Set(copies).size !== 1) {
        die(`в node_modules ${new Set(copies).size} копий @tuidom/core:\n  ${[...new Set(copies)].join("\n  ")}
Две копии ломают instanceof и синглтоны движка. Откати: npm run engine:unlink.`);
    }
    // Версия совпадает с реестровой сплошь и рядом (правка движка до бампа),
    // поэтому сверяем не версию, а integrity: npm пишет в скрытый lockfile
    // node_modules/.package-lock.json, откуда и с каким sha512 он поставил пакет.
    const hidden = readJson(path.join("node_modules", ".package-lock.json")).packages;
    for (const [i, name] of PACKAGES.entries()) {
        const entry = hidden[`node_modules/@tuidom/${name}`];
        const expected = `sha512-${createHash("sha512").update(readFileSync(tgz[i])).digest("base64")}`;
        const installed = readJson(path.join("node_modules", "@tuidom", name, "package.json"));
        if (entry?.integrity !== expected || !exportsPointToDist(installed)) {
            die(`node_modules/@tuidom/${name} — не из ${tgz[i]} (resolved ${entry?.resolved}). Подмена не встала.`);
        }
    }

    // Кэш трансформов vitest/vite держит старый движок.
    rmSync(path.join("node_modules", ".vite"), { recursive: true, force: true });
    rmSync(path.join("node_modules", ".vitest"), { recursive: true, force: true });

    const stamp = { tuidom, sha, dirty, version, packages: PACKAGES, linkedAt: new Date().toISOString() };
    writeFileSync(STAMP, JSON.stringify(stamp, null, 2) + "\n");

    const declared = readJson("package.json").dependencies["@tuidom/core"];
    console.log(`
engine-link: в node_modules стоит tuidom ${version} из ${tuidom}
  коммит ${sha.slice(0, 12)}${dirty ? " + незакоммиченные правки в packages/" : ""}; в package.json по-прежнему ${declared}.

Проверяй НЕ через tsx (\`npm start\` скрыл бы .ts-утечку), а так:
  npm run typecheck && npm test        # типы и юниты на собранном движке
  npm run build && npm run build:sea   # сборка (build:sea — под лизой)
Вернуть движок из реестра: npm run engine:unlink.
Публикацию новой версии движка запрашивает человек; diode на неё не завязываем, пока её нет в npm.`);
}

function unlink() {
    if (!manifestsClean()) {
        die(`${MANIFESTS.join(" и ")} изменены — npm ci поставит по ним, а не по git.
Подмена их не трогала, значит это твои правки: закоммить или отложи их и повтори.`);
    }
    must("npm", ["ci", "--no-audit", "--no-fund"]);
    rmSync(LINK_DIR, { recursive: true, force: true });
    rmSync(path.join("node_modules", ".vite"), { recursive: true, force: true });
    console.log("engine-link: движок снова из реестра, .engine-link/ удалён.");
}

function status() {
    const core = readJson(path.join("node_modules", "@tuidom", "core", "package.json"));
    const declared = readJson("package.json").dependencies["@tuidom/core"];
    if (!existsSync(STAMP)) {
        console.log(`engine-link: подмены нет — @tuidom/core ${core.version} из реестра (package.json: ${declared}).`);
        return;
    }
    const stamp = readJson(STAMP);
    const resolved = readJson(path.join("node_modules", ".package-lock.json")).packages["node_modules/@tuidom/core"]
        ?.resolved;
    console.log(`engine-link: ПОДМЕНА — tuidom ${stamp.version} из ${stamp.tuidom}
  коммит ${String(stamp.sha).slice(0, 12)}${stamp.dirty ? " + незакоммиченные правки" : ""}, собран ${stamp.linkedAt}
  сейчас в node_modules: @tuidom/core ${core.version} (${resolved}); package.json: ${declared}
Вернуть: npm run engine:unlink.`);
}

const opts = parseArgs(process.argv.slice(2));
if (opts.cmd === "link") link(opts);
else if (opts.cmd === "unlink") unlink();
else if (opts.cmd === "status") status();
else die("использование: node scripts/engine-link.mjs link|unlink|status [--tuidom <dir>] [--no-smoke]");
