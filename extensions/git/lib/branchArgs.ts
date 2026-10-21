import { safeRefArg } from "./syncArgs.ts";

/** Все имена/ref'ы — через {@link safeRefArg} (argument injection). */
export function checkoutArgs(params: Record<string, unknown>): string[] | null {
    const ref = safeRefArg(params.ref);
    if (ref === null) return null;
    return params.detach === true ? ["checkout", "--detach", ref] : ["checkout", ref];
}

export function branchCreateArgs(params: Record<string, unknown>): string[] | null {
    const name = safeRefArg(params.name);
    if (name === null) return null;
    const base = safeRefArg(params.base);
    return base === null ? ["checkout", "-b", name] : ["checkout", "-b", name, base];
}

export function branchDeleteArgs(params: Record<string, unknown>): string[] | null {
    const name = safeRefArg(params.name);
    if (name === null) return null;
    return ["branch", params.force === true ? "-D" : "-d", name];
}

export function branchRenameArgs(params: Record<string, unknown>): string[] | null {
    const name = safeRefArg(params.name);
    if (name === null) return null;
    return ["branch", "-m", name];
}

export function mergeArgs(params: Record<string, unknown>): string[] | null {
    const ref = safeRefArg(params.ref);
    return ref === null ? null : ["merge", ref];
}

export function rebaseArgs(params: Record<string, unknown>): string[] | null {
    const ref = safeRefArg(params.ref);
    return ref === null ? null : ["rebase", ref];
}

export function cherryPickArgs(params: Record<string, unknown>): string[] | null {
    const sha = safeRefArg(params.sha);
    return sha === null ? null : ["cherry-pick", sha];
}

export function pushDeleteArgs(params: Record<string, unknown>): string[] | null {
    const remote = safeRefArg(params.remote);
    const ref = safeRefArg(params.ref);
    if (remote === null || ref === null) return null;
    return ["push", remote, "--delete", ref];
}
