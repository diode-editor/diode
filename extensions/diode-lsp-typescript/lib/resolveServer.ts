/**
 * JS-энтрипоинты запускаются НАШИМ node-рантаймом, как в VS Code (в SEA —
 * diode-бинарь + `DIODE_RUN_AS_NODE=1`, калька `ELECTRON_RUN_AS_NODE`).
 * Поэтому кандидаты — JS-энтрипоинты, а не `.bin/…`-шимы: шебанг
 * `#!/usr/bin/env node` требует системный node (без него — exit 127).
 */

export interface ILanguageServerSpec {
    /** id клиента (`LanguageClient(id, …)`) и владелец диагностик. */
    readonly id: string;
    readonly displayName: string;
    readonly languageIds: readonly string[];
    /** По приоритету: настройка → workspace `node_modules` → вшитый сервер → имя в PATH. */
    readonly resolveCandidates: (
        settingPath: string,
        workspaceRoots: readonly string[],
        bundledServerPath: string,
    ) => readonly string[];
}

export interface IServerRuntime {
    readonly command: string;
    /** SEA: бинарь должен уйти в node-режим (`DIODE_RUN_AS_NODE=1` в env сервера). */
    readonly runAsNodeFlag: boolean;
}

export interface IServerCommand {
    readonly command: string;
    readonly args: readonly string[];
    /**
     * `DIODE_EXTENSION_HOST` снимается ВСЕГДА: vscode-languageclient копирует env
     * ext-host'а в сервер, и флаг увёл бы наш бинарь в ext-host-ветку (exit 2 без IPC).
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
    /** Для ATA/tsserver.path. */
    readonly isBundled: boolean;
}

/** PATH-кандидат (имя без разделителей) существованием не проверяется — spawn упадёт сам. */
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
