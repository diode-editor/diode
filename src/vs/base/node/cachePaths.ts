import * as os from "node:os";
import * as path from "node:path";

/** Раскладка совпадает с кэшем `scripts/selfextract-stub.sh`. */
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
        env.XDG_CACHE_HOME !== undefined && env.XDG_CACHE_HOME !== ""
            ? env.XDG_CACHE_HOME
            : path.join(homedir, ".cache");
    return path.join(cacheHome, "diode");
}
