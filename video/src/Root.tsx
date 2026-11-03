import React from 'react';
import { Composition } from 'remotion';
import { Cover } from './Cover';
import { Demo, plan } from './Demo';

export function Root() {
  return (
    <>
      <Composition id="Demo" component={Demo} durationInFrames={plan.durationInFrames} fps={plan.fps} width={plan.width} height={plan.height} />
      <Composition id="Cover" component={Cover} durationInFrames={1} fps={30} width={1500} height={1000} defaultProps={{ variant: 'story' as const }} />
      <Composition id="CoverStamps" component={Cover} durationInFrames={1} fps={30} width={1500} height={1000} defaultProps={{ variant: 'stamps' as const }} />
    </>
  );
}
