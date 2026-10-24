/** `\n`. */
const LINE_FEED = 0x0a;

/**
 * Byte offsets where lines start, appended block by block as the file is scanned. Four bytes per line: each
 * block holds `Uint32` offsets relative to its own base, so the file size is not limited to 4 GB and a 2 GB
 * log of 20M lines costs ~80 MB, not 160 (klogg stores its line ends the same way). A lookup is a binary search
 * over the blocks (hundreds) and a direct index inside.
 */
export class LineStartIndex {
    private readonly blocks: Uint32Array[] = [];
    /** `blockFirstLine[i]` is the index of the first line start kept in `blocks[i]`. */
    private readonly blockFirstLine: number[] = [];
    private readonly blockBase: number[] = [];
    private countValue = 0;

    /** Line starts recorded so far; the first one is recorded by the caller (`append(0)` or the BOM length). */
    public get count(): number {
        return this.countValue;
    }

    /** One line start. Offsets must come in ascending order. */
    public append(offset: number): void {
        const block = new Uint32Array(1);
        block[0] = 0;
        this.pushBlock(block, offset);
    }

    /**
     * Records the start of every line that begins inside `chunk` (the byte after each `\n`), which lies at
     * `chunkOffset` in the file. Returns how many were recorded.
     */
    public appendChunk(chunk: Uint8Array, chunkOffset: number): number {
        const starts: number[] = [];
        let from = 0;
        // One `indexOf` per line, leaving at the first miss. `some` over the bytes bounds the scan without a
        // counter a mutant could stall (docs/MUTATION.md); the bytes themselves are never visited.
        chunk.some(() => {
            const at = indexOfLineFeed(chunk, from);
            if (at === -1) return true;
            from = at + 1;
            starts.push(from);
            return false;
        });
        // Stryker disable next-line ConditionalExpression: an empty block has the first line past every recorded one and is never found; the return only skips it
        if (starts.length === 0) return 0;
        this.pushBlock(Uint32Array.from(starts), chunkOffset);
        return starts.length;
    }

    /** Offset of line `line`'s first byte; `line` must be below {@link count}. */
    public lineStart(line: number): number {
        if (line < 0 || line >= this.countValue) {
            throw new RangeError(`Line ${String(line)} is not indexed (${String(this.countValue)} line starts)`);
        }
        const blockIndex = this.blockOf(line);
        return this.blockBase[blockIndex] + this.blocks[blockIndex][line - this.blockFirstLine[blockIndex]];
    }

    private pushBlock(block: Uint32Array, base: number): void {
        this.blocks.push(block);
        this.blockFirstLine.push(this.countValue);
        this.blockBase.push(base);
        this.countValue += block.length;
    }

    /** The last block whose first line is at or before `line`: a binary search over `blockFirstLine`. */
    private blockOf(line: number): number {
        // Stryker disable next-line ArithmeticOperator: past the last block `blockFirstLine[middle]` is undefined, which is never ≤ line, so a wider range ends at the same block
        return this.searchBlock(line, 0, this.blocks.length - 1);
    }

    /** Recursive (depth log2 of hundreds of blocks), so a broken step overflows the stack instead of spinning. */
    private searchBlock(line: number, low: number, high: number): number {
        if (low >= high) return low;
        const middle = (low + high + 1) >>> 1;
        return this.blockFirstLine[middle] <= line
            ? this.searchBlock(line, middle, high)
            : this.searchBlock(line, low, middle - 1);
    }
}

/** `Buffer.indexOf` when the chunk is a Buffer (memchr); a plain `Uint8Array` is walked by hand (tests). */
function indexOfLineFeed(chunk: Uint8Array, from: number): number {
    return chunk.indexOf(LINE_FEED, from);
}
