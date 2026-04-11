import {useCallback} from 'react';
import type {OnyxCollection, OnyxEntry} from 'react-native-onyx';
import {isArchivedNonExpenseReport, isArchivedReport, isInvoiceRoom} from '@libs/ReportUtils';
import ONYXKEYS from '@src/ONYXKEYS';
import type {Report} from '@src/types/onyx';
import type {InvoiceReceiverType} from '@src/types/onyx/Report';
import useOnyx from './useOnyx';

function useParticipantsInvoiceReport(receiverID: string | number | undefined, receiverType: InvoiceReceiverType, policyID?: string): OnyxEntry<Report> {
    const [reportNameValuePairs] = useOnyx(ONYXKEYS.COLLECTION.REPORT_NAME_VALUE_PAIRS);
    const participantInvoiceReportSelector = useCallback(
        (reports: OnyxCollection<Report>): OnyxEntry<Report> => {
            if (!reports || !reportNameValuePairs) {
                return undefined;
            }

            return Object.values(reports).find((report) => {
                if (!report || !isInvoiceRoom(report)) {
                    return false;
                }

                const isReportArchived = isArchivedReport(reportNameValuePairs[`${ONYXKEYS.COLLECTION.REPORT_NAME_VALUE_PAIRS}${report.reportID}`]);
                if (isArchivedNonExpenseReport(report, isReportArchived)) {
                    return false;
                }

                const isSameReceiver =
                    report.invoiceReceiver &&
                    report.invoiceReceiver.type === receiverType &&
                    (('accountID' in report.invoiceReceiver && report.invoiceReceiver.accountID === receiverID) ||
                        ('policyID' in report.invoiceReceiver && report.invoiceReceiver.policyID === receiverID));

                return report.policyID === policyID && isSameReceiver;
            });
        },
        [reportNameValuePairs, receiverID, receiverType, policyID],
    );

    const [invoiceReport] = useOnyx(ONYXKEYS.COLLECTION.REPORT, {selector: participantInvoiceReportSelector}, [reportNameValuePairs, receiverID, receiverType, policyID]);

    return invoiceReport;
}

export default useParticipantsInvoiceReport;
