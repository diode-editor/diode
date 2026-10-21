/**
 * The VS Code Marketplace / Open VSX vocabulary; we don't invent our own. Alpine/musl
 * (`alpine-x64` on Open VSX) is deliberately not detected: `process.platform` there is
 * still `"linux"`, and there are no musl builds of Diode.
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
        // Stryker disable next-line ConditionalExpression: removing the default body is equivalent, since falling out of the switch returns undefined anyway
        default:
            return undefined;
    }
}
