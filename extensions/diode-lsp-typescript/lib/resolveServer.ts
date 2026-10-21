/**
 * JS entry points run on OUR node runtime, as in VS Code (in SEA it is the
 * diode binary + `DIODE_RUN_AS_NODE=1`, modeled on `ELECTRON_RUN_AS_NODE`).
 * Hence the candidates are JS entry points, not `.bin/…` shims: the shebang
 * `#!/usr/bin/env node` requires a system node (without it, exit 127).
 */

export interface ILanguageServerSpec {
    /** Client id (`LanguageClient(id, …)`) and the diagnostics owner. */
    readonly id: string;
    readonly displayName: string;
    readonly languageIds: readonly string[];
    /** By priority: setting → workspace `node_modules` → bundled server → name in PATH. */
    readonly resolveCandidates: (
        settingPath: string,
        workspaceRoots: readonly string[],
        bundledServerPath: string,
    ) => readonly string[];
}

export interface IServerRuntime {
    readonly command: string;
    /** SEA: the binary must switch to node mode (`DIODE_RUN_AS_NODE=1` in the server env). */
    readonly runAsNodeFlag: boolean;
}

export interface IServerCommand {
    readonly command: string;
    readonly args: readonly string[];
    /**
     * `DIODE_EXTENSION_HOST` is ALWAYS removed: vscode-languageclient copies the extension host
     * env into the server, and the flag would send our binary down the extension host branch (exit 2 without IPC).
     */
    readonly env: Readonly<Record<string, string | undefined>>;
}

export function commandFor(
    candidate: string,
    runtime: IServerRuntime,
    serverArgs: readonly string[] = ["--stdio"],
): IServerCommand {
    const env: Record<string, string | undefined> = { DIODE_EXTENSION_HOST: undefined };
    if (/\.(cjs|mjs|js)$/.test(candidate)) {
        if (runtime.runAsNodeFlag) env.DIODE_RUN_AS_NODE = "1";
        return { command: runtime.command, args: [candidate, ...serverArgs], env };
    }
    return { command: candidate, args: [...serverArgs], env };
}

export const LANGUAGE_SERVERS: readonly ILanguageServerSpec[] = [
    {
        id: "diodeTypescript",
        displayName: "TypeScript (Diode)",
        languageIds: ["typescript", "typescriptreact", "javascript", "javascriptreact"],
        resolveCandidates: (settingPath, workspaceRoots, bundledServerPath) => [
            ...(settingPath !== "" ? [settingPath] : []),
            ...workspaceRoots.map((root) => `${root}/node_modules/typescript-language-server/lib/cli.mjs`),
            ...(bundledServerPath !== "" ? [bundledServerPath] : []),
            "typescript-language-server",
        ],
    },
];

export interface IResolvedServer {
    readonly command: IServerCommand;
    /** For ATA/tsserver.path. */
    readonly isBundled: boolean;
}

/** A PATH candidate (a name without separators) is not checked for existence: spawn fails by itself. */
export function resolveServerCommand(
    spec: ILanguageServerSpec,
    settingPath: string,
    workspaceRoots: readonly string[],
    bundledServerPath: string,
    runtime: IServerRuntime,
    exists: (path: string) => boolean,
): IResolvedServer | null {
    for (const candidate of spec.resolveCandidates(settingPath, workspaceRoots, bundledServerPath)) {
        const isPathLike = candidate.includes("/") || candidate.includes("\\");
        if (isPathLike && !exists(candidate)) continue;
        return { command: commandFor(candidate, runtime), isBundled: candidate === bundledServerPath };
    }
    return null;
}
