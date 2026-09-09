import useDragAndDrop from '@hooks/useDragAndDrop';
import useThemeStyles from '@hooks/useThemeStyles';

import htmlDivElementRef from '@src/types/utils/htmlDivElementRef';
import viewRef from '@src/types/utils/viewRef';

import type {ReactNode} from 'react';

import React, {useRef, useState} from 'react';
import {View} from 'react-native';

type DropZoneWrapperProps = {
    /** Callback to execute when a file is dropped */
    onDrop: (event: DragEvent) => void;

    children: (props: {isDraggingOver: boolean; fileCount: number}) => ReactNode;
};

function DropZoneWrapper({onDrop, children}: DropZoneWrapperProps) {
    const styles = useThemeStyles();
    const [fileCount, setFileCount] = useState(0);
    const dropZone = useRef<HTMLDivElement | View>(null);

    const {isDraggingOver} = useDragAndDrop({
        shouldAcceptDrop: (event) => {
            setFileCount(Array.from(event.dataTransfer?.items ?? []).filter((item) => item.kind === 'file').length);
            return !!event.dataTransfer?.types.some((type) => type === 'Files');
        },
        onDrop,
        shouldStopPropagation: false,
        shouldHandleDragEvent: false,
        dropZone: htmlDivElementRef(dropZone),
    });

    return (
        <View
            ref={viewRef(dropZone)}
            style={styles.flex1}
        >
            {children({isDraggingOver, fileCount})}
        </View>
    );
}

export default DropZoneWrapper;
