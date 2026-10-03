import { token } from "../../instantiation/common/diContainer.ts";

/**
 * Окружение процесса: где лежат user data, куда ставятся расширения, откуда
 * берётся реестр. Аналог `IEnvironmentService` vscode
 * (`platform/environment/common/environment.ts`) — и, как у них, **держим
 * интерфейс как можно меньше**: сюда попадает только то, что нужно сервисам за
 * пределами bootstrap'а, а не всё, что знает резолвер путей.
 *
 * Пути — абсолютные строки (у нас всё на диске, без URI-схем). В тестах
 * окружение тоже полное — пути во временном каталоге, которых может не быть;
 * `null`-путей «неизвестно» нет.
 *
 * Профиль фиксирован на процесс (`--profile`, смена = перезапуск), поэтому его
 * ресурсы лежат здесь же, а не в отдельном сервисе профилей, как у vscode
 * (`IUserDataProfileService.currentProfile`), где профиль переключается на лету.
 */
export interface IEnvironmentService {
    // ── Приложение ──────────────────────────────────────────────

    /** Корень user data (`--user-data-dir`, по умолчанию `~/.diode`). */
    readonly userDataRoot: string;
    /** Каталог внешних расширений: `<root>/extensions` либо `--extensions-dir`. */
    readonly extensionsDir: string;
    /** `<root>/user-data/logs` — родитель `ExtensionContext.logUri` расширений. */
    readonly logsDir: string;
    /** `--registry`: каталог или URL реестра расширений; `undefined` — публичный магазин Diode. */
    readonly registry: string | undefined;

    // ── Активный профиль ────────────────────────────────────────

    /** settings.json активного профиля. */
    readonly settingsResource: string;
    /** keybindings.json активного профиля. */
    readonly keybindingsResource: string;
    /** `<profileDir>/globalStorage` — родитель `ExtensionContext.globalStorageUri`. */
    readonly globalStorageDir: string;
    /** `<profileDir>/workspaceStorage` — корень per-project состояния и `storageUri` расширений. */
    readonly workspaceStorageDir: string;
    /** `<profileDir>/secrets.json` — хранилище `ExtensionContext.secrets`. */
    readonly secretsFile: string;
}

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const IEnvironmentServiceDIToken = token<IEnvironmentService>("EnvironmentService");
