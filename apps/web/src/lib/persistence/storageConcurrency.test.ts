import {IDBFactory, IDBObjectStore} from "fake-indexeddb";
import {afterEach, beforeEach, expect, it, vi} from "vitest";

beforeEach(() => {vi.stubGlobal("indexedDB", new IDBFactory()); vi.resetModules();});
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals();});
async function tab() {vi.resetModules(); return import("./storage");}

it("rejects a stale tab rather than overwriting an acknowledged snapshot", async () => {
  const a = await tab(), b = await tab();
  await a.readProject(); await b.readProject();
  expect((await a.writeProject("saved by A")).ok).toBe(true);
  expect(await b.writeProject("stale B")).toMatchObject({ok: false, status: "error"});
  expect((await a.readProject()).value).toBe("saved by A");
  expect(await b.writeProject("B retries without reloading")).toMatchObject({ok: false});
  expect((await a.readProject()).value).toBe("saved by A");
});

it("does not adopt another tab's data on a first blind write", async () => {
  const a = await tab(), b = await tab();
  await a.writeProject("existing");
  expect((await b.writeProject("blind overwrite")).ok).toBe(false);
  expect((await a.readProject()).value).toBe("existing");
});

it("a stale reset cannot delete newer work in another tab", async () => {
  const a = await tab(), b = await tab();
  await a.readProject(); await b.readProject(); await a.writeProject("keep me");
  expect((await b.clearProject()).ok).toBe(false);
  expect((await a.readProject()).value).toBe("keep me");
});

it("serializes saves before opening the database, including a delayed earlier open", async () => {
  const a = await tab(); await a.readProject();
  const nativeOpen = indexedDB.open.bind(indexedDB);
  let release: (() => void) | undefined;
  let held: (() => void) | undefined;
  const holding = new Promise<void>(resolve => {held = resolve;});
  const opens = vi.spyOn(indexedDB, "open").mockImplementation((...args) => {
    const request = nativeOpen(...args);
    if (opens.mock.calls.length === 1) {
      let released = false;
      request.addEventListener("success", event => {
        if (released) return;
        event.stopImmediatePropagation();
        release = () => {released = true; request.onsuccess?.call(request, event);};
        held?.();
      });
    }
    return request;
  });
  const first = a.writeProject("older"); await holding;
  let secondSettled = false;
  const second = a.writeProject("newest").then(result => {secondSettled = true; return result;});
  try {
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(secondSettled).toBe(false);
    expect(opens).toHaveBeenCalledTimes(1);
  } finally {release?.(); await Promise.all([first, second]);}
  expect((await a.readProject()).value).toBe("newest");
});

it("queues reset after a pending save so the old save cannot resurrect data", async () => {
  const a = await tab();
  const save = a.writeProject("in flight"), reset = a.clearProject();
  expect((await save).ok).toBe(true); expect((await reset).ok).toBe(true);
  expect((await a.readProject()).value).toBeUndefined();
  expect((await a.writeProject("new workspace")).ok).toBe(true);
});

it("isolates workspace queues and expected snapshots", async () => {
  const a = await tab(), b = await tab();
  await a.readProject("current"); await b.readProject("current.demo-v1");
  expect((await a.writeProject("personal", "current")).ok).toBe(true);
  expect((await b.writeProject("demo", "current.demo-v1")).ok).toBe(true);
  expect((await a.readProject("current")).value).toBe("personal");
  expect((await b.readProject("current.demo-v1")).value).toBe("demo");
});

it("only one of two simultaneous writers can replace the same observed snapshot", async () => {
  const a = await tab(), b = await tab();
  await a.readProject(); await b.readProject();
  const results = await Promise.all([a.writeProject("A"), b.writeProject("B")]);
  expect(results.filter(result => result.ok)).toHaveLength(1);
  expect(results.filter(result => !result.ok)).toHaveLength(1);
  expect((await a.readProject()).value).toBe(results[0]?.ok ? "A" : "B");
});

it("identical initialization is idempotent across tabs", async () => {
  const a = await tab(), b = await tab();
  await a.readProject(); await b.readProject();
  expect((await a.writeProject("same" )).ok).toBe(true);
  expect((await b.writeProject("same" )).ok).toBe(true);
  expect((await b.writeProject("next" )).ok).toBe(true);
  expect((await a.readProject()).value).toBe("next");
});

it("reports synchronous quota failure and can retry without losing its baseline", async () => {
  const a = await tab(); await a.readProject();
  const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
    throw new DOMException("disk quota exhausted", "QuotaExceededError");
  });
  expect(await a.writeProject("not yet saved")).toMatchObject({ok: false, status: "error", error: "disk quota exhausted"});
  put.mockRestore();
  expect((await a.writeProject("retried" )).ok).toBe(true);
  expect((await a.readProject()).value).toBe("retried");
});

it("does not advance its observed baseline when a native transaction aborts", async () => {
  const a = await tab(); await a.writeProject("durable");
  const original = IDBObjectStore.prototype.put;
  const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(function (this: IDBObjectStore, ...args) {
    const request = original.apply(this, args); this.transaction.abort(); return request;
  });
  expect((await a.writeProject("aborted" )).ok).toBe(false);
  put.mockRestore();
  expect((await a.writeProject("after abort" )).ok).toBe(true);
  expect((await a.readProject()).value).toBe("after abort");
});

it("reports unavailable storage for reads, writes and resets, then recovers", async () => {
  const a = await tab(); vi.stubGlobal("indexedDB", undefined);
  for (const result of [await a.readProject(), await a.writeProject("unavailable"), await a.clearProject()]) {
    expect(result).toMatchObject({ok: false, status: "unavailable"});
  }
  vi.stubGlobal("indexedDB", new IDBFactory());
  expect((await a.readProject()).ok).toBe(true);
  expect((await a.writeProject("recovered")).ok).toBe(true);
  expect((await a.readProject()).value).toBe("recovered");
});

it("upgrades the existing database without changing either workspace", async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("cutroom", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("projects");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction("projects", "readwrite");
      tx.objectStore("projects").put("legacy personal", "current");
      tx.objectStore("projects").put("legacy demo", "current.demo-v1");
      tx.oncomplete = () => {db.close(); resolve();}; tx.onerror = () => reject(tx.error);
    };
  });
  const a = await tab();
  expect((await a.readProject("current")).value).toBe("legacy personal");
  expect((await a.readProject("current.demo-v1")).value).toBe("legacy demo");
  const version = await new Promise<number>((resolve, reject) => {
    const request = indexedDB.open("cutroom");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {const db = request.result; resolve(db.version); db.close();};
  });
  expect(version).toBe(2);
});

it("fences the version-one unconditional writer after a newer client saves", async () => {
  const a = await tab(); await a.writeProject("new durable snapshot");
  const legacy = await new Promise<string>((resolve, reject) => {
    const request = indexedDB.open("cutroom", 1);
    request.onerror = event => {event.preventDefault(); resolve(request.error?.name ?? "unknown");};
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction("projects", "readwrite");
      tx.objectStore("projects").put("old unsafe writer", "current");
      tx.oncomplete = () => {db.close(); resolve("overwritten");}; tx.onerror = () => reject(tx.error);
    };
  });
  const restored = (await a.readProject()).value;
  expect({legacy, restored}).toEqual({legacy: "VersionError", restored: "new durable snapshot"});
});

it("reports a blocked upgrade and closes its abandoned connection once it opens", async () => {
  const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("cutroom", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("projects");
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const a = await tab();
  try {expect(await a.readProject()).toMatchObject({ok: false, error: expect.stringMatching(/Close other Cutroom tabs/)});}
  finally {legacy.close();}
  expect((await a.readProject()).ok).toBe(true);
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("cutroom", 3);
    request.onblocked = () => reject(new Error("An abandoned version-two connection is still open"));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {request.result.close(); resolve();};
  });
});
