import type {SkTypeface} from '@shopify/react-native-skia';
import type {TNode} from 'react-native-render-html';
import {INTERACTION_METADATA_KEY, X_KEY} from '@components/HTMLEngineProvider/HTMLRenderers/VictoryChartRenderer/constants';
import type {
    CartesianChartData,
    PartialProcessNodeResult,
    ProcessNodeResult,
    RawChartData,
    VictoryChartPointInteractionMetadata,
} from '@components/HTMLEngineProvider/HTMLRenderers/VictoryChartRenderer/types';
import getYKey from '@components/HTMLEngineProvider/HTMLRenderers/VictoryChartRenderer/utils/getYKey';
import parseAttribute from '@components/HTMLEngineProvider/HTMLRenderers/VictoryChartRenderer/utils/parseAttribute';

function getStringValue(value: unknown): string | undefined {
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number') {
        return String(value);
    }
    return undefined;
}

function getMetadataValue(point: RawChartData, attributes: TNode['attributes'], keys: string[]): string | undefined {
    for (const key of keys) {
        const value = getStringValue(point[key] ?? attributes[key]);
        if (value) {
            return value;
        }
    }
    return undefined;
}

function getPointInteractionMetadata(point: RawChartData, attributes: TNode['attributes'], label: string | number, value: number): VictoryChartPointInteractionMetadata {
    const tooltipValue = point.tooltipValue ?? point.tooltipvalue ?? point.y;
    const metadata: VictoryChartPointInteractionMetadata = {
        label: getStringValue(point.label ?? label),
        tooltipLabel: getMetadataValue(point, attributes, ['tooltipLabel', 'tooltiplabel', 'label', 'name']) ?? getStringValue(point.tooltip ?? point.label ?? label),
        tooltipValue: typeof tooltipValue === 'string' || typeof tooltipValue === 'number' ? tooltipValue : value,
        tooltipPercentage: getMetadataValue(point, attributes, ['tooltipPercentage', 'tooltippercentage', 'percentage']),
        searchQuery: getMetadataValue(point, attributes, [
            'searchQuery',
            'searchquery',
            'data-search-query',
            'filterQuery',
            'filterquery',
            'data-filter-query',
            'drilldownQuery',
            'drillDownQuery',
            'drilldownquery',
            'data-drilldown-query',
            'q',
        ]),
        query: getMetadataValue(point, attributes, ['query', 'search']),
        route: getMetadataValue(point, attributes, ['route', 'path', 'drilldownRoute', 'drillDownRoute', 'drilldownroute', 'data-drilldown-route']),
        href: getMetadataValue(point, attributes, ['href', 'drilldownHref', 'drillDownHref', 'drilldownhref', 'data-drilldown-href']),
        url: getMetadataValue(point, attributes, ['url', 'link', 'drilldown', 'drillDown', 'drilldownUrl', 'drillDownUrl', 'drilldownURL', 'drillDownURL', 'drilldownurl', 'data-drilldown-url']),
    };

    Object.keys(metadata).forEach((key) => {
        if (metadata[key as keyof VictoryChartPointInteractionMetadata] === undefined) {
            delete metadata[key as keyof VictoryChartPointInteractionMetadata];
        }
    });

    return metadata;
}

/**
 * Parse data points from a `<victorybar>` or `<victoryline>` node.
 * Both series types share the same data structure: an array of {x, y} points.
 */
function parseVictorySeriesNode(tnode: TNode, typeface: SkTypeface | null, rootProcessedResult: ProcessNodeResult | null): PartialProcessNodeResult {
    const isHorizontal = rootProcessedResult?.isHorizontal;
    const categories = rootProcessedResult?.categories;
    const points = parseAttribute<RawChartData[]>(tnode.attributes.data) ?? [];
    const yKey = getYKey(tnode);
    const data: Record<string, CartesianChartData> = {};
    for (const point of points) {
        if (isHorizontal) {
            const metadata = getPointInteractionMetadata(point, tnode.attributes, point.y, typeof point.x === 'number' ? point.x : categories?.indexOf(point.x) ?? 0);
            // Even though the X-Axis is going to hold the y values on horizontal mode, it's not the independent axis
            // thus we cannot use `point.y` as the key since two points can have the same y value.
            data[`${point.y}-${point.x}`] = {
                [X_KEY]: point.y,
                [yKey]: typeof point.x === 'number' ? point.x : categories?.indexOf(point.x),
                [INTERACTION_METADATA_KEY]: {
                    [yKey]: metadata,
                },
            } as CartesianChartData;
        } else {
            const metadata = getPointInteractionMetadata(point, tnode.attributes, point.x, point.y);
            data[point.x] = {
                [X_KEY]: point.x,
                [yKey]: point.y,
                [INTERACTION_METADATA_KEY]: {
                    [yKey]: metadata,
                },
            } as CartesianChartData;
        }
    }
    return {data, yKeys: [yKey], barYKeys: tnode.tagName === 'victorybar' ? [yKey] : []};
}

export default parseVictorySeriesNode;
