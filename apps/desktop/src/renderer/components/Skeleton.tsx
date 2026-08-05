import React from 'react';

export function Skeleton({
  width = '100%',
  height = 14,
  radius = 6,
  style,
}: {
  width?: string | number;
  height?: string | number;
  radius?: number;
  style?: React.CSSProperties;
}) {
  return <span className="skeleton" style={{ width, height, borderRadius: radius, ...style }} />;
}
