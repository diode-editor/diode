import * as nodePath from "node:path";

import { OperatingSystem } from "../../../../../base/common/platform.ts";
import { Uri } from "../../../../../base/common/uri.ts";
import type { ITerminalBuffer, ITerminalBufferLine } from "../../../terminal/common/terminalBuffer.ts";

import { convertLinkRangeToBuffer, getXtermLineContent, type IBufferRange } from "./terminalLinkHelpers.ts";
import { detectLinks, type IParsedLink } from "./terminalLinkParsing.ts";
import type { ITerminalLinkResolver } from "./terminalLinkResolver.ts";

/** Upstream `TerminalBuiltinLinkType`, local kinds only: a folder outside the workspace is not a link here. */
export type TerminalLinkType = "LocalFile" | "LocalFolderInWorkspace";

/** Upstream `ITerminalSimpleLink`. `bufferRange` is 1-based in x (end inclusive), y is the absolute buffer row. */
export interface ITerminalSimpleLink {
    text: string;
    readonly uri: Uri;
    readonly bufferRange: IBufferRange;
    readonly type: TerminalLinkType;
    parsedLink?: IParsedLink;
}

/** The max line length to try extract links from. */
const MAX_LINE_LENGTH = 2000;
/** The maximum number of links in a line to resolve against the file system. */
const MAX_RESOLVED_LINKS_IN_LINE = 10;
/** The maximum length of a link to resolve against the file system. */
const MAX_RESOLVED_LINK_LENGTH = 1024;

/** Upstream `fallbackMatchers`: mainly paths with spaces that the regular mechanism can't catch. */
const fallbackMatchers: readonly RegExp[] = [
    // Python style error: File "<path>", line <line>
    /^ *File (?<link>"(?<path>.+)"(, line (?<line>\d+))?)/,
    // Unknown tool #200166: FILE  <path>:<line>:<col>
    /^ +FILE +(?<link>(?<path>.+)(?::(?<line>\d+)(?::(?<col>\d+))?)?)/,
    // Some C++ compile error formats: `foo bar(339) : error`, `foo bar(339,12): ...`, `foo bar(339, 12): ...`
    /^(?<link>(?<path>.+)\((?<line>\d+)(?:, ?(?<col>\d+))?\)) ?:/,
    // `foo bar:339 : error`, `foo bar:339:12: error` (Clang)
    /^(?<link>(?<path>.+):(?<line>\d+)(?::(?<col>\d+))?) ?:/,
    // PowerShell and cmd prompt
    /^(?:PS\s+)?(?<link>(?<path>[^>]+))>/,
    // The whole line is the path
    /^ *(?<link>(?<path>.+))/,
];

/**
 * Upstream `TerminalLocalLinkDetector`. Not carried over: the cwd of the command from shell integration (the
 * resolver tries the shell's cwd and the workspace roots instead), WSL paths, remote authorities and the pass
 * over cell attributes (underlined or bold runs as path candidates).
 */
export class TerminalLocalLinkDetector {
    // A reasonable maximum given the tradeoff between performance and how likely such a link is:
    // Windows' old max is 260 ($MAX_PATH), Linux's is 4096 ($PATH_MAX).
    public readonly maxLinkLength = 500;

    public constructor(
        private readonly buffer: ITerminalBuffer,
        private readonly resolver: ITerminalLinkResolver,
        private readonly os: OperatingSystem,
        private readonly isInWorkspace: (uri: Uri) => boolean,
    ) {}

    public async detect(
        lines: ITerminalBufferLine[],
        startLine: number,
        endLine: number,
    ): Promise<ITerminalSimpleLink[]> {
        const links: ITerminalSimpleLink[] = [];

        // Get the text representation of the wrapped line
        const cols = this.buffer.cols;
        const text = getXtermLineContent(this.buffer, startLine, endLine, cols);
        if (text === "" || text.length > MAX_LINE_LENGTH) return [];

        let resolvedLinkCount = 0;
        const osPath = this.os === OperatingSystem.Windows ? nodePath.win32 : nodePath.posix;
        for (const parsedLink of detectLinks(text, this.os)) {
            // Don't try resolve any links of excessive length
            if (parsedLink.path.text.length > MAX_RESOLVED_LINK_LENGTH) continue;

            // Convert the link text's string index into a wrapped buffer range
            const bufferRange = convertLinkRangeToBuffer(
                lines,
                cols,
                {
                    startColumn: (parsedLink.prefix?.index ?? parsedLink.path.index) + 1,
                    startLineNumber: 1,
                    endColumn:
                        parsedLink.path.index +
                        parsedLink.path.text.length +
                        (parsedLink.suffix?.suffix.text.length ?? 0) +
                        1,
                    endLineNumber: 1,
                },
                startLine,
            );

            const linkCandidates: string[] = [parsedLink.path.text];
            const isUri = parsedLink.path.text.startsWith("file://");
            const isAbsolute = osPath.isAbsolute(parsedLink.path.text) || parsedLink.path.text.startsWith("~") || isUri;
            // Also try without relative directory prefixes: `../src/a.ts` printed by a tool run elsewhere
            if (!isAbsolute && /^(\.\.[/\\])+/.test(parsedLink.path.text)) {
                linkCandidates.push(parsedLink.path.text.replace(/^(\.\.[/\\])+/, ""));
            }

            // If any candidates end with special characters that are likely to not be part of the
            // link, add a candidate excluding them.
            const specialEndCharRegex = /[[\]"'.]$/;
            const trimRangeMap = new Map<string, number>();
            const specialEndLinkCandidates: string[] = [];
            for (const candidate of linkCandidates) {
                let previous = candidate;
                let removed = previous.replace(specialEndCharRegex, "");
                let trimRange = 0;
                while (removed !== previous) {
                    // Only trim the link if there is no suffix, otherwise the underline would be incorrect
                    if (!parsedLink.suffix) trimRange++;
                    specialEndLinkCandidates.push(removed);
                    trimRangeMap.set(removed, trimRange);
                    previous = removed;
                    removed = removed.replace(specialEndCharRegex, "");
                }
            }
            linkCandidates.push(...specialEndLinkCandidates);

            // Validate the path and convert to the outgoing type
            const simpleLink = await this.validateAndGetLink(undefined, bufferRange, linkCandidates, trimRangeMap);
            if (simpleLink) {
                simpleLink.parsedLink = parsedLink;
                simpleLink.text = text.substring(
                    parsedLink.prefix?.index ?? parsedLink.path.index,
                    parsedLink.suffix
                        ? parsedLink.suffix.suffix.index + parsedLink.suffix.suffix.text.length
                        : parsedLink.path.index + parsedLink.path.text.length,
                );
                links.push(simpleLink);
            }

            // Stop early if too many links exist in the line
            if (++resolvedLinkCount >= MAX_RESOLVED_LINKS_IN_LINE) break;
        }

        // Match against the fallback matchers which are mainly designed to catch paths with spaces
        // that aren't possible using the regular mechanism.
        if (links.length === 0) {
            for (const matcher of fallbackMatchers) {
                const group = matcher.exec(text)?.groups;
                const link = group?.link;
                const path = group?.path;
                if (link === undefined || path === undefined) continue;

                // Don't try resolve any links of excessive length
                if (link.length > MAX_RESOLVED_LINK_LENGTH) continue;

                // Convert the link text's string index into a wrapped buffer range
                const stringIndex = text.indexOf(link);
                const bufferRange = convertLinkRangeToBuffer(
                    lines,
                    cols,
                    {
                        startColumn: stringIndex + 1,
                        startLineNumber: 1,
                        endColumn: stringIndex + link.length + 1,
                        endLineNumber: 1,
                    },
                    startLine,
                );

                // Validate and add link
                const line = group?.line;
                const col = group?.col;
                const suffix = line === undefined ? "" : `:${line}${col === undefined ? "" : `:${col}`}`;
                const simpleLink = await this.validateAndGetLink(`${path}${suffix}`, bufferRange, [path]);
                if (simpleLink) links.push(simpleLink);
            }
        }

        return links;
    }

    private async validateLinkCandidates(
        linkCandidates: readonly string[],
    ): Promise<{ readonly uri: Uri; readonly link: string; readonly isDirectory: boolean } | null> {
        for (const link of linkCandidates) {
            const uri = link.startsWith("file://") ? Uri.parse(link) : undefined;
            const result = await this.resolver.resolveLink(link, uri);
            if (result) return result;
        }
        return null;
    }

    /**
     * @param linkText The link text, this should be undefined to use the link stat value
     * @param trimRangeMap A map of link candidates to the amount of buffer range they need trimmed.
     */
    private async validateAndGetLink(
        linkText: string | undefined,
        bufferRange: IBufferRange,
        linkCandidates: readonly string[],
        trimRangeMap?: ReadonlyMap<string, number>,
    ): Promise<ITerminalSimpleLink | undefined> {
        const linkStat = await this.validateLinkCandidates(linkCandidates);
        if (!linkStat) return undefined;
        if (linkStat.isDirectory && !this.isInWorkspace(linkStat.uri)) return undefined;

        // Offset the buffer range if the link range was trimmed
        const trimRange = trimRangeMap?.get(linkStat.link);
        if (trimRange) {
            bufferRange.end.x -= trimRange;
            if (bufferRange.end.x < 0) {
                bufferRange.end.y--;
                bufferRange.end.x += this.buffer.cols;
            }
        }

        return {
            text: linkText ?? linkStat.link,
            uri: linkStat.uri,
            bufferRange,
            type: linkStat.isDirectory ? "LocalFolderInWorkspace" : "LocalFile",
        };
    }
}
