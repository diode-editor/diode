/**
 * Платформенный таргет текущего хоста в терминах VS Code Marketplace / Open VSX
 * (`<os>-<arch>`: `linux-x64`, `darwin-arm64`, `win32-arm64`, …). Именно эти
 * значения несут поле `targetPlatform` записей реестра и платформенные vsix
 * Open VSX — словарь один, свой не изобретаем.
 *
 * Неизвестная комбинация ОС/архитектуры → `undefined`: такой хост получает
 * только universal-записи (см. `IHostVersions.targetPlatform`). Alpine/musl
 * (`alpine-x64`/`alpine-arm64` у Open VSX) сознательно не детектится —
 * `process.platform` там тот же `"linux"`, а сборок Diode под musl нет; если
 * появятся, детект добавится здесь, не трогая формат.
 */
export function currentTargetPlatform(
    platform: NodeJS.Platform = process.platform,
    arch: NodeJS.Architecture = process.arch,
): string | undefined {
    switch (platform) {
        case "win32":
            if (arch === "x64") return "win32-x64";
            if (arch === "arm64") return "win32-arm64";
            return undefined;
        case "linux":
            if (arch === "x64") return "linux-x64";
            if (arch === "arm64") return "linux-arm64";
            if (arch === "arm") return "linux-armhf";
            return undefined;
        case "darwin":
            if (arch === "x64") return "darwin-x64";
            if (arch === "arm64") return "darwin-arm64";
            return undefined;
        // Stryker disable next-line ConditionalExpression: удаление тела default эквивалентно — выпадение из switch и так возвращает undefined
        default:
            return undefined;
    }
}
