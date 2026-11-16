import * as path from "node:path";

import type { IDebuggerContribution, IPlatformSpecificAdapterContribution } from "../../contrib/debug/common/debug.ts";

import { DebugAdapterExecutable } from "./debugTypes.ts";

/** What the subprocess knows of an extension: its folder and its manifest. */
export interface IDebuggerExtension {
    readonly extensionPath: string;
    readonly packageJSON: Readonly<Record<string, unknown>>;
}

function contributedDebuggers(extension: IDebuggerExtension): readonly IDebuggerContribution[] {
    const contributes = extension.packageJSON.contributes as { readonly debuggers?: unknown } | undefined;
    const debuggers = contributes?.debuggers;
    return Array.isArray(debuggers)
        ? (debuggers as readonly unknown[]).filter(
              (dbg): dbg is IDebuggerContribution => typeof (dbg as { type?: unknown } | null)?.type === "string",
          )
        : [];
}

/** Upstream `isDebuggerMainContribution`: the contribution that defines a debugger, not one that adds to it. */
function isDebuggerMainContribution(dbg: IDebuggerContribution): boolean {
    return !!dbg.type && [dbg.label, dbg.program, dbg.runtime].some(Boolean);
}

/** Upstream `registerAllDebugTypes`: the types the subprocess has adapters for. */
export function mainDebugTypes(extensions: readonly IDebuggerExtension[]): string[] {
    return extensions.flatMap((extension) =>
        contributedDebuggers(extension)
            .filter(isDebuggerMainContribution)
            .map((dbg) => dbg.type),
    );
}

/**
 * Upstream `definesDebugType`: only a contribution with a `label` defines the debugger, and only its extension may
 * register the adapter descriptor factory of the type.
 */
export function definesDebugType(extension: IDebuggerExtension | undefined, type: string): boolean {
    return !!extension && contributedDebuggers(extension).some((dbg) => !!dbg.label && dbg.type === type);
}

/** Upstream `ExecutableDebugAdapter.extract`: the adapter attributes, relative paths made absolute. */
function extract(
    platformContribution: IPlatformSpecificAdapterContribution,
    extensionFolderPath: string,
): IDebuggerContribution {
    const result = Object.create(null) as Record<string, unknown>;
    const { runtime, runtimeArgs, program, args } = platformContribution;
    if (runtime) {
        result.runtime = runtime.startsWith("./") ? path.join(extensionFolderPath, runtime) : runtime;
    }
    if (runtimeArgs) {
        result.runtimeArgs = runtimeArgs;
    }
    if (program) {
        result.program = path.isAbsolute(program) ? program : path.join(extensionFolderPath, program);
    }
    if (args) {
        result.args = args;
    }
    const contribution = platformContribution as IDebuggerContribution;
    for (const key of ["win", "winx86", "windows", "osx", "linux"] as const) {
        const platform = contribution[key];
        if (platform) {
            result[key] = extract(platform, extensionFolderPath);
        }
    }
    return result as unknown as IDebuggerContribution;
}

/**
 * Upstream `ExecutableDebugAdapter.platformAdapterExecutable`: the adapter of `contributes.debuggers` — the
 * contributions of the type merged (the first one wins a key), the attributes of the current platform over the
 * common ones; `runtime` runs `program`, otherwise `program` is the adapter.
 */
export function platformAdapterExecutable(
    extensions: readonly IDebuggerExtension[],
    debugType: string,
    platform: NodeJS.Platform = process.platform,
): DebugAdapterExecutable | undefined {
    const result = Object.create(null) as Record<string, unknown>;
    const lowerType = debugType.toLowerCase();
    for (const extension of extensions) {
        for (const dbg of contributedDebuggers(extension)) {
            if (dbg.type.toLowerCase() !== lowerType) continue;
            for (const [key, value] of Object.entries(extract(dbg, extension.extensionPath))) {
                if (!(key in result)) result[key] = value;
            }
        }
    }
    const merged = result as unknown as IDebuggerContribution;

    let platformInfo: IPlatformSpecificAdapterContribution | undefined;
    if (platform === "win32") {
        platformInfo = Object.hasOwn(process.env, "PROCESSOR_ARCHITEW6432")
            ? (merged.win ?? merged.windows)
            : (merged.winx86 ?? merged.win ?? merged.windows);
    } else if (platform === "darwin") {
        platformInfo = merged.osx;
    } else {
        platformInfo = merged.linux;
    }
    platformInfo ??= merged;

    const program = platformInfo.program ?? merged.program;
    const args = platformInfo.args ?? merged.args;
    const runtime = platformInfo.runtime ?? merged.runtime;
    const runtimeArgs = platformInfo.runtimeArgs ?? merged.runtimeArgs;

    if (runtime) {
        return new DebugAdapterExecutable(runtime, [
            ...(runtimeArgs ?? []),
            ...(typeof program === "string" ? [program] : []),
            ...(args ?? []),
        ]);
    }
    if (program) {
        return new DebugAdapterExecutable(program, args ?? []);
    }
    return undefined;
}
