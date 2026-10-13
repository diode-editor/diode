/**
 * `ENOENT` — файла или каталога нет. Остальные ошибки fs (`EACCES`, `EISDIR`,
 * `ENOTDIR`, …) — не «нет файла», их нельзя молча трактовать как пустоту.
 * Принимает `unknown` из `catch`: не-объект (и `null`) — не ошибка fs.
 */
export function isFileNotFound(err: unknown): boolean {
    return (err as { code?: unknown } | null | undefined)?.code === "ENOENT";
}
