import type { CSSProperties } from 'react';

/** Cache-busted official lockup — Zero Forge PRESENTS SUPERCRIB (text lockup, not badge). */
const SPLASH_IMG = '/supercrib-splash-v3.jpg?v=3';

interface Props {
  /** True while fading out before screen change. */
  exiting?: boolean;
}

/**
 * Boot splash — full-viewport lockup. Background cover/contain so no photo outline.
 */
export function Splash({ exiting = false }: Props) {
  const stageStyle = {
    ['--splash-img' as string]: `url(${SPLASH_IMG})`,
  } as CSSProperties;

  return (
    <div
      className={`splash-screen${exiting ? ' splash-exit' : ' splash-enter'}`}
      role="status"
      aria-live="polite"
      aria-label="Zero Forge presents SUPERCRIB"
      style={stageStyle}
    >
      <div className="splash-stage" aria-hidden="true" />
    </div>
  );
}
