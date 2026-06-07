import {isTrackingSelector} from '@selectors/GPSDraftDetails';
import {hasSeenTourSelector} from '@selectors/Onboarding';
import {differenceInDays} from 'date-fns';
import {deepEqual} from 'fast-equals';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {TextInputProps} from 'react-native';
// eslint-disable-next-line no-restricted-imports
import {InteractionManager, View} from 'react-native';
import type {ValueOf} from 'type-fest';
import HeaderWithBackButton from '@components/HeaderWithBackButton';
import type {ExpensifyIconName} from '@components/Icon/ExpensifyIconLoader';
import getLastRoute from '@components/Navigation/NavigationTabBar/getLastRoute';
import {usePersonalDetails} from '@components/OnyxListItemProvider';
import type {AnimatedTextInputRef} from '@components/RNTextInput';
import DeferredAutocompleteList from '@components/Search/DeferredSearchAutocompleteList';
import type {GetAdditionalSectionsCallback} from '@components/Search/SearchAutocompleteList';
import {useSearchQueryActions} from '@components/Search/SearchContext';
import SearchInputSelectionWrapper from '@components/Search/SearchInputSelectionWrapper';
import type {SearchQueryItem} from '@components/Search/SearchList/ListItem/SearchQueryListItem';
import {isSearchQueryItem} from '@components/Search/SearchList/ListItem/SearchQueryListItem';
import type {SearchQueryString} from '@components/Search/types';
import type {SelectionListWithSectionsHandle} from '@components/SelectionList/SelectionListWithSections/types';
import useCurrentUserPersonalDetails from '@hooks/useCurrentUserPersonalDetails';
import useDebouncedState from '@hooks/useDebouncedState';
import useKeyboardShortcut from '@hooks/useKeyboardShortcut';
import {useMemoizedLazyExpensifyIcons} from '@hooks/useLazyAsset';
import useLocalize from '@hooks/useLocalize';
import useOnyx from '@hooks/useOnyx';
import usePermissions from '@hooks/usePermissions';
import useReportOrReportDraft from '@hooks/useReportOrReportDraft';
import useResponsiveLayout from '@hooks/useResponsiveLayout';
import useRestoreWorkspacesTabOnNavigate from '@hooks/useRestoreWorkspacesTabOnNavigate';
import useRootNavigationState from '@hooks/useRootNavigationState';
import useSearchTypeMenuSections from '@hooks/useSearchTypeMenuSections';
import useSubscriptionPlan from '@hooks/useSubscriptionPlan';
import useThemeStyles from '@hooks/useThemeStyles';
import {resetExitSurveyForm} from '@libs/actions/ExitSurvey';
import {closeReactNativeApp} from '@libs/actions/HybridApp';
import {openOldDotLink} from '@libs/actions/Link';
import clearSelectedText from '@libs/clearSelectedText/clearSelectedText';
import {scrollToRight} from '@libs/InputUtils';
import interceptAnonymousUser from '@libs/interceptAnonymousUser';
import backHistory from '@libs/Navigation/helpers/backHistory';
import createDynamicRoute from '@libs/Navigation/helpers/dynamicRoutesUtils/createDynamicRoute';
import navigationRef from '@libs/Navigation/navigationRef';
import type {SearchOption} from '@libs/OptionsListUtils';
import {createOptionFromReport} from '@libs/OptionsListUtils';
import Parser from '@libs/Parser';
import {getReportAction, isDeletedAction} from '@libs/ReportActionsUtils';
import {isHiddenForCurrentUser} from '@libs/ReportUtils';
import type {OptionData} from '@libs/ReportUtils';
import {getAutocompleteQueryWithComma, getTrimmedUserSearchQueryPreservingComma} from '@libs/SearchAutocompleteUtils';
import {buildCannedSearchQuery, buildSearchQueryJSON, buildSearchQueryString, getQueryWithUpdatedValues, sanitizeSearchValue} from '@libs/SearchQueryUtils';
import {useIsAgentAccount} from '@libs/SessionUtils';
import StringUtils from '@libs/StringUtils';
import {startSpan} from '@libs/telemetry/activeSpans';
import {shouldHideOldAppRedirect} from '@libs/TryNewDotUtils';
import Navigation from '@navigation/Navigation';
import type {ReportsSplitNavigatorParamList, SearchFullscreenNavigatorParamList} from '@navigation/types';
import variables from '@styles/variables';
import {navigateToAndOpenReport, searchInServer} from '@userActions/Report';
import {setSearchContext} from '@userActions/Search';
import CONFIG from '@src/CONFIG';
import CONST from '@src/CONST';
import NAVIGATORS from '@src/NAVIGATORS';
import ONYXKEYS from '@src/ONYXKEYS';
import ROUTES, {DYNAMIC_ROUTES} from '@src/ROUTES';
import SCREENS from '@src/SCREENS';
import type {ReportActions} from '@src/types/onyx';
import type Report from '@src/types/onyx/Report';
import isLoadingOnyxValue from '@src/types/utils/isLoadingOnyxValue';
import type {SubstitutionMap} from './getQueryWithSubstitutions';
import {getQueryWithSubstitutions} from './getQueryWithSubstitutions';
import {getUpdatedSubstitutionsMap} from './getUpdatedSubstitutionsMap';
import {
    getBalancedNavigationSearchOptions,
    getNavigationSearchOptions,
    getSpendNavigationIconNames,
    getSpendNavigationSearchOptions,
    getTopLevelNavigationSearchOptions,
    getWorkspaceNavigationSearchOptions,
    NAVIGATION_OPTION_ICONS,
    NAVIGATION_TAB_ICONS,
    TOP_LEVEL_NAVIGATION_ICONS,
    WORKSPACE_NAVIGATION_ICONS,
} from './navigationOptions';
import type {AccountNavigationContext, TopLevelNavigationActions} from './navigationOptions';
import {clearPendingRouterQuery, peekPendingRouterQuery} from './SearchRouterContext';
import {getContextualReportData, getContextualSearchAutocompleteKey, getContextualSearchQuery} from './SearchRouterUtils';
import updateAutocompleteSubstitutionsForSelection from './updateAutocompleteSubstitutionsForSelection';
import useAskConcierge from './useAskConcierge';
import useCreateMenuSearchOptions from './useCreateMenuSearchOptions';

const privateIsArchivedSelector = (nvp: {private_isArchived?: string} | undefined): boolean | undefined => !!nvp?.private_isArchived;

type SearchRouterProps = {
    onRouterClose: () => void;
    shouldHideInputCaret?: TextInputProps['caretHidden'];
    isSearchRouterDisplayed?: boolean;
    ref?: React.Ref<View>;
};

function SearchRouter({onRouterClose, shouldHideInputCaret, isSearchRouterDisplayed, ref}: SearchRouterProps) {
    const {translate} = useLocalize();
    const styles = useThemeStyles();
    const {setShouldResetSearchQuery} = useSearchQueryActions();
    const currentUserPersonalDetails = useCurrentUserPersonalDetails();
    const currentUserAccountID = currentUserPersonalDetails.accountID;
    const currentUserEmail = currentUserPersonalDetails.login;
    const [isSearchingForReports] = useOnyx(ONYXKEYS.RAM_ONLY_IS_SEARCHING_FOR_REPORTS);
    const [introSelected] = useOnyx(ONYXKEYS.NVP_INTRO_SELECTED);
    const [betas] = useOnyx(ONYXKEYS.BETAS);
    const [isSelfTourViewed] = useOnyx(ONYXKEYS.NVP_ONBOARDING, {selector: hasSeenTourSelector});
    const [policies] = useOnyx(ONYXKEYS.COLLECTION.POLICY);
    const [lastSearchParams] = useOnyx(ONYXKEYS.REPORT_NAVIGATION_LAST_SEARCH_QUERY);
    const [amountOwed = 0] = useOnyx(ONYXKEYS.NVP_PRIVATE_AMOUNT_OWED);
    const [tryNewDot, tryNewDotMetadata] = useOnyx(ONYXKEYS.NVP_TRY_NEW_DOT);
    const [isTrackingGPS = false] = useOnyx(ONYXKEYS.GPS_DRAFT_DETAILS, {selector: isTrackingSelector});
    const subscriptionPlan = useSubscriptionPlan();
    const personalDetails = usePersonalDetails();
    const {shouldUseNarrowLayout} = useResponsiveLayout();
    const {isBetaEnabled} = usePermissions();
    const isRoomsBetaEnabled = isBetaEnabled(CONST.BETAS.WORKSPACE_ROOMS_PAGE);
    const isAgentAccount = useIsAgentAccount();
    const {typeMenuSections} = useSearchTypeMenuSections();
    const navigateToWorkspaces = useRestoreWorkspacesTabOnNavigate();
    const listRef = useRef<SelectionListWithSectionsHandle>(null);
    const iconNames = useMemo<ExpensifyIconName[]>(
        () => [
            'MagnifyingGlass',
            'ConciergeAvatar',
            ...NAVIGATION_OPTION_ICONS,
            ...WORKSPACE_NAVIGATION_ICONS,
            ...NAVIGATION_TAB_ICONS,
            ...TOP_LEVEL_NAVIGATION_ICONS,
            ...getSpendNavigationIconNames(typeMenuSections),
        ],
        [typeMenuSections],
    );
    const expensifyIcons = useMemoizedLazyExpensifyIcons(iconNames);
    const {askConcierge, shouldShowAskConcierge} = useAskConcierge();
    const getCreateMenuSearchOptions = useCreateMenuSearchOptions();

    const initialQuery = peekPendingRouterQuery();

    // The actual input text that the user sees
    const [textInputValue, , setTextInputValue] = useDebouncedState(initialQuery, 500);
    // The input text that was last used for autocomplete; needed for the SearchAutocompleteList when browsing list via arrow keys
    const [autocompleteQueryValue, setAutocompleteQueryValue] = useState(initialQuery);
    const [selection, setSelection] = useState({start: initialQuery.length, end: initialQuery.length});

    useEffect(() => {
        clearPendingRouterQuery();
    }, []);
    const [autocompleteSubstitutions, setAutocompleteSubstitutions] = useState<SubstitutionMap>({});
    const textInputRef = useRef<AnimatedTextInputRef>(null);

    const {contextualReportID, isSearchRouterScreen} = useRootNavigationState(getContextualReportData);
    const lastReportRouteReportID = useRootNavigationState((rootState) => {
        if (!rootState) {
            return undefined;
        }
        const route = getLastRoute(rootState, NAVIGATORS.REPORTS_SPLIT_NAVIGATOR, SCREENS.REPORT);
        return (route?.params as ReportsSplitNavigatorParamList[typeof SCREENS.REPORT])?.reportID;
    });
    const lastReportRouteReportActionID = useRootNavigationState((rootState) => {
        if (!rootState) {
            return undefined;
        }
        const route = getLastRoute(rootState, NAVIGATORS.REPORTS_SPLIT_NAVIGATOR, SCREENS.REPORT);
        return (route?.params as ReportsSplitNavigatorParamList[typeof SCREENS.REPORT])?.reportActionID;
    });
    const [doesLastReportExist] = useOnyx(`${ONYXKEYS.COLLECTION.REPORT}${lastReportRouteReportID}`, {selector: (report: Report | null | undefined) => !!report?.reportID}, [
        lastReportRouteReportID,
    ]);
    const doesLastReportActionExistSelector = useCallback(
        (reportActions: ReportActions | null | undefined) => {
            const reportAction = lastReportRouteReportActionID ? reportActions?.[lastReportRouteReportActionID] : undefined;
            return !!reportAction && !isDeletedAction(reportAction);
        },
        [lastReportRouteReportActionID],
    );
    const [doesLastReportActionExist] = useOnyx(`${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${lastReportRouteReportID}`, {selector: doesLastReportActionExistSelector}, [
        doesLastReportActionExistSelector,
        lastReportRouteReportID,
    ]);

    const navigateToHome = useCallback(() => {
        Navigation.navigate(ROUTES.HOME);
    }, []);
    const navigateToInbox = useCallback(() => {
        startSpan(CONST.TELEMETRY.SPAN_NAVIGATE_TO_INBOX_TAB, {
            name: CONST.TELEMETRY.SPAN_NAVIGATE_TO_INBOX_TAB,
            op: CONST.TELEMETRY.SPAN_NAVIGATE_TO_INBOX_TAB,
        });

        if (!shouldUseNarrowLayout && doesLastReportExist) {
            const rootState = navigationRef.getRootState();
            const lastRoute = rootState ? getLastRoute(rootState, NAVIGATORS.REPORTS_SPLIT_NAVIGATOR, SCREENS.REPORT) : undefined;
            if (lastRoute) {
                const {reportID, reportActionID, referrer, backTo} = lastRoute.params as ReportsSplitNavigatorParamList[typeof SCREENS.REPORT];
                Navigation.navigate(ROUTES.REPORT_WITH_ID.getRoute(reportID, doesLastReportActionExist ? reportActionID : undefined, referrer, backTo));
                return;
            }
        }

        Navigation.navigate(ROUTES.INBOX);
    }, [doesLastReportActionExist, doesLastReportExist, shouldUseNarrowLayout]);
    const navigateToSpend = useCallback(() => {
        clearSelectedText();
        interceptAnonymousUser(() => {
            startSpan(CONST.TELEMETRY.SPAN_NAVIGATE_TO_REPORTS, {
                name: CONST.TELEMETRY.SPAN_NAVIGATE_TO_REPORTS,
                op: CONST.TELEMETRY.SPAN_NAVIGATE_TO_REPORTS,
                forceTransaction: true,
            });

            const lastSearchRoute = getLastRoute(navigationRef.getRootState(), NAVIGATORS.SEARCH_FULLSCREEN_NAVIGATOR, SCREENS.SEARCH.ROOT);
            if (lastSearchRoute) {
                const {q, ...rest} = lastSearchRoute.params as SearchFullscreenNavigatorParamList[typeof SCREENS.SEARCH.ROOT];
                const queryJSON = buildSearchQueryJSON(q);
                if (queryJSON) {
                    Navigation.navigate(ROUTES.SEARCH_ROOT.getRoute({query: buildSearchQueryString(queryJSON), ...rest}));
                    return;
                }
            }

            const lastQueryJSON = lastSearchParams?.queryJSON;
            const lastQueryFromOnyx = lastQueryJSON ? buildSearchQueryString(lastQueryJSON) : undefined;
            const defaultSearchQuery = buildCannedSearchQuery({type: CONST.SEARCH.DATA_TYPES.EXPENSE});
            Navigation.navigate(ROUTES.SEARCH_ROOT.getRoute({query: lastQueryFromOnyx ?? defaultSearchQuery}));
        });
    }, [lastSearchParams?.queryJSON]);
    const navigateToAccount = useCallback(() => {
        interceptAnonymousUser(() => {
            Navigation.navigate(ROUTES.SETTINGS);
        });
    }, []);
    const isLoadingTryNewDot = isLoadingOnyxValue(tryNewDotMetadata);
    const shouldShowClassicRedirect = !!tryNewDot?.nudgeMigration && !shouldHideOldAppRedirect(tryNewDot, isLoadingTryNewDot, CONFIG.IS_HYBRID_APP);
    const surveyCompletedWithinLastMonth = useMemo(() => {
        if (!tryNewDot?.classicRedirect?.timestamp || !tryNewDot?.classicRedirect?.dismissed) {
            return false;
        }

        return differenceInDays(new Date(), new Date(tryNewDot.classicRedirect.timestamp)) < 30;
    }, [tryNewDot?.classicRedirect?.dismissed, tryNewDot?.classicRedirect?.timestamp]);
    const openClassicRedirect = useCallback(() => {
        if (CONFIG.IS_HYBRID_APP) {
            closeReactNativeApp({shouldSetNVP: true, isTrackingGPS});
            return;
        }

        if (surveyCompletedWithinLastMonth) {
            openOldDotLink(CONST.OLDDOT_URLS.INBOX, true);
            return;
        }

        resetExitSurveyForm(() => {
            if (tryNewDot?.classicRedirect?.dismissed === false) {
                Navigation.navigate(createDynamicRoute(DYNAMIC_ROUTES.EXIT_SURVEY_REASON.path));
                return;
            }

            Navigation.navigate(createDynamicRoute(DYNAMIC_ROUTES.EXIT_SURVEY_CONFIRM.path));
        });
    }, [isTrackingGPS, surveyCompletedWithinLastMonth, tryNewDot?.classicRedirect?.dismissed]);
    const topLevelNavigationActions = useMemo<TopLevelNavigationActions>(
        () => ({
            navigateToHome,
            navigateToInbox,
            navigateToSpend,
            navigateToWorkspaces,
            navigateToAccount,
        }),
        [navigateToAccount, navigateToHome, navigateToInbox, navigateToSpend, navigateToWorkspaces],
    );
    const accountNavigationContext = useMemo<AccountNavigationContext>(
        () => ({
            isAgentAccount,
            openClassicRedirect,
            shouldShowAgents: isBetaEnabled(CONST.BETAS.CUSTOM_AGENT),
            shouldShowClassicRedirect,
            shouldShowSubscription: !!subscriptionPlan || amountOwed > 0,
        }),
        [amountOwed, isAgentAccount, isBetaEnabled, openClassicRedirect, shouldShowClassicRedirect, subscriptionPlan],
    );

    const contextualReport = useReportOrReportDraft(contextualReportID);
    const [contextualReportNVP] = useOnyx(`${ONYXKEYS.COLLECTION.REPORT_NAME_VALUE_PAIRS}${contextualReportID}`, {
        selector: privateIsArchivedSelector,
    });
    const [contextualReportPolicy] = useOnyx(`${ONYXKEYS.COLLECTION.POLICY}${contextualReport?.policyID}`);

    const contextualPoliciesMap = (() => {
        if (!contextualReport?.policyID || !contextualReportPolicy) {
            return {};
        }
        const policyKey = `${ONYXKEYS.COLLECTION.POLICY}${contextualReport.policyID}`;
        return {[policyKey]: contextualReportPolicy};
    })();

    const contextualReportsMap = (() => {
        if (!contextualReportID || !contextualReport) {
            return {};
        }
        const reportKey = `${ONYXKEYS.COLLECTION.REPORT}${contextualReportID}`;
        return {[reportKey]: contextualReport};
    })();

    const getAdditionalSections: GetAdditionalSectionsCallback = useCallback(
        ({recentReports}, sectionIndex) => {
            if (textInputValue.trim().length > CONST.SEARCH.NAVIGATION_SUGGESTION_MIN_QUERY_LENGTH) {
                const navigationItems = getBalancedNavigationSearchOptions([
                    getTopLevelNavigationSearchOptions(textInputValue, translate, expensifyIcons, topLevelNavigationActions),
                    getNavigationSearchOptions(textInputValue, translate, expensifyIcons, accountNavigationContext),
                    getSpendNavigationSearchOptions(textInputValue, translate, typeMenuSections, expensifyIcons),
                    getWorkspaceNavigationSearchOptions(textInputValue, translate, {policies, currentUserEmail, isRoomsBetaEnabled}, expensifyIcons),
                    getCreateMenuSearchOptions(textInputValue),
                ]);

                return navigationItems.length > 0 ? [{sectionIndex, data: navigationItems}] : undefined;
            }

            if (!contextualReportID || textInputValue) {
                return undefined;
            }

            if (!isSearchRouterDisplayed && !isSearchRouterScreen) {
                return undefined;
            }
            let reportForContextualSearch = recentReports.find((option) => option.reportID === contextualReportID);
            const reportForContextualSearchReport = reportForContextualSearch ? contextualReport : undefined;
            const reportAction = getReportAction(reportForContextualSearchReport?.parentReportID, reportForContextualSearchReport?.parentReportActionID);
            const shouldParserToHTML = reportAction?.actionName !== CONST.REPORT.ACTIONS.TYPE.ADD_COMMENT;
            if (!reportForContextualSearch) {
                if (!contextualReport || isHiddenForCurrentUser(contextualReport)) {
                    return undefined;
                }

                const option = createOptionFromReport(contextualReport, personalDetails, contextualReportNVP, contextualReportPolicy, undefined, {
                    showPersonalDetails: true,
                });
                reportForContextualSearch = option;
            }

            const reportQueryValue = reportForContextualSearch.text ?? reportForContextualSearch.alternateText ?? reportForContextualSearch.reportID;

            let roomType: ValueOf<typeof CONST.SEARCH.DATA_TYPES> = CONST.SEARCH.DATA_TYPES.CHAT;
            let autocompleteID: string | undefined = reportForContextualSearch.reportID;

            if (reportForContextualSearch.isInvoiceRoom) {
                roomType = CONST.SEARCH.DATA_TYPES.INVOICE;
                const report = reportForContextualSearch as SearchOption<Report>;
                if (report.item?.invoiceReceiver && report.item.invoiceReceiver?.type === CONST.REPORT.INVOICE_RECEIVER_TYPE.INDIVIDUAL) {
                    autocompleteID = report.item.invoiceReceiver.accountID.toString();
                } else {
                    autocompleteID = '';
                }
            }
            if (reportForContextualSearch.isPolicyExpenseChat) {
                roomType = CONST.SEARCH.DATA_TYPES.EXPENSE;
                if (reportForContextualSearch.policyID) {
                    autocompleteID = reportForContextualSearch.policyID;
                } else {
                    autocompleteID = '';
                }
            }

            return [
                {
                    sectionIndex,
                    data: [
                        {
                            text: StringUtils.lineBreaksToSpaces(
                                `${translate('search.searchIn')} ${
                                    shouldParserToHTML
                                        ? Parser.htmlToText(reportForContextualSearch.text ?? reportForContextualSearch.alternateText ?? '')
                                        : (reportForContextualSearch.text ?? reportForContextualSearch.alternateText ?? '')
                                }`,
                            ),
                            singleIcon: expensifyIcons.MagnifyingGlass,
                            searchQuery: reportQueryValue,
                            autocompleteID,
                            itemStyle: styles.activeComponentBG,
                            keyForList: 'contextualSearch',
                            searchItemType: CONST.SEARCH.SEARCH_ROUTER_ITEM_TYPE.CONTEXTUAL_SUGGESTION,
                            roomType,
                            policyID: reportForContextualSearch.policyID,
                        },
                    ],
                },
            ];
        },
        [
            contextualReportID,
            textInputValue,
            isSearchRouterDisplayed,
            isSearchRouterScreen,
            translate,
            expensifyIcons,
            topLevelNavigationActions,
            accountNavigationContext,
            typeMenuSections,
            policies,
            currentUserEmail,
            isRoomsBetaEnabled,
            getCreateMenuSearchOptions,
            styles.activeComponentBG,
            contextualReport,
            personalDetails,
            contextualReportNVP,
            contextualReportPolicy,
        ],
    );

    const searchQueryItems = textInputValue?.trim()
        ? [
              {
                  text: textInputValue,
                  singleIcon: expensifyIcons.MagnifyingGlass,
                  searchQuery: textInputValue,
                  itemStyle: styles.activeComponentBG,
                  keyForList: CONST.SEARCH.SEARCH_ROUTER_ITEM_TYPE.FIND_ITEM,
                  searchItemType: CONST.SEARCH.SEARCH_ROUTER_ITEM_TYPE.SEARCH,
              },
              ...(shouldShowAskConcierge
                  ? [
                        {
                            text: translate('search.askConcierge', textInputValue),
                            singleIcon: expensifyIcons.ConciergeAvatar,
                            shouldIconApplyFill: false,
                            searchQuery: textInputValue,
                            itemStyle: styles.activeComponentBG,
                            keyForList: CONST.SEARCH.SEARCH_ROUTER_ITEM_TYPE.ASK_CONCIERGE,
                            searchItemType: CONST.SEARCH.SEARCH_ROUTER_ITEM_TYPE.ASK_CONCIERGE,
                        },
                    ]
                  : []),
          ]
        : undefined;

    const shouldScrollRef = useRef(false);
    // Trigger scrollToRight when input value changes and shouldScroll is true
    useEffect(() => {
        if (!textInputRef.current || !shouldScrollRef.current) {
            return;
        }

        scrollToRight(textInputRef.current);
        shouldScrollRef.current = false;
    }, [textInputValue]);

    const onSearchQueryChange = useCallback(
        (userQuery: string, autoScrollToRight = false) => {
            if (autoScrollToRight) {
                shouldScrollRef.current = true;
            }
            const singleLineUserQuery = StringUtils.lineBreaksToSpaces(userQuery, true);
            const updatedUserQuery = getAutocompleteQueryWithComma(textInputValue, singleLineUserQuery);
            setTextInputValue(updatedUserQuery);
            setAutocompleteQueryValue(updatedUserQuery);

            const updatedSubstitutionsMap = getUpdatedSubstitutionsMap(singleLineUserQuery, autocompleteSubstitutions);
            if (!deepEqual(autocompleteSubstitutions, updatedSubstitutionsMap)) {
                setAutocompleteSubstitutions(updatedSubstitutionsMap);
            }
        },
        [autocompleteSubstitutions, setTextInputValue, textInputValue],
    );

    const submitSearch = useCallback(
        (queryString: SearchQueryString, shouldSkipAmountConversion = false) => {
            const queryWithSubstitutions = getQueryWithSubstitutions(queryString, autocompleteSubstitutions, currentUserAccountID);
            const updatedQuery = getQueryWithUpdatedValues(queryWithSubstitutions, shouldSkipAmountConversion);
            if (!updatedQuery) {
                return;
            }

            // Reset the search query flag when performing a new search
            setShouldResetSearchQuery(false);

            backHistory(() => {
                onRouterClose();
                setSearchContext(true);
                Navigation.navigate(ROUTES.SEARCH_ROOT.getRoute({query: updatedQuery}));
            });

            setTextInputValue('');
            setAutocompleteQueryValue('');
        },
        [autocompleteSubstitutions, currentUserAccountID, onRouterClose, setTextInputValue, setShouldResetSearchQuery],
    );

    const onListItemPress = useCallback(
        (item: OptionData | SearchQueryItem) => {
            const setFocusAndScrollToRight = () => {
                InteractionManager.runAfterInteractions(() => {
                    if (!textInputRef.current) {
                        return;
                    }
                    textInputRef.current.focus();
                    scrollToRight(textInputRef.current);
                });
            };

            if (isSearchQueryItem(item)) {
                if (item.searchItemType === CONST.SEARCH.SEARCH_ROUTER_ITEM_TYPE.NAVIGATE) {
                    const {onSelectAction, route} = item;
                    backHistory(() => {
                        onRouterClose();
                        if (onSelectAction) {
                            onSelectAction();
                            return;
                        }
                        if (route) {
                            Navigation.navigate(route);
                        }
                    });
                    setTextInputValue('');
                    setAutocompleteQueryValue('');
                    return;
                }

                if (!item.searchQuery) {
                    return;
                }

                if (item.searchItemType === CONST.SEARCH.SEARCH_ROUTER_ITEM_TYPE.CONTEXTUAL_SUGGESTION) {
                    const searchQuery = getContextualSearchQuery(item, contextualPoliciesMap, contextualReportsMap);
                    const newSearchQuery = `${searchQuery}\u00A0`;
                    onSearchQueryChange(newSearchQuery, true);
                    setSelection({start: newSearchQuery.length, end: newSearchQuery.length});

                    const autocompleteKey = getContextualSearchAutocompleteKey(item, contextualPoliciesMap, contextualReportsMap);
                    if (autocompleteKey && item.autocompleteID) {
                        const substitutions = {...autocompleteSubstitutions, [autocompleteKey]: item.autocompleteID};
                        setAutocompleteSubstitutions(substitutions);
                    }
                    setFocusAndScrollToRight();
                } else if (item.searchItemType === CONST.SEARCH.SEARCH_ROUTER_ITEM_TYPE.AUTOCOMPLETE_SUGGESTION && textInputValue) {
                    const fieldKey = item.mapKey?.includes(':') ? item.mapKey.split(':').at(0) : item.mapKey;
                    const trimmedUserSearchQuery = getTrimmedUserSearchQueryPreservingComma(textInputValue, fieldKey);
                    const newSearchQuery = `${trimmedUserSearchQuery}${sanitizeSearchValue(item.searchQuery)}\u00A0`;
                    onSearchQueryChange(newSearchQuery, true);
                    setSelection({start: newSearchQuery.length, end: newSearchQuery.length});

                    updateAutocompleteSubstitutionsForSelection({
                        newSearchQuery,
                        fieldKey,
                        mapKey: item.mapKey,
                        searchQuery: item.searchQuery,
                        autocompleteID: item.autocompleteID,
                        substitutions: autocompleteSubstitutions,
                        setAutocompleteSubstitutions,
                    });
                    setFocusAndScrollToRight();
                } else if (item.searchItemType === CONST.SEARCH.SEARCH_ROUTER_ITEM_TYPE.ASK_CONCIERGE) {
                    const {searchQuery} = item;
                    backHistory(() => {
                        askConcierge(searchQuery);
                    });
                    onRouterClose();
                } else {
                    submitSearch(item.searchQuery, item.keyForList !== CONST.SEARCH.SEARCH_ROUTER_ITEM_TYPE.FIND_ITEM);
                }
            } else {
                backHistory(() => {
                    if (item?.reportID) {
                        Navigation.navigate(ROUTES.REPORT_WITH_ID.getRoute(item.reportID));
                    } else if ('login' in item) {
                        navigateToAndOpenReport(item.login ? [item.login] : [], personalDetails, currentUserAccountID, introSelected, isSelfTourViewed, betas, false);
                    }
                });
                onRouterClose();
            }
        },
        [
            autocompleteSubstitutions,
            onRouterClose,
            personalDetails,
            onSearchQueryChange,
            setTextInputValue,
            submitSearch,
            textInputValue,
            currentUserAccountID,
            introSelected,
            isSelfTourViewed,
            betas,
            contextualPoliciesMap,
            contextualReportsMap,
            askConcierge,
        ],
    );

    useKeyboardShortcut(CONST.KEYBOARD_SHORTCUTS.ESCAPE, () => {
        onRouterClose();
    });
    const updateAndScrollToFocusedIndex = useCallback(() => listRef.current?.updateAndScrollToFocusedIndex(searchQueryItems?.length ?? 1, true), [searchQueryItems?.length]);

    const modalWidth = shouldUseNarrowLayout ? styles.w100 : {width: variables.searchRouterPopoverWidth};

    return (
        <View
            style={[styles.flex1, modalWidth, styles.h100, !shouldUseNarrowLayout && styles.mh85vh]}
            testID="SearchRouter"
            ref={ref}
        >
            {shouldUseNarrowLayout && (
                <HeaderWithBackButton
                    title={translate('common.search')}
                    onBackButtonPress={() => onRouterClose()}
                    shouldDisplayHelpButton={false}
                />
            )}
            <View style={[shouldUseNarrowLayout ? styles.mv3 : styles.mv2, shouldUseNarrowLayout ? styles.mh5 : styles.mh2]}>
                <SearchInputSelectionWrapper
                    value={textInputValue}
                    isFullWidth={shouldUseNarrowLayout}
                    onSearchQueryChange={onSearchQueryChange}
                    onSubmit={() => {
                        const focusedOption = listRef.current?.getFocusedOption?.();

                        if (!focusedOption) {
                            submitSearch(textInputValue);
                            return;
                        }

                        onListItemPress(focusedOption);
                    }}
                    caretHidden={shouldHideInputCaret}
                    shouldShowOfflineMessage
                    wrapperStyle={styles.searchRouterBorder}
                    wrapperFocusedStyle={styles.borderColorFocus}
                    isSearchingForReports={!!isSearchingForReports}
                    selection={selection}
                    substitutionMap={autocompleteSubstitutions}
                    ref={textInputRef}
                    shouldDelayFocus
                />
            </View>
            <DeferredAutocompleteList
                autocompleteQueryValue={autocompleteQueryValue || textInputValue}
                handleSearch={searchInServer}
                searchQueryItems={searchQueryItems}
                getAdditionalSections={getAdditionalSections}
                onListItemPress={onListItemPress}
                onHighlightFirstItem={updateAndScrollToFocusedIndex}
                ref={listRef}
                textInputRef={textInputRef}
                autocompleteSubstitutions={autocompleteSubstitutions}
            />
        </View>
    );
}

export default SearchRouter;
