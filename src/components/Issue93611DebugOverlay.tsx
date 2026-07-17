import {useCurrentReportIDState} from '@hooks/useCurrentReportID';
import useCurrentUserPersonalDetails from '@hooks/useCurrentUserPersonalDetails';
import useNetwork from '@hooks/useNetwork';
import useOnyx from '@hooks/useOnyx';

import Clipboard from '@libs/Clipboard';
import getNonEmptyStringOnyxID from '@libs/getNonEmptyStringOnyxID';
import {
    clearIssue93611DebugLogs,
    formatIssue93611DebugLogs,
    getIssue93611DebugLogs,
    isIssue93611DebugEnabled,
    recordIssue93611DebugEvent,
    subscribeToIssue93611DebugLogs,
} from '@libs/Issue93611DebugLogger';
import {getReportActionMessageText} from '@libs/ReportActionsUtils';

import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import type * as OnyxTypes from '@src/types/onyx';

import React, {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View} from 'react-native';

function Issue93611DebugOverlayContent() {
    const {width, height} = useWindowDimensions();
    const [isExpanded, setIsExpanded] = useState(false);
    const [copiedLogCount, setCopiedLogCount] = useState<number | null>(null);
    const logs = useSyncExternalStore(subscribeToIssue93611DebugLogs, getIssue93611DebugLogs, getIssue93611DebugLogs);
    const {currentReportID} = useCurrentReportIDState();
    const {accountID: currentUserAccountID} = useCurrentUserPersonalDetails();
    const {isOffline, lastOfflineAt} = useNetwork();
    const [reportActions] = useOnyx(`${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${getNonEmptyStringOnyxID(currentReportID)}`);
    const previousActionSnapshotRef = useRef('');
    const currentReportIDRef = useRef(currentReportID);

    const currentUserAddCommentActions = useMemo(() => {
        return Object.values(reportActions ?? {})
            .filter(
                (action): action is OnyxTypes.ReportAction =>
                    !!action && action.actionName === CONST.REPORT.ACTIONS.TYPE.ADD_COMMENT && (!currentUserAccountID || action.actorAccountID === currentUserAccountID),
            )
            .sort((first, second) => first.created.localeCompare(second.created))
            .slice(-20)
            .map((action) => ({
                reportActionID: action.reportActionID,
                created: action.created,
                text: getReportActionMessageText(action),
                pendingAction: action.pendingAction ?? null,
                isOptimisticAction: action.isOptimisticAction ?? null,
                displayPendingAction: action.pendingAction ?? (action.isOptimisticAction ? CONST.RED_BRICK_ROAD_PENDING_ACTION.ADD : null),
                errorKeys: Object.keys(action.errors ?? {}),
            }));
    }, [currentUserAccountID, reportActions]);

    useEffect(() => {
        currentReportIDRef.current = currentReportID;
    }, [currentReportID]);

    useEffect(() => {
        recordIssue93611DebugEvent('app.page', 'Issue debug overlay mounted', {
            url: window.location.href,
            currentReportID: currentReportIDRef.current ?? null,
        });

        const recordVisibility = () => {
            recordIssue93611DebugEvent('app.visibility', 'Document visibility changed', {
                visibilityState: document.visibilityState,
                currentReportID: currentReportIDRef.current ?? null,
            });
        };
        const recordPageHide = () => {
            recordIssue93611DebugEvent('app.pagehide', 'Browser page is being hidden or closed', {
                visibilityState: document.visibilityState,
                currentReportID: currentReportIDRef.current ?? null,
            });
        };

        document.addEventListener('visibilitychange', recordVisibility);
        window.addEventListener('pagehide', recordPageHide);
        return () => {
            document.removeEventListener('visibilitychange', recordVisibility);
            window.removeEventListener('pagehide', recordPageHide);
        };
    }, []);

    useEffect(() => {
        recordIssue93611DebugEvent('network.state', isOffline ? 'App entered offline state' : 'App entered online state', {
            isOffline,
            lastOfflineAt: lastOfflineAt ?? null,
            navigatorOnline: window.navigator.onLine,
        });
    }, [isOffline, lastOfflineAt]);

    useEffect(() => {
        if (!currentReportID) {
            return;
        }

        recordIssue93611DebugEvent('report.current', 'Current report changed', {reportID: currentReportID});
    }, [currentReportID]);

    useEffect(() => {
        if (!currentReportID) {
            return;
        }

        const snapshotSignature = JSON.stringify({isOffline, actions: currentUserAddCommentActions});
        if (snapshotSignature === previousActionSnapshotRef.current) {
            return;
        }
        previousActionSnapshotRef.current = snapshotSignature;

        recordIssue93611DebugEvent('reportActions.snapshot', 'Current-user AddComment state changed', {
            reportID: currentReportID,
            isOffline,
            actions: currentUserAddCommentActions,
        });
    }, [currentReportID, currentUserAddCommentActions, isOffline]);

    const copyLogs = useCallback(() => {
        Clipboard.setString(formatIssue93611DebugLogs(logs));
        setCopiedLogCount(logs.length);
    }, [logs]);

    const formattedLogs = useMemo(() => formatIssue93611DebugLogs(logs), [logs]);
    const panelSize = useMemo(
        () => ({
            width: Math.min(620, Math.max(300, width - 40)),
            height: Math.min(580, Math.max(260, height - 40)),
        }),
        [height, width],
    );

    if (!isExpanded) {
        return (
            <Pressable
                accessibilityLabel="Open issue 93611 debug logs"
                accessibilityRole="button"
                onPress={() => setIsExpanded(true)}
                style={({pressed}) => [styles.floatingButton, pressed && styles.pressed]}
            >
                <Text style={styles.buttonText}>93611 Logs ({logs.length})</Text>
            </Pressable>
        );
    }

    return (
        <View style={[styles.panel, panelSize]}>
            <View style={styles.header}>
                <View>
                    <Text style={styles.title}>Issue #93611 Debug Logs</Text>
                    <Text style={styles.subtitle}>{logs.length} persisted events</Text>
                </View>
                <Pressable
                    accessibilityLabel="Minimize issue 93611 debug logs"
                    accessibilityRole="button"
                    onPress={() => setIsExpanded(false)}
                    style={({pressed}) => [styles.secondaryButton, pressed && styles.pressed]}
                >
                    <Text style={styles.secondaryButtonText}>Minimize</Text>
                </Pressable>
            </View>

            <ScrollView style={styles.logContainer}>
                <Text
                    selectable
                    style={styles.logText}
                >
                    {formattedLogs}
                </Text>
            </ScrollView>

            <View style={styles.footer}>
                <Pressable
                    accessibilityLabel="Clear issue 93611 debug logs"
                    accessibilityRole="button"
                    onPress={() => {
                        clearIssue93611DebugLogs();
                        setCopiedLogCount(null);
                    }}
                    style={({pressed}) => [styles.secondaryButton, pressed && styles.pressed]}
                >
                    <Text style={styles.secondaryButtonText}>Clear</Text>
                </Pressable>
                <Pressable
                    accessibilityLabel="Copy issue 93611 debug logs"
                    accessibilityRole="button"
                    onPress={copyLogs}
                    style={({pressed}) => [styles.copyButton, pressed && styles.pressed]}
                >
                    <Text style={styles.buttonText}>{copiedLogCount === logs.length ? 'Copied' : 'Copy to clipboard'}</Text>
                </Pressable>
            </View>
        </View>
    );
}

function Issue93611DebugOverlay() {
    if (Platform.OS !== 'web' || !isIssue93611DebugEnabled()) {
        return null;
    }

    return <Issue93611DebugOverlayContent />;
}

const styles = StyleSheet.create({
    floatingButton: {
        position: 'absolute',
        right: 16,
        bottom: 72,
        zIndex: 10000,
        borderRadius: 24,
        backgroundColor: '#2563EB',
        paddingHorizontal: 16,
        paddingVertical: 12,
        elevation: 24,
    },
    panel: {
        position: 'absolute',
        right: 16,
        bottom: 16,
        zIndex: 10000,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#4B5563',
        borderRadius: 12,
        backgroundColor: '#111827',
        elevation: 24,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottomWidth: 1,
        borderBottomColor: '#374151',
        padding: 14,
    },
    title: {
        color: '#F9FAFB',
        fontSize: 16,
        fontWeight: '700',
    },
    subtitle: {
        marginTop: 2,
        color: '#9CA3AF',
        fontSize: 12,
    },
    logContainer: {
        flex: 1,
        padding: 14,
    },
    logText: {
        color: '#D1FAE5',
        fontFamily: 'monospace',
        fontSize: 12,
        lineHeight: 18,
    },
    footer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderTopWidth: 1,
        borderTopColor: '#374151',
        padding: 12,
    },
    copyButton: {
        borderRadius: 8,
        backgroundColor: '#2563EB',
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    secondaryButton: {
        borderWidth: 1,
        borderColor: '#6B7280',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    buttonText: {
        color: '#FFFFFF',
        fontSize: 13,
        fontWeight: '700',
    },
    secondaryButtonText: {
        color: '#E5E7EB',
        fontSize: 13,
        fontWeight: '600',
    },
    pressed: {
        opacity: 0.75,
    },
});

export default Issue93611DebugOverlay;
