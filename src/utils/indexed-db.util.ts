import { QueueItem } from "../types"

const DB_NAME = "react-smart-action-db"
const STORE_NAME = "offline-mutation"
const DB_VERSION = 1

let dbInstance: IDBDatabase | null = null

/**
 * Динамический геттер для IndexedDB.
 * Позволяет безопасно работать в браузере (window),
 * обходить ошибки в SSR, ISR, SSG (Next Js) и корректно цеплять полифилы в тестах (globalThis).
 */
export const getIDB = (): IDBFactory | null => {
    if (typeof window !== "undefined" && window.indexedDB) {
        return window.indexedDB
    }

    if (typeof globalThis !== "undefined" && globalThis.indexedDB) {
        return globalThis.indexedDB
    }

    return null
}

/**
 * Принудительное закрытие соединения.
 */
export const closeDB = (): void => {
    if (dbInstance) {
        dbInstance.close()
        dbInstance = null
    }
}

/**
 * Инициализирует подключения к IndexedDB.
 * Создает базу данных и таблицу (store), если они еще не существуют.
 * а также настраивает индексы для быстрого поиска.
 * 
 * @returns {Promise<IDBDatabase>} Объект активного подключения к базе данных.
 */
export const initDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        if (dbInstance) {
            return resolve(dbInstance)
        }

        const idb = getIDB()

        if (!idb) {
            return reject(new Error("IndexedDB is not available in this environment."))
        }

        const request = idb.open(DB_NAME, DB_VERSION)

        request.onerror = () => reject(request.error)

        request.onsuccess = () => {
            dbInstance = request.result

            dbInstance.onclose = () => {
                dbInstance = null
            }

            dbInstance.onversionchange = () => {
                dbInstance?.close()
                dbInstance = null
            }

            resolve(dbInstance)
        }

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result

            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: "id" })

                store.createIndex("mutationKey", "mutationKey", { unique: false })
                store.createIndex("timestamp", "timestamp", { unique: false })
            }
        }
    })
}

/**
 * Вспомогательная функция для открытия транзакции с гарантией ACID.
 * Promise resolve только после физического commit на диск (событие oncomplete).
 * 
 * @param mode - Режим транзакции: "readonly" (только чтение) или "readwrite" (чтение и запись)
 * @param callback - Функция, в которой выполняется операции с базой. Принимает store, функцию для сохранения результат и функцию для перехвата ошибок.
 * @returns {Promise<T>} Promise, который содержит итоговый результат выполнения транзакции.
 */
export const withStore = async <T>(
    mode: IDBTransactionMode,
    callback: (store: IDBObjectStore, resolve: (value: T) => void, reject: (error: Error) => void) => void
): Promise<T> => {
    const db = await initDB()

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode)
        const store = transaction.objectStore(STORE_NAME)

        let finalResult: T

        transaction.oncomplete = () => {
            resolve(finalResult)
        }

        transaction.onerror = () => {
            reject(transaction.error || new Error("IndexedDB Transaction failed"))
        }

        try {
            callback(store, (value: T) => { finalResult = value }, reject)
        } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)))
        }
    })
}

/**
 * Получения очереди невыполненных задач.
 * Забирает все записи для указанного ключа и строго сортирует их по времени создания (FIFO)
 * 
 * @param mutationKey - Уникальный идентификатор очереди ("update-profile")
 * @returns {Promise<QueueItem<Payload>[]>} Promise с отсортированным массивом задач, ожидающих синхронизации.
 */
export const getQueue = async <Payload>(
    mutationKey: string  
): Promise<QueueItem<Payload>[]> => {
    if (!getIDB()) return []

    return withStore<QueueItem<Payload>[]>("readonly", (store, setResult) => {
        const index = store.index("mutationKey")
        const request = index.getAll(mutationKey)

        request.onsuccess = () => {
            const sorted = (request.result as QueueItem<Payload>[]).sort((a, b) => a.timestamp - b.timestamp)
            setResult(sorted)
        }
    })
}

/**
 * Добавление новой задачи в очередь с поддержкой дедупликации (схлопывание).
 * Если передена функция "squash" и найдено совпадение, старая задача перезаписывается новым
 * сдвигаясь в конец очереди.
 * 
 * @param item - Готовый объект задачи для сохранения в IndexedDB.
 * @param squash - Опциональная функция-предикат для поиска дубликатов. Если возвращает true.
 * @returns {Promise<void>} Promise, который resolve после успешной записи на диск.
 */
export const pushToQueue = async <Payload>(
    item: QueueItem<Payload>,
    squash?: (prevPayload: Payload, nextPayload: Payload) => boolean
) => {
    if (!getIDB()) return

    return withStore<void>("readwrite", (store) => {
        if (!squash) {
            store.add(item)
            return
        }

        const index = store.index("mutationKey")
        const getReq = index.getAll(item.mutationKey)

        getReq.onsuccess = () => {
            const currentQueue = getReq.result as QueueItem<Payload>[]

            const targetIndex = currentQueue.length > 0
                ? currentQueue.findLastIndex(existing => squash(existing.payload, item.payload))
                : -1

            if (targetIndex !== -1) {
                const targetTask = currentQueue[targetIndex]
                const updatedTask: QueueItem<Payload> = {
                    ...targetTask,
                    payload: item.payload,
                    timestamp: item.timestamp,
                    status: "queued",
                    retryCount: 0,
                    lastError: null
                }

                store.put(updatedTask)
            } else {
                store.add(item)
            }
        }
    })
}

/**
 * Точечное обновление существующей задачи в очереди.
 * Используется движком для смены статусов (например, "syncing" -> "failed") и обновления счетчика попыток.
 * 
 * @param id - Уникальный UUID задачи в IndexedDB.
 * @param updates - Объект с полями, которые нужно обновить (Partial).
 * @returns {Promise<void>} Promise, который resolve после успешного применения изменений на диске.
 */
export const updatedTask = async <Payload>(
    id: string,
    updates: Partial<QueueItem<Payload>>
): Promise<void> => {
    if (!getIDB()) return

    return withStore<void>("readwrite", (store, _, reject) => {
        const getReq = store.get(id)

        getReq.onsuccess = () => {
            if (!getReq.result) {
                return reject(new Error(`Task with id ${id} not found`))
            }

            const updatedTask = { ...getReq.result, ...updates }
            store.put(updatedTask)
        }
    })
}

/**
 * Удаление одной задачи из базы данных.
 * Вызывается после успешной отправки на сервер или при ручной отмене задачи пользователем.
 * 
 * @param id - Уникальный UUID задачи, которую нужно удалить.
 * @returns {Promise<void>} Promise, который resolve после успешного удаления записи.
 */
export const removeTask = async (id: string): Promise<void> => {
    if (!getIDB()) return

    return withStore<void>("readwrite", (store) => {
        store.delete(id)
    })
}

/**
 * Полная очистка очереди для конкретного ключа мутации.
 * Сбрасывает все зависшие задачи, связанные с этим ключом.
 * 
 * @param mutationKey - Уникальный идентификатор очереди, которую нужно очистить.
 * @returns {Promise<void>} Promise, который resolve после удаления всех связанных записей.
 */
export const clearQueue = async (mutationKey: string): Promise<void> => {
    if (!getIDB()) return

    return withStore<void>("readwrite", (store) => {
        const index = store.index("mutationKey")
        const req = index.openCursor(IDBKeyRange.only(mutationKey))

        req.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result

            if (cursor) {
                cursor.delete()
                cursor.continue()
            }
        }
    })
}