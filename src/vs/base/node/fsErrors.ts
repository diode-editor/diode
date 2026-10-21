export function isFileNotFound(err: unknown): boolean {
    return (err as { code?: unknown } | null | undefined)?.code === "ENOENT";
}
