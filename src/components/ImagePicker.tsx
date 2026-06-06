import { useCallback, useRef } from 'react';
import type { SampleItem } from './Dropzone';
import { useI18n } from '../i18n/LanguageProvider';

/**
 * 設定 UI 常駐版の画像セレクタ（全画面 Dropzone は初回のみ、以後の差替はここで完結）。
 * Dropzone のサブセット（D&D 装飾・大型ボタンなし）。disabled はモデルロード中/推論中に制御。
 * file input の onChange はキャンセルでは発火しないので既存 lastImageData / lastResult は壊れない。
 * 設定パネル最下部に常駐するため折り畳みは持たず常時展開。見出しテキストはサムネ + ファイル選択
 * ボタンで用途が自明なので省略し、支援技術向けに section の aria-label だけ残す。
 */
interface ImagePickerProps {
  samples: SampleItem[];
  onSelectFile: (file: File) => void;
  onSelectSample: (path: string) => void;
  disabled?: boolean;
  /** モバイル時にカメラ起動 input を出す（既存 Dropzone と同じ振る舞い） */
  enableCameraCapture?: boolean;
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  return /\.(jpe?g|png|webp|gif|heic|heif|bmp)$/i.test(file.name);
}

export function ImagePicker({
  samples,
  onSelectFile,
  onSelectSample,
  disabled = false,
  enableCameraCapture = false,
}: ImagePickerProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const handleClickPick = useCallback(() => {
    if (disabled) return;
    inputRef.current?.click();
  }, [disabled]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && isImageFile(file)) {
        onSelectFile(file);
      }
      e.target.value = '';
    },
    [onSelectFile],
  );

  return (
    <section className="dp-image-picker" aria-label={t.picker.sectionAria}>
      <div className="dp-image-picker__samples">
        {samples.map((s) => (
          <button
            key={s.path}
            type="button"
            className="dp-image-picker__sample"
            onClick={() => onSelectSample(s.path)}
            disabled={disabled}
          >
            {s.thumbnail && (
              <img
                src={s.thumbnail}
                alt=""
                loading="lazy"
                decoding="async"
                className="dp-image-picker__sample-thumb"
              />
            )}
            <span className="dp-image-picker__sample-label">{s.label}</span>
          </button>
        ))}
      </div>
      <div className="dp-image-picker__file-row">
        <button
          type="button"
          onClick={handleClickPick}
          disabled={disabled}
          className="dp-image-picker__file"
        >
          {t.picker.fromFile}
        </button>
        {enableCameraCapture && (
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            disabled={disabled}
            className="dp-image-picker__camera"
          >
            {t.picker.capture}
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        disabled={disabled}
        style={{ display: 'none' }}
      />
      {enableCameraCapture && (
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileChange}
          disabled={disabled}
          style={{ display: 'none' }}
        />
      )}
    </section>
  );
}
