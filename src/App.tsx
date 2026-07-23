import {PortalProvider} from '@gorhom/portal';
import {setWasmUrl} from '@lottiefiles/dotlottie-react';
import * as Sentry from '@sentry/react-native';
import {maybeCompleteAuthSession} from 'expo-web-browser';
import React, {useEffect} from 'react';
import {LogBox, View} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import Onyx from 'react-native-onyx';
import {PickerStateProvider} from 'react-native-picker-select';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import '../wdyr';
import {ActionSheetAwareScrollViewProvider} from './components/ActionSheetAwareScrollView';
import ActiveElementRoleProvider from './components/ActiveElementRoleProvider';
import ColorSchemeWrapper from './components/ColorSchemeWrapper';
import ComposeProviders from './components/ComposeProviders';
import {CurrentUserPersonalDetailsProvider} from './components/CurrentUserPersonalDetailsProvider';
import CustomStatusBarAndBackground from './components/CustomStatusBarAndBackground';
import CustomStatusBarAndBackgroundContextProvider from './components/CustomStatusBarAndBackground/CustomStatusBarAndBackgroundContextProvider';
import EnvironmentProvider from './components/EnvironmentContextProvider';
import ErrorBoundary from './components/ErrorBoundary';
import FullScreenBlockingViewContextProvider from './components/FullScreenBlockingViewContextProvider';
import FullScreenLoaderContextProvider from './components/FullScreenLoaderContext';
import HTMLEngineProvider from './components/HTMLEngineProvider';
import InitialURLContextProvider from './components/InitialURLContextProvider';
import {InputBlurContextProvider} from './components/InputBlurContext';
import KeyboardProvider from './components/KeyboardProvider';
import {LocaleContextProvider} from './components/LocaleContextProvider';
import {ModalProvider} from './components/Modal/Global/ModalContext';
import NavigationBar from './components/NavigationBar';
import OnyxListItemProvider from './components/OnyxListItemProvider';
import PopoverContextProvider from './components/PopoverProvider';
import SafeArea from './components/SafeArea';
import ScrollOffsetContextProvider from './components/ScrollOffsetContextProvider';
import SidePanelContextProvider from './components/SidePanel/SidePanelContextProvider';
import SVGDefinitionsProvider from './components/SVGDefinitionsProvider';
import ThemeIllustrationsProvider from './components/ThemeIllustrationsProvider';
import ThemeProvider from './components/ThemeProvider';
import ThemeStylesProvider from './components/ThemeStylesContextProvider';
import {EditingCellProvider} from './components/TransactionItemRow/EditableCell';
import {KeyboardStateProvider} from './components/withKeyboardState';
import CONFIG from './CONFIG';
import CONST from './CONST';
import Expensify from './Expensify';
import {CurrentReportIDContextProvider} from './hooks/useCurrentReportID';
import useDefaultDragAndDrop from './hooks/useDefaultDragAndDrop';
import HybridAppHandler from './HybridAppHandler';
import OnyxUpdateManager from './libs/actions/OnyxUpdateManager';
import './libs/HybridApp';
import ONYXKEYS from './ONYXKEYS';
import {ConciergeSessionProvider} from './pages/inbox/ConciergeSessionContext';
import './setup/backgroundLocationTrackingTask';
import './setup/backgroundTask';
import './setup/fraudProtection';
import './setup/hybridApp';
import {SplashScreenStateContextProvider} from './SplashScreenStateContext';

// This is needed to close pop-up window during logout for users logged in via SSO
maybeCompleteAuthSession();

// On web, dotlottie-web fetches its WASM binary from a third-party CDN (jsdelivr/unpkg) at runtime,
// which is blocked by our Content Security Policy. Point it at the Expensify CDN proxy instead.
setWasmUrl(CONST.DOTLOTTIE_WASM_URL);

LogBox.ignoreLogs([
    // Basically it means that if the app goes in the background and back to foreground on Android,
    // the timer is lost. Currently Expensify is using a 30 minutes interval to refresh personal details.
    // More details here: https://git.io/JJYeb
    'Setting a timer for a long period of time',
]);

const fill = {flex: 1};

const StrictModeWrapper = CONFIG.USE_REACT_STRICT_MODE_IN_DEV ? React.StrictMode : ({children}: {children: React.ReactElement}) => children;

type Issue94722EventTiming = {
    name: string;
    startTime: number;
    duration: number;
    processingStart: number;
    processingEnd: number;
    interactionID: number;
    targetLabel: string | null;
};

type Issue94722AnimationFrameTiming = {
    startTime: number;
    nextAnimationFrameTime: number;
    duration: number;
};

type Issue94722BenchmarkWindow = Window & {
    __ISSUE_94722_EVENT_TIMINGS__?: Issue94722EventTiming[];
    __ISSUE_94722_ANIMATION_FRAME_TIMINGS__?: Issue94722AnimationFrameTiming[];
    __ISSUE_94722_FIXTURE_READY__?: {contactCount: number; ownerAccountID: number};
};

function Issue94722BenchmarkHarness() {
    useEffect(() => {
        const benchmarkWindow = window as Issue94722BenchmarkWindow;
        const ownerAccountID = 94722000;
        const ownerEmail = 'inp.fixture.owner@example.com';
        const contactCount = 2000;
        const personalDetails = Object.fromEntries([
            [ownerAccountID, {accountID: ownerAccountID, login: ownerEmail, displayName: 'INP Fixture Owner'}],
            ...Array.from({length: contactCount}, (_, index) => {
                const accountID = ownerAccountID + index + 1;
                const suffix = String(index + 1).padStart(4, '0');
                return [accountID, {accountID, login: `inp.contact.${suffix}@example.com`, displayName: `INP Contact ${suffix}`}];
            }),
        ]);

        void Promise.all([
            Onyx.merge(ONYXKEYS.SESSION, {authToken: 'inp-head-to-head-fixture', accountID: ownerAccountID, email: ownerEmail}),
            Onyx.merge(ONYXKEYS.ACCOUNT, {accountID: ownerAccountID, primaryLogin: ownerEmail}),
            Onyx.merge(ONYXKEYS.PERSONAL_DETAILS_LIST, personalDetails),
            Onyx.merge(ONYXKEYS.NETWORK, {isOffline: true}),
        ]).then(() => {
            benchmarkWindow.__ISSUE_94722_FIXTURE_READY__ = {contactCount, ownerAccountID};
        });

        const eventTimings: Issue94722EventTiming[] = [];
        const animationFrameTimings: Issue94722AnimationFrameTiming[] = [];
        benchmarkWindow.__ISSUE_94722_EVENT_TIMINGS__ = eventTimings;
        benchmarkWindow.__ISSUE_94722_ANIMATION_FRAME_TIMINGS__ = animationFrameTimings;

        const isCheckboxTarget = (target: EventTarget | null) => (target instanceof Element ? target.closest('[data-sentry-label="UserListItem-Checkbox"]') : null);

        const handleClick = (event: MouseEvent) => {
            if (!isCheckboxTarget(event.target)) {
                return;
            }

            const startTime = event.timeStamp;
            requestAnimationFrame((nextAnimationFrameTime) => {
                animationFrameTimings.push({
                    startTime,
                    nextAnimationFrameTime,
                    duration: nextAnimationFrameTime - startTime,
                });
            });
        };

        window.addEventListener('click', handleClick, true);

        let observer: PerformanceObserver | undefined;
        try {
            observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    const eventEntry = entry as PerformanceEntry & {
                        processingStart?: number;
                        processingEnd?: number;
                        interactionId?: number;
                        target?: EventTarget | null;
                    };
                    const checkboxTarget = isCheckboxTarget(eventEntry.target ?? null);
                    if (eventEntry.name !== 'click' || !checkboxTarget) {
                        continue;
                    }

                    eventTimings.push({
                        name: eventEntry.name,
                        startTime: eventEntry.startTime,
                        duration: eventEntry.duration,
                        processingStart: eventEntry.processingStart ?? 0,
                        processingEnd: eventEntry.processingEnd ?? 0,
                        interactionID: eventEntry.interactionId ?? 0,
                        targetLabel: checkboxTarget.getAttribute('aria-label'),
                    });
                }
            });
            observer.observe({type: 'event', buffered: true, durationThreshold: 0} as PerformanceObserverInit);
        } catch {
            observer = undefined;
        }

        return () => {
            window.removeEventListener('click', handleClick, true);
            observer?.disconnect();
        };
    }, []);

    return null;
}

function App() {
    useDefaultDragAndDrop();
    OnyxUpdateManager();

    return (
        <StrictModeWrapper>
            <Issue94722BenchmarkHarness />
            <SplashScreenStateContextProvider>
                <InitialURLContextProvider>
                    <HybridAppHandler />

                    <GestureHandlerRootView style={fill}>
                        {/* Initialize metrics early to ensure the UI renders even when NewDot is hidden.
                            This is necessary for iOS HybridApp's SignInPage to appear correctly without the bootsplash.
                            See: https://github.com/Expensify/App/pull/65178#issuecomment-3139026551
                        */}
                        <SafeAreaProvider
                            initialMetrics={{
                                insets: {top: 0, right: 0, bottom: 0, left: 0},
                                frame: {x: 0, y: 0, width: 0, height: 0},
                            }}
                        >
                            <View
                                style={fill}
                                fsClass={CONST.FULLSTORY.CLASS.UNMASK}
                            >
                                <ComposeProviders
                                    components={[
                                        OnyxListItemProvider,
                                        CurrentUserPersonalDetailsProvider,
                                        LocaleContextProvider,
                                        ThemeProvider,
                                        ThemeStylesProvider,
                                        ThemeIllustrationsProvider,
                                        SVGDefinitionsProvider,
                                        HTMLEngineProvider,
                                        PortalProvider,
                                        SafeArea,
                                        PopoverContextProvider,
                                        CurrentReportIDContextProvider,
                                        ConciergeSessionProvider,
                                        ScrollOffsetContextProvider,
                                        PickerStateProvider,
                                        EnvironmentProvider,
                                        CustomStatusBarAndBackgroundContextProvider,
                                        ActiveElementRoleProvider,
                                        ActionSheetAwareScrollViewProvider,
                                        KeyboardProvider,
                                        KeyboardStateProvider,
                                        InputBlurContextProvider,
                                        FullScreenBlockingViewContextProvider,
                                        FullScreenLoaderContextProvider,
                                        ModalProvider,
                                        SidePanelContextProvider,
                                        EditingCellProvider,
                                    ]}
                                >
                                    <CustomStatusBarAndBackground />
                                    <ErrorBoundary errorMessage="NewExpensify crash caught by error boundary">
                                        <ColorSchemeWrapper>
                                            <Expensify />
                                        </ColorSchemeWrapper>
                                    </ErrorBoundary>
                                    <NavigationBar />
                                </ComposeProviders>
                            </View>
                        </SafeAreaProvider>
                    </GestureHandlerRootView>
                </InitialURLContextProvider>
            </SplashScreenStateContextProvider>
        </StrictModeWrapper>
    );
}

const WrappedApp = Sentry.wrap(App);
WrappedApp.displayName = 'App';
export default WrappedApp;
