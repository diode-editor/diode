import { type IdleDeadline, runWhenGlobalIdle } from "../../../../base/common/async.ts";
import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import type { IPosition } from "../../../common/core/iPosition.ts";
import {
    computeDefaultDocumentColors,
    type IDocumentColorComputerTarget,
} from "../../../common/languages/defaultDocumentColorsComputer.ts";
import type {
    DocumentColorProvider,
    IColorInformation,
    IDocumentColorRequest,
} from "../../../common/languages/iColorSource.ts";
import type { ITextDocument } from "../../../common/model/iTextDocument.ts";
import type { ILanguageFeaturesService } from "../../../common/services/languageFeatures.ts";

/**
 * Upstream's worker mirror model over the lines `[from, to)`: matches are searched line by line, offsets count
 * `\n` as one. A color never crosses a line, so the colors of the slices together are those of the document.
 */
class DocumentColorComputerTarget implements IDocumentColorComputerTarget {
    private readonly lineStarts: number[] = [];

    public constructor(
        private readonly document: ITextDocument,
        private readonly from: number,
        to: number,
    ) {
        let offset = 0;
        for (let line = from; line < to; line++) {
            this.lineStarts.push(offset);
            offset += document.getLineLength(line) + 1;
        }
    }

    public positionAt(offset: number): IPosition {
        let low = 0;
        // Stryker disable next-line ArithmeticOperator: a `high` past the end only adds probes of undefined, which compare false
        let high = this.lineStarts.length - 1;
        while (low < high) {
            const mid = (low + high + 1) >> 1;
            if (this.lineStarts[mid] <= offset) low = mid;
            else high = mid - 1;
        }
        return { line: this.from + low, character: offset - this.lineStarts[low] };
    }

    public findMatches(regex: RegExp): RegExpExecArray[] {
        const matches: RegExpExecArray[] = [];
        for (let i = 0; i < this.lineStarts.length; i++) {
            for (const match of this.document.getLineContent(this.from + i).matchAll(regex)) {
                match.index += this.lineStarts[i];
                matches.push(match);
            }
        }
        return matches;
    }
}

/** Upstream `_MODEL_SYNC_LIMIT`, in characters. */
const MODEL_SYNC_LIMIT = 50 * 1024 * 1024;

/** Lines scanned between two looks at the idle deadline. */
export const COLOR_SCAN_BATCH_LINES = 256;

function nextIdle(): Promise<IdleDeadline> {
    return new Promise((resolve) => runWhenGlobalIdle(resolve));
}

/**
 * Port of upstream `DefaultDocumentColorProvider`: the built-in detector of hex/rgb/hsl colors in any file.
 * Upstream scans in a worker; here the scan runs in idle slices, so neither the first frame of a big file
 * nor a keystroke waits for it. A cancelled request or a newer text stops it: the answer would be dropped.
 * Upstream's worker never gets a document above `_MODEL_SYNC_LIMIT` and answers `null` for it; the same
 * here, so "Enable Editing" on a huge log does not scan it at all.
 */
export class DefaultDocumentColorProvider implements DocumentColorProvider {
    public constructor(private readonly syncLimit = MODEL_SYNC_LIMIT) {}

    public async provideDocumentColors(
        request: IDocumentColorRequest,
        token: ICancellationToken,
    ): Promise<IColorInformation[] | null> {
        const document = request.document;
        if (document.getValueLength() > this.syncLimit) return null;
        const colors: IColorInformation[] = [];
        let line = 0;
        while (line < document.lineCount) {
            const idle = await nextIdle();
            if (token.isCancellationRequested || document.versionId !== request.versionId) return null;
            do {
                const to = Math.min(document.lineCount, line + COLOR_SCAN_BATCH_LINES);
                const target = new DocumentColorComputerTarget(document, line, to);
                // Not `push(...)`: a spread of hundreds of thousands of colors overflows the call stack.
                for (const color of computeDefaultDocumentColors(target)) colors.push(color);
                line = to;
            } while (line < document.lineCount && idle.timeRemaining() > 0);
        }
        return colors;
    }
}

/** Upstream `DefaultDocumentColorProviderFeature`. */
export function registerDefaultDocumentColorProvider(languageFeatures: ILanguageFeaturesService): IDisposable {
    return languageFeatures.colorProvider.register("*", new DefaultDocumentColorProvider());
}
