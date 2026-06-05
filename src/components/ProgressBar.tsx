import type { AppState, ModelLoadProgress } from '../types';
import { useI18n } from '../i18n/LanguageProvider';

interface ProgressBarProps {
  appState: AppState;
  loadProgress: ModelLoadProgress | null;
}

/** 進捗フェーズの識別子。表示文字列は locale (`t.progress[key]`) で解決する。 */
export type ProgressPhaseKey = 'downloading' | 'preparing' | 'analyzing';

export interface PhaseView {
  key: ProgressPhaseKey;
  progress: number;
  indeterminate: boolean;
}

export function selectPhase(appState: AppState, loadProgress: ModelLoadProgress | null): PhaseView | null {
  if (appState === 'model_loading') {
    if (loadProgress?.status === 'downloading') {
      return {
        key: 'downloading',
        progress: loadProgress.progress,
        indeterminate: false,
      };
    }
    return {
      key: 'preparing',
      progress: loadProgress?.progress ?? 0,
      indeterminate: loadProgress?.status !== 'loading',
    };
  }
  if (appState === 'inferring') {
    return {
      key: 'analyzing',
      progress: 0,
      indeterminate: true,
    };
  }
  return null;
}

export function ProgressBar({ appState, loadProgress }: ProgressBarProps) {
  const { t } = useI18n();
  const phase = selectPhase(appState, loadProgress);
  if (!phase) return null;

  const pct = phase.indeterminate ? 100 : Math.max(0, Math.min(1, phase.progress)) * 100;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
        padding: '0.75rem 1rem',
        background: 'rgba(255, 255, 255, 0.04)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '8px',
      }}
    >
      <div style={{ fontSize: '0.9rem', color: '#cfd6e0' }}>{t.progress[phase.key]}</div>
      <div
        style={{
          position: 'relative',
          height: '6px',
          borderRadius: '3px',
          background: 'rgba(255, 255, 255, 0.08)',
          overflow: 'hidden',
        }}
      >
        <div
          style={
            phase.indeterminate
              ? {
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  width: '40%',
                  background: 'linear-gradient(90deg, transparent, #6aa9ff, transparent)',
                  animation: 'progress-indeterminate 1.4s linear infinite',
                }
              : {
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: 0,
                  width: `${pct}%`,
                  background: '#6aa9ff',
                  transition: 'width 0.2s ease-out',
                }
          }
        />
      </div>
    </div>
  );
}
