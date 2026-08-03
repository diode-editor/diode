import { safeRefArg } from "./syncArgs.ts";

/** Сборка argv remote/tag-операций (значения — через {@link safeRefArg}). */
export function remoteAddArgs(params: Record<string, unknown>): string[] | null {
    const name = safeRefArg(params.name);
    const url = safeRefArg(params.url);
    if (name === null || url === null) return null;
    return ["remote", "add", name, url];
}

export function remoteRemoveArgs(params: Record<string, unknown>): string[] | null {
    const name = safeRefArg(params.name);
    return name === null ? null : ["remote", "remove", name];
}

/** Аннотированный тег при непустом сообщении, иначе lightweight. */
export function tagCreateArgs(params: Record<string, unknown>): string[] | null {
    const name = safeRefArg(params.name);
    if (name === null) return null;
    const message = typeof params.message === "string" ? params.message.trim() : "";
    return message === "" ? ["tag", name] : ["tag", "-a", name, "-m", message];
}

export function tagDeleteArgs(params: Record<string, unknown>): string[] | null {
    const name = safeRefArg(params.name);
    return name === null ? null : ["tag", "-d", name];
}
