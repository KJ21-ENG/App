import {isSingleNewDotEntrySelector} from '@selectors/HybridApp';
import {hasCompletedGuidedSetupFlowSelector, isInvitedWorkspaceMemberSelector, tryNewDotOnyxSelector} from '@selectors/Onboarding';
import {emailSelector} from '@selectors/Session';
import type {OnyxCollection} from 'react-native-onyx';
import {useCallback, useEffect} from 'react';
import getCurrentUrl from '@libs/Navigation/currentUrl';
import Navigation from '@libs/Navigation/Navigation';
// eslint-disable-next-line no-restricted-imports
import TransitionTracker from '@libs/Navigation/TransitionTracker';
import {isLoggingInAsNewUser} from '@libs/SessionUtils';
import {startOnboardingFlow} from '@userActions/Welcome/OnboardingFlow';
import CONFIG from '@src/CONFIG';
import ONYXKEYS from '@src/ONYXKEYS';
import ROUTES from '@src/ROUTES';
import type {Policy} from '@src/types/onyx';
import isLoadingOnyxValue from '@src/types/utils/isLoadingOnyxValue';
import useOnyx from './useOnyx';

/**
 * Hook to handle redirection to the onboarding flow based on the user's onboarding status
 *
 * Warning: This hook should be used only once in the app
 */
function useOnboardingFlowRouter() {
    const currentUrl = getCurrentUrl();
    const [isLoadingApp = true] = useOnyx(ONYXKEYS.IS_LOADING_APP);
    const [onboardingValues, isOnboardingCompletedMetadata] = useOnyx(ONYXKEYS.NVP_ONBOARDING);
    const [account] = useOnyx(ONYXKEYS.ACCOUNT);
    const [sessionEmail] = useOnyx(ONYXKEYS.SESSION, {selector: emailSelector});
    const isLoggingInAsNewSessionUser = isLoggingInAsNewUser(currentUrl, sessionEmail);
    const getIsInvitedWorkspaceMember = useCallback(
        (policies: OnyxCollection<Policy> | null | undefined) => isInvitedWorkspaceMemberSelector(policies, sessionEmail),
        [sessionEmail],
    );
    const [isInvitedWorkspaceMember = false, isInvitedWorkspaceMemberMetadata] = useOnyx(
        ONYXKEYS.COLLECTION.POLICY,
        {selector: getIsInvitedWorkspaceMember},
        [sessionEmail],
    );
    const [tryNewDot, tryNewDotMetadata] = useOnyx(ONYXKEYS.NVP_TRY_NEW_DOT, {
        selector: tryNewDotOnyxSelector,
    });
    const {isHybridAppOnboardingCompleted, hasBeenAddedToNudgeMigration} = tryNewDot ?? {};
    const isOnboardingLoading = isLoadingOnyxValue(isOnboardingCompletedMetadata, tryNewDotMetadata);

    const [, dismissedProductTrainingMetadata] = useOnyx(ONYXKEYS.NVP_DISMISSED_PRODUCT_TRAINING);

    const [onboardingPurposeSelected] = useOnyx(ONYXKEYS.ONBOARDING_PURPOSE_SELECTED);
    const [onboardingCompanySize] = useOnyx(ONYXKEYS.ONBOARDING_COMPANY_SIZE);
    const [onboardingInitialPath] = useOnyx(ONYXKEYS.ONBOARDING_LAST_VISITED_PATH);

    const [isSingleNewDotEntry, isSingleNewDotEntryMetadata] = useOnyx(ONYXKEYS.HYBRID_APP, {selector: isSingleNewDotEntrySelector});

    const isOnboardingCompleted = hasCompletedGuidedSetupFlowSelector(onboardingValues);
    const isOnboardingRoute = currentUrl?.includes(`/${ROUTES.ONBOARDING_ROOT.route}`) ?? false;

    useEffect(() => {
        // This should delay opening the onboarding modal so it does not interfere with the ongoing ReportScreen params changes

        const handle = TransitionTracker.runAfterTransitions({
            callback: () => {
                // Prevent showing onboarding if we are logging in as a new user with short lived token
                if (currentUrl?.includes(ROUTES.TRANSITION_BETWEEN_APPS) && isLoggingInAsNewSessionUser) {
                    return;
                }

                if (isLoadingApp !== false || isOnboardingLoading) {
                    return;
                }

                if (isLoadingOnyxValue(isOnboardingCompletedMetadata, tryNewDotMetadata, dismissedProductTrainingMetadata, isInvitedWorkspaceMemberMetadata)) {
                    return;
                }

                if (CONFIG.IS_HYBRID_APP && isLoadingOnyxValue(isSingleNewDotEntryMetadata)) {
                    return;
                }

                if (CONFIG.IS_HYBRID_APP) {
                    // For single entries, such as using the Travel feature from OldDot, we don't want to show onboarding
                    if (isSingleNewDotEntry) {
                        return;
                    }

                    // When user is transitioning from OldDot to NewDot, we usually show the explanation modal
                    if (isHybridAppOnboardingCompleted === false) {
                        Navigation.navigate(ROUTES.EXPLANATION_MODAL_ROOT);
                    }
                }

                const isMigratedUser = hasBeenAddedToNudgeMigration ?? false;
                const shouldSkipForInvitedWorkspaceMember = !CONFIG.IS_HYBRID_APP && isInvitedWorkspaceMember;
                if (shouldSkipForInvitedWorkspaceMember && isOnboardingRoute) {
                    Navigation.dismissModal();
                    return;
                }

                if (isMigratedUser || shouldSkipForInvitedWorkspaceMember) {
                    return;
                }

                // Explicitly start the onboarding flow when onboarding is not completed.
                // We use startOnboardingFlow (which calls resetRoot) instead of Navigation.navigate because
                // navigate goes through the router where OnboardingGuard would block the navigation.
                // waitForProtectedRoutes ensures navigation is ready, which is critical during fresh login.
                // Skip when HybridApp explanation modal is active (OldDot-transitioning users).
                if (isOnboardingCompleted === false && !(CONFIG.IS_HYBRID_APP && isHybridAppOnboardingCompleted === false)) {
                    Navigation.waitForProtectedRoutes().then(() => {
                        startOnboardingFlow({
                            onboardingValuesParam: onboardingValues ?? undefined,
                            isUserFromPublicDomain: !!account?.isFromPublicDomain,
                            hasAccessiblePolicies: !!account?.hasAccessibleDomainPolicies,
                            currentOnboardingCompanySize: onboardingCompanySize,
                            currentOnboardingPurposeSelected: onboardingPurposeSelected,
                            onboardingInitialPath,
                            onboardingValues,
                        });
                    });
                }
            },
        });

        return () => {
            handle.cancel();
        };
    }, [
        isLoadingApp,
        isHybridAppOnboardingCompleted,
        isOnboardingCompletedMetadata,
        tryNewDotMetadata,
        isSingleNewDotEntryMetadata,
        isSingleNewDotEntry,
        dismissedProductTrainingMetadata,
        currentUrl,
        isLoggingInAsNewSessionUser,
        isOnboardingLoading,
        onboardingValues,
        account?.isFromPublicDomain,
        account?.hasAccessibleDomainPolicies,
        onboardingCompanySize,
        onboardingPurposeSelected,
        onboardingInitialPath,
        hasBeenAddedToNudgeMigration,
        isInvitedWorkspaceMember,
        isInvitedWorkspaceMemberMetadata,
        isOnboardingCompleted,
        isOnboardingRoute,
    ]);

    return {
        isOnboardingCompleted: hasCompletedGuidedSetupFlowSelector(onboardingValues),
        isHybridAppOnboardingCompleted,
        isOnboardingLoading: !!onboardingValues?.isLoading,
    };
}

export default useOnboardingFlowRouter;
