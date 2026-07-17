type Issue93611DebugDetails = Record<string, unknown>;

type Issue93611DebugEntry = {
    id: string;
    timestamp: string;
    pageSessionID: string;
    category: string;
    message: string;
    details?: Issue93611DebugDetails;
};

type Listener = (logs: readonly Issue93611DebugEntry[]) => void;

const STORAGE_KEY = 'issue93611-debug-logs-v1';
const MAX_LOGS = 400;
const pageSessionID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

let sequence = 0;
let cachedLogs: Issue93611DebugEntry[] | undefined;
let isStorageListenerAttached = false;
const listeners = new Set<Listener>();

function isIssue93611DebugEnabled(): boolean {
    return __DEV__ && typeof window !== 'undefined' && window.location.hostname === 'dev.new.expensify.com';
}

function isDebugEntry(value: unknown): value is Issue93611DebugEntry {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const entry = value as Partial<Issue93611DebugEntry>;
    return (
        typeof entry.id === 'string' &&
        typeof entry.timestamp === 'string' &&
        typeof entry.pageSessionID === 'string' &&
        typeof entry.category === 'string' &&
        typeof entry.message === 'string'
    );
}

function parseLogs(value: string | null): Issue93611DebugEntry[] {
    if (!value) {
        return [];
    }

    try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter(isDebugEntry).slice(-MAX_LOGS) : [];
    } catch {
        return [];
    }
}

function readPersistedLogs(): Issue93611DebugEntry[] {
    if (!isIssue93611DebugEnabled()) {
        return [];
    }

    try {
        return parseLogs(window.localStorage.getItem(STORAGE_KEY));
    } catch {
        return [];
    }
}

function notifyListeners() {
    const logs = getIssue93611DebugLogs();
    for (const listener of listeners) {
        listener(logs);
    }
}

function attachStorageListener() {
    if (!isIssue93611DebugEnabled() || isStorageListenerAttached) {
        return;
    }

    window.addEventListener('storage', (event) => {
        if (event.key !== STORAGE_KEY) {
            return;
        }

        cachedLogs = parseLogs(event.newValue);
        notifyListeners();
    });
    isStorageListenerAttached = true;
}

function getIssue93611DebugLogs(): readonly Issue93611DebugEntry[] {
    if (!cachedLogs) {
        cachedLogs = readPersistedLogs();
    }
    attachStorageListener();
    return cachedLogs;
}

function persistLogs(logs: readonly Issue93611DebugEntry[]) {
    if (!isIssue93611DebugEnabled()) {
        return;
    }

    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
    } catch {
        // The in-memory log remains available if storage is unavailable or full.
    }
}

function recordIssue93611DebugEvent(category: string, message: string, details?: Issue93611DebugDetails) {
    if (!isIssue93611DebugEnabled()) {
        return;
    }

    const entry: Issue93611DebugEntry = {
        id: `${Date.now()}-${pageSessionID}-${sequence++}`,
        timestamp: new Date().toISOString(),
        pageSessionID,
        category,
        message,
        details,
    };
    const mergedLogs = new Map<string, Issue93611DebugEntry>();
    for (const existingEntry of [...readPersistedLogs(), ...getIssue93611DebugLogs(), entry]) {
        mergedLogs.set(existingEntry.id, existingEntry);
    }
    cachedLogs = Array.from(mergedLogs.values()).slice(-MAX_LOGS);
    persistLogs(cachedLogs);
    notifyListeners();
}

function subscribeToIssue93611DebugLogs(listener: Listener): () => void {
    listeners.add(listener);
    attachStorageListener();
    return () => listeners.delete(listener);
}

function clearIssue93611DebugLogs() {
    cachedLogs = [];
    persistLogs(cachedLogs);
    notifyListeners();
}

function formatIssue93611DebugLogs(logs: readonly Issue93611DebugEntry[]): string {
    if (logs.length === 0) {
        return 'No issue #93611 debug logs captured yet.';
    }

    return logs
        .map((entry) => {
            let details = '';
            if (entry.details) {
                try {
                    details = `\n${JSON.stringify(entry.details, null, 2)}`;
                } catch {
                    details = '\n[Unable to serialize details]';
                }
            }
            return `[${entry.timestamp}] [page:${entry.pageSessionID}] ${entry.category} — ${entry.message}${details}`;
        })
        .join('\n\n');
}

export type {Issue93611DebugEntry};
export {clearIssue93611DebugLogs, formatIssue93611DebugLogs, getIssue93611DebugLogs, isIssue93611DebugEnabled, recordIssue93611DebugEvent, subscribeToIssue93611DebugLogs};
