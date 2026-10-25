import type { OperatingSystem } from "../../../../../base/common/platform.ts";
import type { Uri } from "../../../../../base/common/uri.ts";
import type { ITerminalBuffer, ITerminalBufferLine } from "../../../terminal/common/terminalBuffer.ts";

import type { IParsedLink } from "./terminalLinkParsing.ts";
import type { ITerminalLinkResolver } from "./terminalLinkResolver.ts";
import { type TerminalLinkType, TerminalLocalLinkDetector } from "./terminalLocalLinkDetector.ts";

/** A cell position: 0-based `x`, absolute 0-based buffer row `y`. */
export interface ITerminalCellPosition {
    readonly x: number;
    readonly y: number;
}

/** A detected link; `start`/`end` are inclusive cells, a wrapped link spans several rows. */
export interface ITerminalLink {
    readonly text: string;
    readonly uri: Uri;
    readonly type: TerminalLinkType;
    readonly parsedLink: IParsedLink | undefined;
    readonly start: ITerminalCellPosition;
    readonly end: ITerminalCellPosition;
}

export function isInLink(link: ITerminalLink, x: number, y: number): boolean {
    if (y < link.start.y || y > link.end.y) return false;
    if (y === link.start.y && x < link.start.x) return false;
    return !(y === link.end.y && x > link.end.x);
}

export interface ITerminalLinkProviderOptions {
    readonly resolver: ITerminalLinkResolver;
    readonly os: OperatingSystem;
    readonly isInWorkspace: (uri: Uri) => boolean;
}

/**
 * Upstream `TerminalLinkDetectorAdapter.provideLinks`: the links of the whole wrapped line around a buffer row.
 * Every pointer move parses the line again; the disk is behind the resolver's cache.
 */
export class TerminalLinkProvider {
    public constructor(private readonly options: ITerminalLinkProviderOptions) {}

    public async provideLinks(buffer: ITerminalBuffer, row: number): Promise<ITerminalLink[]> {
        const firstLine = buffer.getLine(row);
        if (firstLine === undefined) return [];
        const detector = new TerminalLocalLinkDetector(
            buffer,
            this.options.resolver,
            this.options.os,
            this.options.isInWorkspace,
        );

        // Cap the maximum context on either side of the line being provided, by taking the context
        // around the line being provided for this ensures the line the pointer is on will have
        // links provided.
        const maxCharacterContext = Math.max(detector.maxLinkLength, buffer.cols);
        const maxLineContext = Math.ceil(maxCharacterContext / buffer.cols);
        const minStartLine = Math.max(row - maxLineContext, 0);
        // Past the buffer end `getLine` returns nothing and the walk stops there.
        const maxEndLine = row + maxLineContext;

        const lines: ITerminalBufferLine[] = [firstLine];
        let startLine = row;
        while (startLine > minStartLine && lines[0].isWrapped) {
            const previous = buffer.getLine(startLine - 1);
            // Stryker disable next-line ConditionalExpression: rows from 0 up always exist; the guard narrows the type.
            if (previous === undefined) break;
            lines.unshift(previous);
            startLine--;
        }
        let endLine = row;
        while (endLine < maxEndLine) {
            const next = buffer.getLine(endLine + 1);
            if (next?.isWrapped !== true) break;
            lines.push(next);
            endLine++;
        }

        const detected = await detector.detect(lines, startLine, endLine);
        // Upstream's adapter also trims a trailing colon, for word links: a local link never ends with one.
        return detected.map((link): ITerminalLink => {
            const range = link.bufferRange;
            // The detector's range is 1-based in both axes (xterm's link API)
            return {
                text: link.text,
                uri: link.uri,
                type: link.type,
                parsedLink: link.parsedLink,
                start: { x: range.start.x - 1, y: range.start.y - 1 },
                end: { x: range.end.x - 1, y: range.end.y - 1 },
            };
        });
    }
}
