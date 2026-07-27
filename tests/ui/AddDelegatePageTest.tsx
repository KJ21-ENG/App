import {render} from '@testing-library/react-native';

import SelectionListWithSections from '@components/SelectionList/SelectionListWithSections';

import usePersonalDetailSearchSelector from '@hooks/usePersonalDetailSearchSelector';

import Navigation from '@libs/Navigation/Navigation';
import type {OptionData} from '@libs/PersonalDetailOptionsListUtils';

import AddDelegatePage from '@pages/settings/Security/AddDelegate/AddDelegatePage';

import ROUTES from '@src/ROUTES';

import type React from 'react';

const validRecentOption: OptionData = {
    accountID: 123,
    alternateText: 'recent@example.com',
    isSelected: false,
    keyForList: 'recent@example.com',
    login: 'recent@example.com',
    reportID: '456',
    text: 'Recent user',
};

const mockToggleSelection = jest.fn();

jest.mock('@components/DelegateNoAccessWrapper', () => jest.fn(({children}: {children: React.ReactNode}) => children));
jest.mock('@components/HeaderWithBackButton', () => jest.fn(() => null));
jest.mock('@components/ScreenWrapper', () => jest.fn(({children}: {children: React.ReactNode}) => children));
jest.mock('@components/SelectionList/ListItem/UserListItem', () => jest.fn(() => null));
jest.mock('@components/SelectionList/SelectionListWithSections', () => jest.fn(() => null));
jest.mock('@hooks/useLocalize', () =>
    jest.fn(() => ({
        translate: (key: string) => key,
    })),
);
jest.mock('@hooks/useOnyx', () => jest.fn(() => [undefined]));
jest.mock('@hooks/usePersonalDetailSearchSelector');
jest.mock('@hooks/useThemeStyles', () =>
    jest.fn(() => ({
        flex1: {},
        pRelative: {},
        w100: {},
    })),
);
jest.mock('@libs/actions/Report', () => ({
    searchUserInServer: jest.fn(),
}));
jest.mock('@libs/Navigation/Navigation', () => ({
    goBack: jest.fn(),
    navigate: jest.fn(),
}));

describe('AddDelegatePage', () => {
    const mockedSelectionList = jest.mocked(SelectionListWithSections);
    const mockedUsePersonalDetailSearchSelector = jest.mocked(usePersonalDetailSearchSelector);

    beforeEach(() => {
        jest.clearAllMocks();
        mockedUsePersonalDetailSearchSelector.mockReturnValue({
            areOptionsInitialized: true,
            availableOptions: {
                personalDetails: [],
                recentOptions: [validRecentOption],
                selectedOptions: [],
                userToInvite: null,
            },
            debouncedSearchTerm: '',
            searchTerm: '',
            selectedNonExistingOptions: [],
            setSearchTerm: jest.fn(),
            toggleSelection: mockToggleSelection,
        } as ReturnType<typeof usePersonalDetailSearchSelector>);
    });

    it('navigates a valid recent contact to the Full or Limited role selection page', () => {
        render(<AddDelegatePage />);

        const selectionListProps = mockedSelectionList.mock.lastCall?.[0];
        const renderedRecentOption = selectionListProps?.sections.at(0)?.data.at(0);

        expect(renderedRecentOption).toEqual(expect.objectContaining({login: validRecentOption.login}));

        if (!renderedRecentOption) {
            throw new Error('Expected a rendered recent option');
        }

        selectionListProps?.onSelectRow(renderedRecentOption);

        expect(mockToggleSelection).toHaveBeenCalledWith(renderedRecentOption);
        expect(Navigation.navigate).toHaveBeenCalledWith(ROUTES.SETTINGS_DELEGATE_ROLE.getRoute(validRecentOption.login ?? ''));
    });
});
