import React, {useEffect, useMemo, useRef} from 'react';
import HeaderWithBackButton from '@components/HeaderWithBackButton';
import {useSession} from '@components/OnyxListItemProvider';
import ScreenWrapper from '@components/ScreenWrapper';
import useAndroidBackButtonHandler from '@hooks/useAndroidBackButtonHandler';
import useOnyx from '@hooks/useOnyx';
import useStyleUtils from '@hooks/useStyleUtils';
import useTheme from '@hooks/useTheme';
import {openApp} from '@libs/actions/App';
import {joinRoom} from '@libs/actions/Report';
import {isMobileSafari} from '@libs/Browser';
import Navigation from '@libs/Navigation/Navigation';
import {waitForIdle} from '@libs/Network/SequentialQueue';
import {isChatThread, isHiddenForCurrentUser, isPublicRoom, isValidReport} from '@libs/ReportUtils';
import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import ROUTES from '@src/ROUTES';
import SCREENS from '@src/SCREENS';
import SignInPageWrapped, {SignInPage} from './SignInPage';
import type {SignInPageRef} from './SignInPage';

function SignInModal() {
    const theme = useTheme();
    const StyleUtils = useStyleUtils();
    const signinPageRef = useRef<SignInPageRef | null>(null);
    const session = useSession();
    const [isLoadingApp] = useOnyx(ONYXKEYS.IS_LOADING_APP);
    const [allReports] = useOnyx(ONYXKEYS.COLLECTION.REPORT);
    const hasSignedInRef = useRef(false);
    const signInOriginReportIDRef = useRef<string | undefined>(undefined);
    // Use of SignInPageWrapped (with shouldEnableMaxHeight prop in SignInPageWrapper) is a workaround for Safari not supporting interactive-widget=resizes-content.
    // This allows better scrolling experience after keyboard shows for modals with input, that are larger than remaining screen height.
    // More info https://github.com/Expensify/App/pull/62799#issuecomment-2943136220.
    const SignInPageBase = useMemo(() => (isMobileSafari() ? SignInPageWrapped : SignInPage), []);

    // The SignInPage (child component of SignInModal) uses useAndroidBackButtonHandler, which adds a hardwareBackPress listener that remains active in the SignInModal.
    // Use of useAndroidBackButtonHandler with a returning true callback disables the default SignInModal hardware Android button behaviour, leaving only SignInPage handling (https://github.com/Expensify/App/issues/69391).
    // The SignInPage Android back button behavior needs to remain because it is a fix for issue (https://github.com/Expensify/App/issues/67883) that occurs in the SignInModal.
    useAndroidBackButtonHandler(() => {
        return true;
    });

    useEffect(() => {
        const isAnonymousUser = session?.authTokenType === CONST.AUTH_TOKEN_TYPES.ANONYMOUS;
        if (!isAnonymousUser) {
            hasSignedInRef.current = true;
            signInOriginReportIDRef.current = Navigation.getTopmostReportId();

            // To prevent deadlock when OpenReport and OpenApp overlap, wait for the queue to be idle before calling openApp.
            // This ensures that any communication gaps between the client and server during OpenReport processing do not cause the queue to pause,
            // which would prevent us from processing or clearing the queue.
            waitForIdle().then(() => openApp(true));
        }
    }, [session?.authTokenType]);

    // Wait for IS_LOADING_APP to become false after sign-in before dismissing the modal.
    // openApp queues a request and IS_LOADING_APP only transitions to false once the response
    // is processed and NVP_ONBOARDING is loaded. Dismissing at that point ensures OnboardingGuard
    // evaluates with accurate data and properly redirects new users to onboarding.
    useEffect(() => {
        if (!hasSignedInRef.current || isLoadingApp !== false) {
            return;
        }

        hasSignedInRef.current = false;

        const originReportID = signInOriginReportIDRef.current;
        signInOriginReportIDRef.current = undefined;

        const originReport = originReportID ? allReports?.[`${ONYXKEYS.COLLECTION.REPORT}${originReportID}`] : undefined;
        const publicRoomReportID = isChatThread(originReport) ? originReport.parentReportID : originReportID;
        const publicRoomReport = publicRoomReportID ? allReports?.[`${ONYXKEYS.COLLECTION.REPORT}${publicRoomReportID}`] : undefined;
        const currentUserAccountID = session?.accountID;

        if (
            currentUserAccountID &&
            isPublicRoom(publicRoomReport) &&
            isValidReport(publicRoomReport) &&
            isHiddenForCurrentUser(publicRoomReport?.participants?.[currentUserAccountID]?.notificationPreference)
        ) {
            joinRoom(publicRoomReport, currentUserAccountID);
        }

        Navigation.dismissModal();
        Navigation.navigate(ROUTES.HOME);
    }, [allReports, isLoadingApp, session?.accountID]);

    return (
        <ScreenWrapper
            style={[StyleUtils.getBackgroundColorStyle(theme.PAGE_THEMES[SCREENS.RIGHT_MODAL.SIGN_IN].backgroundColor)]}
            includeSafeAreaPaddingBottom={false}
            shouldShowOfflineIndicator={false}
            testID="SignInModal"
        >
            <HeaderWithBackButton
                onBackButtonPress={() => {
                    if (!signinPageRef.current) {
                        Navigation.goBack();
                        return;
                    }
                    signinPageRef.current?.navigateBack();
                }}
            />
            <SignInPageBase ref={signinPageRef} />
        </ScreenWrapper>
    );
}

export default SignInModal;
