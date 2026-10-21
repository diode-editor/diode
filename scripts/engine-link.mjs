#!/usr/bin/env node
// Local check of an UNPUBLISHED tuidom in diode: build the engine packages
// from the tuidom working tree and install them into diode's node_modules in place
// of the registry versions, without touching package.json and package-lock.json.
//
//   npm run engine:link                  # TUIDOM_DIR or /workspaces/tuidom/tuidom
//   npm run engine:link -- --tuidom <dir>  # another tuidom checkout/worktree
//   npm run engine:link -- --no-smoke    # skip the engine smoke test on bare node (faster)
//   npm run engine:status                # what is installed in node_modules now
//   npm run engine:unlink                # restore the engine from the registry (npm ci)
//
// Tgz only, not `npm link` / `file:` / a symlink: tuidom package `exports` point
// at `./src/*.ts`, and build-package.mjs swaps them to dist only for the duration of `npm pack`.
// A symlink would serve .ts: tsx swallows it, but bare node, tsup and SEA do not.
//
// All packages in ONE command: inter-package dependencies are exact pins, and a lone
// elements would pull a second core from the registry (breaking instanceof and singletons).
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
    if (r.status !== 0) die(`"${cmd} ${args.join(" ")}" exited with code ${r.status}`);
}

function readJson(p) {
    return JSON.parse(readFileSync(p, "utf8"));
}

function manifestsClean() {
    return sh("git", ["diff", "--quiet", "--", ...MANIFESTS]).status === 0;
}

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
        else die(`unknown argument "${a}"`);
    }
    return opts;
}

function link(opts) {
    const tuidom = path.resolve(opts.tuidom);
    if (!existsSync(path.join(tuidom, "scripts", "build-package.mjs"))) {
        die(`${tuidom} is not a tuidom checkout (no scripts/build-package.mjs). Pass --tuidom <dir> or TUIDOM_DIR.`);
    }
    if (!manifestsClean()) {
        die(`${MANIFESTS.join(" and ")} are modified. The engine swap leaves them alone and checks that via git diff:
commit or set aside your manifest edits, then retry.`);
    }
    const pkgJsonOf = (name) => path.join(tuidom, "packages", name, "package.json");
    for (const name of PACKAGES) {
        if (exportsPointToDist(readJson(pkgJsonOf(name)))) {
            die(`${pkgJsonOf(name)}: exports already point at dist, so the previous build probably failed
before restoring it. Restore the file (git -C ${tuidom} checkout -- packages/${name}/package.json) and retry.`);
        }
    }

    const sha = sh("git", ["-C", tuidom, "rev-parse", "HEAD"]).stdout.trim();
    const dirty = sh("git", ["-C", tuidom, "status", "--porcelain", "--", "packages"]).stdout.trim() !== "";

    must("npm", ["run", "pack", ...(opts.smoke ? [] : ["--", "--no-smoke"])], { cwd: tuidom });

    for (const name of PACKAGES) {
        if (exportsPointToDist(readJson(pkgJsonOf(name)))) {
            die(`after the build ${pkgJsonOf(name)} still has dist exports: restore it in tuidom.`);
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
        if (!existsSync(src)) die(`no ${src} after npm run pack`);
        cpSync(src, path.join(LINK_DIR, file));
        tgz.push(path.join(LINK_DIR, file));
    }

    must("npm", ["install", "--no-save", "--no-audit", "--no-fund", ...tgz.map((t) => `./${t}`)]);

    if (!manifestsClean()) {
        sh("git", ["checkout", "--", ...MANIFESTS]);
        die(`npm install changed ${MANIFESTS.join("/")}; restored them from git. The swap in node_modules is still there,
but better roll it back: npm run engine:unlink.`);
    }
    const copies = sh("npm", ["ls", "@tuidom/core", "--all", "--parseable"])
        .stdout.split("\n")
        .filter((l) => l.endsWith(`${path.sep}@tuidom${path.sep}core`));
    if (new Set(copies).size !== 1) {
        die(`node_modules has ${new Set(copies).size} copies of @tuidom/core:\n  ${[...new Set(copies)].join("\n  ")}
Two copies break instanceof and the engine singletons. Roll back: npm run engine:unlink.`);
    }
    // Integrity, not version: before a bump the version equals the registry one.
    const hidden = readJson(path.join("node_modules", ".package-lock.json")).packages;
    for (const [i, name] of PACKAGES.entries()) {
        const entry = hidden[`node_modules/@tuidom/${name}`];
        const expected = `sha512-${createHash("sha512").update(readFileSync(tgz[i])).digest("base64")}`;
        const installed = readJson(path.join("node_modules", "@tuidom", name, "package.json"));
        if (entry?.integrity !== expected || !exportsPointToDist(installed)) {
            die(
                `node_modules/@tuidom/${name} is not from ${tgz[i]} (resolved ${entry?.resolved}). The swap did not take.`,
            );
        }
    }

    // The vitest/vite transform cache holds the old engine.
    rmSync(path.join("node_modules", ".vite"), { recursive: true, force: true });
    rmSync(path.join("node_modules", ".vitest"), { recursive: true, force: true });

    const stamp = { tuidom, sha, dirty, version, packages: PACKAGES, linkedAt: new Date().toISOString() };
    writeFileSync(STAMP, JSON.stringify(stamp, null, 2) + "\n");

    const declared = readJson("package.json").dependencies["@tuidom/core"];
    console.log(`
engine-link: node_modules has tuidom ${version} from ${tuidom}
  commit ${sha.slice(0, 12)}${dirty ? " + uncommitted edits in packages/" : ""}; package.json still says ${declared}.

Check NOT through tsx (\`npm start\` would hide a .ts leak), but like this:
  npm run typecheck && npm test        # types and unit tests on the built engine
  npm run build && npm run build:sea   # build (build:sea under a lease)
Restore the engine from the registry: npm run engine:unlink.
Publishing a new engine version is requested by a human; diode does not depend on it until it is on npm.`);
}

function unlink() {
    if (!manifestsClean()) {
        die(`${MANIFESTS.join(" and ")} are modified: npm ci would install from them, not from git.
The swap did not touch them, so these are your edits: commit or set them aside and retry.`);
    }
    must("npm", ["ci", "--no-audit", "--no-fund"]);
    rmSync(LINK_DIR, { recursive: true, force: true });
    rmSync(path.join("node_modules", ".vite"), { recursive: true, force: true });
    console.log("engine-link: the engine is from the registry again, .engine-link/ removed.");
}

function status() {
    const core = readJson(path.join("node_modules", "@tuidom", "core", "package.json"));
    const declared = readJson("package.json").dependencies["@tuidom/core"];
    if (!existsSync(STAMP)) {
        console.log(
            `engine-link: no swap, @tuidom/core ${core.version} from the registry (package.json: ${declared}).`,
        );
        return;
    }
    const stamp = readJson(STAMP);
    const resolved = readJson(path.join("node_modules", ".package-lock.json")).packages["node_modules/@tuidom/core"]
        ?.resolved;
    console.log(`engine-link: SWAPPED, tuidom ${stamp.version} from ${stamp.tuidom}
  commit ${String(stamp.sha).slice(0, 12)}${stamp.dirty ? " + uncommitted edits" : ""}, built ${stamp.linkedAt}
  now in node_modules: @tuidom/core ${core.version} (${resolved}); package.json: ${declared}
Restore: npm run engine:unlink.`);
}

const opts = parseArgs(process.argv.slice(2));
if (opts.cmd === "link") link(opts);
else if (opts.cmd === "unlink") unlink();
else if (opts.cmd === "status") status();
else die("usage: node scripts/engine-link.mjs link|unlink|status [--tuidom <dir>] [--no-smoke]");
