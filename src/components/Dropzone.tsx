import { useCallback, useRef, useState } from 'react';
import { useI18n } from '../i18n/LanguageProvider';

export interface SampleItem {
  label: string;
  /** BASE_URL からの相対パス（例: 'samples/sample-01.jpg'） */
  path: string;
  thumbnail?: string;
}

interface DropzoneProps {
  samples: SampleItem[];
  onSelectFile: (file: File) => void;
  onSelectSample: (path: string) => void;
  disabled?: boolean;
  /** モバイル時にカメラ起動 input を出す */
  enableCameraCapture?: boolean;
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  // 一部ブラウザで type が空のことがある（HEIC 等）
  return /\.(jpe?g|png|webp|gif|heic|heif|bmp)$/i.test(file.name);
}

export function Dropzone({
  samples,
  onSelectFile,
  onSelectSample,
  disabled = false,
  enableCameraCapture = false,
}: DropzoneProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);

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

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer.types.includes('Files')) {
        setDragActive(true);
        e.dataTransfer.dropEffect = 'copy';
      }
    },
    [disabled],
  );

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      if (disabled) return;
      const file = e.dataTransfer.files?.[0];
      if (file && isImageFile(file)) {
        onSelectFile(file);
      }
    },
    [disabled, onSelectFile],
  );

  return (
    <div
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: '1rem',
        padding: '1.5rem',
        border: `2px dashed ${dragActive ? '#6aa9ff' : 'rgba(255, 255, 255, 0.2)'}`,
        borderRadius: '12px',
        background: dragActive ? 'rgba(106, 169, 255, 0.08)' : 'rgba(255, 255, 255, 0.03)',
        transition: 'background 0.15s ease-out, border-color 0.15s ease-out',
      }}
    >
      <button
        type="button"
        onClick={handleClickPick}
        disabled={disabled}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '1rem',
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
        aria-label={t.dropzone.pickAria}
      >
        <div aria-hidden style={{ fontSize: '2.5rem', lineHeight: 1 }}>
          ⬆
        </div>
        <div style={{ fontSize: '1rem' }}>{t.dropzone.cta}</div>
        <div style={{ fontSize: '0.8rem', color: '#9aa3b2' }}>{t.dropzone.formats}</div>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        disabled={disabled}
        style={{ display: 'none' }}
      />

      {enableCameraCapture && (
        <div>
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            disabled={disabled}
          >
            {t.dropzone.capture}
          </button>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
            disabled={disabled}
            style={{ display: 'none' }}
          />
        </div>
      )}

      {samples.length > 0 && (
        <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: '1rem' }}>
          <div style={{ fontSize: '0.85rem', color: '#9aa3b2', marginBottom: '0.5rem' }}>
            {t.dropzone.trySamples}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {samples.map((s) => (
              <button
                key={s.path}
                type="button"
                onClick={() => onSelectSample(s.path)}
                disabled={disabled}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '0.25rem',
                  padding: '0.4rem 0.6rem',
                  fontSize: '0.85rem',
                }}
              >
                {s.thumbnail && (
                  <img
                    src={s.thumbnail}
                    alt=""
                    style={{
                      width: '72px',
                      height: '54px',
                      objectFit: 'cover',
                      borderRadius: '4px',
                    }}
                  />
                )}
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
