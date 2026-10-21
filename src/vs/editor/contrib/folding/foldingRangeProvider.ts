import type { ITextDocument } from "../../common/model/iTextDocument.ts";

import type { IFoldingRegion } from "./iFoldingRegion.ts";
import { createFoldingRegion } from "./iFoldingRegion.ts";

/** -1 when the line is empty / whitespace-only. Mirrors VS Code's `computeIndentLevel`. */
export function computeIndentLevel(line: string, tabSize: number): number {
    let indent = 0;
    let i = 0;
    const len = line.length;
    while (i < len) {
        const ch = line[i];
        if (ch === " ") {
            indent++;
        } else if (ch === "\t") {
            indent = indent - (indent % tabSize) + tabSize;
        } else {
            break;
        }
        i++;
    }
    if (i === len) return -1;
    return indent;
}

/**
 * Blank lines are attached to the region above them: `offSide` (blank lines
 * terminate a block, e.g. Python) is not yet honoured.
 */
export function computeIndentationFolds(document: ITextDocument, tabSize: number): IFoldingRegion[] {
    const lineCount = document.lineCount;
    const result: IFoldingRegion[] = [];

    // Scanned bottom-to-top. `endAbove` is one past the region's last content line.
    // The sentinel at indent -1 makes the outermost region always close.
    const openRegions: { indent: number; endAbove: number }[] = [{ indent: -1, endAbove: lineCount }];

    for (let line = lineCount - 1; line >= 0; line--) {
        const indent = computeIndentLevel(document.getLineContent(line), tabSize);
        if (indent === -1) {
            continue;
        }

        let previous = openRegions[openRegions.length - 1];
        if (previous.indent > indent) {
            do {
                openRegions.pop();
                previous = openRegions[openRegions.length - 1];
            } while (previous.indent > indent);

            const endLine = previous.endAbove - 1;
            /* v8 ignore start -- defensive: a region always spans its header plus at least one deeper line, so endLine is always > line; the guard never rejects */
            if (endLine - line >= 1) {
                result.push(createFoldingRegion(line, endLine));
            }
            /* v8 ignore stop */
        }

        if (previous.indent === indent) {
            previous.endAbove = line;
        } else {
            openRegions.push({ indent, endAbove: line });
        }
    }

    result.sort((a, b) => a.startLine - b.startLine);
    return result;
}
