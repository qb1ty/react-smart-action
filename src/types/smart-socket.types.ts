import type { Dispatch, SetStateAction } from "react";

/**
 * Возможные состояние соединения WebSocket
 */
export type WebSocketStatus = "CONNECTING" | "OPEN" | "CLOSING" | "CLOSED"

/**
 * Контроллеры для передачи в обработчик onMessage,
 * нужны для управления оптимистичного состояния.
 */
export interface SocketMessageControls<State> {
    /** Подтвердить успешность операции и удалить последний снимок отката */
    confirm: () => void
    /** Откатить состояние UI к предыдущему снимку (если backend вернул ошибку в теле сообщения) */
    rollback: (error?: Error | string) => void
    /** Перманентно обновить подтвержденное состояние (напрмер, пришел свежий массив данных)  */
    updateState: Dispatch<SetStateAction<State>>
    /** Запустить повторную синхронизацию данных (resync) прямо из обработчика сообщения */
    resync: () => Promise<void> | void
}

/**
 * Опции настройки для хука useSmartSocket
 */
export interface SmartSocketOptions<State, Payload, ServerResponse = unknown> {
    /** URL сокета. Может быть строкой или асинхронной функцией */
    url: string | (() => string | Promise<string>)
    /** Включить/выключить автоматическое подключение при монтировании (по умолчанию: true) */
    enabled?: boolean
    /** Протоколы WebSocket (например, "wss" или массив протоколов) */
    protocols?: string | string[]

    /** Настройки автоматического переподключения при сбоях */
    reconnect?: boolean
    maxRetries?: number
    reconnectIntervalMs?: number

    /** Автоматически вызывать onResync при успешном восстановлении оборвоннаго соединения */
    resyncOnReconnect?: boolean

    /**
     * Функция синхронизации. Вызывается при reconnect или вручную через resync().
     * Идеально подходит для HTTP-запроса актуальных данных или отправки команды "SYNC" в сокет.
     */
    onResync?: (controls: {
        updateState: Dispatch<SetStateAction<State>>
        sendRaw: (data: string | ArrayBuffer | Blob) => void
        emit: (payload: Payload) => void
    }) => Promise<void> | void

    /** Время в мс, сколько ждем подтверждения (confirm) от сервера. Если время вышло - автоматический откат */
    ackTimeoutMs?: number
    /** Callback, срабатывающий, если сервер не успел подтвердить операцию за ackTimeoutMs */
    onAckTimeout?: (error: Error, revertedState: State) => void

    /** Оптимистичный updater: как UI должен измениться мгновенно при вызове emit(payload) */
    optimisticUpdater?: (currentState: State, payload: Payload) => State

    /** Касстомная сериализация перед отправкой (по умолчанию JSON.stringify) */
    serialize?: (payload: Payload) => string | ArrayBuffer | Blob
    /** Касстомная десериализация входящих данных (по умолчанию JSON.parse)  */
    deserialize?:  (raw: MessageEvent["data"]) => unknown

    /**
     * Валидатор ответа от backend
     * Если вернет false или выбросит ошибку - сообщения отклоняется и вызывается onValidationError.
     */
    validateResponse?: (data: unknown) => data is ServerResponse
    /** Обработчик невалидных сообщений (если пришел мусор или не тот формат) */
    onValidationError?: (error: Error, rawData: unknown) => void

    /** Главный обработчик валидных сообщении от сервера */
    onMessage?: (response: ServerResponse, controls: SocketMessageControls<State>) => void

    /** Жизненный цикл соединения */
    onOpen?: (event: Event) => void
    onClose?: (event: CloseEvent) => void
    onError?: (event: Event | Error) => void

    /** Callback, срабатывающий при откате состояние к стабильному */
    onRollback?: (error: Error, restoredState: State) => void
}

/** 
 * Возвращаемый объект хука useSmartSocket
 */
export interface SmartSocketReturn<State, Payload> {
    /** Текущее состояние (включая временные оптимистичные обновления) */
    state: State
    /** Отправить данные с оптимистичным обновления UI и обновления таймера TTL */
    emit: (payload: Payload) => void
    /** Отправить сырые данные в сокет без оптимистчиного обновления UI */
    sendRaw: (data: string | ArrayBuffer | Blob) => void
    /** Вручную зафиксировать текущее состояние как новый стабильный якорь (O(1)) */
    confirm: () => void
    /** Вручную откатить UI назад к Стабильному якорю (O(1)) */
    rollback: (err?: Error | string) => void
    /** Вручную вызвать функцию onResync для принудительного обновления данных от сервера */
    resync: () => Promise<void> | void
    /** Принудительно открыть соединение */
    connect: () => void
    /** Принудительно закрыть соединение */
    disconnect: () => void
    /** Метаданные о работе сокета и транзакции React */
    meta: {
        isPending: boolean
        status: WebSocketStatus
        error: Error | null
        /** UI прямо сейчас находится в неподтвержденном оптимистичном состоянии */
        isOptimistic: boolean
        /** В данный момент выполняется асинхронная функция onResync */
        isResyncing: boolean
        reconnectAttempts: number
    }
}