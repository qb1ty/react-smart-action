import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { useOfflineMutation } from "../offline-mutation.hook"
import { clearQueue, pushToQueue } from "../../utils/indexed-db.util"
import "fake-indexeddb/auto"


class MockBroadcastChannel {
    name: string
    onmessage: ((event: MessageEvent) => void) | null = null
    constructor(name: string) {
        this.name = name
    }
    postMessage(data: any) {
        if (this.onmessage) {
            this.onmessage({ data } as MessageEvent)
        }
    }
    close() {}
}

globalThis.BroadcastChannel = MockBroadcastChannel as any

let mockIsOnline = true
Object.defineProperty(navigator, "onLine", {
    get: () => mockIsOnline,
    configurable: true
})


Object.defineProperty(navigator, "locks", {
    value: {
        request: vi.fn(async (name, options, callback) => {
            await callback({ name })
        })
    },
    configurable: true
})

type TestState = { items: string[] }
type TestPayload = string

describe("useOfflineMutation Hook", () => {
    beforeEach(async () => {
        await clearQueue("test-mutation")
        mockIsOnline = true
        vi.clearAllMocks()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it("should apply optimistic updates instantly and sync when online", async () => {
        const actionMock = vi.fn().mockResolvedValue("success")
        const initial = { items: ["A"] }
        
        const { result } = renderHook(() => useOfflineMutation<TestState, TestPayload>(
            initial,
            {
                mutationKey: "test-mutation",
                action: actionMock,
                optimisticUpdater: (state, payload) => ({ items: [...state.items, payload] })
            }
        ))

        expect(result.current.state.items).toEqual(["A"])

        await act(async () => {
            result.current.execute("B")
        })

        expect(result.current.state.items).toEqual(["A", "B"])

        await waitFor(() => {
            expect(actionMock).toHaveBeenCalledWith("B")
            expect(result.current.meta.queue.length).toBe(0)
        })
    })

    it("should save to IndexedDB and NOT call action if offline", async () => {
        const actionMock = vi.fn()
        mockIsOnline = false

        const initial = { items: [] }
        
        const { result } = renderHook(() => useOfflineMutation<TestState, TestPayload>(
            initial,
            {
                mutationKey: "test-mutation",
                action: actionMock,
                optimisticUpdater: (state, payload) => ({ items: [...state.items, payload] })
            }
        ))

        await act(async () => {
            result.current.execute("Offline Task")
        })

        expect(result.current.state.items).toEqual(["Offline Task"])

        await waitFor(() => {
            expect(actionMock).not.toHaveBeenCalled()
            expect(result.current.meta.queue.length).toBe(1)
            expect(result.current.meta.queue[0].payload).toBe("Offline Task")
            expect(result.current.meta.queue[0].status).toBe("queued")
        })
    })

    it("should process queue automatically when back online", async () => {
        const actionMock = vi.fn().mockResolvedValue("ok")
        mockIsOnline = false

        const initial = { items: [] }
        
        const { result } = renderHook(() => useOfflineMutation<TestState, TestPayload>(
            initial,
            {
                mutationKey: "test-mutation",
                action: actionMock
            }
        ))

        await act(async () => {
            result.current.execute("Task 1")
        })

        await waitFor(() => expect(result.current.meta.queue.length).toBe(1))
        expect(actionMock).not.toHaveBeenCalled()

        await act(async () => {
            mockIsOnline = true
            window.dispatchEvent(new Event("online"))
        })

        await waitFor(() => {
            expect(actionMock).toHaveBeenCalledWith("Task 1")
            expect(result.current.meta.queue.length).toBe(0)
        })
    })

    it("should handle conflicts (409) and pause the queue", async () => {
        const conflictError = new Error("Conflict")
        const actionMock = vi.fn().mockRejectedValue(conflictError)
        const onConflictMock = vi.fn()

        const initial = { items: [] }
        
        const { result } = renderHook(() => useOfflineMutation<TestState, TestPayload>(
            initial,
            {
                mutationKey: "test-mutation",
                action: actionMock,
                categorizeError: () => ({ name: "Error", message: "409", reason: "conflict" }),
                onConflict: onConflictMock
            }
        ))

        await act(async () => {
            result.current.execute("Conflicting Task")
        })

        await waitFor(() => {
            expect(actionMock).toHaveBeenCalled()
            expect(result.current.meta.syncStatus).toBe("paused_conflict")
            expect(result.current.meta.queue[0].status).toBe("paused_conflict")
            expect(onConflictMock).toHaveBeenCalled()
        })
    })

    it("should squash multiple tasks into one if squash function returns true", async () => {
        mockIsOnline = false
        const actionMock = vi.fn()

        const initial = { items: [] }
        
        const { result } = renderHook(() => useOfflineMutation<TestState, TestPayload>(
            initial,
            {
                mutationKey: "test-squash",
                action: actionMock,
                squash: (prev, next) => prev.startsWith("Item") && next.startsWith("Item")
            }
        ))

        await act(async () => {
            result.current.execute("Item v1")
        })
        await act(async () => {
            result.current.execute("Item v2")
        })

        await waitFor(() => {
            expect(result.current.meta.queue.length).toBe(1)
            expect(result.current.meta.queue[0].payload).toBe("Item v2")
        })
    })

    it("should apply onPrepare to modify payload before sending", async () => {
        const actionMock = vi.fn().mockResolvedValue("success")
        const onPrepareMock = vi.fn().mockImplementation(async (payload) => `${payload} + JWT`)

        const initial = { items: [] }
        
        const { result } = renderHook(() => useOfflineMutation<TestState, TestPayload>(
            initial,
            {
                mutationKey: "test-prepare",
                action: actionMock,
                onPrepare: onPrepareMock
            }
        ))

        await act(async () => {
            result.current.execute("Secure Data")
        })

        await waitFor(() => {
            expect(onPrepareMock).toHaveBeenCalledWith("Secure Data")
            expect(actionMock).toHaveBeenCalledWith("Secure Data + JWT")
        })
    })

    it("should handle retries and trigger onRollback when max retries are exceeded", async () => {
        const error = new Error("Network issue")
        const actionMock = vi.fn().mockRejectedValue(error)
        const rollbackMock = vi.fn()

        const initial = { items: ["Stable State"] }
        
        const { result } = renderHook(() => useOfflineMutation<TestState, TestPayload>(
            initial,
            {
                mutationKey: "test-retries",
                action: actionMock,
                categorizeError: () => ({ name: "Error", message: "timeout", reason: "timeout" }),
                retryConfig: { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 50 },
                onRollback: rollbackMock
            }
        ))

        await act(async () => {
            result.current.execute("Failing Task")
        })

        await waitFor(() => {
            expect(actionMock).toHaveBeenCalledTimes(3)
        })

        await waitFor(() => {
            expect(rollbackMock).toHaveBeenCalledWith(
                expect.objectContaining({ reason: "timeout" }),
                { items: ["Stable State"] }
            )
            expect(result.current.meta.queue.length).toBe(0)
        })
    })

    it("should allow manual queue clearing via clearQueue control", async () => {
        mockIsOnline = false

        const initial = { items: [] }

        const { result } = renderHook(() => useOfflineMutation<TestState, TestPayload>(
            initial,
            { mutationKey: "test-clear", action: vi.fn() }
        ))

        await act(async () => {
            result.current.execute("Task 1")
            result.current.execute("Task 2")
        })

        await waitFor(() => expect(result.current.meta.queue.length).toBe(2))

        await act(async () => {
            await result.current.clearQueue()
        })

        await waitFor(() => expect(result.current.meta.queue.length).toBe(0))
    })

    it("should update UI queue when receiving REFRESH_QUEUE via BroadcastChannel", async () => {
        const initial = { items: [] }

        const { result } = renderHook(() => useOfflineMutation<TestState, TestPayload>(
            initial,
            { mutationKey: "test-broadcast", action: vi.fn() }
        ))

        await act(async () => {
            const channel = new MockBroadcastChannel("sync-channel-test-broadcast")
            channel.postMessage("REFRESH_QUEUE")
        })

        await waitFor(() => {
            expect(result.current.meta.queue).toEqual([])
        })
    })
})