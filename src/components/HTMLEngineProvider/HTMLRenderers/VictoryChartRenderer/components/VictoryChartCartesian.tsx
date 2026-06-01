import React, {useCallback, useMemo, useState} from 'react';
import type {LayoutChangeEvent} from 'react-native';
import {StyleSheet, View} from 'react-native';
import {Gesture} from 'react-native-gesture-handler';
import type {TNode} from 'react-native-render-html';
import Animated, {useAnimatedReaction, useAnimatedStyle, useSharedValue} from 'react-native-reanimated';
import {scheduleOnRN} from 'react-native-worklets';
import {BAR_INNER_PADDING} from '@components/Charts/BarChart/BarChartContent';
import ChartTooltip from '@components/Charts/components/ChartTooltip';
import {CartesianChart} from 'victory-native';
import type {CartesianChartRenderArg} from 'victory-native';
import useEnvironment from '@hooks/useEnvironment';
import {openLink} from '@libs/actions/Link';
import Navigation from '@libs/Navigation/Navigation';
import {useVictoryChartContext} from '@components/HTMLEngineProvider/HTMLRenderers/VictoryChartRenderer/context/VictoryChartContext';
import {VictoryChartRenderArgsProvider} from '@components/HTMLEngineProvider/HTMLRenderers/VictoryChartRenderer/context/VictoryChartRenderArgsContext';
import {INTERACTION_METADATA_KEY} from '@components/HTMLEngineProvider/HTMLRenderers/VictoryChartRenderer/constants';
import type {CartesianChartData, VictoryChartPointInteractionMetadata, YKey} from '@components/HTMLEngineProvider/HTMLRenderers/VictoryChartRenderer/types';
import getHierarchyID from '@components/HTMLEngineProvider/HTMLRenderers/VictoryChartRenderer/utils/getHierarchyID';
import getYKey from '@components/HTMLEngineProvider/HTMLRenderers/VictoryChartRenderer/utils/getYKey';
import parseAttribute from '@components/HTMLEngineProvider/HTMLRenderers/VictoryChartRenderer/utils/parseAttribute';
import parseOffset from '@components/HTMLEngineProvider/HTMLRenderers/VictoryChartRenderer/utils/parseOffset';
import ROUTES from '@src/ROUTES';
import type {Route} from '@src/ROUTES';
import VictoryChartLabel from './VictoryChartLabel';
import VictoryChartLegend from './VictoryChartLegend';
import VictoryChartSeries from './VictoryChartSeries';

const TOOLTIP_BAR_GAP = 8;
const SEARCH_QUERY_PARAM_KEYS = new Set(['q', 'query', 'searchquery', 'filterquery']);

type CartesianRenderArgs = CartesianChartRenderArg<CartesianChartData, YKey>;
type ChartBounds = CartesianRenderArgs['chartBounds'];
type ChartPoints = CartesianRenderArgs['points'];

type VictoryChartPoint = {
    x: number;
    xValue: string | number;
    y: number | null | undefined;
    yValue: number | null | undefined;
};

type VictoryChartBarTarget = {
    x: number;
    y: number;
    baselineY: number;
    barWidth: number;
    label: string;
    value: number;
    xValue: string | number;
    yValue: number | null | undefined;
    metadata: VictoryChartPointInteractionMetadata;
};

type VictoryChartBarTargetGroup = {
    yKeys: YKey[];
    customBarWidth?: number;
    betweenGroupPadding?: number;
    isBarGroup: boolean;
};

type ActiveTooltipData = {
    label: string;
    amount: string;
    percentage?: string;
};

function getNumberAttribute(attribute: string | undefined): number | undefined {
    const value = parseAttribute<string | number>(attribute ?? '');
    const numberValue = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numberValue) ? numberValue : undefined;
}

function getStandaloneBarWidth(points: VictoryChartPoint[], chartBounds: ChartBounds, customBarWidth?: number): number {
    if (customBarWidth) {
        return customBarWidth;
    }

    const pointsLength = points.length;
    const denominator = pointsLength - 1 <= 0 ? Math.max(pointsLength, 1) : pointsLength - 1;
    return Math.max(1, ((1 - BAR_INNER_PADDING) * (chartBounds.right - chartBounds.left)) / denominator);
}

function getGroupedBarLayout(pointsCount: number, chartBounds: ChartBounds, seriesCount: number, customBarWidth?: number, betweenGroupPadding = 0, isHorizontal = false) {
    const boundSize = isHorizontal ? chartBounds.top - chartBounds.bottom : chartBounds.right - chartBounds.left;
    const groupWidth = ((1 - betweenGroupPadding) * boundSize) / Math.max(1, pointsCount);
    const barWidth = customBarWidth ?? ((1 - BAR_INNER_PADDING) * groupWidth) / Math.max(1, seriesCount);
    const gapWidth = (groupWidth - barWidth * seriesCount) / Math.max(1, seriesCount - 1);

    return {barWidth, groupWidth, gapWidth};
}

function getBarTargetGroups(tnode: TNode, chartBounds: ChartBounds, points: ChartPoints, isHorizontal = false): VictoryChartBarTargetGroup[] {
    const groups: VictoryChartBarTargetGroup[] = [];

    const collectGroups = (node: TNode, isInsideBarGroup = false) => {
        if (node.tagName === 'victorygroup') {
            const barChildren = node.children.filter((child) => child.tagName === 'victorybar');
            const firstBarChild = barChildren.at(0);

            if (firstBarChild) {
                const customBarWidth = getNumberAttribute(firstBarChild.attributes.barwidth);
                const firstBarPoints = (points[getYKey(firstBarChild)] ?? []) as VictoryChartPoint[];
                groups.push({
                    yKeys: barChildren.map(getYKey),
                    customBarWidth,
                    isBarGroup: true,
                    betweenGroupPadding: customBarWidth
                        ? parseOffset(node.attributes.offset, chartBounds, barChildren.length, customBarWidth, firstBarPoints.length, isHorizontal)
                        : undefined,
                });
            }

            node.children.filter((child) => child.tagName !== 'victorybar').forEach((child) => collectGroups(child, true));
            return;
        }

        if (node.tagName === 'victorybar' && !isInsideBarGroup) {
            groups.push({
                yKeys: [getYKey(node)],
                customBarWidth: getNumberAttribute(node.attributes.barwidth),
                isBarGroup: false,
            });
        }

        node.children.forEach((child) => collectGroups(child, isInsideBarGroup));
    };

    tnode.children.forEach((child) => collectGroups(child));
    return groups;
}

function decodeQueryValue(value: string): string {
    try {
        return decodeURIComponent(value.replace(/\+/g, ' '));
    } catch {
        return value;
    }
}

function getQueryParamValue(value: string | undefined): string | undefined {
    if (!value) {
        return undefined;
    }

    const queryStartIndex = value.indexOf('?');
    if (queryStartIndex < 0) {
        return undefined;
    }

    const hashStartIndex = value.indexOf('#', queryStartIndex);
    const queryString = value.slice(queryStartIndex + 1, hashStartIndex < 0 ? undefined : hashStartIndex);
    return queryString.split('&').reduce<string | undefined>((foundValue, queryPart) => {
        if (foundValue) {
            return foundValue;
        }

        const [rawKey, ...rawValueParts] = queryPart.split('=');
        const key = decodeQueryValue(rawKey).toLowerCase();
        if (!SEARCH_QUERY_PARAM_KEYS.has(key)) {
            return undefined;
        }

        const rawValue = rawValueParts.join('=');
        return rawValue ? decodeQueryValue(rawValue) : undefined;
    }, undefined);
}

function getMetadataSearchQuery(metadata: VictoryChartPointInteractionMetadata): string | undefined {
    const explicitQuery = metadata.searchQuery ?? metadata.filterQuery ?? metadata.q ?? metadata.query;
    if (!explicitQuery) {
        return getQueryParamValue(metadata.route) ?? getQueryParamValue(metadata.href) ?? getQueryParamValue(metadata.url);
    }

    return getQueryParamValue(explicitQuery) ?? explicitQuery;
}

function getTooltipData(target: VictoryChartBarTarget): ActiveTooltipData {
    return {
        label: target.metadata.tooltipLabel ?? target.metadata.label ?? target.label,
        amount: String(target.metadata.tooltipValue ?? target.value),
        percentage: target.metadata.tooltipPercentage,
    };
}

/**
 * Renders the CartesianChart with data, axes, and domain config drawn from context.
 * Labels and legend overlays are handled internally via `renderOutside`.
 */
function VictoryChartCartesian() {
    const {environmentURL} = useEnvironment();
    const {tnode, data, xKey, yKeys, xAxis, yAxis, domain, domainPadding, padding, isHorizontal, barYKeys, labelItems, legendItems} = useVictoryChartContext();
    const [chartWidth, setChartWidth] = useState(0);
    const [activeTooltipData, setActiveTooltipData] = useState<ActiveTooltipData | null>(null);
    const chartData = useMemo(() => Object.values(data) as CartesianChartData[], [data]);
    const chartDataByXValue = useMemo(() => new Map(chartData.map((dataPoint) => [String(dataPoint[xKey]), dataPoint])), [chartData, xKey]);
    const activeBarTargetIndex = useSharedValue(-1);
    const barTargets = useSharedValue<VictoryChartBarTarget[]>([]);
    const isTooltipActive = useSharedValue(false);
    const tooltipPosition = useSharedValue({x: 0, y: 0});

    const handleLayout = (event: LayoutChangeEvent) => {
        setChartWidth(event.nativeEvent.layout.width);
    };

    const syncActiveTooltipData = useCallback(
        (targetIndex: number) => {
            const target = barTargets.get().at(targetIndex);
            setActiveTooltipData(target ? getTooltipData(target) : null);
        },
        [barTargets],
    );

    useAnimatedReaction(
        () => activeBarTargetIndex.get(),
        (targetIndex) => {
            scheduleOnRN(syncActiveTooltipData, targetIndex);
        },
    );

    const tooltipOverlayStyle = useAnimatedStyle(() => ({
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        opacity: isTooltipActive.get() ? 1 : 0,
    }));

    const handleBarPress = useCallback(
        (targetIndex: number) => {
            const target = barTargets.get().at(targetIndex);
            if (!target) {
                return;
            }

            const {metadata} = target;
            const searchQuery = getMetadataSearchQuery(metadata);
            if (searchQuery) {
                const route = ROUTES.SEARCH_ROOT.getRoute({query: searchQuery});
                Navigation.navigate(route);
                return;
            }

            if (metadata.route) {
                Navigation.navigate(metadata.route as Route);
                return;
            }

            const href = metadata.href ?? metadata.url;
            if (!href) {
                return;
            }

            if (href.startsWith('/')) {
                Navigation.navigate(href as Route);
                return;
            }

            openLink(href, environmentURL);
        },
        [barTargets, environmentURL],
    );

    const findHitTargetIndex = (cursorX: number, cursorY: number) => {
        'worklet';

        const targets = barTargets.get();
        for (let index = 0; index < targets.length; index++) {
            const target = targets[index];
            const left = target.x - target.barWidth / 2;
            const right = target.x + target.barWidth / 2;
            const top = Math.min(target.y, target.baselineY);
            const bottom = Math.max(target.y, target.baselineY);
            if (cursorX >= left && cursorX <= right && cursorY >= top && cursorY <= bottom) {
                return index;
            }
        }
        return -1;
    };

    const setActiveTarget = (targetIndex: number) => {
        'worklet';

        activeBarTargetIndex.set(targetIndex);
        isTooltipActive.set(targetIndex >= 0);

        if (targetIndex < 0) {
            return;
        }

        const target = barTargets.get().at(targetIndex);
        if (!target) {
            return;
        }

        tooltipPosition.set({
            x: target.x,
            y: Math.min(target.y, target.baselineY) - TOOLTIP_BAR_GAP,
        });
    };

    const customGestures = barYKeys.length
        ? Gesture.Race(
              Gesture.Hover()
                  .onBegin((event) => {
                      'worklet';

                      setActiveTarget(findHitTargetIndex(event.x, event.y));
                  })
                  .onUpdate((event) => {
                      'worklet';

                      setActiveTarget(findHitTargetIndex(event.x, event.y));
                  })
                  .onEnd(() => {
                      'worklet';

                      setActiveTarget(-1);
                  }),
              Gesture.Tap().onEnd((event) => {
                  'worklet';

                  const targetIndex = findHitTargetIndex(event.x, event.y);
                  setActiveTarget(targetIndex);
                  if (targetIndex >= 0) {
                      scheduleOnRN(handleBarPress, targetIndex);
                  }
              }),
          )
        : undefined;

    const syncBarTargets = useCallback(
        (renderArgs: CartesianRenderArgs) => {
            const nextTargets: VictoryChartBarTarget[] = [];
            const baselineY = Number.isFinite(renderArgs.yScale(0)) ? renderArgs.yScale(0) : renderArgs.chartBounds.bottom;

            getBarTargetGroups(tnode, renderArgs.chartBounds, renderArgs.points, isHorizontal ?? false).forEach((barTargetGroup) => {
                const firstYKey = barTargetGroup.yKeys.at(0);
                if (!firstYKey) {
                    return;
                }

                const firstPoints = (renderArgs.points[firstYKey] ?? []) as VictoryChartPoint[];
                const groupedBarLayout =
                    barTargetGroup.isBarGroup
                        ? getGroupedBarLayout(
                              firstPoints.length,
                              renderArgs.chartBounds,
                              barTargetGroup.yKeys.length,
                              barTargetGroup.customBarWidth,
                              barTargetGroup.betweenGroupPadding,
                              isHorizontal ?? false,
                          )
                        : undefined;

                barTargetGroup.yKeys.forEach((yKey, seriesIndex) => {
                    const points = (renderArgs.points[yKey] ?? []) as VictoryChartPoint[];
                    const groupedOffset = groupedBarLayout ? -groupedBarLayout.groupWidth / 2 + seriesIndex * (groupedBarLayout.barWidth + groupedBarLayout.gapWidth) : 0;
                    const barWidth = groupedBarLayout ? Math.max(1, Math.abs(groupedBarLayout.barWidth)) : getStandaloneBarWidth(points, renderArgs.chartBounds, barTargetGroup.customBarWidth);

                    points.forEach((point, index) => {
                        if (typeof point.y !== 'number') {
                            return;
                        }

                        const dataPoint = chartDataByXValue.get(String(point.xValue));
                        const value = typeof point.yValue === 'number' ? point.yValue : dataPoint?.[yKey];
                        if (typeof value !== 'number') {
                            return;
                        }

                        const metadata = dataPoint?.[INTERACTION_METADATA_KEY]?.[yKey] ?? {};
                        nextTargets.push({
                            x: groupedBarLayout ? point.x + groupedOffset + groupedBarLayout.barWidth / 2 : point.x,
                            y: point.y,
                            baselineY,
                            barWidth,
                            label: String(dataPoint?.[xKey] ?? point.xValue ?? index),
                            value,
                            xValue: point.xValue,
                            yValue: point.yValue,
                            metadata,
                        });
                    });
                });
            });

            barTargets.set(nextTargets);
        },
        [barTargets, chartDataByXValue, isHorizontal, tnode, xKey],
    );

    return (
        <View
            style={styles.wrapper}
            onLayout={handleLayout}
        >
            <CartesianChart
                data={chartData}
                xKey={xKey}
                yKeys={yKeys}
                xAxis={xAxis}
                yAxis={yAxis}
                domain={domain}
                domainPadding={domainPadding}
                padding={padding}
                customGestures={customGestures}
                renderOutside={(renderArgs) => {
                    syncBarTargets(renderArgs);
                    return (
                        <VictoryChartRenderArgsProvider value={renderArgs}>
                            {labelItems.map((labelItem) => (
                                <VictoryChartLabel
                                    key={`label-${labelItem.x}-${labelItem.y}`}
                                    {...labelItem}
                                />
                            ))}
                            {legendItems.map((legendItem) => (
                                <VictoryChartLegend
                                    key={`legend-${legendItem.x}-${legendItem.y}`}
                                    {...legendItem}
                                />
                            ))}
                        </VictoryChartRenderArgsProvider>
                    );
                }}
            >
                {(renderArgs) => (
                    <VictoryChartRenderArgsProvider value={renderArgs}>
                        {tnode.children.map((child) => (
                            <VictoryChartSeries
                                key={`${child.tagName ?? 'node'}-${getHierarchyID(child)}`}
                                tnode={child}
                                isHorizontal={isHorizontal}
                            />
                        ))}
                    </VictoryChartRenderArgsProvider>
                )}
            </CartesianChart>
            {!!activeTooltipData && (
                <Animated.View
                    style={tooltipOverlayStyle}
                    pointerEvents="none"
                >
                    <ChartTooltip
                        label={activeTooltipData.label}
                        amount={activeTooltipData.amount}
                        percentage={activeTooltipData.percentage}
                        chartWidth={chartWidth}
                        initialTooltipPosition={tooltipPosition}
                    />
                </Animated.View>
            )}
        </View>
    );
}

VictoryChartCartesian.displayName = 'VictoryChartCartesian';

const styles = StyleSheet.create({
    wrapper: {
        flex: 1,
        height: '100%',
        width: '100%',
    },
});

export default VictoryChartCartesian;
