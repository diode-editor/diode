import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { type ILanguageService, NULL_LANGUAGE_SERVICE } from "../vs/editor/common/languages/iLanguageService.ts";
import { installVsix } from "../vs/platform/extensionManagement/node/extensionInstaller.ts";
import type { IExtensionRegistration } from "../vs/workbench/services/extensions/node/iExtensionEntry.ts";

import { registrationFromInstalled } from "./installedExtensionRegistration.ts";
import { fetchStockVsix } from "./stockVsix.ts";

/**
 * The client asks the server whether a file is in an Angular project (`IsInAngularProject`), and the answer is yes
 * only with `@angular/core` in the project's `node_modules`: the vsix bundles the server and TypeScript, not
 * Angular. The fixture installs the library once and links it into the workspace ({@link linkAngularLibrary}); a
 * committed `node_modules` is not an option.
 */

export const ANGULAR_ID = "Angular.ng-template";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ANGULAR_LIB_CACHE_DIR = path.join(REPO_ROOT, "node_modules", ".cache", "diode-angular-fixture");

/** `@angular/compiler` is the peer the language service compiles templates with; rxjs and tslib are core's. */
const ANGULAR_PACKAGES = ["@angular/core", "@angular/compiler", "rxjs", "tslib"];

export const ANGULAR_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) =>
        filePath.endsWith(".html") ? "html" : filePath.endsWith(".ts") ? "typescript" : undefined,
};

/**
 * `src/app/hello.component.{ts,html}` (an unknown name in the external template), `src/app/app.component.ts` (an
 * inline template with an unknown name), a tsconfig with `strictTemplates`.
 */
export const ANGULAR_SAMPLE_DIR = path.resolve(import.meta.dirname, "..", "..", "e2e", "fixtures", "angularSample");

export interface IInstalledAngular {
    readonly registration: IExtensionRegistration;
    dispose(): void;
}

export async function installAngular(): Promise<IInstalledAngular> {
    const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-vsix-"));
    const { id, version } = await installVsix((await fetchStockVsix(ANGULAR_ID)).vsixPath, extensionsDir);
    return {
        registration: await registrationFromInstalled(extensionsDir, id, version),
        dispose: (): void => {
            fs.rmSync(extensionsDir, { recursive: true, force: true });
        },
    };
}

/** The version is not pinned, as with the stock vsix; the cache lives until node_modules is cleaned. */
export function ensureAngularLibrary(): string {
    const nodeModules = path.join(ANGULAR_LIB_CACHE_DIR, "node_modules");
    /* v8 ignore start -- test helper: one suite calls it, so a CI run sees either a warm cache or a cold one */
    if (fs.existsSync(path.join(nodeModules, "@angular", "core", "package.json"))) return nodeModules;
    /* v8 ignore stop */
    fs.mkdirSync(path.dirname(ANGULAR_LIB_CACHE_DIR), { recursive: true });
    const staging = fs.mkdtempSync(`${ANGULAR_LIB_CACHE_DIR}.`);
    fs.writeFileSync(path.join(staging, "package.json"), '{ "private": true }\n');
    execFileSync("npm", ["install", ...ANGULAR_PACKAGES, "--no-audit", "--no-fund", "--loglevel=error"], {
        cwd: staging,
        stdio: "pipe",
        timeout: 180_000,
    });
    /* v8 ignore start -- test helper: the catch is for a parallel e2e worker that got there first */
    try {
        fs.renameSync(staging, ANGULAR_LIB_CACHE_DIR);
    } catch {
        // Its install is just as good.
        fs.rmSync(staging, { recursive: true, force: true });
    }
    /* v8 ignore stop */
    return nodeModules;
}

export function linkAngularLibrary(workspaceDir: string, nodeModules: string): void {
    fs.symlinkSync(nodeModules, path.join(workspaceDir, "node_modules"), "dir");
}

/** The sample's files by their path relative to the project, `/`-separated. */
export function angularSampleFiles(): Record<string, string> {
    const files: Record<string, string> = {};
    const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else
                files[path.relative(ANGULAR_SAMPLE_DIR, full).split(path.sep).join("/")] = fs.readFileSync(
                    full,
                    "utf8",
                );
        }
    };
    walk(ANGULAR_SAMPLE_DIR);
    return files;
}
