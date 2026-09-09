import DragAndDropConsumer from '@components/DragAndDrop/Consumer';
import {useWideRHPState} from '@components/WideRHPContextProvider';

import {useMemoizedLazyExpensifyIcons} from '@hooks/useLazyAsset';
import useLocalize from '@hooks/useLocalize';
import useResponsiveLayout from '@hooks/useResponsiveLayout';
import useTheme from '@hooks/useTheme';
import useThemeStyles from '@hooks/useThemeStyles';

import type {ViewStyle} from 'react-native';

import React from 'react';
// We use Animated for all functionality related to wide RHP to make it easier
// to interact with react-navigation components (e.g., CardContainer, interpolator), which also use Animated.
// eslint-disable-next-line no-restricted-imports
import {Animated, View} from 'react-native';

import DropZoneUI from './DropZoneUI';
import DropZoneWrapper from './DropZoneWrapper';

type DropZoneProps = {
    isEditing: boolean;

    /** Callback to execute when a file is dropped */
    onAttachmentDrop: (event: DragEvent) => void;

    /** Callback to execute when a file is dropped */
    onReceiptDrop: (event: DragEvent) => void;

    shouldAcceptSingleReceipt?: boolean;

    /** Bulk report drops create expenses even when a single drop edits a receipt. */
    shouldAllowMultipleReceipts?: boolean;
};

function DualDropZone({isEditing, onAttachmentDrop, onReceiptDrop, shouldAcceptSingleReceipt, shouldAllowMultipleReceipts = false}: DropZoneProps) {
    const styles = useThemeStyles();
    const {translate} = useLocalize();
    const {shouldUseNarrowLayout, isMediumScreenWidth} = useResponsiveLayout();
    const theme = useTheme();
    const icons = useMemoizedLazyExpensifyIcons(['MessageInABottle', 'SmartScan', 'ReplaceReceipt']);

    const {isWideRHPFocused} = useWideRHPState();
    const shouldStackVertically = (shouldUseNarrowLayout || isMediumScreenWidth) && !isWideRHPFocused;
    const scanReceiptsText = shouldAcceptSingleReceipt ? 'dropzone.addReceipt' : 'dropzone.scanReceipts';
    const receiptTitle = isEditing ? 'dropzone.replaceReceipt' : scanReceiptsText;
    const shouldStackRevertHorizontally = isWideRHPFocused;
    let flexStyle: ViewStyle = styles.flexRow;
    if (shouldStackVertically) {
        flexStyle = styles.flexColumn;
    } else if (shouldStackRevertHorizontally) {
        flexStyle = styles.flexRowReverse;
    }

    return (
        <DragAndDropConsumer onDrop={() => {}}>
            <View style={[flexStyle, styles.w100, styles.h100]}>
                <DropZoneWrapper onDrop={onAttachmentDrop}>
                    {({isDraggingOver}) => (
                        <DropZoneUI
                            icon={icons.MessageInABottle}
                            dropTitle={translate('dropzone.addAttachments')}
                            dropStyles={styles.attachmentDropOverlay(isDraggingOver)}
                            dropTextStyles={styles.attachmentDropText}
                            dropWrapperStyles={shouldStackVertically ? styles.pb0 : styles.pr0}
                            dashedBorderStyles={[
                                styles.dropzoneArea,
                                styles.easeInOpacityTransition,
                                styles.activeDropzoneDashedBorder(theme.attachmentDropBorderColorActive, isDraggingOver),
                            ]}
                        />
                    )}
                </DropZoneWrapper>
                <Animated.View style={isWideRHPFocused ? styles.wideRHPDropZoneContainer : [styles.flex1, styles.h100]}>
                    <DropZoneWrapper onDrop={onReceiptDrop}>
                        {({isDraggingOver, fileCount}) => (
                            <DropZoneUI
                                icon={isEditing && !(shouldAllowMultipleReceipts && fileCount > 1) ? icons.ReplaceReceipt : icons.SmartScan}
                                dropTitle={translate(shouldAllowMultipleReceipts && fileCount > 1 ? 'dropzone.scanReceipts' : receiptTitle)}
                                dropStyles={styles.receiptDropOverlay(isDraggingOver)}
                                dropTextStyles={styles.receiptDropText}
                                dashedBorderStyles={[
                                    styles.dropzoneArea,
                                    styles.easeInOpacityTransition,
                                    styles.activeDropzoneDashedBorder(theme.receiptDropBorderColorActive, isDraggingOver),
                                ]}
                            />
                        )}
                    </DropZoneWrapper>
                </Animated.View>
            </View>
        </DragAndDropConsumer>
    );
}

export default DualDropZone;
