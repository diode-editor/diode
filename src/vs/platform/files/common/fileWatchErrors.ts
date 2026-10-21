// On ENOSPC/EMFILE the user needs a fix, not a stack trace: VS Code shows a
// notification, we log a line for now (docs/TODO/EnvironmentTuning.md).

const WATCH_LIMIT_CODES = new Set(["ENOSPC", "EMFILE"]);

export interface FileWatchErrorInfo {
    readonly code: string | undefined;
    /** For this error it makes sense to suggest tuning. */
    readonly isWatchLimit: boolean;
    /** Empty string if there's nothing to suggest. */
    readonly hint: string;
}

export function describeFileWatchError(error: unknown): FileWatchErrorInfo {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    const isWatchLimit = code !== undefined && WATCH_LIMIT_CODES.has(code);
    return {
        code,
        isWatchLimit,
        hint: isWatchLimit ? " — inotify watch limit reached; increase fs.inotify.max_user_watches" : "",
    };
}
