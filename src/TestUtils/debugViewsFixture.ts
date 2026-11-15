// Stack frames, scopes and variables for the tests of the debug views without an adapter: the children are given,
// a lazy variable resolves to what the test says.

import { DebugExpressionRenderer } from "../vs/workbench/contrib/debug/browser/debugExpressionRenderer.ts";
import type { IExpression, IScope, IStackFrame } from "../vs/workbench/contrib/debug/common/debug.ts";
import { ErrorScope, Scope, Variable } from "../vs/workbench/contrib/debug/common/debugModel.ts";

/** Rows without types, the eye as `◉`, highlights that end without a rerender. */
export function testExpressionRenderer(): DebugExpressionRenderer {
    return new DebugExpressionRenderer({
        icons: { glyph: () => "◉" },
        showVariableTypes: () => false,
        onHighlightsExpired: () => undefined,
    });
}

const NO_PARENT = { getId: () => "root" } as never;

/** A variable with the given children; `lazy` resolves to `resolved` with the children when evaluated. */
export class TestVariable extends Variable {
    public constructor(
        name: string,
        value: string,
        private readonly kids: readonly IExpression[] = [],
        options: { lazy?: { value: string }; type?: string } = {},
    ) {
        super(
            undefined,
            1,
            NO_PARENT,
            // Any positive reference has children; a lazy hint hides them until evaluated.
            kids.length,
            name,
            name,
            value,
            undefined,
            undefined,
            undefined,
            options.lazy === undefined ? undefined : { lazy: true },
            options.type,
        );
        this.resolved = options.lazy?.value ?? value;
    }

    private readonly resolved: string;

    public override getChildren(): Promise<IExpression[]> {
        return Promise.resolve([...this.kids]);
    }

    public override evaluateLazy(): Promise<void> {
        this.presentationHint = undefined;
        this.value = this.resolved;
        this.reference = this.kids.length;
        return Promise.resolve();
    }
}

class TestScope extends Scope {
    public constructor(
        frame: IStackFrame,
        index: number,
        name: string,
        expensive: boolean,
        private readonly kids: readonly IExpression[],
    ) {
        super(frame, index, name, kids.length, expensive);
    }

    public override getChildren(): Promise<IExpression[]> {
        return Promise.resolve([...this.kids]);
    }
}

export interface ITestFrame extends IStackFrame {
    /** How many times the views told it to forget its scopes. */
    readonly forgotten: number;
    /** How many times the scopes were read. */
    readonly reads: number;
}

export interface ITestScopeSpec {
    readonly name: string;
    readonly expensive?: boolean;
    readonly error?: boolean;
    readonly variables: readonly IExpression[];
}

/** A frame of thread 1 whose scopes are the given ones. */
export function testFrame(scopes: readonly ITestScopeSpec[]): ITestFrame {
    const frame = {
        forgotten: 0,
        reads: 0,
        thread: { session: undefined, threadId: 1 },
        getScopes: (): Promise<IScope[]> => {
            frame.reads++;
            return Promise.resolve(built);
        },
        forgetScopes: () => {
            frame.forgotten++;
        },
    };
    const built: IScope[] = scopes.map((spec, index) =>
        spec.error === true
            ? new ErrorScope(frame as never, index, spec.name)
            : new TestScope(frame as never, index, spec.name, spec.expensive === true, spec.variables),
    );
    return frame as unknown as ITestFrame;
}
