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

/**
 * Аннотированный тег при непустом сообщении, иначе lightweight. Необязательный
 * `ref` ставит тег на конкретный коммит (граф) — без него git берёт HEAD.
 */
export function tagCreateArgs(params: Record<string, unknown>): string[] | null {
    const name = safeRefArg(params.name);
    if (name === null) return null;
    const message = typeof params.message === "string" ? params.message.trim() : "";
    const args = message === "" ? ["tag", name] : ["tag", "-a", name, "-m", message];
    const ref = safeRefArg(params.ref);
    if (ref !== null) args.push(ref);
    return args;
}

export function tagDeleteArgs(params: Record<string, unknown>): string[] | null {
    const name = safeRefArg(params.name);
    return name === null ? null : ["tag", "-d", name];
}
