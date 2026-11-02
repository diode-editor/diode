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
 * clangd comes from the machine (`clangd` on `PATH`, CI installs it with apt): the extension's own download is
 * a network fetch of ~50 MB per run, and on linux/arm64 there is nothing to download. Without it the suites are
 * skipped ({@link clangdMissing}).
 */

export const CLANGD_ID = "llvm-vs-code-extensions.vscode-clangd";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

export const CPP_SAMPLE_DIR = path.join(REPO_ROOT, "e2e", "fixtures", "cppSample");

/** As the built-in cpp extension maps them: a header is C++ too. */
export const CPP_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (/\.(?:cpp|h)$/.test(filePath) ? "cpp" : undefined),
};

/** The machine's `clangd`: the first `PATH` entry that has one. */
export function findClangd(): string | undefined {
    const name = process.platform === "win32" ? "clangd.exe" : "clangd";
    for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
        if (dir === "") continue;
        const candidate = path.join(dir, name);
        if (fs.existsSync(candidate)) return candidate;
    }
    return undefined;
}

export function clangdMissing(): string | undefined {
    return findClangd() === undefined
        ? "clangd not found in PATH — vscode-clangd suites skipped (CI installs it with apt)"
        : undefined;
}

/** `-DSHAPE_SCALE=3` is what tells a picked-up database from the fallback flags (`scale.cpp`). */
export function writeCompileCommands(dir: string, sourceDir: string): void {
    fs.mkdirSync(dir, { recursive: true });
    const entries = ["main.cpp", "shape.cpp", "scale.cpp"].map((file) => ({
        directory: sourceDir,
        file: path.join(sourceDir, file),
        arguments: ["c++", "-std=c++17", "-DSHAPE_SCALE=3", "-c", file],
    }));
    fs.writeFileSync(path.join(dir, "compile_commands.json"), JSON.stringify(entries, null, 2));
}

export interface IInstalledClangd {
    readonly registration: IExtensionRegistration;
    dispose(): void;
}

export async function installClangd(): Promise<IInstalledClangd> {
    const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-vsix-"));
    const { id, version } = await installVsix((await fetchStockVsix(CLANGD_ID)).vsixPath, extensionsDir);
    return {
        registration: await registrationFromInstalled(extensionsDir, id, version),
        dispose: (): void => {
            fs.rmSync(extensionsDir, { recursive: true, force: true });
        },
    };
}
