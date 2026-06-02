import type {TextInput} from 'react-native';
import shouldSetSelectionRange from '@libs/shouldSetSelectionRange';
import CONST from '@src/CONST';
import type {InputType, Selection} from './types';

const setSelectionRange = shouldSetSelectionRange();
const SHOW_TEXT_NODE = 4;

const getTextInputElement = (textInput: InputType): HTMLElement | null => {
    if (typeof HTMLElement !== 'undefined' && textInput instanceof HTMLElement) {
        return textInput;
    }

    const document = globalThis.document;
    const activeElement = document?.activeElement;
    if (typeof HTMLElement !== 'undefined' && activeElement instanceof HTMLElement && activeElement.id === CONST.COMPOSER.NATIVE_ID) {
        return activeElement;
    }

    return document?.getElementById(CONST.COMPOSER.NATIVE_ID) ?? null;
};

const getTextNodePosition = (element: HTMLElement, position: number): {node: Text; offset: number} | undefined => {
    const treeWalker = element.ownerDocument.createTreeWalker(element, SHOW_TEXT_NODE);
    let remainingPosition = position;
    let currentNode = treeWalker.nextNode() as Text | null;
    let lastTextNode: Text | undefined;

    while (currentNode) {
        const nodeLength = currentNode.textContent?.length ?? 0;

        if (remainingPosition <= nodeLength) {
            return {node: currentNode, offset: remainingPosition};
        }

        remainingPosition -= nodeLength;
        lastTextNode = currentNode;
        currentNode = treeWalker.nextNode() as Text | null;
    }

    if (!lastTextNode) {
        return undefined;
    }

    return {node: lastTextNode, offset: lastTextNode.textContent?.length ?? 0};
};

const setTextInputSelection = (textInput: InputType, forcedSelectionRange: Selection) => {
    if (setSelectionRange && (textInput as HTMLTextAreaElement).setSelectionRange) {
        (textInput as HTMLTextAreaElement).setSelectionRange?.(forcedSelectionRange.start, forcedSelectionRange.end);
    } else if ((textInput as TextInput).setSelection) {
        (textInput as TextInput).setSelection?.(forcedSelectionRange.start, forcedSelectionRange.end);
    } else {
        const textInputElement = getTextInputElement(textInput);
        const document = textInputElement?.ownerDocument ?? globalThis.document;
        const selection = document?.defaultView?.getSelection?.();
        const range = document?.createRange?.();

        if (!textInputElement || !selection || !range) {
            return;
        }

        const maxOffset = textInputElement.textContent?.length ?? 0;
        const start = Math.min(forcedSelectionRange.start, maxOffset);
        const end = Math.min(forcedSelectionRange.end, maxOffset);
        const startPosition = getTextNodePosition(textInputElement, start);
        const endPosition = getTextNodePosition(textInputElement, end);

        if (!startPosition || !endPosition) {
            range.setStart(textInputElement, 0);
            range.setEnd(textInputElement, 0);
        } else {
            range.setStart(startPosition.node, startPosition.offset);
            range.setEnd(endPosition.node, endPosition.offset);
        }

        selection.removeAllRanges();
        selection.addRange(range);
    }
};

export default setTextInputSelection;
