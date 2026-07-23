import { useCallback, useOptimistic, useState, useTransition } from "react";
import type { OptimisticToggleOptions, OptimisticToggleReturn } from "../types";

/**
 * Хук для мгновенного оптимистичного переключения булевых состояний
 * 
 * @param initialState - Текущее состояние, пришедшее из пропсов или сервера.
 * @param onToggle - Асинхронная функция, отправляющая новое состояние на сервер.
 * @param options - Дополнительные коллбеки (onSuccess, onError, onSettled)
 * @returns Кортеж [isOptimistic, toggleFn, { isPending, error }]
 */

export const useOptimisticToggle =
    (
        initialState: boolean,
        onToggle: (nextState: boolean) => Promise<unknown> | void,
        options?: OptimisticToggleOptions
    ): OptimisticToggleReturn => {
        const [error, setError] = useState<Error | null>(null)
        
        const [isPending, startTransition] = useTransition()
        const [optimisticState, setOptimisticState] = useOptimistic<boolean, boolean>(
            initialState,
            (_currentState, nextState) => nextState
        )

        const toggle = useCallback(() => {
            setError(null)

            const nextState = !optimisticState

            startTransition(async () => {
                setOptimisticState(nextState)

                try {
                    await onToggle(nextState)

                    options?.onSuccess?.(nextState)
                } catch (err) {
                    const errorObj = err instanceof Error ? err : new Error(String(err))

                    setError(errorObj)

                    options?.onError?.(errorObj, nextState)
                } finally {
                    options?.onSettled?.(nextState)
                }
            })
        }, [optimisticState, onToggle, options, setOptimisticState])

        return [
            optimisticState,
            toggle,
            { isPending, error }
        ]
    }
