import { token } from "../../instantiation/common/diContainer.ts";

/**
 * Как `IEnvironmentService` vscode, **держим интерфейс как можно меньше**: только то,
 * что нужно сервисам за пределами bootstrap'а. Пути — абсолютные строки, без URI.
 * Профиль фиксирован на процесс (смена = перезагрузка окна), поэтому его ресурсы
 * лежат здесь; у vscode профиль переключается на лету.
 */
export interface IEnvironmentService {
    readonly userDataRoot: string;
    readonly extensionsDir: string;
    readonly logsDir: string;
    /** `undefined` — публичный магазин Diode. */
    readonly registry: string | undefined;
    /** Для `~` в путях, которые вводит человек. */
    readonly userHome: string;

    readonly settingsResource: string;
    readonly keybindingsResource: string;
    readonly globalStorageDir: string;
    readonly workspaceStorageDir: string;
    readonly secretsFile: string;
}

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const IEnvironmentServiceDIToken = token<IEnvironmentService>("EnvironmentService");
