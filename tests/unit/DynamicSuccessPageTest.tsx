import {fireEvent, render, screen} from '@testing-library/react-native';
import React from 'react';
import type {ComponentProps} from 'react';
import type {ResultMetadata} from 'react-native-onyx';
import Navigation from '@libs/Navigation/Navigation';
import DynamicSuccessPage from '@pages/settings/Security/TwoFactorAuth/DynamicSuccessPage';
import {clearTwoFactorAuthData} from '@userActions/TwoFactorAuthActions';
import {startOnboardingFlow} from '@userActions/Welcome/OnboardingFlow';
import ONYXKEYS from '@src/ONYXKEYS';
import ROUTES from '@src/ROUTES';
import SCREENS from '@src/SCREENS';

const mockUseOnyx = jest.fn();
const mockUseDynamicBackPath = jest.fn();
const mockUseDynamicForwardPath = jest.fn();
const mockGetStateFromPath = jest.fn();

jest.mock('@expensify/react-native-hybrid-app', () => ({
    __esModule: true,
    default: {
        closeReactNativeApp: jest.fn(),
        isHybridApp: jest.fn(() => false),
    },
}));

jest.mock('@hooks/useOnyx', () => ({
    __esModule: true,
    default: (...args: unknown[]) => mockUseOnyx(...args) as unknown,
}));

jest.mock('@hooks/useDynamicBackPath', () => ({
    __esModule: true,
    default: (...args: unknown[]) => mockUseDynamicBackPath(...args) as unknown,
}));

jest.mock('@hooks/useDynamicForwardPath', () => ({
    __esModule: true,
    default: (...args: unknown[]) => mockUseDynamicForwardPath(...args) as unknown,
}));

jest.mock('@hooks/useEnvironment', () => ({
    __esModule: true,
    default: () => ({environmentURL: 'https://new.expensify.com'}),
}));

jest.mock('@libs/Navigation/helpers/getStateFromPath', () => ({
    __esModule: true,
    default: (...args: unknown[]) => mockGetStateFromPath(...args) as unknown,
}));

jest.mock('@libs/Navigation/Navigation', () => ({
    __esModule: true,
    default: {
        goBack: jest.fn(),
        navigate: jest.fn(),
        revealRouteBeforeDismissingModal: jest.fn(),
    },
}));

jest.mock('@libs/TryNewDotUtils', () => ({
    shouldHideOldAppRedirect: jest.fn(() => false),
}));

jest.mock('@libs/actions/connections/Xero', () => ({
    getXeroSetupLink: jest.fn(),
}));

jest.mock('@userActions/BankAccounts', () => ({
    openReimbursementAccountPage: jest.fn(),
}));

jest.mock('@userActions/HybridApp', () => ({
    closeReactNativeApp: jest.fn(),
}));

jest.mock('@userActions/Link', () => ({
    openLink: jest.fn(),
}));

jest.mock('@userActions/TwoFactorAuthActions', () => ({
    clearTwoFactorAuthData: jest.fn(),
    quitAndNavigateBack: jest.fn(),
}));

jest.mock('@userActions/Welcome/OnboardingFlow', () => ({
    startOnboardingFlow: jest.fn(),
}));

jest.mock('@pages/settings/Security/TwoFactorAuth/SuccessPageBase', () => {
    const {Pressable, Text} = jest.requireActual<typeof import('react-native')>('react-native');

    return {
        __esModule: true,
        default: ({onButtonPress}: {onButtonPress: () => void}) => (
            <Pressable
                testID="success-button"
                onPress={onButtonPress}
            >
                <Text>Done</Text>
            </Pressable>
        ),
    };
});

describe('DynamicSuccessPage', () => {
    const loadedMetadata = {status: 'loaded'} as ResultMetadata<unknown>;
    const onyxValues = new Map<string, unknown>();
    const defaultProps = {
        route: {
            key: 'two-factor-success',
            name: SCREENS.TWO_FACTOR_AUTH.DYNAMIC_SUCCESS,
            params: {},
        },
    } as ComponentProps<typeof DynamicSuccessPage>;

    beforeEach(() => {
        jest.clearAllMocks();
        onyxValues.clear();
        mockUseDynamicBackPath.mockReturnValue(ROUTES.SETTINGS_SECURITY);
        mockUseDynamicForwardPath.mockReturnValue(undefined);
        mockGetStateFromPath.mockReturnValue({
            key: 'root',
            index: 0,
            routeNames: [SCREENS.SETTINGS.SECURITY],
            routes: [{key: 'security', name: SCREENS.SETTINGS.SECURITY}],
            stale: false,
            type: 'stack',
        });
        mockUseOnyx.mockImplementation((key: string) => [onyxValues.get(key), loadedMetadata]);
    });

    it('returns to onboarding after required 2FA setup succeeds while guided setup is incomplete', () => {
        const onboardingValues = {hasCompletedGuidedSetupFlow: false, signupQualifier: 'smb'};
        onyxValues.set(ONYXKEYS.ACCOUNT, {
            twoFactorAuthSetupInProgress: true,
            isFromPublicDomain: false,
            hasAccessibleDomainPolicies: true,
            validated: true,
        });
        onyxValues.set(ONYXKEYS.NVP_ONBOARDING, onboardingValues);
        onyxValues.set(ONYXKEYS.ONBOARDING_PURPOSE_SELECTED, 'manage_team');
        onyxValues.set(ONYXKEYS.ONBOARDING_COMPANY_SIZE, 'small');
        onyxValues.set(ONYXKEYS.ONBOARDING_LAST_VISITED_PATH, '/onboarding/personal-details');

        render(<DynamicSuccessPage {...defaultProps} />);
        fireEvent.press(screen.getByTestId('success-button'));

        expect(clearTwoFactorAuthData).toHaveBeenCalledWith(true);
        expect(Navigation.revealRouteBeforeDismissingModal).toHaveBeenCalledWith(ROUTES.HOME, {afterTransition: expect.any(Function)});
        expect(startOnboardingFlow).not.toHaveBeenCalled();

        const revealOptions = (Navigation.revealRouteBeforeDismissingModal as jest.Mock).mock.calls.at(0)?.at(1) as {afterTransition: () => void};
        revealOptions.afterTransition();

        expect(startOnboardingFlow).toHaveBeenCalledWith({
            onboardingValuesParam: onboardingValues,
            isUserFromPublicDomain: false,
            hasAccessiblePolicies: true,
            currentOnboardingCompanySize: 'small',
            currentOnboardingPurposeSelected: 'manage_team',
            onboardingInitialPath: '/onboarding/personal-details',
            onboardingValues,
            isAccountValidated: true,
        });
        expect(Navigation.navigate).not.toHaveBeenCalled();
    });

    it('keeps completed onboarding users on the 2FA enabled settings page', () => {
        onyxValues.set(ONYXKEYS.ACCOUNT, {
            twoFactorAuthSetupInProgress: true,
            validated: true,
        });
        onyxValues.set(ONYXKEYS.NVP_ONBOARDING, {hasCompletedGuidedSetupFlow: true});

        render(<DynamicSuccessPage {...defaultProps} />);
        fireEvent.press(screen.getByTestId('success-button'));

        expect(Navigation.navigate).toHaveBeenCalledWith(ROUTES.SETTINGS_2FA_ENABLED, {forceReplace: true});
        expect(clearTwoFactorAuthData).toHaveBeenCalledWith(true);
        expect(startOnboardingFlow).not.toHaveBeenCalled();
    });
});
