/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/base/common/lazy.ts
// Не дословно: upstream кладёт `unknown` из `catch` в `Error | undefined`, наш strict это не пускает.

const enum LazyValueState {
    Uninitialized,
    Running,
    Completed,
}

export class Lazy<T> {
    private state = LazyValueState.Uninitialized;
    private resolved?: T;
    private error: { readonly thrown: unknown } | undefined;

    public constructor(private readonly executor: () => T) {}

    /**
     * True if the lazy value has been resolved.
     */
    public get hasValue(): boolean {
        return this.state === LazyValueState.Completed;
    }

    /**
     * Get the wrapped value.
     *
     * This will force evaluation of the lazy value if it has not been resolved yet. Lazy values are only
     * resolved once. `getValue` will re-throw exceptions that are hit while resolving the value
     */
    public get value(): T {
        if (this.state === LazyValueState.Uninitialized) {
            this.state = LazyValueState.Running;
            try {
                this.resolved = this.executor();
            } catch (err) {
                this.error = { thrown: err };
            } finally {
                this.state = LazyValueState.Completed;
            }
        } else if (this.state === LazyValueState.Running) {
            throw new Error("Cannot read the value of a lazy that is being initialized");
        }

        if (this.error) {
            throw this.error.thrown;
        }
        return this.resolved as T;
    }

    /**
     * Get the wrapped value without forcing evaluation.
     */
    public get rawValue(): T | undefined {
        return this.resolved;
    }
}
