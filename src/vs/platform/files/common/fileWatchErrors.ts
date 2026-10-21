// На ENOSPC/EMFILE пользователю нужен рецепт, а не трасса: VS Code показывает
// уведомление, у нас пока строка в лог (docs/TODO/EnvironmentTuning.md).

const WATCH_LIMIT_CODES = new Set(["ENOSPC", "EMFILE"]);

export interface FileWatchErrorInfo {
    readonly code: string | undefined;
    /** По такой ошибке имеет смысл советовать тюнинг. */
    readonly isWatchLimit: boolean;
    /** Пустая строка, если советовать нечего. */
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
