import { Uri } from "../../../../base/common/uri.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { DiffEditorPane2 } from "../../../browser/parts/editor/diffEditorPane2.ts";
import type { IEditorPaneFactory } from "../../../services/editor/browser/editorPaneFactory.ts";

import { diffPaneRecipe, type IDiffSideSpec, type IOpenDiffPairOptions, openDiffPair } from "./openDiffPair.ts";

/** upstream `DiffEditorInput.ID`. */
export const DIFF_EDITOR_PANE_TYPE_ID = "workbench.editors.diffEditorInput";

/** Сторона диффа в сессии — только та, что читается с диска по uri. */
interface ISerializedDiffSide {
    readonly uri: string;
    readonly label: string;
    readonly identity: string;
    readonly preferDisk?: boolean;
    readonly onMissing?: "empty" | "error";
}

interface ISerializedDiff {
    readonly original: ISerializedDiffSide;
    readonly modified: ISerializedDiffSide;
    readonly title?: string;
}

/**
 * Фабрика дифф-вкладки: рецепт — спеки сторон, по которым её открыло ядро
 * сравнения ({@link openDiffPair}). Сплит и копия в группу повторяют любую
 * такую вкладку, кроме untitled-пары (сторона-модель принадлежит одной панели).
 * Рестарт переживают только диффы файлов с диска, как у upstream
 * `DiffEditorInputSerializer` с несериализуемой стороной: снимок буфера обмена
 * не сохраняется, а `git:`-сторону на старте читать ещё некому — её провайдер
 * появляется с активацией расширения.
 */
export function createDiffEditorPaneFactory(accessor: ServiceAccessor): IEditorPaneFactory<IOpenDiffPairOptions> {
    return {
        typeId: DIFF_EDITOR_PANE_TYPE_ID,
        describe: (pane) => (pane instanceof DiffEditorPane2 ? diffPaneRecipe(pane) : undefined),
        serialize(options) {
            const original = serializeSide(options.original);
            const modified = serializeSide(options.modified);
            if (original === undefined || modified === undefined) return undefined;
            const value: ISerializedDiff = {
                original,
                modified,
                ...(options.title !== undefined ? { title: options.title } : {}),
            };
            return JSON.stringify(value);
        },
        deserialize(value) {
            const parsed = parseDiff(value);
            if (parsed === undefined) return undefined;
            return {
                original: deserializeSide(parsed.original),
                modified: deserializeSide(parsed.modified),
                ...(parsed.title !== undefined ? { title: parsed.title } : {}),
            };
        },
        async open(options, target) {
            await openDiffPair(accessor, options, target);
        },
    };
}

function serializeSide(side: IDiffSideSpec): ISerializedDiffSide | undefined {
    if (side.uri?.scheme !== "file" || side.text !== undefined || side.ownedModel !== undefined) return undefined;
    return {
        uri: side.uri.toString(),
        label: side.label,
        identity: side.identity,
        ...(side.preferDisk !== undefined ? { preferDisk: side.preferDisk } : {}),
        ...(side.onMissing !== undefined ? { onMissing: side.onMissing } : {}),
    };
}

function deserializeSide(side: ISerializedDiffSide): IDiffSideSpec {
    return {
        uri: Uri.parse(side.uri),
        label: side.label,
        identity: side.identity,
        ...(side.preferDisk !== undefined ? { preferDisk: side.preferDisk } : {}),
        ...(side.onMissing !== undefined ? { onMissing: side.onMissing } : {}),
    };
}

/** Строка сессии → рецепт; чужая или битая строка — `undefined`, а не исключение. */
function parseDiff(value: string): ISerializedDiff | undefined {
    let raw: unknown;
    try {
        raw = JSON.parse(value);
    } catch {
        return undefined;
    }
    if (typeof raw !== "object" || raw === null) return undefined;
    const obj = raw as Record<string, unknown>;
    const original = parseSide(obj.original);
    const modified = parseSide(obj.modified);
    if (original === undefined || modified === undefined) return undefined;
    return { original, modified, ...(typeof obj.title === "string" ? { title: obj.title } : {}) };
}

function parseSide(raw: unknown): ISerializedDiffSide | undefined {
    if (typeof raw !== "object" || raw === null) return undefined;
    const side = raw as Record<string, unknown>;
    if (typeof side.uri !== "string" || typeof side.label !== "string" || typeof side.identity !== "string") {
        return undefined;
    }
    return {
        uri: side.uri,
        label: side.label,
        identity: side.identity,
        ...(typeof side.preferDisk === "boolean" ? { preferDisk: side.preferDisk } : {}),
        ...(side.onMissing === "empty" || side.onMissing === "error" ? { onMissing: side.onMissing } : {}),
    };
}
