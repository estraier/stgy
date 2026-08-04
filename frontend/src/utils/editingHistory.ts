export const EDITING_HISTORY_DATABASE_NAME = "stgy-editing-history";
export const EDITING_HISTORY_PERIODIC_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
export const EDITING_HISTORY_SAVED_RETENTION_MS = 10 * 24 * 60 * 60 * 1000;
export const EDITING_HISTORY_DAILY_FINAL_RETENTION_MS = 45 * 24 * 60 * 60 * 1000;
export const EDITING_HISTORY_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const EDITING_HISTORY_MAX_BYTES = 50 * 1024 * 1024;
export const EDITING_HISTORY_PAGE_SIZE = 50;

const DATABASE_VERSION = 2;
const SNAPSHOTS_STORE = "snapshots";
const CONTENTS_STORE = "contents";
const METADATA_STORE = "metadata";
const LAST_CLEANUP_KEY = "lastCleanupAt";
const QUOTA_RECOVERY_MINIMUM_BYTES = 1024 * 1024;

export type EditingHistoryTargetType = "post" | "draft";
export type EditingHistorySnapshotKind = "periodic" | "saved";

export type EditingHistoryTarget = {
  type: EditingHistoryTargetType;
  id: string;
};

export type EditingHistorySnapshot = {
  id: string;
  schemaVersion: 2;
  ownerUserId: string;
  targetType: EditingHistoryTargetType;
  targetId: string;
  timestamp: number;
  contentHash: string;
  preview: string;
  compression: "gzip";
  compressedByteSize: number;
  uncompressedByteSize: number;
  kind: EditingHistorySnapshotKind;
  savedDate: string | null;
  savedTimezone: string | null;
};

export type EditingHistoryPage = {
  snapshots: EditingHistorySnapshot[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
};

type RawEditingHistorySnapshot = Omit<
  EditingHistorySnapshot,
  "schemaVersion" | "kind" | "savedDate" | "savedTimezone"
> & {
  schemaVersion?: number;
  kind?: EditingHistorySnapshotKind;
  savedDate?: string | null;
  savedTimezone?: string | null;
};

type EditingHistoryContent = {
  id: string;
  data: Blob;
};

type EditingHistoryMetadata = {
  key: string;
  value: number;
};

let databasePromise: Promise<IDBDatabase> | null = null;

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction was aborted."));
  });
}

function normalizeSnapshot(snapshot: RawEditingHistorySnapshot): EditingHistorySnapshot {
  const kind: EditingHistorySnapshotKind = snapshot.kind === "saved" ? "saved" : "periodic";
  return {
    ...snapshot,
    schemaVersion: 2,
    kind,
    savedDate:
      kind === "saved" && typeof snapshot.savedDate === "string" ? snapshot.savedDate : null,
    savedTimezone:
      kind === "saved" && typeof snapshot.savedTimezone === "string"
        ? snapshot.savedTimezone
        : null,
  };
}

function ensureSnapshotIndexes(store: IDBObjectStore): void {
  if (!store.indexNames.contains("ownerTimestamp")) {
    store.createIndex("ownerTimestamp", ["ownerUserId", "timestamp"], { unique: false });
  }
  if (!store.indexNames.contains("target")) {
    store.createIndex("target", ["ownerUserId", "targetType", "targetId"], {
      unique: false,
    });
  }
  if (!store.indexNames.contains("timestamp")) {
    store.createIndex("timestamp", "timestamp", { unique: false });
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is unavailable in this browser."));
  }
  if (databasePromise) return databasePromise;

  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(EDITING_HISTORY_DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const upgradeTransaction = request.transaction;
      let snapshots: IDBObjectStore;
      if (!database.objectStoreNames.contains(SNAPSHOTS_STORE)) {
        snapshots = database.createObjectStore(SNAPSHOTS_STORE, { keyPath: "id" });
      } else if (upgradeTransaction) {
        snapshots = upgradeTransaction.objectStore(SNAPSHOTS_STORE);
      } else {
        throw new Error("Editing history database upgrade transaction is unavailable.");
      }
      ensureSnapshotIndexes(snapshots);

      if (!database.objectStoreNames.contains(CONTENTS_STORE)) {
        database.createObjectStore(CONTENTS_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(METADATA_STORE)) {
        database.createObjectStore(METADATA_STORE, { keyPath: "key" });
      }

      const cursorRequest = snapshots.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        cursor.update(normalizeSnapshot(cursor.value as RawEditingHistorySnapshot));
        cursor.continue();
      };
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error("Failed to open editing history database."));
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(new Error("Editing history database upgrade is blocked by another tab."));
    };
  });

  return databasePromise;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export function createEditingHistoryDraftId(): string {
  return randomHex(8);
}

export function formatEditingHistoryTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return [
    pad(date.getFullYear(), 4),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    pad(date.getMilliseconds(), 3),
  ].join("");
}

export function formatEditingHistorySavedDate(timestamp: number, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date(timestamp));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  if (!year || !month || !day) {
    throw new Error("Failed to determine the editing history save date.");
  }
  return `${year}-${month}-${day}`;
}

export function makeEditingHistorySnapshotId(
  ownerUserId: string,
  target: EditingHistoryTarget,
  timestamp: number,
): string {
  return `stgy-editing-history-${ownerUserId}-${target.type}-${formatEditingHistoryTimestamp(timestamp)}-${target.id}`;
}

export function makeEditingHistoryPreview(content: string, maxCharacters = 100): string {
  return Array.from(content).slice(0, maxCharacters).join("");
}

export async function hashEditingHistoryContent(content: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("Web Crypto is unavailable in this browser.");
  }
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(new Uint8Array(digest));
}

async function gzipContent(content: string): Promise<{
  blob: Blob;
  uncompressedByteSize: number;
}> {
  if (typeof CompressionStream === "undefined") {
    throw new Error("Gzip compression is unavailable in this browser.");
  }
  const bytes = new TextEncoder().encode(content);
  const compressedStream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  const compressed = await new Response(compressedStream).blob();
  return {
    blob: new Blob([compressed], { type: "application/gzip" }),
    uncompressedByteSize: bytes.byteLength,
  };
}

async function gunzipContent(blob: Blob): Promise<string> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Gzip decompression is unavailable in this browser.");
  }
  const stream = blob.stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "QuotaExceededError";
}

async function addSnapshotRecords(
  snapshot: EditingHistorySnapshot,
  content: EditingHistoryContent,
): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction([SNAPSHOTS_STORE, CONTENTS_STORE], "readwrite");
  const done = transactionToPromise(transaction);
  transaction.objectStore(SNAPSHOTS_STORE).add(snapshot);
  transaction.objectStore(CONTENTS_STORE).add(content);
  await done;
}

async function readAllSnapshots(): Promise<EditingHistorySnapshot[]> {
  const database = await openDatabase();
  const transaction = database.transaction(SNAPSHOTS_STORE, "readonly");
  const done = transactionToPromise(transaction);
  const result = await requestToPromise(
    transaction.objectStore(SNAPSHOTS_STORE).getAll() as IDBRequest<RawEditingHistorySnapshot[]>,
  );
  await done;
  return result.map(normalizeSnapshot);
}

async function readLastCleanupAt(): Promise<number | null> {
  const database = await openDatabase();
  const transaction = database.transaction(METADATA_STORE, "readonly");
  const done = transactionToPromise(transaction);
  const record = await requestToPromise(
    transaction.objectStore(METADATA_STORE).get(LAST_CLEANUP_KEY) as IDBRequest<
      EditingHistoryMetadata | undefined
    >,
  );
  await done;
  return typeof record?.value === "number" ? record.value : null;
}

async function readAllContentKeys(): Promise<IDBValidKey[]> {
  const database = await openDatabase();
  const transaction = database.transaction(CONTENTS_STORE, "readonly");
  const done = transactionToPromise(transaction);
  const keys = await requestToPromise(transaction.objectStore(CONTENTS_STORE).getAllKeys());
  await done;
  return keys;
}

function dailyFinalGroupKey(snapshot: EditingHistorySnapshot): string | null {
  if (snapshot.kind !== "saved" || !snapshot.savedDate) return null;
  return JSON.stringify([
    snapshot.ownerUserId,
    snapshot.targetType,
    snapshot.targetId,
    snapshot.savedDate,
  ]);
}

export function findEditingHistoryDailyFinalIds(
  snapshots: readonly EditingHistorySnapshot[],
): Set<string> {
  const latestByGroup = new Map<string, EditingHistorySnapshot>();
  for (const snapshot of snapshots) {
    const groupKey = dailyFinalGroupKey(snapshot);
    if (!groupKey) continue;
    const current = latestByGroup.get(groupKey);
    if (
      !current ||
      snapshot.timestamp > current.timestamp ||
      (snapshot.timestamp === current.timestamp && snapshot.id > current.id)
    ) {
      latestByGroup.set(groupKey, snapshot);
    }
  }
  return new Set(Array.from(latestByGroup.values(), (snapshot) => snapshot.id));
}

export function getEditingHistoryRetentionMs(
  snapshot: EditingHistorySnapshot,
  dailyFinalIds: ReadonlySet<string>,
): number {
  if (snapshot.kind === "periodic") return EDITING_HISTORY_PERIODIC_RETENTION_MS;
  if (dailyFinalIds.has(snapshot.id)) return EDITING_HISTORY_DAILY_FINAL_RETENTION_MS;
  return EDITING_HISTORY_SAVED_RETENTION_MS;
}

function snapshotSize(snapshot: EditingHistorySnapshot): number {
  return Math.max(0, snapshot.compressedByteSize || 0);
}

function buildCapacityCandidates(
  snapshots: readonly EditingHistorySnapshot[],
  dailyFinalIds: ReadonlySet<string>,
  now: number,
): EditingHistorySnapshot[] {
  return [...snapshots].sort((a, b) => {
    const aRatio = Math.max(0, now - a.timestamp) / getEditingHistoryRetentionMs(a, dailyFinalIds);
    const bRatio = Math.max(0, now - b.timestamp) / getEditingHistoryRetentionMs(b, dailyFinalIds);
    if (aRatio !== bRatio) return bRatio - aRatio;
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    const sizeDifference = snapshotSize(b) - snapshotSize(a);
    if (sizeDifference !== 0) return sizeDifference;
    return a.id.localeCompare(b.id);
  });
}

type CleanupOptions = {
  forceAgeCleanup?: boolean;
  reserveBytes?: number;
  quotaRecovery?: boolean;
};

export async function cleanupEditingHistory(options: CleanupOptions = {}): Promise<void> {
  const now = Date.now();
  const reserveBytes = Math.max(0, options.reserveBytes ?? 0);
  const [allSnapshots, lastCleanupAt] = await Promise.all([
    readAllSnapshots(),
    readLastCleanupAt(),
  ]);
  const capacityLimit = Math.max(0, EDITING_HISTORY_MAX_BYTES - reserveBytes);
  const initialTotalBytes = allSnapshots.reduce((sum, snapshot) => sum + snapshotSize(snapshot), 0);
  const scheduledCleanupDue =
    options.forceAgeCleanup === true ||
    lastCleanupAt === null ||
    now - lastCleanupAt >= EDITING_HISTORY_CLEANUP_INTERVAL_MS;
  const capacityCleanupNeeded =
    initialTotalBytes > capacityLimit || options.quotaRecovery === true;
  const runRetentionCleanup = scheduledCleanupDue || capacityCleanupNeeded;
  const runIntegrityCleanup = scheduledCleanupDue || options.quotaRecovery === true;

  const deleteIds = new Set<string>();
  let orphanContentIds: string[] = [];

  if (runIntegrityCleanup) {
    const snapshotIds = new Set(allSnapshots.map((snapshot) => snapshot.id));
    const contentIds = new Set((await readAllContentKeys()).map(String));
    orphanContentIds = Array.from(contentIds).filter((id) => !snapshotIds.has(id));
    for (const snapshot of allSnapshots) {
      if (!contentIds.has(snapshot.id)) deleteIds.add(snapshot.id);
    }
  }

  let remaining = allSnapshots.filter((snapshot) => !deleteIds.has(snapshot.id));
  let dailyFinalIds = findEditingHistoryDailyFinalIds(remaining);

  if (runRetentionCleanup) {
    for (const snapshot of remaining) {
      const retentionMs = getEditingHistoryRetentionMs(snapshot, dailyFinalIds);
      if (now - snapshot.timestamp >= retentionMs) deleteIds.add(snapshot.id);
    }
    remaining = remaining.filter((snapshot) => !deleteIds.has(snapshot.id));
    dailyFinalIds = findEditingHistoryDailyFinalIds(remaining);
  }

  let totalBytes = remaining.reduce((sum, snapshot) => sum + snapshotSize(snapshot), 0);
  let targetBytes = capacityLimit;
  if (options.quotaRecovery) {
    const requestedFreeBytes = Math.max(reserveBytes, QUOTA_RECOVERY_MINIMUM_BYTES);
    targetBytes = Math.min(targetBytes, Math.max(0, initialTotalBytes - requestedFreeBytes));
  }

  let candidates = buildCapacityCandidates(remaining, dailyFinalIds, now);
  while (totalBytes > targetBytes && candidates.length > 0) {
    const candidate = candidates.shift();
    if (!candidate || deleteIds.has(candidate.id)) continue;

    const wasDailyFinal = dailyFinalIds.has(candidate.id);
    deleteIds.add(candidate.id);
    totalBytes -= snapshotSize(candidate);
    remaining = remaining.filter((snapshot) => snapshot.id !== candidate.id);

    if (wasDailyFinal) {
      // A previous saved snapshot for the same post and date may now become the daily final.
      dailyFinalIds = findEditingHistoryDailyFinalIds(remaining);
      candidates = buildCapacityCandidates(remaining, dailyFinalIds, now);
    }
  }

  if (
    deleteIds.size === 0 &&
    orphanContentIds.length === 0 &&
    !runRetentionCleanup
  ) {
    return;
  }

  const database = await openDatabase();
  const transaction = database.transaction(
    [SNAPSHOTS_STORE, CONTENTS_STORE, METADATA_STORE],
    "readwrite",
  );
  const done = transactionToPromise(transaction);
  const snapshotsStore = transaction.objectStore(SNAPSHOTS_STORE);
  const contentsStore = transaction.objectStore(CONTENTS_STORE);
  for (const id of deleteIds) {
    snapshotsStore.delete(id);
    contentsStore.delete(id);
  }
  for (const id of orphanContentIds) contentsStore.delete(id);
  if (runRetentionCleanup) {
    transaction.objectStore(METADATA_STORE).put({ key: LAST_CLEANUP_KEY, value: now });
  }
  await done;
}

export async function saveEditingHistorySnapshot(params: {
  ownerUserId: string;
  target: EditingHistoryTarget;
  content: string;
  contentHash?: string;
  timestamp?: number;
  kind?: EditingHistorySnapshotKind;
  savedTimezone?: string | null;
}): Promise<EditingHistorySnapshot> {
  const timestamp = params.timestamp ?? Date.now();
  const contentHash = params.contentHash ?? (await hashEditingHistoryContent(params.content));
  const { blob, uncompressedByteSize } = await gzipContent(params.content);
  const baseId = makeEditingHistorySnapshotId(params.ownerUserId, params.target, timestamp);
  const kind = params.kind ?? "periodic";
  let savedTimezone: string | null = null;
  let savedDate: string | null = null;
  if (kind === "saved") {
    savedTimezone =
      params.savedTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    savedDate = formatEditingHistorySavedDate(timestamp, savedTimezone);
  }

  const makeRecords = (id: string): [EditingHistorySnapshot, EditingHistoryContent] => [
    {
      id,
      schemaVersion: 2,
      ownerUserId: params.ownerUserId,
      targetType: params.target.type,
      targetId: params.target.id,
      timestamp,
      contentHash,
      preview: makeEditingHistoryPreview(params.content),
      compression: "gzip",
      compressedByteSize: blob.size,
      uncompressedByteSize,
      kind,
      savedDate,
      savedTimezone,
    },
    { id, data: blob },
  ];

  let records = makeRecords(baseId);
  try {
    await addSnapshotRecords(records[0], records[1]);
  } catch (error) {
    if (error instanceof DOMException && error.name === "ConstraintError") {
      records = makeRecords(`${baseId}-${randomHex(2)}`);
      await addSnapshotRecords(records[0], records[1]);
    } else if (isQuotaError(error)) {
      await cleanupEditingHistory({
        forceAgeCleanup: true,
        reserveBytes: blob.size,
        quotaRecovery: true,
      });
      await addSnapshotRecords(records[0], records[1]);
    } else {
      throw error;
    }
  }

  try {
    await cleanupEditingHistory();
  } catch (error) {
    console.warn("Failed to clean up editing history after saving.", error);
  }
  return records[0];
}

export async function saveSavedEditingHistorySnapshot(params: {
  ownerUserId: string;
  postId: string;
  content: string;
  savedTimezone?: string | null;
}): Promise<EditingHistorySnapshot> {
  return saveEditingHistorySnapshot({
    ownerUserId: params.ownerUserId,
    target: { type: "post", id: params.postId },
    content: params.content,
    kind: "saved",
    savedTimezone: params.savedTimezone,
  });
}

export async function listEditingHistorySnapshots(
  ownerUserId: string,
  requestedPage = 1,
  pageSize = EDITING_HISTORY_PAGE_SIZE,
): Promise<EditingHistoryPage> {
  const normalizedPageSize = Math.max(1, Math.floor(pageSize));
  const database = await openDatabase();
  const range = IDBKeyRange.bound(
    [ownerUserId, 0],
    [ownerUserId, Number.MAX_SAFE_INTEGER],
  );

  const countTransaction = database.transaction(SNAPSHOTS_STORE, "readonly");
  const countDone = transactionToPromise(countTransaction);
  const totalCount = await requestToPromise(
    countTransaction.objectStore(SNAPSHOTS_STORE).index("ownerTimestamp").count(range),
  );
  await countDone;

  const totalPages = Math.ceil(totalCount / normalizedPageSize);
  const page =
    totalPages === 0
      ? 1
      : Math.min(Math.max(1, Math.floor(requestedPage)), totalPages);
  const offset = (page - 1) * normalizedPageSize;

  const transaction = database.transaction(SNAPSHOTS_STORE, "readonly");
  const done = transactionToPromise(transaction);
  const index = transaction.objectStore(SNAPSHOTS_STORE).index("ownerTimestamp");
  const snapshots = await new Promise<EditingHistorySnapshot[]>((resolve, reject) => {
    const values: EditingHistorySnapshot[] = [];
    let advanced = offset === 0;
    const request = index.openCursor(range, "prev");
    request.onerror = () => reject(request.error ?? new Error("Failed to list editing history."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || values.length >= normalizedPageSize) {
        resolve(values);
        return;
      }
      if (!advanced) {
        advanced = true;
        cursor.advance(offset);
        return;
      }
      values.push(normalizeSnapshot(cursor.value as RawEditingHistorySnapshot));
      cursor.continue();
    };
  });
  await done;
  return { snapshots, page, pageSize: normalizedPageSize, totalCount, totalPages };
}

export async function readEditingHistoryContent(
  id: string,
  ownerUserId: string,
): Promise<{ snapshot: EditingHistorySnapshot; content: string }> {
  const database = await openDatabase();
  const transaction = database.transaction([SNAPSHOTS_STORE, CONTENTS_STORE], "readonly");
  const done = transactionToPromise(transaction);
  const snapshotsStore = transaction.objectStore(SNAPSHOTS_STORE);
  const contentsStore = transaction.objectStore(CONTENTS_STORE);
  const [rawSnapshot, contentRecord] = await Promise.all([
    requestToPromise(
      snapshotsStore.get(id) as IDBRequest<RawEditingHistorySnapshot | undefined>,
    ),
    requestToPromise(contentsStore.get(id) as IDBRequest<EditingHistoryContent | undefined>),
  ]);
  await done;

  if (!rawSnapshot || rawSnapshot.ownerUserId !== ownerUserId) {
    throw new Error("Editing history entry was not found.");
  }
  const snapshot = normalizeSnapshot(rawSnapshot);
  if (!contentRecord?.data) {
    throw new Error("Editing history content is missing.");
  }
  if (snapshot.compression !== "gzip") {
    throw new Error("Unsupported editing history compression format.");
  }

  const content = await gunzipContent(contentRecord.data);
  const contentHash = await hashEditingHistoryContent(content);
  if (contentHash !== snapshot.contentHash) {
    throw new Error("Editing history content is corrupted.");
  }
  return { snapshot, content };
}

export async function clearEditingHistory(ownerUserId: string): Promise<void> {
  if (!ownerUserId) throw new Error("Editing history owner is required.");

  const database = await openDatabase();
  const transaction = database.transaction([SNAPSHOTS_STORE, CONTENTS_STORE], "readwrite");
  const done = transactionToPromise(transaction);
  const snapshotsStore = transaction.objectStore(SNAPSHOTS_STORE);
  const contentsStore = transaction.objectStore(CONTENTS_STORE);
  const range = IDBKeyRange.bound(
    [ownerUserId, 0],
    [ownerUserId, Number.MAX_SAFE_INTEGER],
  );

  const snapshotsCursorDone = new Promise<void>((resolve, reject) => {
    const request = snapshotsStore.index("ownerTimestamp").openCursor(range);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to clear editing history."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    };
  });

  const contentIdPrefix = `stgy-editing-history-${ownerUserId}-`;
  const contentsCursorDone = new Promise<void>((resolve, reject) => {
    const request = contentsStore.openCursor();
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to clear editing history content."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      const content = cursor.value as EditingHistoryContent;
      if (content.id.startsWith(contentIdPrefix)) cursor.delete();
      cursor.continue();
    };
  });

  await Promise.all([snapshotsCursorDone, contentsCursorDone]);
  await done;
}

export async function migrateEditingHistoryDraftToPost(params: {
  ownerUserId: string;
  draftId: string;
  postId: string;
}): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction([SNAPSHOTS_STORE, CONTENTS_STORE], "readwrite");
  const done = transactionToPromise(transaction);
  const snapshotsStore = transaction.objectStore(SNAPSHOTS_STORE);
  const contentsStore = transaction.objectStore(CONTENTS_STORE);
  const index = snapshotsStore.index("target");
  const range = IDBKeyRange.only([params.ownerUserId, "draft", params.draftId]);

  const cursorPromise = new Promise<void>((resolve, reject) => {
    const request = index.openCursor(range);
    request.onerror = () => reject(request.error ?? new Error("Failed to migrate draft history."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      const oldSnapshot = normalizeSnapshot(cursor.value as RawEditingHistorySnapshot);
      const getContent = contentsStore.get(oldSnapshot.id) as IDBRequest<
        EditingHistoryContent | undefined
      >;
      getContent.onerror = () =>
        reject(getContent.error ?? new Error("Failed to read draft history content."));
      getContent.onsuccess = () => {
        const oldContent = getContent.result;
        if (oldContent) {
          const draftTarget: EditingHistoryTarget = { type: "draft", id: params.draftId };
          const target: EditingHistoryTarget = { type: "post", id: params.postId };
          const oldBaseId = makeEditingHistorySnapshotId(
            params.ownerUserId,
            draftTarget,
            oldSnapshot.timestamp,
          );
          const collisionSuffix = oldSnapshot.id.startsWith(oldBaseId)
            ? oldSnapshot.id.slice(oldBaseId.length)
            : "";
          const newId =
            makeEditingHistorySnapshotId(params.ownerUserId, target, oldSnapshot.timestamp) +
            collisionSuffix;
          const newSnapshot: EditingHistorySnapshot = {
            ...oldSnapshot,
            id: newId,
            targetType: "post",
            targetId: params.postId,
          };
          snapshotsStore.put(newSnapshot);
          contentsStore.put({ id: newId, data: oldContent.data } satisfies EditingHistoryContent);
        }
        snapshotsStore.delete(oldSnapshot.id);
        contentsStore.delete(oldSnapshot.id);
        cursor.continue();
      };
    };
  });

  await cursorPromise;
  await done;
}
