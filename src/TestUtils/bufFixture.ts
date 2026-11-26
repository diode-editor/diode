import { randomBytes } from "node:crypto";
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
 * Shared setup of the extensionHost.bufLsp* suites: the REAL third-party vsix bufbuild.vscode-buf from the
 * marketplace, installed by the regular `installVsix` — not a line of our own extension code. The language server is
 * `buf lsp serve` of the real `buf` binary.
 *
 * Without buf on PATH the extension downloads the binary itself, but first EVERY start asks the GitHub API for the
 * latest release — 60 requests an hour per IP without a token. So the suite puts `buf` into its own cache once and
 * passes it through the `buf.commandLine.path` setting (the extension checks it first). The user's path with the
 * download is covered by the `buf-lsp` scenario and the marketplace smoke check.
 */

/** The registry entry id; e2e and scenarios install it directly with `--install-extension`. */
export const BUF_ID = "bufbuild.vscode-buf";

export const PROTO_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".proto") ? "proto" : undefined),
    getLanguageDisplayName: () => undefined,
};

/**
 * The canonical file: a message with a doc comment (hover), its use in an rpc (hover and F12), an import of a
 * well-known type (resolves with no setup) and the typo `Usr` (the "cannot find `Usr`" diagnostic is the server's
 * readiness signal). Lines are 0-based: `message User` is 6, `Usr broken` 10, the empty line in the body of `User` 11,
 * `rpc Get(User…` 15 (`User` from column 10).
 */
export const MAIN_PROTO = [
    'syntax = "proto3";',
    "package demo.v1;",
    "",
    'import "google/protobuf/timestamp.proto";',
    "",
    "// A user of the demo service.",
    "message User {",
    "  string name = 1;",
    "  int32 age = 2;",
    "  google.protobuf.Timestamp created = 3;",
    "  Usr broken = 4;",
    "  ",
    "}",
    "",
    "service Users {",
    "  rpc Get(User) returns (User);",
    "}",
    "",
].join("\n");

/** An unformatted but valid file: Format Document must fix the indentation. */
export const UNFORMATTED_PROTO = [
    'syntax = "proto3";',
    "package demo.v1;",
    "",
    "message   Point {",
    "int32 x=1;",
    "}",
    "",
].join("\n");

export interface IInstalledBuf {
    readonly registration: IExtensionRegistration;
    dispose(): void;
}

/**
 * Installs the vsix into an isolated directory and builds the registration from the INSTALLED manifest with the same
 * function as the app.
 */
export async function installBuf(): Promise<IInstalledBuf> {
    const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-vsix-"));
    const { id, version } = await installVsix((await fetchStockVsix(BUF_ID)).vsixPath, extensionsDir);
    return {
        registration: await registrationFromInstalled(extensionsDir, id, version),
        dispose: (): void => {
            fs.rmSync(extensionsDir, { recursive: true, force: true });
        },
    };
}

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** The buf binary cache; under node_modules, so it is outside the working tree and survives runs. */
const BUF_CLI_CACHE_DIR = path.join(REPO_ROOT, "node_modules", ".cache", "diode-buf-cli");

/** The buf release asset name: the same table as the extension's (`github.js`, `findAsset`). */
function bufAssetName(): string {
    const system = process.platform === "darwin" ? "Darwin" : "Linux";
    const arch = process.arch === "arm64" ? (process.platform === "darwin" ? "arm64" : "aarch64") : "x86_64";
    return `buf-${system}-${arch}`;
}

/**
 * The path to the `buf` binary of the latest release. The tag comes from the `releases/latest/download/…` redirect
 * (not the API, so not under its limit); the binary is downloaded into the cache once per tag, and an atomic rename
 * settles the race of parallel workers, as in `stockVsix.ts`.
 */
export async function ensureBufCli(): Promise<string> {
    const asset = bufAssetName();
    // The first redirect is `latest` → `releases/download/<tag>/<asset>`; after it GitHub sends to the asset storage,
    // whose address no longer has the tag.
    const head = await fetch(`https://github.com/bufbuild/buf/releases/latest/download/${asset}`, {
        method: "HEAD",
        redirect: "manual",
    });
    const location = head.headers.get("location") ?? "";
    const tag = /\/releases\/download\/(v[^/]+)\//.exec(location)?.[1];
    if (tag === undefined) {
        throw new Error(`cannot resolve the latest buf release: HTTP ${String(head.status)}, location "${location}"`);
    }
    const cached = path.join(BUF_CLI_CACHE_DIR, tag, "buf");
    if (fs.existsSync(cached)) return cached;

    const response = await fetch(location);
    if (!response.ok) throw new Error(`cannot download ${location}: HTTP ${String(response.status)}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    fs.mkdirSync(path.dirname(cached), { recursive: true });
    const temp = `${cached}.${randomBytes(6).toString("hex")}.tmp`;
    fs.writeFileSync(temp, bytes, { mode: 0o755 });
    fs.renameSync(temp, cached);
    return cached;
}
