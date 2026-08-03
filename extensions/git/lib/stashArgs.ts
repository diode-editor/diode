/**
 * Сборка argv stash-операций. Индекс стэша валидируется строго
 * (`stash@{N}` — приходит из нашего же пикера), сообщение — свободный текст
 * (значение после `-m`, инъекция флагов невозможна).
 */
const STASH_INDEX_RE = /^stash@\{\d+\}$/;

function safeStashIndex(value: unknown): string | null {
    if (typeof value !== "string" || !STASH_INDEX_RE.test(value)) return null;
    return value;
}

export function stashPushArgs(params: Record<string, unknown>): string[] {
    const args = ["stash", "push"];
    if (params.includeUntracked === true) args.push("-u");
    if (params.staged === true) args.push("--staged");
    if (typeof params.message === "string" && params.message.trim() !== "") {
        args.push("-m", params.message.trim());
    }
    return args;
}

export function stashPopArgs(params: Record<string, unknown>): string[] | null {
    const index = safeStashIndex(params.index);
    if (params.index !== undefined && index === null) return null;
    return index === null ? ["stash", "pop"] : ["stash", "pop", index];
}

export function stashApplyArgs(params: Record<string, unknown>): string[] | null {
    const index = safeStashIndex(params.index);
    if (params.index !== undefined && index === null) return null;
    return index === null ? ["stash", "apply"] : ["stash", "apply", index];
}

export function stashDropArgs(params: Record<string, unknown>): string[] | null {
    const index = safeStashIndex(params.index);
    return index === null ? null : ["stash", "drop", index];
}
