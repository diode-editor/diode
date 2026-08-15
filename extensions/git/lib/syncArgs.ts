/**
 * Сборка argv сетевых операций из параметров `diode.git.op`. Значения remote/ref
 * приходят из-за границы процесса — {@link safeRefArg} отбрасывает всё, что
 * похоже на флаг (защита от argument injection), пустые строки и не-строки.
 */
export function safeRefArg(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (trimmed === "" || trimmed.startsWith("-")) return null;
    return trimmed;
}

export function pullArgs(params: Record<string, unknown>): string[] {
    const args = ["pull"];
    if (params.rebase === true) args.push("--rebase");
    const remote = safeRefArg(params.remote);
    const ref = safeRefArg(params.ref);
    if (remote !== null) {
        args.push(remote);
        if (ref !== null) args.push(ref);
    }
    return args;
}

export function pushArgs(params: Record<string, unknown>): string[] {
    const args = ["push"];
    if (params.forceWithLease === true) args.push("--force-with-lease");
    if (params.followTags === true) args.push("--follow-tags");
    if (params.setUpstream === true) args.push("-u");
    const remote = safeRefArg(params.remote);
    const ref = safeRefArg(params.ref);
    if (remote !== null) {
        args.push(remote);
        if (ref !== null) args.push(ref);
    }
    return args;
}

export function fetchArgs(params: Record<string, unknown>): string[] {
    const args = ["fetch"];
    if (params.prune === true) args.push("--prune");
    if (params.all === true) args.push("--all");
    const remote = safeRefArg(params.remote);
    if (params.all !== true && remote !== null) args.push(remote);
    return args;
}
