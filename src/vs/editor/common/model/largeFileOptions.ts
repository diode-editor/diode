/**
 * Upstream `TextModel.LARGE_FILE_SIZE_THRESHOLD` / `LARGE_FILE_LINE_COUNT_THRESHOLD`: a file above
 * either of them is "too large for tokenization" when `editor.largeFileOptimizations` is on.
 * Here they are the defaults of a setting (human's decision 2026-10-23: the threshold is configurable).
 */
export const LARGE_FILE_SIZE_THRESHOLD_MB = 20;
export const LARGE_FILE_LINE_COUNT_THRESHOLD = 300 * 1000;

export const MiB = 1024 * 1024;

export interface ILargeFileOptions {
    /** `editor.largeFileOptimizations`; `false` — no file is ever "too large". */
    readonly largeFileOptimizations: boolean;
    /** `editor.largeFileSizeThreshold`, in MiB of text (characters, as upstream counts its 20 MB). */
    readonly sizeThresholdMb: number;
    /** `editor.largeFileLineCountThreshold`. */
    readonly lineCountThreshold: number;
}

export const DEFAULT_LARGE_FILE_OPTIONS: ILargeFileOptions = {
    largeFileOptimizations: true,
    sizeThresholdMb: LARGE_FILE_SIZE_THRESHOLD_MB,
    lineCountThreshold: LARGE_FILE_LINE_COUNT_THRESHOLD,
};

/** Both axes are strict "above", like upstream's `>` on the buffer length and line count. */
export function isTooLargeForTokenization(valueLength: number, lineCount: number, options: ILargeFileOptions): boolean {
    if (!options.largeFileOptimizations) return false;
    return valueLength > options.sizeThresholdMb * MiB || lineCount > options.lineCountThreshold;
}
