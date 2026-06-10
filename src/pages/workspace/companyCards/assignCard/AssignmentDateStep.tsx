import {format} from 'date-fns';
import React, {useState} from 'react';
import {View} from 'react-native';
import ActivityIndicator from '@components/ActivityIndicator';
import Button from '@components/Button';
import DatePicker from '@components/DatePicker';
import InteractiveStepWrapper from '@components/InteractiveStepWrapper';
import Text from '@components/Text';
import useLocalize from '@hooks/useLocalize';
import useOnyx from '@hooks/useOnyx';
import useThemeStyles from '@hooks/useThemeStyles';
import type {PlatformStackScreenProps} from '@libs/Navigation/PlatformStackNavigation/types';
import type {SettingsNavigatorParamList} from '@libs/Navigation/types';
import type {SkeletonSpanReasonAttributes} from '@libs/telemetry/useSkeletonSpan';
import {isRequiredFulfilled} from '@libs/ValidationUtils';
import Navigation from '@navigation/Navigation';
import {setAssignCardStepAndData} from '@userActions/CompanyCards';
import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import ROUTES from '@src/ROUTES';
import type SCREENS from '@src/SCREENS';
import isLoadingOnyxValue from '@src/types/utils/isLoadingOnyxValue';

type AssignmentDateStepProps = PlatformStackScreenProps<SettingsNavigatorParamList, typeof SCREENS.WORKSPACE.COMPANY_CARDS_ASSIGN_CARD_ASSIGNMENT_DATE>;

function AssignmentDateStep({route}: AssignmentDateStepProps) {
    const {translate} = useLocalize();
    const styles = useThemeStyles();
    const [assignCard, assignCardMeta] = useOnyx(ONYXKEYS.ASSIGN_CARD);
    const isEditing = assignCard?.isEditing;
    const [errorText, setErrorText] = useState('');
    const [localAssignmentDate, setLocalAssignmentDate] = useState<string>();
    const assignmentDate = localAssignmentDate ?? assignCard?.cardToAssign?.assignmentDate ?? format(new Date(), CONST.DATE.FNS_FORMAT_STRING);

    const routeParams = {policyID: route.params.policyID, feed: route.params.feed, cardID: route.params.cardID};

    const handleBackButtonPress = () => {
        if (isEditing) {
            setAssignCardStepAndData({
                isEditing: false,
            });
        }
        Navigation.goBack();
    };

    const submit = () => {
        if (!isRequiredFulfilled(assignmentDate)) {
            setErrorText(translate('common.error.fieldRequired'));
            return;
        }

        setAssignCardStepAndData({
            cardToAssign: {
                assignmentDate,
            },
            isEditing: false,
        });

        if (isEditing) {
            Navigation.goBack();
            return;
        }

        Navigation.navigate(ROUTES.WORKSPACE_COMPANY_CARDS_ASSIGN_CARD_TRANSACTION_START_DATE.getRoute(routeParams));
    };

    const isLoading = isLoadingOnyxValue(assignCardMeta);
    const activityReasonAttributes: SkeletonSpanReasonAttributes = {
        context: 'AssignmentDateStep',
        isLoading,
    };

    return (
        <InteractiveStepWrapper
            wrapperID="AssignmentDateStep"
            handleBackButtonPress={handleBackButtonPress}
            headerTitle={translate('workspace.companyCards.assignCard')}
            enableEdgeToEdgeBottomSafeAreaPadding
        >
            {isLoading ? (
                <ActivityIndicator
                    size={CONST.ACTIVITY_INDICATOR_SIZE.LARGE}
                    style={styles.h100}
                    reasonAttributes={activityReasonAttributes}
                />
            ) : (
                <>
                    <Text style={[styles.textHeadlineLineHeightXXL, styles.ph5, styles.mt3]}>{translate('workspace.companyCards.chooseAssignmentDate')}</Text>
                    <Text style={[styles.textSupporting, styles.ph5, styles.mv3]}>{translate('workspace.companyCards.assignmentDateDescription')}</Text>
                    <View style={[styles.flex1, styles.ph5]}>
                        <DatePicker
                            inputID=""
                            value={assignmentDate}
                            label={translate('workspace.companyCards.assignmentDate')}
                            onInputChange={(value) => {
                                if (!isRequiredFulfilled(value)) {
                                    setErrorText(translate('common.error.fieldRequired'));
                                } else {
                                    setErrorText('');
                                }
                                setLocalAssignmentDate(value);
                            }}
                            minDate={new Date()}
                            errorText={errorText}
                        />
                        <Button
                            success
                            large
                            pressOnEnter
                            text={translate(isEditing ? 'common.save' : 'common.next')}
                            onPress={submit}
                            style={[styles.mt5]}
                        />
                    </View>
                </>
            )}
        </InteractiveStepWrapper>
    );
}

export default AssignmentDateStep;
