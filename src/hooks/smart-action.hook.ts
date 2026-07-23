import { useCallback, useEffect, useOptimistic, useRef, useState, useTransition } from "react"
import type { SmartActionOptions, SmartActionReturn } from "../types"

/**
 * Внутренний тип для reducer: сохраняет payload для выполнения оптимистичного обновления
 */
type ActionPayload<Payload> = {
    payload: Payload
}

/**
 * Универсальный хук-комбайн для управления сложными асинхронными операциями.
 * Поддерживает кастомные оптимистичные обновления, защиту от спама (Debounce) и автоматические повторы (Retry)
 * 
 * @param initialState - Исходное состояние из родителя или сервера.
 * @param options - Настройки запроса, updater, debounce и retries
 */
export const useSmartAction =
    <State, Payload = void>(
        initialState: State,
        options: SmartActionOptions<State, Payload>
    ): SmartActionReturn<State, Payload> => {
        const {
            action,
            optimisticUpdater,
            debounceMs = 0,
            retries = 0,
            retryDelayMs = 1000,
            onSuccess,
            onError,
            onSettled
        } = options

        const [localState, setLocalState] = useState<State>(initialState)

        useEffect(() => {
            setLocalState(initialState)
        }, [initialState])

        const [error, setError] = useState<Error | null>(null)
        const [attemptCount, setAttemptCount] = useState<number>(0)
        const [isPending, startTransition] = useTransition()

        const isMountedRef = useRef<boolean>(true)
        const actionIdRef = useRef<number>(0)
        const cancelDebounceRef = useRef<(() => void) | null>(null)

        useEffect(() => {
            isMountedRef.current = true

            return () => {
                isMountedRef.current = false
                if (cancelDebounceRef.current) {
                    cancelDebounceRef.current()
                }
            }
        }, [])

        const [optimisticState, setOptimisticState] = useOptimistic<State, ActionPayload<Payload>>(
            localState,
            (currentState, { payload }) => {
                return optimisticUpdater ? optimisticUpdater(currentState, payload) : currentState
            }
        )

        const executeWithRetry = useCallback(
            async (payload: Payload): Promise<void> => {
                if (!isMountedRef.current) return

                let currentAttempt = 0

                try {
                    while (currentAttempt <= retries) {
                        if (!isMountedRef.current) return

                        setAttemptCount(currentAttempt + 1)

                        try {
                            const result = await action(payload)

                            if (isMountedRef.current) {
                                onSuccess?.(result, payload)
                                setError(null)
                                if (optimisticUpdater) {
                                    setLocalState(prev => optimisticUpdater(prev, payload))
                                }
                            }

                            return
                        } catch (err) {
                            if (!isMountedRef.current) return

                            const errorObj = err instanceof Error ? err : new Error(String(err))

                            if (currentAttempt < retries) {
                                currentAttempt++
                                await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
                                continue
                            }

                            setError(errorObj)
                            onError?.(errorObj, payload)
                            throw errorObj
                        }
                    }
                } finally {
                    if (isMountedRef.current) {
                        onSettled?.()
                    }
                }
            },
            [action, retries, retryDelayMs, onSuccess, onError, onSettled, optimisticUpdater]
        )

        const clearError = useCallback(() => {
            setError(null)
        }, [])

        const execute = useCallback(
            (payload: Payload) => {
                setError(null)

                if (cancelDebounceRef.current) {
                    cancelDebounceRef.current()
                }

                const currentId = ++actionIdRef.current

                startTransition(async () => {
                    setOptimisticState({ payload })

                    if (debounceMs > 0) {
                        await new Promise<void>((resolve) => {
                            const timer = setTimeout(() => {
                                cancelDebounceRef.current = null
                                resolve()
                            }, debounceMs)

                            cancelDebounceRef.current = () => {
                                clearTimeout(timer)
                                resolve()
                            }
                        })
                    }

                    if (currentId !== actionIdRef.current) {
                        return
                    }

                    try {
                        await executeWithRetry(payload)
                    } catch {}
                })
            },
            [debounceMs, executeWithRetry, setOptimisticState]
        )

        return {
            state: optimisticState,
            execute,
            clearError,
            meta: {
                isPending,
                error,
                attemptCount
            }
        }
    }
