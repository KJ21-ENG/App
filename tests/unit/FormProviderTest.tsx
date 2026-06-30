import {act, render, screen} from '@testing-library/react-native';
import React, {useContext} from 'react';
import {Text} from 'react-native';
import FormContext from '@components/Form/FormContext';
import FormProvider from '@components/Form/FormProvider';
import type {FormOnyxValues, FormRef} from '@components/Form/types';
import ONYXKEYS from '@src/ONYXKEYS';

jest.mock('@hooks/useAccessibilityAnnouncement', () => jest.fn());
jest.mock('@hooks/useBottomSafeSafeAreaPaddingStyle', () => jest.fn(() => ({})));
jest.mock('@components/InputBlurContext', () => ({
    useInputBlurActions: jest.fn(() => ({
        setIsBlurred: jest.fn(),
    })),
}));
jest.mock('@hooks/useIsFocusedRef', () => jest.fn(() => ({current: true})));
jest.mock('@hooks/useLocalize', () =>
    jest.fn(() => ({
        preferredLocale: 'en',
        translate: jest.fn((key: string) => key),
    })),
);
jest.mock('@hooks/useNetwork', () => jest.fn(() => ({isOffline: false})));
jest.mock('@hooks/useOnyx', () => jest.fn(() => [undefined, {status: 'loaded'}]));
jest.mock('@hooks/useSafeAreaPaddings', () => jest.fn(() => ({paddingBottom: 0})));
jest.mock('@hooks/useThemeStyles', () =>
    jest.fn(
        () =>
            new Proxy(
                {},
                {
                    get: () => ({}),
                },
            ),
    ),
);

function RegisteredInput({inputID, defaultValue = ''}: {inputID: string; defaultValue?: string}) {
    const {registerInput} = useContext(FormContext);
    const inputProps = registerInput(inputID, false, {valueType: 'string', defaultValue});

    return <Text>{inputProps.errorText ?? `${inputID}-ready`}</Text>;
}

describe('FormProvider', () => {
    it('validates with value overrides after marking an input as touched', () => {
        const formRef = React.createRef<FormRef>();
        const validate = jest.fn((values: FormOnyxValues<typeof ONYXKEYS.FORMS.MONEY_REQUEST_SUBRATE_FORM>) => {
            if (values.subrate0 === 'newSubrate' && !values.quantity0) {
                return {quantity0: 'quantity required'};
            }

            return {};
        });

        render(
            <FormProvider
                ref={formRef}
                formID={ONYXKEYS.FORMS.MONEY_REQUEST_SUBRATE_FORM}
                validate={validate}
                onSubmit={jest.fn()}
                submitButtonText="Save"
                shouldUseScrollView={false}
                isSubmitButtonVisible={false}
            >
                <RegisteredInput
                    inputID="subrate0"
                    defaultValue="oldSubrate"
                />
                <RegisteredInput inputID="quantity0" />
            </FormProvider>,
        );

        expect(screen.queryByText('quantity required')).toBeNull();

        act(() => {
            formRef.current?.touchInputAndValidate('quantity0', {
                subrate0: 'newSubrate',
                quantity0: '',
            });
        });

        expect(screen.getByText('quantity required')).toBeTruthy();
        expect(validate).toHaveBeenLastCalledWith(expect.objectContaining({subrate0: 'newSubrate', quantity0: ''}), expect.any(Function));
    });
});
