import { useState, useEffect, useRef, useOptimistic, useTransition, useCallback } from "react"
import { pushToQueue, getQueue, updatedTask, removeTask, clearQueue } from "../utils"
import type { QueueItem, OfflineMutationOptions, OfflineMutationReturn, SyncStatus, QueueControls } from "../types"

export const useOfflineMutation = <State, Payload, ServerResponse = unknown>(
    initialState: State,
    options: OfflineMutationOptions<State, Payload, ServerResponse>
): OfflineMutationReturn<State, Payload> => {
    const [queue, setQueue] = useState<QueueItem<Payload>[]>([])
    const [isOffline, setIsOffline] = useState<boolean>(false)
    const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle")
    const [lastError, setLastError] = useState<Error | null>(null)

    const optionsRef = useRef(options)
    optionsRef.current = options

    const initialStateRef = useRef(initialState)
    initialStateRef.current = initialState

    const chanelRef = useRef<BroadcastChannel | null>(null)
    const triggerSyncRef = useRef<() => void>(() => {}) 

    const [optimisticState, setOptimisticState] = useOptimistic<State, Payload>(
        initialState,
        options.optimisticUpdater || ((state, _payload) => state)
    )

    const [_, startTransition] = useTransition()

    const refreshQueueUI = useCallback(async () => {
        const currentQueue = await getQueue<Payload>(optionsRef.current.mutationKey)
        setQueue(currentQueue)
    }, [])

    const broadcastUpdate = useCallback(() => {
        refreshQueueUI()
        chanelRef.current?.postMessage("REFRESH_QUEUE")
    }, [refreshQueueUI])

    const processQueueAsLeader = useCallback(async () => {
        setSyncStatus("syncing")
        let currentQueue = await getQueue<Payload>(optionsRef.current.mutationKey)

        for (const task of currentQueue) {
            if (!navigator.onLine) {
                setSyncStatus("paused_network")
                break
            }

            if (task.status === "paused_conflict") {
                setSyncStatus("paused_conflict")
                break
            }

            try {
                const payloadToSync = optionsRef.current.onPrepare
                    ? await optionsRef.current.onPrepare(task.payload)
                    : task.payload

                const response = await optionsRef.current.action(payloadToSync)

                await removeTask(task.id)
                optionsRef.current.onSyncSuccess?.(response, payloadToSync)
                broadcastUpdate()
            } catch (error) {
                const categorizedError = optionsRef.current.categorizeError
                    ? optionsRef.current.categorizeError(error)
                    : { name: "Error", message: String(error), reason: "unknown" as const }

                setLastError(categorizedError as Error)

                if (categorizedError.reason === "conflict") {
                    await updatedTask(task.id, { status: "paused_conflict", lastError: categorizedError as any })
                    setSyncStatus("paused_conflict")

                    const controls: QueueControls = {
                        removeTask: async (id) => { await removeTask(id); broadcastUpdate(); triggerSyncRef.current() },
                        clearQueue: async () => { await clearQueue(optionsRef.current.mutationKey); broadcastUpdate() },
                        resumeSync: async () => triggerSyncRef.current()
                    }

                    optionsRef.current.onConflict?.(categorizedError as any, task.payload, controls)
                    broadcastUpdate()
                    break
                }

                const retryConfig = optionsRef.current.retryConfig || {}
                const maxRetries = retryConfig.maxRetries || Infinity
                const baseDelayMs = retryConfig.baseDelayMs || 1000
                const maxDelayMs = retryConfig.maxDelayMs || 30000 

                if (task.retryCount >= maxRetries) {
                    await removeTask(task.id)
                    optionsRef.current.onRollback?.(categorizedError as any, initialStateRef.current) 
                    broadcastUpdate()
                    continue
                }

                const nextRetryCount = task.retryCount + 1
                const backOffDelay = Math.min(baseDelayMs * Math.pow(2, task.retryCount), maxDelayMs)

                await updatedTask(task.id, {
                    status: "failed",
                    retryCount: nextRetryCount,
                    lastError: categorizedError
                })

                broadcastUpdate()

                if (categorizedError.reason === "offline" || categorizedError.reason === "timeout") {
                    setSyncStatus("paused_network")
                } else {
                    setSyncStatus("idle")
                }

                setTimeout(() => {
                    triggerSyncRef.current()
                }, backOffDelay)
                
                break
            }
        }

        setSyncStatus(prev => {
            if (prev !== "paused_network" && prev !== "paused_conflict") {
                return "idle"
            }
            return prev
        })
    }, [broadcastUpdate])

    const triggerSync = useCallback(async () => {
        if (typeof window === "undefined" || !navigator.onLine) return

        const lockname = `sync-lock-${optionsRef.current.mutationKey}`

        if (navigator.locks) {
            await navigator.locks.request(lockname, { mode: "exclusive", ifAvailable: true }, async (lock) => {
                if (!lock) {
                    return
                }
                await processQueueAsLeader()
            })
        } else {
            await processQueueAsLeader()
        }
    }, [processQueueAsLeader])

    triggerSyncRef.current = triggerSync

    const execute = useCallback((payload: Payload) => {
        startTransition(async () => {
            setOptimisticState(payload)

            const newTask: QueueItem<Payload> = {
                id: crypto.randomUUID(),
                mutationKey: optionsRef.current.mutationKey,
                payload,
                timestamp: Date.now(),
                status: "queued",
                retryCount: 0,
                lastError: null
            }

            await pushToQueue(newTask, optionsRef.current.squash)
            broadcastUpdate()

            triggerSync()
        })
    }, [setOptimisticState, triggerSync, broadcastUpdate])

    useEffect(() => {
        setIsOffline(typeof navigator !== "undefined" && !navigator.onLine)
        refreshQueueUI()

        chanelRef.current = new BroadcastChannel(`sync-channel-${options.mutationKey}`)
        chanelRef.current.onmessage = (event) => {
            if (event.data === "REFRESH_QUEUE") {
                refreshQueueUI()
            }
        }

        const handleOnline = () => {
            setIsOffline(false)
            triggerSync()
        }

        const handleOffline = () => setIsOffline(true)

        window.addEventListener("online", handleOnline)
        window.addEventListener("offline", handleOffline)

        return () => {
            window.removeEventListener("online", handleOnline)
            window.removeEventListener("offline", handleOffline)

            chanelRef.current?.close()
        }
    }, [options.mutationKey, refreshQueueUI, triggerSync])

    const handleRemoveTask = useCallback(async (id: string) => {
        await removeTask(id)
        broadcastUpdate()
    }, [broadcastUpdate])

    const handleClearQueue = useCallback(async () => {
        await clearQueue(optionsRef.current.mutationKey)
        broadcastUpdate()
    }, [broadcastUpdate])

    return {
        state: optimisticState,
        execute,
        removeTask: handleRemoveTask,
        clearQueue: handleClearQueue,
        resumeSync: triggerSync,
        meta: {
            syncStatus,
            queue,
            isOffline,
            error: lastError as any
        }
    }
}