/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/terminalContrib/links/browser/terminalLinkHelpers.ts
// Narrow extraction: only what the local link detector uses; xterm types are our structural subset.

import type { ITerminalBuffer, ITerminalBufferLine } from "../../../terminal/common/terminalBuffer.ts";

/** xterm's `IBufferRange`: 1-based `x` (end inclusive), absolute `y`. */
export interface IBufferRange {
    start: { x: number; y: number };
    end: { x: number; y: number };
}

/** The editor's `IRange` shape over string indices, 1-based. */
export interface ILinkRange {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
}

/**
 * Converts a possibly wrapped link's range (comprised of string indices) into a buffer range that plays nicely with xterm.js
 *
 * @param lines A single line (not the entire buffer)
 * @param bufferWidth The number of columns in the terminal
 * @param range The link range - string indices
 * @param startLine The absolute y position (on the buffer) of the line
 */
export function convertLinkRangeToBuffer(
    lines: ITerminalBufferLine[],
    bufferWidth: number,
    range: ILinkRange,
    startLine: number,
): IBufferRange {
    const bufferRange: IBufferRange = {
        start: {
            x: range.startColumn,
            y: range.startLineNumber + startLine,
        },
        end: {
            x: range.endColumn - 1,
            y: range.endLineNumber + startLine,
        },
    };

    // Shift start range right for each wide character before the link
    let startOffset = 0;
    const startWrappedLineCount = Math.ceil(range.startColumn / bufferWidth);
    for (let y = 0; y < Math.min(startWrappedLineCount); y++) {
        const lineLength = Math.min(bufferWidth, range.startColumn - 1 - y * bufferWidth);
        let lineOffset = 0;
        const line = lines.at(y);
        // Sanity check for line, apparently this can happen but it's not clear under what
        // circumstances this happens. Continue on, skipping the remainder of start offset if this
        // happens to minimize impact.
        if (!line) {
            break;
        }
        for (let x = 0; x < Math.min(bufferWidth, lineLength + lineOffset); x++) {
            const cell = line.getCell(x);
            // This is unexpected but it means the character doesn't exist, so we shouldn't add to
            // the offset
            if (!cell) {
                break;
            }
            const width = cell.getWidth();
            if (width === 2) {
                lineOffset++;
            }
            const char = cell.getChars();
            if (char.length > 1) {
                lineOffset -= char.length - 1;
            }
        }
        startOffset += lineOffset;
    }

    // Shift end range right for each wide character inside the link
    let endOffset = 0;
    const endWrappedLineCount = Math.ceil(range.endColumn / bufferWidth);
    for (let y = Math.max(0, startWrappedLineCount - 1); y < endWrappedLineCount; y++) {
        const start = y === startWrappedLineCount - 1 ? (range.startColumn - 1 + startOffset) % bufferWidth : 0;
        const lineLength = Math.min(bufferWidth, range.endColumn + startOffset - y * bufferWidth);
        let lineOffset = 0;
        const line = lines.at(y);
        // Sanity check for line, apparently this can happen but it's not clear under what
        // circumstances this happens. Continue on, skipping the remainder of start offset if this
        // happens to minimize impact.
        if (!line) {
            break;
        }
        for (let x = start; x < Math.min(bufferWidth, lineLength + lineOffset); x++) {
            const cell = line.getCell(x);
            // This is unexpected but it means the character doesn't exist, so we shouldn't add to
            // the offset
            if (!cell) {
                break;
            }
            const width = cell.getWidth();
            const chars = cell.getChars();
            // Offset for null cells following wide characters
            if (width === 2) {
                lineOffset++;
            }
            // Offset for early wrapping when the last cell in row is a wide character
            if (x === bufferWidth - 1 && chars === "") {
                lineOffset++;
            }
            // Offset multi-code characters like emoji
            if (chars.length > 1) {
                lineOffset -= chars.length - 1;
            }
        }
        endOffset += lineOffset;
    }

    // Apply the width character offsets to the result
    bufferRange.start.x += startOffset;
    bufferRange.end.x += startOffset + endOffset;

    // Convert back to wrapped lines
    while (bufferRange.start.x > bufferWidth) {
        bufferRange.start.x -= bufferWidth;
        bufferRange.start.y++;
    }
    while (bufferRange.end.x > bufferWidth) {
        bufferRange.end.x -= bufferWidth;
        bufferRange.end.y++;
    }

    return bufferRange;
}

export function getXtermLineContent(buffer: ITerminalBuffer, lineStart: number, lineEnd: number, cols: number): string {
    // Cap the maximum number of lines generated to prevent potential performance problems. This is
    // more of a sanity check as the wrapped line should already be trimmed down at this point.
    const maxLineLength = Math.max(2048, cols * 2);
    lineEnd = Math.min(lineEnd, lineStart + maxLineLength);
    let content = "";
    for (let i = lineStart; i <= lineEnd; i++) {
        // Make sure only 0 to cols are considered as resizing when windows mode is enabled will
        // retain buffer data outside of the terminal width as reflow is disabled.
        const line = buffer.getLine(i);
        if (line) {
            content += line.translateToString(true, 0, cols);
        }
    }
    return content;
}
