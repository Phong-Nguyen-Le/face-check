import React from "react";
import { View } from "react-native";
import Svg, { Line } from "react-native-svg";

type Props = {
  width: number;
  height: number;
  progress: number;
  tickCount?: number;
  tickLength?: number;
  tickWidth?: number;
  activeColor?: string;
  inactiveColor?: string;
  startAngle?: number;
  endAngle?: number;
  /** Scale the Y radius of the ellipse. 1 = natural fit, <1 = flatter, >1 = taller. */
  curveScaleY?: number;
};

export function OvalTickProgress({
  width,
  height,
  progress,
  tickCount = 150,
  tickLength = 6,
  tickWidth = 3,
  activeColor = "#6D28D9",
  inactiveColor = "rgba(0,0,0,0.18)",
  startAngle = -90,
  endAngle = 270,
  curveScaleY = 1,
}: Props) {
  const safeProgress = Math.max(0, Math.min(progress, 1));

  const cx = width / 2;
  const cy = height / 2;

  const outerRx = width / 2 - tickWidth;
  const outerRy = (height / 2 - tickWidth) * curveScaleY;

  const innerRx = outerRx - tickLength;
  const innerRy = outerRy - tickLength;

  const activeTicks = Math.round(tickCount * safeProgress);

  const angleRange = endAngle - startAngle;

  return (
    <View style={{ width, height }} pointerEvents="none">
      <Svg width={width} height={height}>
        {Array.from({ length: tickCount }).map((_, index) => {
          const angle = startAngle + (angleRange * index) / tickCount;

          const rad = (angle * Math.PI) / 180;

          const x1 = cx + innerRx * Math.cos(rad);
          const y1 = cy + innerRy * Math.sin(rad);

          const x2 = cx + outerRx * Math.cos(rad);
          const y2 = cy + outerRy * Math.sin(rad);

          const isActive = index < activeTicks;

          return (
            <Line
              key={index}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={isActive ? activeColor : inactiveColor}
              strokeWidth={tickWidth}
              strokeLinecap="round"
            />
          );
        })}
      </Svg>
    </View>
  );
}
