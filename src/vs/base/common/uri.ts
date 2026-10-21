import { URI, Utils } from "vscode-uri";

/**
 * `vscode-uri` — upstream-реализация, не порт; она же `vscode.Uri` в субпроцессе.
 * Статик `joinPath` дописан через `Object.assign`, чтобы `instanceof` в
 * расширениях не сломался. `fsPath` на не-file схемах не бросает
 * (`untitled:Untitled-1` → `"Untitled-1"`): дисковые операции гейтить по `scheme`.
 */
export const Uri = Object.assign(URI, { joinPath: Utils.joinPath });

export type Uri = URI;
