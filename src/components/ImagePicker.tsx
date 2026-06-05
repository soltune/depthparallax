import { useCallback, useEffect, useRef, useState } from 'react';
import type { SampleItem } from './Dropzone';
import { useI18n } from '../i18n/LanguageProvider';

/**
 * 設定 UI 常駐版の画像セレクタ（全画面 Dropzone は初回のみ、以後の差替はここで完結）。
 * Dropzone のサブセット（D&D 装飾・大型ボタンなし）。disabled はモデルロード中/推論中に制御。
 * file input の onChange はキャンセルでは発火しないので既存 lastImageData / lastResult は壊れない。
 * collapseKey 変化（= 推論完了で lastResult 更新）で自動 collapse。collapsed は「画像 ▾」の 1 行帯。
 */
interface ImagePickerProps {
  samples: SampleItem[];
  onSelectFile: (file: File) => void;
  onSelectSample: (path: string) => void;
  disabled?: boolean;
  /** モバイル時にカメラ起動 input を出す（既存 Dropzone と同じ振る舞い） */
  enableCameraCapture?: boolean;
  /** 変化したら自動で折り畳む（通常は最新の DepthResult を渡し推論完了で collapse）。 */
  collapseKey?: unknown;
  /** collapsed バーのサムネ URL（サンプルはサムネ path、アップロードは dataURL）。 */
  currentThumbnailUrl?: string | null;
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
  collapseKey,
  currentThumbnailUrl,
}: ImagePickerProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const [collapsed, setCollapsed] = useState(true);
  const prevCollapseKeyRef = useRef(collapseKey);

  useEffect(() => {
    if (prevCollapseKeyRef.current !== collapseKey) {
      prevCollapseKeyRef.current = collapseKey;
      setCollapsed(true);
    }
  }, [collapseKey]);

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

  if (collapsed) {
    return (
      <section className="dp-image-picker dp-image-picker--collapsed" aria-label={t.picker.sectionAria}>
        <button
          type="button"
          className="dp-image-picker__toggle"
          onClick={() => setCollapsed(false)}
          aria-expanded={false}
          aria-controls="dp-image-picker-body"
        >
          {currentThumbnailUrl && (
            <img
              src={currentThumbnailUrl}
              alt=""
              className="dp-image-picker__toggle-thumb"
              decoding="async"
            />
          )}
          <span className="dp-image-picker__toggle-label">{t.picker.change}</span>
          <span className="dp-image-picker__toggle-chevron" aria-hidden="true">
            ▾
          </span>
        </button>
      </section>
    );
  }

  return (
    <section
      className="dp-image-picker dp-image-picker--expanded"
      aria-label={t.picker.sectionAria}
      id="dp-image-picker-body"
    >
      <div className="dp-image-picker__header">
        <div className="dp-image-picker__label">{t.picker.selectAnother}</div>
        <button
          type="button"
          className="dp-image-picker__collapse"
          onClick={() => setCollapsed(true)}
          aria-expanded={true}
          aria-controls="dp-image-picker-body"
          aria-label={t.picker.collapseAria}
        >
          ▴
        </button>
      </div>
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
