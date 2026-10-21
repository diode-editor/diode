import * as fs from "node:fs";

import { Uri } from "../../../../base/common/uri.ts";
import type { ISelection } from "../../../../editor/common/core/iSelection.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";

import type { EditorGroup } from "./editorGroupModel.ts";

export interface IEditorPaneOpenTarget {
    readonly group: EditorGroup;
    readonly focus: boolean;
}

/**
 * Lightweight counterpart of upstream `EditorInput.copy()` + `EditorPaneDescriptor.describes` + `IEditorSerializer`.
 * The descriptor is a plain object, not an input with a lifecycle: the pane owns its model via a registry reference.
 * Methods rather than function-typed fields on purpose: method parameters are bivariant, so factories of different
 * descriptor types fit in one list.
 */
export interface IEditorPaneFactory<D> {
    /** Upstream `typeId` of the matching input: a session entry finds its factory by it. */
    readonly typeId: string;

    /** Upstream `EditorInputCapabilities.Singleton`: split and copy to group do not duplicate the tab. */
    readonly singleton?: boolean;

    /** `undefined` — the tab belongs to another factory or cannot be duplicated. */
    describe(pane: IEditorPane): D | undefined;

    /** `undefined` — the tab does not survive a restart. */
    serialize(descriptor: D): string | undefined;

    /** `undefined` — can no longer be reopened (file deleted, etc.). */
    deserialize(value: string): D | undefined;

    /** If the resource is already open in the group, that tab is activated. Never rejects: the factory reports failures itself. */
    open(descriptor: D, target: IEditorPaneOpenTarget): Promise<void>;
}

/**
 * An explicit list assembled by the profile module (deviates from the upstream registry: `services/editor` does not
 * know about contrib). The factory reaches into the container lazily, in `open`: creating it does not pull in the service graph.
 */
export type EditorPaneFactoryCtor = (accessor: ServiceAccessor) => IEditorPaneFactory<unknown>;

export const EditorPaneFactoriesDIToken = token<readonly IEditorPaneFactory<unknown>[]>("EditorPaneFactories");

/** What carries over from a text tab to its copy (US-1). */
export interface ITextEditorViewState {
    readonly selections: readonly ISelection[];
    readonly scrollTop: number;
    readonly scrollLeft: number;
}

/** Restored from the session — without `viewState`. */
export interface ITextEditorPaneDescriptor {
    readonly uri: Uri;
    readonly viewState?: ITextEditorViewState;
}

/** Upstream `FILE_EDITOR_INPUT_ID`: the text factory writes only files to the session. */
export const TEXT_EDITOR_PANE_TYPE_ID = "workbench.editors.files.fileEditorInput";

export interface ITextEditorPaneFactoryHost {
    canRestore(uri: Uri): boolean;
    openUri(uri: Uri, options: { focus: boolean; group: EditorGroup; viewState?: ITextEditorViewState }): Promise<void>;
}

/**
 * An untitled buffer is not duplicated — the registry has no shared model for untitled (E3). Only files survive
 * a restart: the provider of a non-disk resource appears only once its extension activates.
 */
export function createTextEditorPaneFactory(
    host: ITextEditorPaneFactoryHost,
): IEditorPaneFactory<ITextEditorPaneDescriptor> {
    return {
        typeId: TEXT_EDITOR_PANE_TYPE_ID,
        describe(pane) {
            if (!(pane instanceof TextEditorPane)) return undefined;
            if (pane.uri.scheme === "untitled" || !host.canRestore(pane.uri)) return undefined;
            return {
                uri: pane.uri,
                viewState: {
                    selections: pane.viewState.cloneSelections(),
                    scrollTop: pane.viewState.scrollTop,
                    scrollLeft: pane.viewState.scrollLeft,
                },
            };
        },
        serialize({ uri }) {
            return uri.scheme === "file" ? uri.toString() : undefined;
        },
        deserialize(value) {
            const uri = Uri.parse(value);
            return uri.scheme === "file" && fs.existsSync(uri.fsPath) ? { uri } : undefined;
        },
        open({ uri, viewState }, { group, focus }) {
            return host.openUri(uri, { group, focus, viewState });
        },
    };
}
