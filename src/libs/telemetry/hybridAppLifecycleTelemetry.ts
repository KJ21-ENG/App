import type {SeverityLevel} from '@sentry/react-native';
import * as Sentry from '@sentry/react-native';
import type {AppStateStatus} from 'react-native';
import {AppState, Platform} from 'react-native';
import Log from '@libs/Log';
import CONFIG from '@src/CONFIG';

type HybridAppLifecycleBreadcrumbData = Record<string, boolean | number | string | null | undefined>;

const CATEGORY = 'hybrid_app.lifecycle';
const ISSUE_ID = 'APP-25V';

function getBreadcrumbData(data: HybridAppLifecycleBreadcrumbData = {}): HybridAppLifecycleBreadcrumbData {
    return {
        issueID: ISSUE_ID,
        platform: Platform.OS,
        appState: AppState.currentState ?? 'unknown',
        timestamp: new Date().toISOString(),
        ...data,
    };
}

function addHybridAppLifecycleBreadcrumb(message: string, data?: HybridAppLifecycleBreadcrumbData, level: SeverityLevel = 'info'): void {
    if (!CONFIG.IS_HYBRID_APP) {
        return;
    }

    const breadcrumbData = getBreadcrumbData(data);
    Sentry.addBreadcrumb({
        category: CATEGORY,
        message: `[${ISSUE_ID}] ${message}`,
        level,
        data: breadcrumbData,
    });
    Log.info(`[${ISSUE_ID}][HybridApp] ${message}`, false, breadcrumbData);
}

function startHybridAppLifecycleAppStateBreadcrumbs(): () => void {
    if (!CONFIG.IS_HYBRID_APP) {
        return () => {};
    }

    let previousAppState: AppStateStatus = AppState.currentState ?? 'unknown';
    addHybridAppLifecycleBreadcrumb('AppState listener attached', {currentAppState: previousAppState});

    const appStateChangeSubscription = AppState.addEventListener('change', (nextAppState) => {
        addHybridAppLifecycleBreadcrumb('AppState changed', {previousAppState, nextAppState});
        previousAppState = nextAppState;
    });

    return () => {
        addHybridAppLifecycleBreadcrumb('AppState listener removed', {previousAppState});
        appStateChangeSubscription.remove();
    };
}

export {addHybridAppLifecycleBreadcrumb, startHybridAppLifecycleAppStateBreadcrumbs};
