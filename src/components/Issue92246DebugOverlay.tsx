import React, {useEffect, useMemo, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import Clipboard from '@libs/Clipboard';
import {clearIssue92246DebugLogs, getIssue92246DebugLogsText, subscribeIssue92246DebugLogs} from '@libs/Issue92246Debug';
import type {Issue92246DebugLog} from '@libs/Issue92246Debug';

function Issue92246DebugOverlay() {
    const [isExpanded, setIsExpanded] = useState(false);
    const [logs, setLogs] = useState<Issue92246DebugLog[]>([]);
    const logText = useMemo(() => getIssue92246DebugLogsText(logs), [logs]);

    useEffect(() => subscribeIssue92246DebugLogs(setLogs), []);

    const copyLogs = () => {
        Clipboard.setString(logText || 'No issue #92246 debug logs recorded yet.');
    };

    if (!isExpanded) {
        return (
            <View style={styles.buttonContainer}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open issue 92246 debug logs"
                    style={styles.floatingButton}
                    onPress={() => setIsExpanded(true)}
                >
                    <Text style={styles.buttonText}>92246 logs</Text>
                </Pressable>
            </View>
        );
    }

    return (
        <View style={styles.panelContainer}>
            <View style={styles.panel}>
                <View style={styles.header}>
                    <View>
                        <Text style={styles.title}>Issue 92246 logs</Text>
                        <Text style={styles.subtitle}>{logs.length} entries</Text>
                    </View>
                    <View style={styles.actions}>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Copy issue 92246 debug logs"
                            style={styles.actionButton}
                            onPress={copyLogs}
                        >
                            <Text style={styles.actionText}>Copy</Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Clear issue 92246 debug logs"
                            style={styles.actionButton}
                            onPress={clearIssue92246DebugLogs}
                        >
                            <Text style={styles.actionText}>Clear</Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Minimize issue 92246 debug logs"
                            style={styles.actionButton}
                            onPress={() => setIsExpanded(false)}
                        >
                            <Text style={styles.actionText}>Minimize</Text>
                        </Pressable>
                    </View>
                </View>
                <ScrollView style={styles.logScroller}>
                    <Text style={styles.logText}>{logText || 'No issue #92246 debug logs recorded yet.'}</Text>
                </ScrollView>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    buttonContainer: {
        position: 'absolute',
        right: 16,
        bottom: 88,
        zIndex: 10000,
    },
    floatingButton: {
        borderRadius: 8,
        backgroundColor: '#111827',
        paddingHorizontal: 12,
        paddingVertical: 9,
        shadowColor: '#000000',
        shadowOpacity: 0.25,
        shadowRadius: 8,
        shadowOffset: {width: 0, height: 2},
        elevation: 8,
    },
    buttonText: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: '700',
    },
    panelContainer: {
        position: 'absolute',
        right: 16,
        bottom: 88,
        width: 360,
        maxWidth: '92%',
        maxHeight: '70%',
        zIndex: 10000,
    },
    panel: {
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#1F2937',
        borderRadius: 8,
        backgroundColor: '#FFFFFF',
        shadowColor: '#000000',
        shadowOpacity: 0.3,
        shadowRadius: 14,
        shadowOffset: {width: 0, height: 4},
        elevation: 10,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#E5E7EB',
        padding: 12,
    },
    title: {
        color: '#111827',
        fontSize: 14,
        fontWeight: '700',
    },
    subtitle: {
        marginTop: 2,
        color: '#4B5563',
        fontSize: 12,
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    actionButton: {
        borderRadius: 6,
        backgroundColor: '#E5E7EB',
        paddingHorizontal: 10,
        paddingVertical: 7,
    },
    actionText: {
        color: '#111827',
        fontSize: 12,
        fontWeight: '700',
    },
    logScroller: {
        maxHeight: 360,
        padding: 12,
    },
    logText: {
        color: '#111827',
        fontFamily: 'monospace',
        fontSize: 11,
        lineHeight: 16,
    },
});

export default Issue92246DebugOverlay;
