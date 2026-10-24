import * as nodePath from "node:path";

import { OperatingSystem } from "../../../../../base/common/platform.ts";
import { Uri } from "../../../../../base/common/uri.ts";
import type { IFileService } from "../../../../../platform/files/common/files.ts";

import { removeLinkQueryString, removeLinkSuffix, winDrivePrefix } from "./terminalLinkParsing.ts";

/** Upstream `ResolvedLink`: `null` — the link doesn't exist on disk. */
export type ResolvedLink = { readonly uri: Uri; readonly link: string; readonly isDirectory: boolean } | null;

export interface ITerminalLinkResolver {
    resolveLink(link: string, uri?: Uri): Promise<ResolvedLink>;
}

export interface ITerminalLinkResolverContext {
    readonly os: OperatingSystem;
    readonly userHome: string | undefined;
    /**
     * Bases for a relative path, most likely first: the shell's cwd, then the workspace roots. Upstream has the
     * single `initialCwd` and the cwd of the command from shell integration, which we don't have.
     */
    getCwds(): Promise<readonly string[]>;
}

/** Upstream `LinkCacheConstants.TTL`: the whole cache is dropped this long after the last write. */
const LINK_CACHE_TTL_MS = 10_000;

/**
 * Upstream `TerminalLinkResolver`. The cache is keyed by the absolute path, not by the link text: the same
 * relative text means a different file after `cd`.
 */
export class TerminalLinkResolver implements ITerminalLinkResolver {
    private readonly cache = new Map<string, ResolvedLink>();
    private cacheExpiresAt = 0;

    public constructor(
        private readonly fileService: Pick<IFileService, "stat">,
        private readonly context: ITerminalLinkResolverContext,
        private readonly now: () => number = Date.now,
    ) {}

    public async resolveLink(link: string, uri?: Uri): Promise<ResolvedLink> {
        if (uri !== undefined) return this.stat(uri, link);

        // Remove any line/col suffix and any query string
        const linkUrl = removeLinkQueryString(removeLinkSuffix(link));
        if (linkUrl.length === 0) return null;

        for (const path of await this.preprocessPath(linkUrl)) {
            const resolved = await this.stat(Uri.file(path), link);
            if (resolved !== null) return resolved;
        }
        return null;
    }

    /** Upstream `_preprocessPath`, but a relative path yields a candidate per base directory. */
    private async preprocessPath(link: string): Promise<readonly string[]> {
        const osPath = this.context.os === OperatingSystem.Windows ? nodePath.win32 : nodePath.posix;
        if (link.startsWith("~")) {
            const home = this.context.userHome;
            return home === undefined ? [] : [osPath.normalize(osPath.join(home, link.substring(1)))];
        }
        if (this.context.os === OperatingSystem.Windows) {
            // Remove \\?\ from paths so that they share the same underlying uri and don't open multiple tabs
            if (new RegExp(`^${winDrivePrefix}`).test(link) || link.startsWith("\\\\?\\")) {
                return [osPath.normalize(link.replace(/^\\\\\?\\/, ""))];
            }
        } else if (link.startsWith("/")) {
            return [osPath.normalize(link)];
        }
        const cwds = await this.context.getCwds();
        return cwds.map((cwd) => osPath.normalize(osPath.join(cwd, link)));
    }

    private async stat(uri: Uri, link: string): Promise<ResolvedLink> {
        const key = uri.toString();
        const cached = this.getCached(key);
        if (cached !== undefined) return cached === null ? null : { ...cached, link };
        let result: ResolvedLink;
        try {
            const stat = await this.fileService.stat(uri);
            result = { uri, link, isDirectory: stat.isDirectory };
        } catch {
            result = null;
        }
        this.cacheExpiresAt = this.now() + LINK_CACHE_TTL_MS;
        this.cache.set(key, result);
        return result;
    }

    private getCached(key: string): ResolvedLink | undefined {
        if (this.now() >= this.cacheExpiresAt) this.cache.clear();
        return this.cache.get(key);
    }
}
