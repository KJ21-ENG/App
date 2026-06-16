type Issue92246DebugDetails = Record<string, unknown>;

type Issue92246DebugLog = {
    timestamp: string;
    event: string;
    details?: Issue92246DebugDetails;
};

type Issue92246DebugListener = (logs: Issue92246DebugLog[]) => void;

const MAX_LOGS = 200;
let logs: Issue92246DebugLog[] = [];
const listeners = new Set<Issue92246DebugListener>();

function notifyListeners() {
    listeners.forEach((listener) => listener(logs));
}

function addIssue92246DebugLog(event: string, details?: Issue92246DebugDetails) {
    logs = [
        ...logs,
        {
            timestamp: new Date().toISOString(),
            event,
            details,
        },
    ].slice(-MAX_LOGS);
    notifyListeners();
}

function subscribeIssue92246DebugLogs(listener: Issue92246DebugListener) {
    listeners.add(listener);
    listener(logs);

    return () => {
        listeners.delete(listener);
    };
}

function clearIssue92246DebugLogs() {
    logs = [];
    notifyListeners();
}

function getIssue92246DebugLogsText(currentLogs = logs) {
    return currentLogs
        .map((log, index) => {
            const details = log.details ? `\n${JSON.stringify(log.details, null, 2)}` : '';
            return `[${index + 1}] ${log.timestamp} ${log.event}${details}`;
        })
        .join('\n\n');
}

export {addIssue92246DebugLog, clearIssue92246DebugLogs, getIssue92246DebugLogsText, subscribeIssue92246DebugLogs};
export type {Issue92246DebugLog};
