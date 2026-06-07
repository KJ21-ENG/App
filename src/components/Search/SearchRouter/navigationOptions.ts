import type {OnyxCollection} from 'react-native-onyx';
import type {ExpensifyIconName} from '@components/Icon/ExpensifyIconLoader';
import type {LocaleContextProps} from '@components/LocaleContextProvider';
import type {SearchQueryItem} from '@components/Search/SearchList/ListItem/SearchQueryListItem';
import {isAnyHRConnected} from '@libs/HRUtils';
import {canMemberRead, canPolicyAccessFeature, hasAccountingFeatureConnection, isGroupPolicy, isTimeTrackingEnabled, shouldShowPolicy} from '@libs/PolicyUtils';
import type {PolicyFeature} from '@libs/PolicyUtils';
import {getDefaultWorkspaceAvatar} from '@libs/ReportUtils';
import type {SearchKey, SearchTypeMenuItem, SearchTypeMenuSection} from '@libs/SearchUIUtils';
import CONST from '@src/CONST';
import type {TranslationPaths} from '@src/languages/types';
import type {Route} from '@src/ROUTES';
import ROUTES from '@src/ROUTES';
import type {Policy} from '@src/types/onyx';
import type {PolicyFeatureName} from '@src/types/onyx/Policy';
import type IconAsset from '@src/types/utils/IconAsset';

type NavigationOption = {
    titleKey: TranslationPaths;
    icon: ExpensifyIconName;
    getRoute?: () => Route;
    onSelectAction?: () => void;
    keywords?: string[];
    shouldShow?: () => boolean;
};

type AccountNavigationOption = Omit<NavigationOption, 'getRoute' | 'onSelectAction' | 'shouldShow'> & {
    getRoute?: (context: AccountNavigationContext) => Route;
    onSelectAction?: (context: AccountNavigationContext) => void;
    shouldShow?: (context: AccountNavigationContext) => boolean;
};

type AccountNavigationContext = {
    isAgentAccount: boolean;
    openClassicRedirect: () => void;
    shouldShowAgents: boolean;
    shouldShowClassicRedirect: boolean;
    shouldShowSubscription: boolean;
};

type TopLevelNavigationActions = {
    navigateToHome: () => void;
    navigateToInbox: () => void;
    navigateToSpend: () => void;
    navigateToWorkspaces: () => void;
    navigateToAccount: () => void;
};

const ACCOUNT_NAVIGATION_OPTIONS: AccountNavigationOption[] = [
    {titleKey: 'common.profile', icon: 'Profile', getRoute: () => ROUTES.SETTINGS_PROFILE.getRoute()},
    {titleKey: 'common.wallet', icon: 'Wallet', getRoute: () => ROUTES.SETTINGS_WALLET, shouldShow: ({isAgentAccount}) => !isAgentAccount},
    {
        titleKey: 'allSettingsScreen.subscription',
        icon: 'CreditCard',
        getRoute: () => ROUTES.SETTINGS_SUBSCRIPTION.getRoute(),
        keywords: ['billing'],
        shouldShow: ({isAgentAccount, shouldShowSubscription}) => !isAgentAccount && shouldShowSubscription,
    },
    {titleKey: 'expenseRulesPage.title', icon: 'Bolt', getRoute: () => ROUTES.SETTINGS_RULES},
    {titleKey: 'agentsPage.title', icon: 'Bot', getRoute: () => ROUTES.SETTINGS_AGENTS, shouldShow: ({isAgentAccount, shouldShowAgents}) => !isAgentAccount && shouldShowAgents},
    {titleKey: 'common.preferences', icon: 'Gear', getRoute: () => ROUTES.SETTINGS_PREFERENCES, shouldShow: ({isAgentAccount}) => !isAgentAccount},
    {titleKey: 'delegate.copilot', icon: 'Users', getRoute: () => ROUTES.SETTINGS_COPILOT},
    {titleKey: 'initialSettingsPage.security', icon: 'Lock', getRoute: () => ROUTES.SETTINGS_SECURITY, keywords: ['password', '2fa'], shouldShow: ({isAgentAccount}) => !isAgentAccount},
    {titleKey: 'initialSettingsPage.help', icon: 'QuestionMark', getRoute: () => ROUTES.SETTINGS_HELP},
    {titleKey: 'initialSettingsPage.about', icon: 'Info', getRoute: () => ROUTES.SETTINGS_ABOUT},
    {titleKey: 'initialSettingsPage.aboutPage.troubleshoot', icon: 'Lightbulb', getRoute: () => ROUTES.SETTINGS_TROUBLESHOOT},
    {
        titleKey: 'exitSurvey.goToExpensifyClassic',
        icon: 'ExpensifyLogoNew',
        keywords: ['classic', 'old dot', 'olddot'],
        onSelectAction: ({openClassicRedirect}) => openClassicRedirect(),
        shouldShow: ({shouldShowClassicRedirect}) => shouldShowClassicRedirect,
    },
];

const ACCOUNT_NAVIGATION_ICONS = Array.from(new Set(ACCOUNT_NAVIGATION_OPTIONS.map((option) => option.icon)));

const TOP_LEVEL_NAVIGATION_OPTIONS = (actions: TopLevelNavigationActions): NavigationOption[] => [
    {titleKey: 'common.home', icon: 'Home', onSelectAction: actions.navigateToHome, keywords: ['dashboard']},
    {titleKey: 'common.inbox', icon: 'Inbox', onSelectAction: actions.navigateToInbox, keywords: ['chat', 'chats', 'messages']},
    {titleKey: 'common.spend', icon: 'ReceiptMultiple', onSelectAction: actions.navigateToSpend, keywords: ['expenses', 'search']},
    {titleKey: 'common.workspacesTabTitle', icon: 'Buildings', onSelectAction: actions.navigateToWorkspaces, keywords: ['workspaces']},
    {titleKey: 'initialSettingsPage.account', icon: 'User', onSelectAction: actions.navigateToAccount, keywords: ['settings']},
];

const TOP_LEVEL_NAVIGATION_ICONS: ExpensifyIconName[] = ['Home', 'Inbox', 'ReceiptMultiple', 'Buildings', 'User'];
const NAVIGATION_TAB_ICONS: ExpensifyIconName[] = ['User', 'ReceiptMultiple'];
const MAX_NAVIGATION_RESULTS = 8;

const INDEXED_SPEND_SEARCH_KEYS = new Set<SearchKey>([
    CONST.SEARCH.SEARCH_KEYS.EXPENSES,
    CONST.SEARCH.SEARCH_KEYS.REPORTS,
    CONST.SEARCH.SEARCH_KEYS.SUBMIT,
    CONST.SEARCH.SEARCH_KEYS.APPROVE,
    CONST.SEARCH.SEARCH_KEYS.PAY,
    CONST.SEARCH.SEARCH_KEYS.EXPORT,
    CONST.SEARCH.SEARCH_KEYS.UNAPPROVED_CASH,
    CONST.SEARCH.SEARCH_KEYS.UNAPPROVED_CARD,
    CONST.SEARCH.SEARCH_KEYS.STATEMENTS,
    CONST.SEARCH.SEARCH_KEYS.RECONCILIATION,
    CONST.SEARCH.SEARCH_KEYS.SPEND_OVER_TIME,
    CONST.SEARCH.SEARCH_KEYS.TOP_SPENDERS,
    CONST.SEARCH.SEARCH_KEYS.TOP_CATEGORIES,
    CONST.SEARCH.SEARCH_KEYS.TOP_MERCHANTS,
]);

type WorkspacePageOption = {
    titleKey: TranslationPaths;
    icon: ExpensifyIconName;
    getRoute: (policyID: string) => Route;
    keywords?: string[];
    policyFeature?: PolicyFeature;
    feature?: PolicyFeatureName;
    requiresProtectedItems?: boolean;
    requiresMoreFeaturesRead?: boolean;
    isAvailable?: (context: {isRoomsBetaEnabled: boolean}) => boolean;
};

const PROTECTED_WORKSPACE_FEATURES: PolicyFeature[] = [
    CONST.POLICY.POLICY_FEATURE.REPORT_FIELDS,
    CONST.POLICY.POLICY_FEATURE.ACCOUNTING,
    CONST.POLICY.POLICY_FEATURE.CATEGORIES,
    CONST.POLICY.POLICY_FEATURE.TAGS,
    CONST.POLICY.POLICY_FEATURE.TAXES,
    CONST.POLICY.POLICY_FEATURE.WORKFLOWS,
    CONST.POLICY.POLICY_FEATURE.RULES,
    CONST.POLICY.POLICY_FEATURE.DISTANCE_RATES,
    CONST.POLICY.POLICY_FEATURE.EXPENSIFY_CARD,
    CONST.POLICY.POLICY_FEATURE.COMPANY_CARDS,
    CONST.POLICY.POLICY_FEATURE.PER_DIEM,
    CONST.POLICY.POLICY_FEATURE.MORE_FEATURES,
];

const WORKSPACE_PAGE_OPTIONS: WorkspacePageOption[] = [
    {
        titleKey: 'workspace.common.profile',
        icon: 'Building',
        getRoute: (id) => ROUTES.WORKSPACE_OVERVIEW.getRoute(id),
        keywords: ['overview'],
    },
    {
        titleKey: 'workspace.common.members',
        icon: 'Users',
        getRoute: (id) => ROUTES.WORKSPACE_MEMBERS.getRoute(id),
        keywords: ['member'],
    },
    {
        titleKey: 'workspace.common.rooms',
        icon: 'Hashtag',
        getRoute: (id) => ROUTES.WORKSPACE_ROOMS.getRoute(id),
        keywords: ['room'],
        isAvailable: ({isRoomsBetaEnabled}) => isRoomsBetaEnabled,
    },
    {
        titleKey: 'common.reports',
        icon: 'Document',
        getRoute: (id) => ROUTES.WORKSPACE_REPORTS.getRoute(id),
        keywords: ['report'],
        requiresProtectedItems: true,
        policyFeature: CONST.POLICY.POLICY_FEATURE.REPORT_FIELDS,
    },
    {
        titleKey: 'workspace.common.accounting',
        icon: 'Sync',
        getRoute: (id) => ROUTES.POLICY_ACCOUNTING.getRoute(id),
        keywords: ['accounting'],
        requiresProtectedItems: true,
        policyFeature: CONST.POLICY.POLICY_FEATURE.ACCOUNTING,
        feature: CONST.POLICY.MORE_FEATURES.ARE_CONNECTIONS_ENABLED,
    },
    {
        titleKey: 'workspace.common.hr',
        icon: 'Users',
        getRoute: (id) => ROUTES.WORKSPACE_HR.getRoute(id),
        keywords: ['human resources', 'people'],
        requiresProtectedItems: true,
        requiresMoreFeaturesRead: true,
        feature: CONST.POLICY.MORE_FEATURES.IS_HR_ENABLED,
    },
    {
        titleKey: 'workspace.common.receiptPartners',
        icon: 'Receipt',
        getRoute: (id) => ROUTES.WORKSPACE_RECEIPT_PARTNERS.getRoute(id),
        keywords: ['receipt partner'],
        requiresProtectedItems: true,
        requiresMoreFeaturesRead: true,
        feature: CONST.POLICY.MORE_FEATURES.ARE_RECEIPT_PARTNERS_ENABLED,
    },
    {
        titleKey: 'workspace.common.categories',
        icon: 'Folder',
        getRoute: (id) => ROUTES.WORKSPACE_CATEGORIES.getRoute(id),
        keywords: ['category'],
        requiresProtectedItems: true,
        policyFeature: CONST.POLICY.POLICY_FEATURE.CATEGORIES,
        feature: CONST.POLICY.MORE_FEATURES.ARE_CATEGORIES_ENABLED,
    },
    {
        titleKey: 'workspace.common.tags',
        icon: 'Tag',
        getRoute: (id) => ROUTES.WORKSPACE_TAGS.getRoute(id),
        keywords: ['tag'],
        requiresProtectedItems: true,
        policyFeature: CONST.POLICY.POLICY_FEATURE.TAGS,
        feature: CONST.POLICY.MORE_FEATURES.ARE_TAGS_ENABLED,
    },
    {
        titleKey: 'workspace.common.taxes',
        icon: 'Coins',
        getRoute: (id) => ROUTES.WORKSPACE_TAXES.getRoute(id),
        keywords: ['tax'],
        requiresProtectedItems: true,
        policyFeature: CONST.POLICY.POLICY_FEATURE.TAXES,
        feature: CONST.POLICY.MORE_FEATURES.ARE_TAXES_ENABLED,
    },
    {
        titleKey: 'workspace.common.workflows',
        icon: 'Workflows',
        getRoute: (id) => ROUTES.WORKSPACE_WORKFLOWS.getRoute(id),
        keywords: ['workflow'],
        requiresProtectedItems: true,
        policyFeature: CONST.POLICY.POLICY_FEATURE.WORKFLOWS,
        feature: CONST.POLICY.MORE_FEATURES.ARE_WORKFLOWS_ENABLED,
    },
    {
        titleKey: 'workspace.common.rules',
        icon: 'Feed',
        getRoute: (id) => ROUTES.WORKSPACE_RULES.getRoute(id),
        keywords: ['rule'],
        requiresProtectedItems: true,
        policyFeature: CONST.POLICY.POLICY_FEATURE.RULES,
        feature: CONST.POLICY.MORE_FEATURES.ARE_RULES_ENABLED,
    },
    {
        titleKey: 'workspace.common.distanceRates',
        icon: 'Car',
        getRoute: (id) => ROUTES.WORKSPACE_DISTANCE_RATES.getRoute(id),
        keywords: ['distance rate', 'mileage'],
        requiresProtectedItems: true,
        policyFeature: CONST.POLICY.POLICY_FEATURE.DISTANCE_RATES,
        feature: CONST.POLICY.MORE_FEATURES.ARE_DISTANCE_RATES_ENABLED,
    },
    {
        titleKey: 'workspace.common.travel',
        icon: 'LuggageWithLines',
        getRoute: (id) => ROUTES.WORKSPACE_TRAVEL.getRoute(id),
        keywords: ['trip'],
        requiresProtectedItems: true,
        requiresMoreFeaturesRead: true,
        feature: CONST.POLICY.MORE_FEATURES.IS_TRAVEL_ENABLED,
    },
    {
        titleKey: 'workspace.common.expensifyCard',
        icon: 'ExpensifyCard',
        getRoute: (id) => ROUTES.WORKSPACE_EXPENSIFY_CARD.getRoute(id),
        keywords: ['card'],
        requiresProtectedItems: true,
        policyFeature: CONST.POLICY.POLICY_FEATURE.EXPENSIFY_CARD,
        feature: CONST.POLICY.MORE_FEATURES.ARE_EXPENSIFY_CARDS_ENABLED,
    },
    {
        titleKey: 'workspace.common.companyCards',
        icon: 'CreditCard',
        getRoute: (id) => ROUTES.WORKSPACE_COMPANY_CARDS.getRoute(id),
        keywords: ['company card', 'cards'],
        requiresProtectedItems: true,
        policyFeature: CONST.POLICY.POLICY_FEATURE.COMPANY_CARDS,
        feature: CONST.POLICY.MORE_FEATURES.ARE_COMPANY_CARDS_ENABLED,
    },
    {
        titleKey: 'common.perDiem',
        icon: 'CalendarSolid',
        getRoute: (id) => ROUTES.WORKSPACE_PER_DIEM.getRoute(id),
        keywords: ['per diem'],
        requiresProtectedItems: true,
        policyFeature: CONST.POLICY.POLICY_FEATURE.PER_DIEM,
        feature: CONST.POLICY.MORE_FEATURES.ARE_PER_DIEM_RATES_ENABLED,
    },
    {
        titleKey: 'iou.time',
        icon: 'Clock',
        getRoute: (id) => ROUTES.WORKSPACE_TIME_TRACKING.getRoute(id),
        keywords: ['time tracking'],
        requiresProtectedItems: true,
        requiresMoreFeaturesRead: true,
        feature: CONST.POLICY.MORE_FEATURES.IS_TIME_TRACKING_ENABLED,
    },
    {
        titleKey: 'workspace.common.invoices',
        icon: 'InvoiceGeneric',
        getRoute: (id) => ROUTES.WORKSPACE_INVOICES.getRoute(id),
        keywords: ['invoice'],
        requiresProtectedItems: true,
        requiresMoreFeaturesRead: true,
        feature: CONST.POLICY.MORE_FEATURES.ARE_INVOICES_ENABLED,
    },
    {
        titleKey: 'workspace.common.moreFeatures',
        icon: 'Gear',
        getRoute: (id) => ROUTES.WORKSPACE_MORE_FEATURES.getRoute(id),
        keywords: ['features'],
        requiresProtectedItems: true,
        requiresMoreFeaturesRead: true,
    },
];

const WORKSPACE_NAVIGATION_ICONS = Array.from(new Set(WORKSPACE_PAGE_OPTIONS.map((option) => option.icon)));

function doesOptionMatchQuery(title: string, query: string, keywords?: string[]) {
    return [title, ...(keywords ?? [])].filter(Boolean).join(' ').toLowerCase().includes(query);
}

function getIndexedSpendMenuItems(typeMenuSections: SearchTypeMenuSection[]): SearchTypeMenuItem[] {
    return typeMenuSections.flatMap((section) => section.menuItems).filter((item) => INDEXED_SPEND_SEARCH_KEYS.has(item.key));
}

function getSpendNavigationIconNames(typeMenuSections: SearchTypeMenuSection[]): ExpensifyIconName[] {
    return Array.from(new Set(getIndexedSpendMenuItems(typeMenuSections).map((item) => item.icon)));
}

function getPolicyFeatureStates(policy: Policy): Partial<Record<PolicyFeatureName, boolean>> {
    return {
        [CONST.POLICY.MORE_FEATURES.ARE_DISTANCE_RATES_ENABLED]: policy.areDistanceRatesEnabled,
        [CONST.POLICY.MORE_FEATURES.ARE_WORKFLOWS_ENABLED]: policy.areWorkflowsEnabled,
        [CONST.POLICY.MORE_FEATURES.ARE_CATEGORIES_ENABLED]: policy.areCategoriesEnabled,
        [CONST.POLICY.MORE_FEATURES.ARE_TAGS_ENABLED]: policy.areTagsEnabled,
        [CONST.POLICY.MORE_FEATURES.ARE_TAXES_ENABLED]: policy.tax?.trackingEnabled,
        [CONST.POLICY.MORE_FEATURES.ARE_COMPANY_CARDS_ENABLED]: policy.areCompanyCardsEnabled,
        [CONST.POLICY.MORE_FEATURES.ARE_CONNECTIONS_ENABLED]: !!policy.areConnectionsEnabled || hasAccountingFeatureConnection(policy),
        [CONST.POLICY.MORE_FEATURES.IS_HR_ENABLED]: (policy.isHREnabled === true || isAnyHRConnected(policy)) && canPolicyAccessFeature(policy, CONST.POLICY.MORE_FEATURES.IS_HR_ENABLED),
        [CONST.POLICY.MORE_FEATURES.ARE_EXPENSIFY_CARDS_ENABLED]: policy.areExpensifyCardsEnabled,
        [CONST.POLICY.MORE_FEATURES.ARE_REPORT_FIELDS_ENABLED]: policy.areReportFieldsEnabled,
        [CONST.POLICY.MORE_FEATURES.ARE_RULES_ENABLED]: policy.areRulesEnabled,
        [CONST.POLICY.MORE_FEATURES.ARE_INVOICES_ENABLED]: policy.areInvoicesEnabled,
        [CONST.POLICY.MORE_FEATURES.ARE_PER_DIEM_RATES_ENABLED]: policy.arePerDiemRatesEnabled && canPolicyAccessFeature(policy, CONST.POLICY.MORE_FEATURES.ARE_PER_DIEM_RATES_ENABLED),
        [CONST.POLICY.MORE_FEATURES.ARE_RECEIPT_PARTNERS_ENABLED]: policy.receiptPartners?.enabled ?? false,
        [CONST.POLICY.MORE_FEATURES.IS_TRAVEL_ENABLED]: policy.isTravelEnabled,
        [CONST.POLICY.MORE_FEATURES.IS_TIME_TRACKING_ENABLED]: isTimeTrackingEnabled(policy),
    };
}

function buildNavigationOptionRows(
    options: NavigationOption[],
    query: string,
    translate: LocaleContextProps['translate'],
    icons: Partial<Record<ExpensifyIconName, IconAsset>>,
    rightTab?: {text: string; icon?: IconAsset},
): SearchQueryItem[] {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
        return [];
    }

    return options
        .filter((option) => option.shouldShow?.() !== false)
        .map((option) => ({option, title: translate(option.titleKey)}))
        .filter(({option, title}) => doesOptionMatchQuery(title, normalizedQuery, option.keywords))
        .map(
            ({option, title}): SearchQueryItem => ({
                text: translate('search.goTo', {destination: title}),
                singleIcon: icons[option.icon],
                rightText: rightTab?.text,
                rightIcon: rightTab?.icon,
                keyForList: `${CONST.SEARCH.SEARCH_ROUTER_ITEM_TYPE.NAVIGATE}-${option.titleKey}`,
                searchItemType: CONST.SEARCH.SEARCH_ROUTER_ITEM_TYPE.NAVIGATE,
                route: option.getRoute?.(),
                onSelectAction: option.onSelectAction,
            }),
        )
        .filter((item) => !!item.route || !!item.onSelectAction);
}

function getBalancedNavigationSearchOptions(groups: SearchQueryItem[][], maxResults = MAX_NAVIGATION_RESULTS): SearchQueryItem[] {
    const rows: SearchQueryItem[] = [];
    const indexes = groups.map(() => 0);

    while (rows.length < maxResults) {
        let didAddItem = false;

        for (const [groupIndex, group] of groups.entries()) {
            const nextItem = group.at(indexes[groupIndex]);
            if (!nextItem) {
                continue;
            }

            rows.push(nextItem);
            indexes[groupIndex]++;
            didAddItem = true;

            if (rows.length === maxResults) {
                break;
            }
        }

        if (!didAddItem) {
            break;
        }
    }

    return rows;
}

function getTopLevelNavigationSearchOptions(
    query: string,
    translate: LocaleContextProps['translate'],
    icons: Partial<Record<ExpensifyIconName, IconAsset>>,
    actions: TopLevelNavigationActions,
): SearchQueryItem[] {
    return buildNavigationOptionRows(TOP_LEVEL_NAVIGATION_OPTIONS(actions), query, translate, icons);
}

function getNavigationSearchOptions(
    query: string,
    translate: LocaleContextProps['translate'],
    icons: Partial<Record<ExpensifyIconName, IconAsset>>,
    context: AccountNavigationContext,
): SearchQueryItem[] {
    const accountTab = {text: translate('initialSettingsPage.account'), icon: icons.User};
    return buildNavigationOptionRows(
        ACCOUNT_NAVIGATION_OPTIONS.map((option) => {
            const getRoute = option.getRoute;
            const onSelectAction = option.onSelectAction;

            return {
                ...option,
                getRoute: getRoute ? () => getRoute(context) : undefined,
                onSelectAction: onSelectAction ? () => onSelectAction(context) : undefined,
                shouldShow: () => option.shouldShow?.(context) !== false,
            };
        }),
        query,
        translate,
        icons,
        accountTab,
    );
}

function getSpendNavigationSearchOptions(
    query: string,
    translate: LocaleContextProps['translate'],
    typeMenuSections: SearchTypeMenuSection[],
    icons: Partial<Record<ExpensifyIconName, IconAsset>>,
): SearchQueryItem[] {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
        return [];
    }

    const spendText = translate('common.spend');
    return getIndexedSpendMenuItems(typeMenuSections)
        .map((item) => ({item, title: translate(item.translationPath)}))
        .filter(({item, title}) => doesOptionMatchQuery(title, normalizedQuery, [item.key]))
        .map(
            ({item, title}): SearchQueryItem => ({
                text: translate('search.goTo', {destination: title}),
                singleIcon: icons[item.icon],
                rightText: spendText,
                rightIcon: icons.ReceiptMultiple,
                keyForList: `${CONST.SEARCH.SEARCH_ROUTER_ITEM_TYPE.NAVIGATE}-${item.key}`,
                searchItemType: CONST.SEARCH.SEARCH_ROUTER_ITEM_TYPE.NAVIGATE,
                route: ROUTES.SEARCH_ROOT.getRoute({query: item.searchQuery}),
            }),
        );
}

type WorkspaceNavigationParams = {
    policies: OnyxCollection<Policy>;
    currentUserEmail: string | undefined;
    isRoomsBetaEnabled: boolean;
};

function getWorkspaceNavigationSearchOptions(
    query: string,
    translate: LocaleContextProps['translate'],
    {policies, currentUserEmail, isRoomsBetaEnabled}: WorkspaceNavigationParams,
    icons: Partial<Record<ExpensifyIconName, IconAsset>>,
): SearchQueryItem[] {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
        return [];
    }

    const rows: SearchQueryItem[] = [];
    for (const policy of Object.values(policies ?? {})) {
        if (!policy || !shouldShowPolicy(policy, true, currentUserEmail)) {
            continue;
        }

        const currentUserLogin = currentUserEmail ?? '';
        const isProtectedWorkspace = isGroupPolicy(policy) && PROTECTED_WORKSPACE_FEATURES.some((policyFeature) => canMemberRead(policy, currentUserLogin, policyFeature));
        const canReadMoreFeatures = canMemberRead(policy, currentUserLogin, CONST.POLICY.POLICY_FEATURE.MORE_FEATURES);
        const featureStates = getPolicyFeatureStates(policy);
        const workspaceName = policy.name ?? '';
        const workspaceAvatar = {
            source: policy.avatarURL ? policy.avatarURL : getDefaultWorkspaceAvatar(workspaceName),
            name: workspaceName,
            id: policy.id,
        };

        for (const option of WORKSPACE_PAGE_OPTIONS) {
            if (option.requiresProtectedItems && !isProtectedWorkspace) {
                continue;
            }
            if (option.policyFeature && !canMemberRead(policy, currentUserLogin, option.policyFeature)) {
                continue;
            }
            if (option.requiresMoreFeaturesRead && !canReadMoreFeatures) {
                continue;
            }
            if (option.feature && !featureStates[option.feature]) {
                continue;
            }
            if (option.isAvailable && !option.isAvailable({isRoomsBetaEnabled})) {
                continue;
            }

            const title = translate(option.titleKey);
            if (!doesOptionMatchQuery(title, normalizedQuery, option.keywords)) {
                continue;
            }

            rows.push({
                text: translate('search.goTo', {destination: title}),
                singleIcon: icons[option.icon],
                rightText: workspaceName,
                rightAvatar: workspaceAvatar,
                keyForList: `${CONST.SEARCH.SEARCH_ROUTER_ITEM_TYPE.NAVIGATE}-ws-${policy.id}-${option.titleKey}`,
                searchItemType: CONST.SEARCH.SEARCH_ROUTER_ITEM_TYPE.NAVIGATE,
                route: option.getRoute(policy.id),
            });
        }
    }

    return rows;
}

export {
    ACCOUNT_NAVIGATION_ICONS as NAVIGATION_OPTION_ICONS,
    WORKSPACE_NAVIGATION_ICONS,
    NAVIGATION_TAB_ICONS,
    TOP_LEVEL_NAVIGATION_ICONS,
    MAX_NAVIGATION_RESULTS,
    getBalancedNavigationSearchOptions,
    getTopLevelNavigationSearchOptions,
    getNavigationSearchOptions,
    getSpendNavigationSearchOptions,
    getSpendNavigationIconNames,
    getWorkspaceNavigationSearchOptions,
};
export type {AccountNavigationContext, TopLevelNavigationActions};
