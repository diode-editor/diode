import * as os from "node:os";
import * as path from "node:path";

/**
 * Пользовательский кэш-каталог diode для распакованных ассетов (вшитый
 * language-сервер и т.п.): переживает ребут (в отличие от `os.tmpdir()`,
 * куда распаковываются rg/node-pty) и уважает XDG. Раскладка совпадает с
 * кэшем self-extract-стаба (`scripts/selfextract-stub.sh`):
 * `${XDG_CACHE_HOME:-~/.cache}/diode`; на Windows — `%LOCALAPPDATA%/diode/cache`.
 */
export function userCacheDir(
    env: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform,
    homedir: string = os.homedir(),
): string {
    if (platform === "win32") {
        const localAppData =
            env.LOCALAPPDATA !== undefined && env.LOCALAPPDATA !== ""
                ? env.LOCALAPPDATA
                : path.join(homedir, "AppData", "Local");
        return path.join(localAppData, "diode", "cache");
    }
    const cacheHome =
        env.XDG_CACHE_HOME !== undefined && env.XDG_CACHE_HOME !== "" ? env.XDG_CACHE_HOME : path.join(homedir, ".cache");
    return path.join(cacheHome, "diode");
}
