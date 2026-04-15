import {hasSeenTourSelector} from '@selectors/Onboarding';
import {useCallback, useMemo} from 'react';
import type {OnyxCollection} from 'react-native-onyx';
import isSidePanelReportSupported from '@components/SidePanel/isSidePanelReportSupported';
import Log from '@libs/Log';
import {navigateAfterOnboardingWithMicrotaskQueue} from '@libs/navigateAfterOnboarding';
import {createDisplayName} from '@libs/PersonalDetailsUtils';
import {isPaidGroupPolicy, isPolicyAdmin} from '@libs/PolicyUtils';
import {shouldPinAdminRoomByDefault} from '@libs/ReportUtils';
import {createWorkspace, generatePolicyID, newGenerateDefaultWorkspaceName} from '@userActions/Policy/Policy';
import {completeOnboarding, extractRHPVariantFromResponse, togglePinnedState} from '@userActions/Report';
import {setOnboardingAdminsChatReportID, setOnboardingPolicyID} from '@userActions/Welcome';
import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import {lastWorkspaceNumberSelector} from '@src/selectors/Policy';
import type {OnboardingPurpose, OnboardingRHPVariant, Policy} from '@src/types/onyx';
import useArchivedReportsIdSet from './useArchivedReportsIdSet';
import useCurrentUserPersonalDetails from './useCurrentUserPersonalDetails';
import useHasActiveAdminPolicies from './useHasActiveAdminPolicies';
import useLocalize from './useLocalize';
import useOnboardingMessages from './useOnboardingMessages';
import useOnyx from './useOnyx';
import usePermissions from './usePermissions';
import usePreferredPolicy from './usePreferredPolicy';
import useResponsiveLayout from './useResponsiveLayout';

/**
 * Hook that provides a function to auto-create a workspace for Track (PERSONAL_SPEND)
 * users during onboarding and complete the onboarding flow.
 *
 * Shared by BaseOnboardingPersonalDetails and BaseOnboardingPurpose.
 */
function useAutoCreateTrackWorkspace() {
    const [onboardingPolicyID] = useOnyx(ONYXKEYS.ONBOARDING_POLICY_ID);
    const [onboardingAdminsChatReportID] = useOnyx(ONYXKEYS.ONBOARDING_ADMINS_CHAT_REPORT_ID);
    const [introSelected] = useOnyx(ONYXKEYS.NVP_INTRO_SELECTED);
    const [isSelfTourViewed] = useOnyx(ONYXKEYS.NVP_ONBOARDING, {selector: hasSeenTourSelector});
    const [betas] = useOnyx(ONYXKEYS.BETAS);
    const [session] = useOnyx(ONYXKEYS.SESSION);
    const paidGroupPolicySelector = useMemo(
        () => (policies: OnyxCollection<Policy>) => Object.values(policies ?? {}).some((policy) => isPaidGroupPolicy(policy) && isPolicyAdmin(policy, session?.email)),
        [session?.email],
    );
    const lastWorkspaceNumberWithEmailSelector = useCallback(
        (policies: OnyxCollection<Policy>) => {
            return lastWorkspaceNumberSelector(policies, session?.email ?? '');
        },
        [session?.email],
    );
    const [hasPaidGroupAdminPolicy] = useOnyx(ONYXKEYS.COLLECTION.POLICY, {selector: paidGroupPolicySelector});
    const [lastWorkspaceNumber] = useOnyx(ONYXKEYS.COLLECTION.POLICY, {selector: lastWorkspaceNumberWithEmailSelector});
    const [activePolicyID] = useOnyx(ONYXKEYS.NVP_ACTIVE_POLICY_ID);
    const [conciergeChatReportID = ''] = useOnyx(ONYXKEYS.CONCIERGE_REPORT_ID);
    const currentUserPersonalDetails = useCurrentUserPersonalDetails();
    const archivedReportsIdSet = useArchivedReportsIdSet();
    const {isBetaEnabled} = usePermissions();
    const {translate, formatPhoneNumber} = useLocalize();
    const {isRestrictedPolicyCreation} = usePreferredPolicy();
    const hasActiveAdminPolicies = useHasActiveAdminPolicies();
    const {onboardingMessages} = useOnboardingMessages();

    // We use isSmallScreenWidth instead of shouldUseNarrowLayout because navigateAfterOnboarding
    // relies on actual device screen width to handle navigation stack differences: on small screens,
    // removing OnboardingModalNavigator redirects to HOME, requiring explicit navigation to the last
    // accessed report. This behavior is tied to screen size, not responsive layout mode.
    // eslint-disable-next-line rulesdir/prefer-shouldUseNarrowLayout-instead-of-isSmallScreenWidth
    const {isSmallScreenWidth} = useResponsiveLayout();

    const autoCreateTrackWorkspace = useCallback(
        async (firstName: string, lastName: string, onboardingPurposeSelected: OnboardingPurpose) => {
            const shouldCreateWorkspace = !isRestrictedPolicyCreation && !onboardingPolicyID && !hasPaidGroupAdminPolicy;
            const displayName = createDisplayName(session?.email ?? '', {firstName, lastName}, formatPhoneNumber);

            const {adminsChatReportID: newAdminsChatReportID, policyID: newPolicyID} = shouldCreateWorkspace
                ? createWorkspace({
                      policyOwnerEmail: undefined,
                      makeMeAdmin: true,
                      policyName: newGenerateDefaultWorkspaceName(session?.email ?? '', lastWorkspaceNumber, translate, displayName),
                      policyID: generatePolicyID(),
                      engagementChoice: CONST.ONBOARDING_CHOICES.TRACK_WORKSPACE,
                      currency: currentUserPersonalDetails.localCurrencyCode ?? CONST.CURRENCY.USD,
                      file: undefined,
                      shouldAddOnboardingTasks: false,
                      introSelected,
                      activePolicyID,
                      currentUserAccountIDParam: session?.accountID ?? CONST.DEFAULT_NUMBER_ID,
                      currentUserEmailParam: session?.email ?? '',
                      shouldAddGuideWelcomeMessage: false,
                      onboardingPurposeSelected,
                      betas,
                      isSelfTourViewed,
                      hasActiveAdminPolicies,
                  })
                : {adminsChatReportID: onboardingAdminsChatReportID, policyID: onboardingPolicyID};

            // On mobile, hardcode trackExpensesWithConcierge since the web flow already works
            // with the CompleteGuidedSetup response and side panel isn't supported on native.
            let rhpVariant: OnboardingRHPVariant | undefined = isSidePanelReportSupported ? undefined : CONST.ONBOARDING_RHP_VARIANT.TRACK_EXPENSES_WITH_CONCIERGE;
            try {
                const response = await completeOnboarding({
                    engagementChoice: CONST.ONBOARDING_CHOICES.TRACK_WORKSPACE,
                    onboardingMessage: onboardingMessages[CONST.ONBOARDING_CHOICES.TRACK_WORKSPACE],
                    firstName,
                    lastName,
                    adminsChatReportID: newAdminsChatReportID,
                    onboardingPolicyID: newPolicyID,
                    shouldWaitForRHPVariantInitialization: isSidePanelReportSupported,
                    introSelected,
                    isSelfTourViewed,
                    betas,
                });

                if (isSidePanelReportSupported) {
                    rhpVariant = extractRHPVariantFromResponse(response);
                }
            } catch (error) {
                Log.warn('[useAutoCreateTrackWorkspace] Error completing onboarding', {error});
            } finally {
                setOnboardingAdminsChatReportID();
                setOnboardingPolicyID();

                // The CompleteGuidedSetup response's onyxData for TRACK_WORKSPACE contains a
                // single-field merge that sets `isPinned: false` on the freshly-created admins
                // room, which clobbers the optimistic `isPinned: true` set by
                // `buildOptimisticWorkspaceChats` via `shouldPinAdminRoomByDefault()`. Without
                // this, the admins room falls through the LHN's pinned-early-return in
                // `reasonForReportToBeInOptionList` and gets filtered out as an empty chat
                // (onboarding tasks are posted to Concierge, not the admins room, for
                // TRACK_WORKSPACE). Re-apply the intended pin here — passing `false` as the
                // second arg because `togglePinnedState` flips the current value, and we want
                // the new value to be `true`. This also tells the server to persist the pin
                // via TOGGLE_PINNED_CHAT, keeping client and server in sync. See issue #87046.
                if (shouldCreateWorkspace && newAdminsChatReportID && shouldPinAdminRoomByDefault()) {
                    togglePinnedState(newAdminsChatReportID, false);
                }

                // The 6th parameter of `navigateAfterOnboarding` is
                // `onboardingAdminsChatReportID`, used on large screens to open the new
                // admins room as the post-onboarding destination. This call previously
                // passed an unrelated Concierge report ID (typically `undefined` for fresh
                // Track signups), which left large-screen users landing on Home instead of
                // inside the admins room.
                navigateAfterOnboardingWithMicrotaskQueue(
                    isSmallScreenWidth,
                    isBetaEnabled(CONST.BETAS.DEFAULT_ROOMS),
                    conciergeChatReportID,
                    archivedReportsIdSet,
                    newPolicyID,
                    newAdminsChatReportID,
                    false,
                    rhpVariant,
                );
            }
        },
        [
            session?.email,
            session?.accountID,
            lastWorkspaceNumber,
            translate,
            formatPhoneNumber,
            isRestrictedPolicyCreation,
            onboardingPolicyID,
            hasPaidGroupAdminPolicy,
            onboardingAdminsChatReportID,
            currentUserPersonalDetails.localCurrencyCode,
            introSelected,
            activePolicyID,
            isSelfTourViewed,
            onboardingMessages,
            betas,
            hasActiveAdminPolicies,
            isSmallScreenWidth,
            isBetaEnabled,
            conciergeChatReportID,
            archivedReportsIdSet,
        ],
    );

    return autoCreateTrackWorkspace;
}

export default useAutoCreateTrackWorkspace;
