import React, {useState} from 'react';
import {View} from 'react-native';
import type {OnyxEntry} from 'react-native-onyx';
import FullPageNotFoundView from '@components/BlockingViews/FullPageNotFoundView';
import Button from '@components/Button';
import FixedFooter from '@components/FixedFooter';
import FullScreenLoadingIndicator from '@components/FullscreenLoadingIndicator';
import HeaderWithBackButton from '@components/HeaderWithBackButton';
import MoneyRequestView from '@components/ReportActionItem/MoneyRequestView';
import ScreenWrapper from '@components/ScreenWrapper';
import ScrollView from '@components/ScrollView';
import Text from '@components/Text';
import useCurrentUserPersonalDetails from '@hooks/useCurrentUserPersonalDetails';
import useLocalize from '@hooks/useLocalize';
import useMergeTransactions from '@hooks/useMergeTransactions';
import useOnyx from '@hooks/useOnyx';
import usePermissions from '@hooks/usePermissions';
import useSelfDMReport from '@hooks/useSelfDMReport';
import useThemeStyles from '@hooks/useThemeStyles';
import {mergeTransactionRequest} from '@libs/actions/MergeTransaction';
import getIsNarrowLayout from '@libs/getIsNarrowLayout';
import getNonEmptyStringOnyxID from '@libs/getNonEmptyStringOnyxID';
import {buildMergedTransactionData, getTransactionThreadReportID} from '@libs/MergeTransactionUtils';
import Navigation from '@libs/Navigation/Navigation';
import type {PlatformStackScreenProps} from '@libs/Navigation/PlatformStackNavigation/types';
import type {MergeTransactionNavigatorParamList} from '@libs/Navigation/types';
import {findSelfDMReportID} from '@libs/ReportUtils';
import type {SkeletonSpanReasonAttributes} from '@libs/telemetry/useSkeletonSpan';
import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import ROUTES from '@src/ROUTES';
import type SCREENS from '@src/SCREENS';
import type {Transaction} from '@src/types/onyx';
import isLoadingOnyxValue from '@src/types/utils/isLoadingOnyxValue';

type ConfirmationPageProps = PlatformStackScreenProps<MergeTransactionNavigatorParamList, typeof SCREENS.MERGE_TRANSACTION.CONFIRMATION_PAGE>;

function ConfirmationPage({route}: ConfirmationPageProps) {
    const {translate} = useLocalize();
    const styles = useThemeStyles();
    const [isMergingExpenses, setIsMergingExpenses] = useState(false);

    const {transactionID, isOnSearch, backTo} = route.params;
    const [mergeTransaction, mergeTransactionMetadata] = useOnyx(`${ONYXKEYS.COLLECTION.MERGE_TRANSACTION}${getNonEmptyStringOnyxID(transactionID)}`);
    const {targetTransaction, sourceTransaction, targetTransactionReport, targetTransactionPolicy} = useMergeTransactions({mergeTransaction});
    const [allTransactionViolations] = useOnyx(ONYXKEYS.COLLECTION.TRANSACTION_VIOLATIONS);

    const [policyTags] = useOnyx(`${ONYXKEYS.COLLECTION.POLICY_TAGS}${targetTransactionPolicy?.id}`);
    const [policyCategories] = useOnyx(`${ONYXKEYS.COLLECTION.POLICY_CATEGORIES}${targetTransactionPolicy?.id}`);

    const currentUserPersonalDetails = useCurrentUserPersonalDetails();
    const currentUserAccountIDParam = currentUserPersonalDetails.accountID;
    const currentUserEmailParam = currentUserPersonalDetails.login ?? '';
    const {isBetaEnabled} = usePermissions();
    const isASAPSubmitBetaEnabled = isBetaEnabled(CONST.BETAS.ASAP_SUBMIT);

    const targetTransactionThreadReportID = getTransactionThreadReportID(targetTransaction);
    const [targetTransactionThreadReport] = useOnyx(`${ONYXKEYS.COLLECTION.REPORT}${targetTransactionThreadReportID}`);
    const [targetTransactionThreadParentReport] = useOnyx(`${ONYXKEYS.COLLECTION.REPORT}${getNonEmptyStringOnyxID(targetTransactionThreadReport?.parentReportID)}`);
    const [targetTransactionThreadParentReportNextStep] = useOnyx(`${ONYXKEYS.COLLECTION.NEXT_STEP}${getNonEmptyStringOnyxID(targetTransactionThreadReport?.parentReportID)}`);

    const selfDMReport = useSelfDMReport();

    // Build the merged transaction data for display
    const mergedTransactionData = buildMergedTransactionData(targetTransaction, mergeTransaction);

    const handleMergeExpenses = () => {
        if (!targetTransaction || !mergeTransaction || !sourceTransaction) {
            return;
        }
        const isMergingToUnreported = mergeTransaction.reportID === CONST.REPORT.UNREPORTED_REPORT_ID;
        const destinationReportID = isMergingToUnreported ? undefined : mergeTransaction.reportID;
        const fallbackSearchReportID = isMergingToUnreported ? (findSelfDMReportID() ?? CONST.REPORT.UNREPORTED_REPORT_ID) : destinationReportID;

        setIsMergingExpenses(true);
        mergeTransactionRequest({
            mergeTransactionID: transactionID,
            mergeTransaction,
            targetTransaction,
            sourceTransaction,
            targetTransactionThreadReport,
            targetTransactionThreadParentReport,
            targetTransactionThreadParentReportNextStep,
            allTransactionViolations,
            policy: targetTransactionPolicy,
            policyTags,
            policyCategories,
            currentUserAccountIDParam,
            currentUserEmailParam,
            isASAPSubmitBetaEnabled,
            selfDMReport,
        });

        const searchReportIDToOpen = targetTransactionThreadReportID ?? fallbackSearchReportID;

        // Search-origin merges should reopen the merged expense in the search RHP.
        if (isOnSearch && searchReportIDToOpen) {
            Navigation.dismissModal();
            Navigation.setNavigationActionToMicrotaskQueue(() => {
                Navigation.navigate(ROUTES.SEARCH_REPORT.getRoute({reportID: searchReportIDToOpen}));
            });
            return;
        }

        if (destinationReportID) {
            const isNarrowLayout = getIsNarrowLayout();
            const expenseReportRoute = ROUTES.EXPENSE_REPORT_RHP.getRoute({reportID: destinationReportID});
            const dismissToDestinationReport = (afterOpenReport?: () => void) => {
                const openExpenseReportRoute = () => {
                    Navigation.navigate(expenseReportRoute, {forceReplace: !isNarrowLayout});
                    afterOpenReport?.();
                };

                if (isNarrowLayout) {
                    Navigation.dismissModal({afterTransition: openExpenseReportRoute});
                    return;
                }

                Navigation.dismissToPreviousRHP({
                    afterTransition: openExpenseReportRoute,
                });
            };

            if (!targetTransactionThreadReportID) {
                dismissToDestinationReport();
                return;
            }

            if (destinationReportID === targetTransaction.reportID) {
                Navigation.dismissToPreviousRHP();
                return;
            }

            dismissToDestinationReport(() => {
                Navigation.setNavigationActionToMicrotaskQueue(() => {
                    Navigation.navigate(
                        ROUTES.SEARCH_REPORT.getRoute({
                            reportID: targetTransactionThreadReportID,
                            backTo: expenseReportRoute,
                        }),
                    );
                });
            });
            return;
        }

        Navigation.dismissToSuperWideRHP();
    };

    if (isLoadingOnyxValue(mergeTransactionMetadata)) {
        const reasonAttributes: SkeletonSpanReasonAttributes = {
            context: 'TransactionMerge.ConfirmationPage',
            isLoadingMergeTransaction: isLoadingOnyxValue(mergeTransactionMetadata),
        };
        return <FullScreenLoadingIndicator reasonAttributes={reasonAttributes} />;
    }

    return (
        <ScreenWrapper
            testID="ConfirmationPage"
            shouldEnableMaxHeight
            includeSafeAreaPaddingBottom
        >
            <FullPageNotFoundView shouldShow={!mergeTransaction && !isMergingExpenses}>
                <HeaderWithBackButton
                    title={translate('transactionMerge.confirmationPage.header')}
                    onBackButtonPress={() => {
                        Navigation.goBack(backTo);
                    }}
                />
                <ScrollView>
                    <View style={[styles.ph5, styles.pb8]}>
                        <Text>{translate('transactionMerge.confirmationPage.pageTitle')}</Text>
                    </View>
                    <MoneyRequestView
                        expensePolicy={targetTransactionPolicy}
                        parentReportID={targetTransactionReport?.reportID}
                        shouldShowAnimatedBackground={false}
                        readonly
                        updatedTransaction={mergedTransactionData as unknown as OnyxEntry<Transaction>}
                        mergeTransactionID={transactionID}
                    />
                </ScrollView>
                <FixedFooter style={styles.ph5}>
                    <Button
                        text={translate('transactionMerge.confirmationPage.confirmButton')}
                        success
                        onPress={handleMergeExpenses}
                        large
                    />
                </FixedFooter>
            </FullPageNotFoundView>
        </ScreenWrapper>
    );
}

export default ConfirmationPage;
