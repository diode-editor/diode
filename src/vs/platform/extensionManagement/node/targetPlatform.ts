/**
 * Словарь VS Code Marketplace / Open VSX — свой не изобретаем. Alpine/musl
 * (`alpine-x64` у Open VSX) сознательно не детектится: `process.platform` там тот же
 * `"linux"`, а сборок Diode под musl нет.
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
