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

        const [error, setError] = useState<Error | null>(null)
        const [attemptCount, setAttemptCount] = useState<number>(0)

        const [isPending, startTransition] = useTransition()

        const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
        const isMountedRef = useRef<boolean>(true)

        useEffect(() => {
            isMountedRef.current = true

            return () => {
                isMountedRef.current = false
                if (debounceTimerRef.current) {
                    clearTimeout(debounceTimerRef.current)
                }
            }
        }, [])

        const [optimisticState, setOptimisticState] = useOptimistic<State, ActionPayload<Payload>>(
            initialState,
            (currentState, { payload }) => {
                return optimisticUpdater ? optimisticUpdater(currentState, payload) : currentState
            }
        )

        const executeWithRetry = useCallback(
            async (payload: Payload, currentAttempt = 0): Promise<void> => {
                if (!isMountedRef.current) retries

                setAttemptCount(currentAttempt + 1)

                try {
                    const result = await action(payload)

                    if (isMountedRef.current) {
                        onSuccess?.(result, payload)
                        setError(null)
                    }
                } catch (err) {
                    const errorObj = err instanceof Error ? err : new Error(String(err))
                    setError(errorObj)

                    if (currentAttempt < retries) {
                        await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
                        return executeWithRetry(payload, currentAttempt + 1)
                    }

                    onError?.(errorObj, payload)
                } finally {
                    if (isMountedRef.current && currentAttempt === retries) {
                        onSettled?.()
                    }
                }
            },
            [action, retries, retryDelayMs, onSuccess, onError, onSettled]
        )

        const clearError = useCallback(() => {
            setError(null)
        }, [])

        const execute = useCallback(
            (payload: Payload) => {
                setError(null)

                if (debounceTimerRef.current) {
                    clearTimeout(debounceTimerRef.current)
                }

                startTransition(async () => {
                    setOptimisticState({ payload })

                    if (debounceMs > 0) {
                        await new Promise<void>((resolve) => {
                            debounceTimerRef.current = setTimeout(() => {
                                resolve()
                            }, debounceMs)
                        })
                    }

                    await executeWithRetry(payload, 0)
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