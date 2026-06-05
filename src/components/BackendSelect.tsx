import { useI18n } from '../i18n/LanguageProvider';
import type { InferenceBackend } from '../types';

/** ドロップダウンに並べる順序（WebGPU 優先表示）。 */
const BACKEND_OPTIONS: readonly InferenceBackend[] = ['webgpu', 'wasm'];

const BACKEND_LABELS: Record<InferenceBackend, string> = {
  webgpu: 'WebGPU',
  wasm: 'WASM',
};

interface BackendSelectProps {
  backend: InferenceBackend;
  onChange: (next: InferenceBackend) => void;
}

/**
 * 推論バックエンド切替セレクトボックス。ヘッダーの言語セレクト左に配置する。
 * 一部 GPU/ドライバで WebGPU の深度が壊れる端末向けの手動回避手段。
 * 選択可能な端末（非 iOS かつ WebGPU 利用可）でのみ App から描画される。
 */
export function BackendSelect({ backend, onChange }: BackendSelectProps) {
  const { t } = useI18n();

  return (
    <select
      className="dp-backend-select"
      value={backend}
      onChange={(e) => onChange(e.target.value as InferenceBackend)}
      title={t.app.backendHint}
      aria-label={t.app.backendSelectAria}
    >
      {BACKEND_OPTIONS.map((code) => (
        <option key={code} value={code}>
          {t.app.backend}: {BACKEND_LABELS[code]}
        </option>
      ))}
    </select>
  );
}
