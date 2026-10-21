/** Компоненты собираются в конструкторе; async-инициализация (диск, индексация, spawn) — только у сервисов. */
export interface IActivatable {
    activate(): Promise<void>;
}
