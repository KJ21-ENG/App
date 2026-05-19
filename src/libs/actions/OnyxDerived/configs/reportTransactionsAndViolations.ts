import type {OnyxCollection} from 'react-native-onyx';
import createOnyxDerivedValueConfig from '@userActions/OnyxDerived/createOnyxDerivedValueConfig';
import ONYXKEYS from '@src/ONYXKEYS';
import type {TransactionViolation} from '@src/types/onyx';
import type {ReportTransactionsAndViolationsDerivedValue} from '@src/types/onyx/DerivedValues';

let previousViolations: OnyxCollection<TransactionViolation[]> = {};
const transactionReportIDMapping: Record<string, string> = {};

function getTransactionIDFromTransactionKey(transactionKey: string) {
    return transactionKey.replace(ONYXKEYS.COLLECTION.TRANSACTION, '');
}

function getTransactionKeyFromViolationKey(transactionViolationKey: string) {
    return transactionViolationKey.replace(ONYXKEYS.COLLECTION.TRANSACTION_VIOLATIONS, ONYXKEYS.COLLECTION.TRANSACTION);
}

function getReportIDFromCurrentValue(transactionKey: string, currentValue: ReportTransactionsAndViolationsDerivedValue | undefined) {
    const transactionID = getTransactionIDFromTransactionKey(transactionKey);
    const violationKey = `${ONYXKEYS.COLLECTION.TRANSACTION_VIOLATIONS}${transactionID}`;

    return Object.entries(currentValue ?? {}).find(
        ([, reportTransactionsAndViolations]) => transactionKey in reportTransactionsAndViolations.transactions || violationKey in reportTransactionsAndViolations.violations,
    )?.[0];
}

export default createOnyxDerivedValueConfig({
    key: ONYXKEYS.DERIVED.REPORT_TRANSACTIONS_AND_VIOLATIONS,
    dependencies: [ONYXKEYS.COLLECTION.TRANSACTION, ONYXKEYS.COLLECTION.TRANSACTION_VIOLATIONS],
    compute: ([transactions, violations], {sourceValues, currentValue}) => {
        if (!transactions) {
            return currentValue ?? {};
        }

        // If there is a source value for transactions or transaction violations, we need to process only the transactions that have been updated or added
        // If not, we need to process all transactions
        const transactionsUpdates = sourceValues?.[ONYXKEYS.COLLECTION.TRANSACTION];
        const transactionViolationsUpdates = sourceValues?.[ONYXKEYS.COLLECTION.TRANSACTION_VIOLATIONS];
        const shouldRebuildAllReports = !transactionsUpdates && !transactionViolationsUpdates;
        let transactionsToProcess = Object.keys(transactions);
        if (transactionsUpdates) {
            transactionsToProcess = Object.keys(transactionsUpdates);
        } else if (transactionViolationsUpdates) {
            transactionsToProcess = Object.keys(transactionViolationsUpdates).map(getTransactionKeyFromViolationKey);
        }

        if (shouldRebuildAllReports) {
            Object.keys(transactionReportIDMapping).forEach((transactionKey) => {
                delete transactionReportIDMapping[transactionKey];
            });
        }

        const reportTransactionsAndViolations: ReportTransactionsAndViolationsDerivedValue = shouldRebuildAllReports ? {} : {...(currentValue ?? {})};

        // Track which reportID entries have been cloned so we only clone once per reportID.
        // This avoids mutating nested objects that are still referenced by the cached value.
        const clonedReportIDs = new Set<string>();
        const ensureCloned = (id: string) => {
            if (clonedReportIDs.has(id) || !reportTransactionsAndViolations[id]) {
                return;
            }

            reportTransactionsAndViolations[id] = {
                transactions: {...reportTransactionsAndViolations[id].transactions},
                violations: {...reportTransactionsAndViolations[id].violations},
            };
            clonedReportIDs.add(id);
        };

        for (const transactionKey of transactionsToProcess) {
            const transaction = transactions[transactionKey];
            const previousReportID = transactionReportIDMapping[transactionKey] ?? getReportIDFromCurrentValue(transactionKey, currentValue);
            const transactionWasUpdated = !!transactionsUpdates && transactionKey in transactionsUpdates;
            const reportID = transaction?.reportID ?? (transactionViolationsUpdates ? previousReportID : undefined);
            const transactionID = transaction?.transactionID ?? getTransactionIDFromTransactionKey(transactionKey);
            const violationKey = `${ONYXKEYS.COLLECTION.TRANSACTION_VIOLATIONS}${transactionID}`;
            const transactionViolations = violations?.[violationKey];
            const previousTransactionViolations = previousViolations?.[violationKey];

            // If the transaction itself moved or was deleted, remove it from the previous report.
            // Violation-only updates must not change transaction/report membership.
            if (transactionWasUpdated && previousReportID && previousReportID !== transaction?.reportID && reportTransactionsAndViolations[previousReportID]) {
                ensureCloned(previousReportID);
                delete reportTransactionsAndViolations[previousReportID].transactions[transactionKey];
                const transactionID = getTransactionIDFromTransactionKey(transactionKey);
                if (transactionID) {
                    delete reportTransactionsAndViolations[previousReportID].violations[`${ONYXKEYS.COLLECTION.TRANSACTION_VIOLATIONS}${transactionID}`];
                }
            }

            if (transactionWasUpdated && !transaction && transactionReportIDMapping[transactionKey]) {
                delete transactionReportIDMapping[transactionKey];
            }

            if (!reportID) {
                continue;
            }

            if (!reportTransactionsAndViolations[reportID]) {
                reportTransactionsAndViolations[reportID] = {
                    transactions: {},
                    violations: {},
                };
                clonedReportIDs.add(reportID);
            } else {
                ensureCloned(reportID);
            }

            const violationInSourceValues = transactionViolationsUpdates?.[violationKey];

            // If violations exist and have length > 0, add them to the structure
            if (transactionViolations && transactionViolations.length > 0) {
                reportTransactionsAndViolations[reportID].violations[violationKey] = transactionViolations;
            } else if (violationInSourceValues === undefined || (previousTransactionViolations && previousTransactionViolations.length > 0)) {
                // If violations were removed (previous had violations but current doesn't) or explicitly set to undefined, remove them from the structure
                delete reportTransactionsAndViolations[reportID].violations[violationKey];
            }

            if (transaction) {
                reportTransactionsAndViolations[reportID].transactions[transactionKey] = transaction;
            }
            transactionReportIDMapping[transactionKey] = reportID;
        }

        previousViolations = violations;

        return reportTransactionsAndViolations;
    },
});
