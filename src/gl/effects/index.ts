/** 全エフェクトの EffectDescriptor 一覧（orbit は ViewMode 側で扱うため含まない）。 */
import type { EffectDescriptor } from '../../types';
import { parallaxEffect } from './parallax.ts';
import { fogEffect } from './fog.ts';
import { scanlineEffect } from './scanline.ts';
import { chromaticEffect } from './chromatic.ts';
import { neonEffect } from './neon.ts';
import { anaglyphEffect } from './anaglyph.ts';
import { dofEffect } from './dof.ts';
import { tiltshiftEffect } from './tiltshift.ts';
import { dollyEffect } from './dolly.ts';
import { particlesEffect } from './particles.ts';

export const EFFECT_DESCRIPTORS: readonly EffectDescriptor[] = [
  parallaxEffect,
  fogEffect,
  scanlineEffect,
  chromaticEffect,
  neonEffect,
  anaglyphEffect,
  dofEffect,
  tiltshiftEffect,
  particlesEffect,
  dollyEffect,
];

// dev only: primaryParam が params[].name と一致しているか等を検査（型では捕捉できない）。
// throw はせず警告のみ（UI 不変原則優先）。
if (import.meta.env.DEV) {
  for (const d of EFFECT_DESCRIPTORS) {
    if (!d.group) {
      console.error(`[effects] descriptor "${d.type}" is missing required field "group"`);
    }
    if (d.primaryParam !== undefined) {
      const found = d.params.some((p) => p.name === d.primaryParam);
      if (!found) {
        console.error(
          `[effects] descriptor "${d.type}" declares primaryParam="${d.primaryParam}" but no matching params[].name`,
        );
      }
    }
  }
}
