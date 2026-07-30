import { describe, it, expect, beforeEach } from "vitest"
import {
    initDB,
    closeDB,
    pushToQueue,
    getQueue,
    updatedTask,
    removeTask,
    clearQueue
} from "../indexed-db.util"
import type { QueueItem } from "../../types"
import "fake-indexeddb/auto"

type TestPayload = { title: string }

const createTask = (id: string, key: string, title: string, timestamp: number): QueueItem<TestPayload> => ({
    id,
    mutationKey: key,
    payload: { title },
    timestamp,
    status: "queued",
    retryCount: 0,
    lastError: null
})

describe("IndexedDB Offline Engine", () => {
    
    beforeEach(async () => {
        closeDB()

        const idb = window.indexedDB || globalThis.indexedDB
        const dbs = await idb.databases()

        const deletePromises = dbs.map(db => {
            return new Promise<void>((resolve, reject) => {
                if (!db.name) return resolve()

                const req = idb.deleteDatabase(db.name)
                
                req.onsuccess = () => resolve()
                req.onerror = () => reject(req.error)
                req.onblocked = () => resolve() 
            })
        })

        await Promise.all(deletePromises)
    })

    describe("Initialization", () => {
        it(
            "should initialize database and create object store with indexes",
            async () => {
                const db = await initDB()
                
                expect(db.name).toBe("react-smart-action-db")
                expect(db.objectStoreNames.contains("offline-mutation")).toBe(true)

                const tx = db.transaction("offline-mutation", "readonly")
                const store = tx.objectStore("offline-mutation")

                expect(store.indexNames.contains("mutationKey")).toBe(true)
                expect(store.indexNames.contains("timestamp")).toBe(true)
            }
        )
    })

    describe("FIFO Queue (getQueue & pushToQueue)", () => {
        it("should retrieve tasks strictly sorted by timestamp (FIFO)", async () => {
            await pushToQueue(createTask("3", "todo", "Task 3", 3000))
            await pushToQueue(createTask("1", "todo", "Task 1", 1000))
            await pushToQueue(createTask("2", "todo", "Task 2", 2000))

            const queue = await getQueue<TestPayload>("todo")
            
            expect(queue.length).toBe(3)

            expect(queue[0].id).toBe("1")
            expect(queue[1].id).toBe("2")
            expect(queue[2].id).toBe("3")
        })

        it("should filter tasks by mutationKey", async () => {
            await pushToQueue(createTask("1", "todo", "Todo 1", 1000))
            await pushToQueue(createTask("2", "profile", "Profile 1", 2000))

            const queue = await getQueue<TestPayload>("todo")

            expect(queue.length).toBe(1)
            expect(queue[0].id).toBe("1")
        })
    })

    describe("Deduplication (Squash)", () => {
        it("should NOT squash if squash function is not provided", async () => {
            const task1 = createTask("1", "user", "Alice", 1000)
            const task2 = createTask("2", "user", "Alice", 2000)

            await pushToQueue(task1)
            await pushToQueue(task2)

            const queue = await getQueue<TestPayload>("user")

            expect(queue.length).toBe(2)
        })

        it("should squash and update the LAST matching task in the queue", async () => {
            await pushToQueue(createTask("1", "user", "Alice", 1000))
            await pushToQueue(createTask("2", "user", "Bob", 2000))
            await pushToQueue(createTask("3", "user", "Charlie", 3000))
            
            const newTask = createTask("4", "user", "Bob Updated", 4000)
            
            const squashFn = (prev: { title: string }, next: { title: string }) => 
                prev.title.startsWith("Bob") && next.title.startsWith("Bob")

            await pushToQueue(newTask, squashFn)

            const queue = await getQueue<TestPayload>("user")
            
            expect(queue.length).toBe(3)
            
            const updatedTask = queue.find(t => t.id === "2")

            expect(updatedTask).toBeDefined()
            expect(updatedTask?.payload.title).toBe("Bob Updated")
            expect(updatedTask?.timestamp).toBe(4000)
            expect(updatedTask?.status).toBe("queued")
        })
    })

    describe("Task Management", () => {
        it("should update task properties partially", async () => {
            await pushToQueue(createTask("1", "todo", "Task 1", 1000))
            
            await updatedTask("1", { 
                status: "failed", 
                retryCount: 2,
                lastError: { name: "Error", message: "", reason: "timeout" }
            })

            const queue = await getQueue<TestPayload>("todo")

            expect(queue[0].status).toBe("failed")
            expect(queue[0].retryCount).toBe(2)
            expect(queue[0].lastError?.reason).toBe("timeout")
            expect(queue[0].payload.title).toBe("Task 1") 
        })

        it("should remove a specific task", async () => {
            await pushToQueue(createTask("1", "todo", "Task 1", 1000))
            await pushToQueue(createTask("2", "todo", "Task 2", 2000))

            await removeTask("1")

            const queue = await getQueue<TestPayload>("todo")

            expect(queue.length).toBe(1)
            expect(queue[0].id).toBe("2")
        })

        it("should clear all tasks for a specific mutationKey", async () => {
            await pushToQueue(createTask("1", "todo", "Task 1", 1000))
            await pushToQueue(createTask("2", "todo", "Task 2", 2000))
            await pushToQueue(createTask("3", "profile", "Profile", 3000))

            await clearQueue("todo")

            const todoQueue = await getQueue<TestPayload>("todo")
            const profileQueue = await getQueue<TestPayload>("profile")

            expect(todoQueue.length).toBe(0)
            expect(profileQueue.length).toBe(1)
        })
    })
})