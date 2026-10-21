import type { ICancellationToken } from "../../../../base/common/cancellation.ts";

/**
 * Merges calls of several providers with the SAME request object into one RPC: the request still
 * carries the full document text (deltas are task G3), and N providers would mean N copies per keystroke.
 * "Same request" means object identity: two keystrokes are two objects.
 */
export class ProviderRequestBatcher<TRequest extends object, TResult> {
    private pending: IBatch<TRequest, TResult> | null = null;

    /**
     * @param send results are aligned with `handles`; `token` cancels the batch's first call
     *   (the consumer hands one token to all providers)
     * @param empty the answer for a provider that got no result
     */
    public constructor(
        private readonly send: (
            handles: readonly number[],
            request: TRequest,
            token: ICancellationToken | undefined,
        ) => Promise<readonly TResult[]>,
        private readonly empty: TResult,
    ) {}

    public call(handle: number, request: TRequest, token?: ICancellationToken): Promise<TResult> {
        const batch = this.pending?.request === request ? this.pending : this.open(request, token);
        const index = batch.handles.push(handle) - 1;
        return batch.results.then((results) => results.at(index) ?? this.empty);
    }

    private open(request: TRequest, token: ICancellationToken | undefined): IBatch<TRequest, TResult> {
        const handles: number[] = [];
        // Sent in a microtask: the consumer's synchronous pass has already added every handle to
        // the batch. Only the last batch is open; an earlier one doesn't close it.
        const batch: IBatch<TRequest, TResult> = {
            request,
            handles,
            results: Promise.resolve().then(() => {
                if (this.pending === batch) this.pending = null;
                return this.send(handles, request, token);
            }),
        };
        this.pending = batch;
        return batch;
    }
}

interface IBatch<TRequest, TResult> {
    readonly request: TRequest;
    readonly handles: number[];
    readonly results: Promise<readonly TResult[]>;
}
