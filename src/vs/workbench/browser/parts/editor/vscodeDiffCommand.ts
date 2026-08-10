import type { Uri } from "../../../../base/common/uri.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { reviveWireUri } from "../../../api/common/wireTypes.ts";
import {
    FileSystemProviderRegistryDIToken,
    LanguageServiceDIToken,
    TokenizationRegistryDIToken,
    TokenStyleResolverDIToken,
} from "../../../common/coreTokens.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";

import { DiffEditorPane } from "./diffEditorPane.ts";

/**
 * Читает текст ресурса: открытый буфер (живые правки важнее диска) → реестр
 * провайдеров ФС (роутинг по схеме — git:/file:); недоступный ресурс — пусто.
 */
async function readSide(accessor: ServiceAccessor, uri: Uri): Promise<string> {
    const editors = accessor.get(EditorServiceDIToken);
    const pane = editors
        .getEditors()
        .find((candidate) => candidate.uri.toString() === uri.toString());
    if (pane !== undefined) return pane.getText();
    try {
        const bytes = await accessor.get(FileSystemProviderRegistryDIToken).readFile(uri);
        return new TextDecoder().decode(bytes);
    } catch {
        return "";
    }
}

function basename(uri: Uri): string {
    return uri.path.slice(uri.path.lastIndexOf("/") + 1);
}

/**
 * `vscode.diff` — стандартная команда VS Code, которую расширения зовут через
 * `commands.executeCommand("vscode.diff", left, right, title?, options?)`:
 * открывает дифф-вкладку `left ↔ right`. Uri приезжают JSON-компонентами
 * (`Uri.toJSON()` → `{$mid, scheme, path, …}`) либо строками —
 * {@link reviveWireUri}. `options.viewColumn` не поддержан (открытие в активной
 * группе; расширение может сфокусировать группу заранее через
 * `window.showTextDocument`).
 */
export const vscodeDiffCommand: CommandAction = {
    id: "vscode.diff",
    title: "Compare Two Resources",
    run(accessor, ...args) {
        // Из субпроцесса аргументы приходят одним массивом (`{id, args}`),
        // из ядра — varargs: нормализуем оба входа.
        const list = args.length === 1 && Array.isArray(args[0]) ? (args[0] as unknown[]) : args;
        const left = reviveWireUri(list[0]);
        const right = reviveWireUri(list[1]);
        if (left === null || right === null) return;
        const title = typeof list[2] === "string" ? list[2] : `${basename(left)} ↔ ${basename(right)}`;
        void (async () => {
            const editors = accessor.get(EditorServiceDIToken);
            const [originalText, modifiedText] = await Promise.all([
                readSide(accessor, left),
                readSide(accessor, right),
            ]);
            const languageId =
                accessor.get(LanguageServiceDIToken).getLanguageIdForResource(right.fsPath) ?? "plaintext";
            const input = {
                // Идентичность вкладки — пара ресурсов: повторный diff тех же
                // сторон обновляет вкладку на месте (снимок), а не плодит новые.
                uri: right.with({ scheme: "vexx-diff", query: `vs:${left.toString()}` }),
                label: title,
                originalText,
                modifiedText,
                languageId,
                originalUri: left,
                modifiedUri: right,
            };
            const existing = editors.getPanes().find((pane) => pane.uri.toString() === input.uri.toString());
            if (existing instanceof DiffEditorPane) {
                existing.setInput(input);
                editors.activateTab(editors.getPanes().indexOf(existing));
                return;
            }
            editors.openPane(
                new DiffEditorPane(
                    accessor.get(TokenizationRegistryDIToken),
                    accessor.get(TokenStyleResolverDIToken),
                    input,
                ),
            );
        })();
    },
};
