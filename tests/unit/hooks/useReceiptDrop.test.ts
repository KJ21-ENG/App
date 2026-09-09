import {act, renderHook} from '@testing-library/react-native';

import useFilesValidation from '@hooks/useFilesValidation';

import {getFilesFromClipboardEvent} from '@libs/fileDownload/FileUtils';
import {shouldRestrictUserBillableActions} from '@libs/SubscriptionUtils';

import useReceiptDrop from '@pages/inbox/report/ReportActionCompose/useReceiptDrop';

import {initMoneyRequest} from '@userActions/IOU/MoneyRequest';
import {replaceReceipt, setMoneyRequestReceipt} from '@userActions/IOU/Receipt';
import {buildOptimisticTransactionAndCreateDraft} from '@userActions/TransactionEdit';

import CONST from '@src/CONST';

import createRandomTransaction from '../../utils/collections/transaction';

jest.mock('@hooks/useCurrentUserPersonalDetails', () => () => ({accountID: 1}));
jest.mock('@hooks/useOnyx', () => () => [{}]);
jest.mock('@hooks/usePersonalPolicy', () => () => ({}));
jest.mock('@hooks/useFilesValidation', () => jest.fn());
jest.mock('@libs/fileDownload/FileUtils', () => ({getFilesFromClipboardEvent: jest.fn()}));
jest.mock('@libs/PolicyUtils', () => ({hasOnlyPersonalPolicies: jest.fn()}));
jest.mock('@libs/ReportUtils', () => ({isSelfDM: () => false}));
jest.mock('@libs/SubscriptionUtils', () => ({shouldRestrictUserBillableActions: jest.fn()}));
jest.mock('@navigation/Navigation', () => ({navigate: jest.fn()}));
jest.mock('@userActions/IOU/MoneyRequest', () => ({initMoneyRequest: jest.fn(), setMoneyRequestParticipantsFromReport: jest.fn()}));
jest.mock('@userActions/IOU/Receipt', () => ({replaceReceipt: jest.fn(), setMoneyRequestReceipt: jest.fn()}));
jest.mock('@userActions/TransactionEdit', () => ({buildOptimisticTransactionAndCreateDraft: jest.fn()}));

const validateFiles = jest.fn<void, Parameters<ReturnType<typeof useFilesValidation>['validateFiles']>>();
const fileA = new File(['receipt A'], 'a.jpg', {type: 'image/jpeg'});
const fileB = new File(['receipt B'], 'b.jpg', {type: 'image/jpeg'});
const event: DragEvent = Object.assign(new MouseEvent('drop'), {dataTransfer: null});

function setup(overrides: Partial<Parameters<typeof useReceiptDrop>[0]> = {}) {
    return renderHook(() =>
        useReceiptDrop({
            reportID: 'report',
            report: {reportID: 'report'},
            transactionID: 'original',
            shouldAddOrReplaceReceipt: true,
            isTransactionThreadView: false,
            canCreateExpenses: true,
            ...overrides,
        }),
    );
}

function completeValidation(files: File[]) {
    const options = validateFiles.mock.calls.at(-1)?.[2];
    act(() => options?.onFilesValidated?.(files, []));
}

describe('report receipt drop operation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(useFilesValidation).mockReturnValue({validateFiles, PDFValidationComponent: undefined});
        jest.mocked(initMoneyRequest).mockReturnValue({...createRandomTransaction(1), transactionID: CONST.IOU.OPTIMISTIC_TRANSACTION_ID});
        jest.mocked(buildOptimisticTransactionAndCreateDraft).mockReturnValue({...createRandomTransaction(2), transactionID: 'new-second'});
        jest.mocked(shouldRestrictUserBillableActions).mockReturnValue(false);
        URL.createObjectURL = jest.fn(() => 'blob:synthetic');
    });

    it.each([2, 1])('creates %s expenses from the surviving original multiple-receipt batch', (survivors) => {
        jest.mocked(getFilesFromClipboardEvent).mockReturnValue([fileA, fileB]);
        const {result} = setup();
        act(() => result.current.onReceiptDropped(event));
        expect(validateFiles.mock.calls.at(-1)?.[0]).toEqual([fileA, fileB]);
        completeValidation([fileA, fileB].slice(0, survivors));
        expect(replaceReceipt).not.toHaveBeenCalled();
        expect(initMoneyRequest).toHaveBeenCalledTimes(1);
        expect(setMoneyRequestReceipt).toHaveBeenCalledTimes(survivors);
        expect(buildOptimisticTransactionAndCreateDraft).toHaveBeenCalledTimes(survivors - 1);
    });

    it.each([false, true])('preserves single receipt editing (transaction thread: %s)', (isTransactionThreadView) => {
        jest.mocked(getFilesFromClipboardEvent).mockReturnValue([fileA]);
        const {result} = setup({isTransactionThreadView, canCreateExpenses: false});
        act(() => result.current.onReceiptDropped(event));
        completeValidation([fileA]);
        expect(replaceReceipt).toHaveBeenCalledTimes(1);
        expect(initMoneyRequest).not.toHaveBeenCalled();
    });

    it('preserves first-file editing for multiple files in an individual transaction thread', () => {
        jest.mocked(getFilesFromClipboardEvent).mockReturnValue([fileA, fileB]);
        const {result} = setup({isTransactionThreadView: true, canCreateExpenses: false});
        act(() => result.current.onReceiptDropped(event));
        expect(validateFiles.mock.calls.at(-1)?.[0]).toEqual([fileA]);
        completeValidation([fileA]);
        expect(replaceReceipt).toHaveBeenCalledTimes(1);
        expect(initMoneyRequest).not.toHaveBeenCalled();
    });

    it('does not grant bulk creation from receipt editing permission', () => {
        jest.mocked(getFilesFromClipboardEvent).mockReturnValue([fileA, fileB]);
        const {result} = setup({canCreateExpenses: false});
        act(() => result.current.onReceiptDropped(event));
        expect(validateFiles).not.toHaveBeenCalled();
        expect(replaceReceipt).not.toHaveBeenCalled();
        expect(initMoneyRequest).not.toHaveBeenCalled();
    });

    it('retains bulk creation in reports without a receipt editing target', () => {
        jest.mocked(getFilesFromClipboardEvent).mockReturnValue([fileA, fileB]);
        const {result} = setup({shouldAddOrReplaceReceipt: false, transactionID: undefined});
        act(() => result.current.onReceiptDropped(event));
        completeValidation([fileA, fileB]);
        expect(setMoneyRequestReceipt).toHaveBeenCalledTimes(2);
        expect(replaceReceipt).not.toHaveBeenCalled();
    });

    it('preserves billing restrictions', () => {
        jest.mocked(shouldRestrictUserBillableActions).mockReturnValue(true);
        const {result} = setup();
        act(() => result.current.onReceiptDropped(event));
        expect(validateFiles).not.toHaveBeenCalled();
    });
});
