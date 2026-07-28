import { useCallback, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import type { SmartSocketOptions, SmartSocketReturn, WebSocketStatus } from "../types";

/**
 * Специализированый хук для управления реального времени (Real-Time) соединениями WebSocket в React 19.
 * Обеспечивает мгновенный оптимистичный UI с нулевой нагрузкой на память (O(1) Стабильный Якорь),
 * автоматический reconnect, защиту от зависших состояний (TTL/ACK таймеры) и механизм ручного/автоматического Resync.
 * 
 * @param initialState - Исходное или последнее подтверждённое сервером состояние (Golden Anchor).
 * @param options - Настройки WebSocket соединения, сериализации, валидации ответов и таймеров.
 */
export const useSmartSocket =
    <State, Payload = unknown, ServerResponse = unknown>(
        initialState: State,
        options: SmartSocketOptions<State, Payload, ServerResponse>
    ): SmartSocketReturn<State, Payload> => {
        const { url, enabled = true, protocols } = options

        const fullOptions = {
            reconnect: true,
            maxRetries: 5,
            reconnectIntervalMs: 2000,
            resyncOnReconnect: true,
            ackTimeoutMs: 0,
            serialize: JSON.stringify,
            deserialize: (raw: MessageEvent["data"]) => (typeof raw === "string" ? JSON.parse(raw) : raw),
            ...options
        }

        const optionsRef = useRef(fullOptions)
        optionsRef.current = fullOptions

        const [confirmedState, setConfirmedState] = useState<State>(initialState)
        const [error, setError] = useState<Error | null>(null)
        const [status, setStatus] = useState<WebSocketStatus>("CLOSED")
        const [reconnectAttempts, setReconnectAttempts] = useState<number>(0)
        const [isOptimistic, setIsOptimistic] = useState<boolean>(false)
        const [isResyncing, setIsResyncing] = useState<boolean>(false)

        const [isPending, startTransition] = useTransition()

        const reconnectAttemptsRef = useRef<number>(0)
        const lastStableStateRef = useRef<State>(initialState)
        const confirmedStateRef = useRef<State>(initialState)
        const isOptimisticRef = useRef<boolean>(false)
        const errorRef = useRef<Error | null>(null)
        const wsRef = useRef<WebSocket | null>(null)
        const isMountedRef = useRef<boolean>(true)
        const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
        const ackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

        useEffect(() => {
            confirmedStateRef.current = confirmedState
        }, [confirmedState])

        useEffect(() => {
            isOptimisticRef.current = isOptimistic
        }, [isOptimistic])

        useEffect(() => {
            errorRef.current = error
        }, [error])

        useEffect(() => {
            setConfirmedState(initialState)
            lastStableStateRef.current = initialState
            confirmedStateRef.current = initialState
        }, [initialState])

        const [optimisticState, setOptimisticState] = useOptimistic<State, Payload>(
            confirmedState,
            (current, payload) => {
                const updater = optionsRef.current.optimisticUpdater
                return updater ? updater(current, payload) : (payload as unknown as State)
            }
        )

        const clearAckTimer = useCallback(() => {
            if (ackTimerRef.current) {
                clearTimeout(ackTimerRef.current)
                ackTimerRef.current = null
            }
        }, [])

        const confirm = useCallback(() => {
            clearAckTimer()
            setIsOptimistic(false)
            lastStableStateRef.current = confirmedStateRef.current
        }, [clearAckTimer])

        const rollback = useCallback((err?: Error | string | null) => {
            clearAckTimer()
            setIsOptimistic(false)

            const errorObj = typeof err === "string" ? new Error(err) : err || new Error("WebSocket Rollback")
            setError(errorObj)

            startTransition(() => {
                setConfirmedState(lastStableStateRef.current)
            })

            optionsRef.current.onRollback?.(errorObj, lastStableStateRef.current)
        }, [clearAckTimer])

        const sendRaw = useCallback((data: string | ArrayBuffer | Blob) => {
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(data)
            } else {
                console.warn("[useSmartSocket]: Attempt to send sendRaw to a closed socket")
            }
        }, [])

        const emit = useCallback((payload: Payload) => {
            setError(null)

            if (!isOptimisticRef.current && !errorRef.current) {
                lastStableStateRef.current = confirmedStateRef.current
            }

            setIsOptimistic(true)
            startTransition(() => {
                setOptimisticState(payload)
            })

            try {
                const serializedData = optionsRef.current.serialize(payload)

                if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
                    throw new Error("WebSocket is not connected. Sending is not possible")
                }

                wsRef.current.send(serializedData)

                const updater = optionsRef.current.optimisticUpdater
                if (updater) {
                    setConfirmedState(prev => updater(prev, payload))
                }

                clearAckTimer()

                const { ackTimeoutMs } = optionsRef.current
                if (ackTimeoutMs > 0) {
                    ackTimerRef.current = setTimeout(() => {
                        if (!isMountedRef.current) return

                        const timeoutError = new Error(`Server did not acknowledge the operation within ${ackTimeoutMs}ms (ACK Timeout)`)

                        setIsOptimistic(false)
                        startTransition(() => {
                            setConfirmedState(lastStableStateRef.current)
                        })
                        setError(timeoutError)
                        optionsRef.current.onAckTimeout?.(timeoutError, lastStableStateRef.current)
                    }, ackTimeoutMs)
                }
            } catch (err) {
                const errorObj = err instanceof Error ? err : new Error(String(err))
                rollback(errorObj)
            }
        }, [clearAckTimer, rollback, setOptimisticState])

        const resync = useCallback(async (): Promise<void> => {
            if (!optionsRef.current.onResync || !isMountedRef.current) return

            setIsResyncing(true)

            try {
                await optionsRef.current.onResync({
                    updateState: (newValue) => {
                        if (!isMountedRef.current) return

                        setConfirmedState(newValue)

                        lastStableStateRef.current = typeof newValue === "function"
                            ? (newValue as (prev: State) => State)(lastStableStateRef.current)
                            : newValue

                        setIsOptimistic(false)
                        clearAckTimer()
                    },
                    sendRaw,
                    emit
                })  
            } catch (err) {
                const errorObj = err instanceof Error ? err : new Error(String(err))
                setError(errorObj)
            } finally {
                if (isMountedRef.current) {
                    setIsResyncing(false)
                }
            }
        }, [clearAckTimer, emit, sendRaw])

        const disconnect = useCallback(() => {
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current)
                reconnectTimerRef.current = null
            }

            clearAckTimer()

            if (wsRef.current) {
                wsRef.current.close()
                wsRef.current = null
            }

            setStatus("CLOSED")
        }, [clearAckTimer])

        const connect = useCallback(async () => {
            if (!isMountedRef.current || !enabled) return

            disconnect()
            
            setStatus("CONNECTING")
            try {
                const resolvedUrl = typeof url === "function" ? await url() : url
                const ws = new WebSocket(resolvedUrl, protocols)
                wsRef.current = ws

                ws.onopen = (event) => {
                    if (!isMountedRef.current) return

                    setStatus("OPEN")
                    setError(null)

                    if (reconnectAttemptsRef.current > 0 && optionsRef.current.resyncOnReconnect) {
                        resync()
                    }

                    reconnectAttemptsRef.current = 0
                    setReconnectAttempts(0)
                    optionsRef.current.onOpen?.(event)
                }

                ws.onmessage = (event) => {
                    if (!isMountedRef.current) return

                    let parsedData: unknown

                    try {
                        parsedData = optionsRef.current.deserialize(event.data)
                    } catch (err) {
                        const errorObj = err instanceof Error ? err : new Error(`Deserialization error: ${String(err)}`)
                        setError(errorObj)
                        optionsRef.current.onValidationError?.(errorObj, event.data)
                        return
                    }

                    if (optionsRef.current.validateResponse) {
                        try {
                            const isValid = optionsRef.current.validateResponse(parsedData)
                            if (!isValid) {
                                const errorObj = new Error("The incoming message does not match the expected response schema.")
                                setError(errorObj)
                                optionsRef.current.onValidationError?.(errorObj, parsedData)
                                return
                            }
                        } catch (err) {
                            const errorObj = err instanceof Error ? err : new Error(`Validation error: ${String(err)}`)
                            setError(errorObj)
                            optionsRef.current.onValidationError?.(errorObj, parsedData)
                            return
                        }
                    }

                    try {
                        optionsRef.current.onMessage?.(parsedData as ServerResponse, {
                            confirm,
                            rollback,
                            updateState: (newValue) => {
                                setConfirmedState(newValue)
                                lastStableStateRef.current = typeof newValue === "function"
                                    ? (newValue as (prev: State) => State)(lastStableStateRef.current)
                                    : newValue
                            },
                            resync
                        })
                    } catch (err) {
                        const errorObj = err instanceof Error ? err : new Error(String(err))
                        setError(errorObj)
                    }
                }

                ws.onerror = (event) => {
                    if (!isMountedRef.current) return

                    const errorObj = new Error("WebSocket Connection Error")
                    setError(errorObj)

                    optionsRef.current.onError?.(event)
                }

                ws.onclose = (event) => {
                    if (!isMountedRef.current) return

                    setStatus("CLOSED")
                    wsRef.current = null

                    optionsRef.current.onClose?.(event)

                    const { reconnect, maxRetries, reconnectIntervalMs } = optionsRef.current

                    if (reconnect && reconnectAttemptsRef.current < maxRetries) {
                        reconnectTimerRef.current = setTimeout(() => {
                            if (!isMountedRef.current) return

                            reconnectAttemptsRef.current += 1
                            setReconnectAttempts(reconnectAttemptsRef.current)
                            connect()
                        }, reconnectIntervalMs)
                    }
                }
            } catch (err) {
                const errorObj = err instanceof Error ? err : new Error(String(err))
                setError(errorObj)
                setStatus("CLOSED")
            }
        }, [url, enabled, protocols, disconnect, resync, confirm, rollback])

        useEffect(() => {
            isMountedRef.current = true

            if (enabled) {
                connect()
            }

            return () => {
                isMountedRef.current = false
                disconnect()
            }
        }, [connect, disconnect, enabled])

        return {
            state: optimisticState,
            emit,
            sendRaw,
            confirm,
            rollback,
            resync,
            connect,
            disconnect,
            meta: {
                isPending,
                status,
                error,
                isOptimistic,
                isResyncing,
                reconnectAttempts
            }
        }
    }