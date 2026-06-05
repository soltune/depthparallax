/** English locale. Mirrors ja.ts; the shared {@link Dictionary} type enforces key parity. */
import type { Dictionary } from '../index';

export const en: Dictionary = {
  lang: { ja: 'JP', en: 'EN', selectAria: 'Language' },
  app: {
    backend: 'Backend',
    backendHint: 'Switch inference backend. Try WASM if depth looks wrong on this GPU.',
    backendSelectAria: 'Select inference backend',
    errorPrefix: 'Error',
    reload: 'Reload',
    dismissError: 'Dismiss error',
    inputPreview: 'Input preview',
    loadingImage: 'Loading image…',
    processing: 'Processing…',
    analyzingDepth: 'Analyzing depth…',
    cancel: 'Cancel',
    footerModel: 'Model: Depth Anything V2 Small (q4f16)',
    inferenceTime: 'Inference: {ms} ms / Depth: {w}×{h}',
    github: 'View source on GitHub',
  },
  samples: { outdoor: 'Outdoor', portrait: 'Portrait', city: 'City night' },
  progress: {
    downloading: 'Downloading model (1/2)',
    preparing: 'Preparing model (2/2)',
    analyzing: 'Analyzing depth…',
  },
  dropzone: {
    pickAria: 'Click to select an image',
    cta: 'Drop an image / click to select',
    formats: 'JPG, PNG, WebP / up to 10MB',
    trySamples: 'Try a sample',
    capture: '📷 Camera',
  },
  picker: {
    sectionAria: 'Image',
    change: 'Change image',
    selectAnother: 'Choose another image',
    collapseAria: 'Collapse image section',
    fromFile: 'Select file',
    capture: '📷 Camera',
  },
  effectPanel: {
    groupFilter: 'Filters',
    groupMotion: 'Motion',
    groupsAria: 'Effect groups',
    noEffect: 'No effect',
    scrollLeft: 'Scroll left',
    scrollRight: 'Scroll right',
    noParams: 'No adjustable parameters',
    reset: 'Reset to defaults',
  },
  viewMode: { aria: 'View mode', parallax: 'Parallax', orbit: '3D' },
  controlBar: {
    strength: 'Parallax strength',
    gyro: 'Gyro',
  },
  orbit: {
    params: {
      depthScale: 'Depth strength',
      autoRotate: 'Auto-rotate',
    },
    autoRotateLabel: 'Auto-rotate',
  },
  common: { play: 'Play', stop: 'Stop', playButton: '▶ Play', stopButton: '⏸ Stop' },
  dolly: { autoplay: 'Auto-play', progressAria: 'Dolly zoom playback progress' },
  focal: { label: 'Focal depth', auto: 'Auto', autoHint: 'Reset to auto-measured position' },
  miniPrimary: {
    groupAria: 'Current state and primary parameter',
    modeAria: 'Current mode',
    noEffect: 'No effect selected',
    dollyPlay: 'Play dolly zoom',
    dollyStop: 'Stop dolly zoom auto-play',
  },
  depthMap: {
    showToggle: 'Show depth map',
    enhanceToggle: 'Enhance depth contrast',
    enhanceTooltip:
      'For images with skewed depth distribution, evenly expands relief within the subject and background (histogram equalization).',
    pipAria: 'Enlarge depth map',
    modalAria: 'Depth map detail',
    close: 'Close',
    caption: 'Depth map',
    near: 'Near',
    far: 'Far',
  },
  bottomSheet: { expand: 'Expand sheet', collapse: 'Collapse sheet' },
  webglError: {
    title: 'Failed to initialize the WebGL2 renderer',
    body: 'Your browser may not support WebGL2 / FBO.',
  },
  effects: {
    parallax: { name: 'Parallax only' },
    fog: {
      name: 'Fog',
      params: { fogColor: 'Fog color', fogDensity: 'Density', fogCurve: 'Depth focus' },
    },
    scanline: {
      name: 'CRT',
      params: { lineCount: 'Line count', lineIntensity: 'Intensity', scanSpeed: 'Scroll speed' },
    },
    chromatic: {
      name: 'Chromatic aberration',
      params: { aberration: 'Aberration', focalDepth: 'Focal depth' },
    },
    neon: {
      name: 'Neon glow',
      params: { glowColor: 'Glow color', edgeThreshold: 'Edge threshold', glowIntensity: 'Intensity' },
    },
    anaglyph: {
      name: 'Anaglyph 3D',
      params: { eyeSeparation: 'Eye separation (px)' },
    },
    dof: {
      name: 'Depth of field',
      params: {
        focalDepth: 'Focal depth',
        focalAuto: 'Auto focal depth',
        maxBlurRadius: 'Blur strength (px)',
      },
    },
    tiltshift: {
      name: 'Tilt-shift',
      params: {
        focalDepth: 'Focal depth',
        focalAuto: 'Auto focal depth',
        focalBandWidth: 'Focus band width',
        maxBlurRadius: 'Blur strength (px)',
        saturationBoost: 'Saturation boost',
      },
    },
    dolly: {
      name: 'Dolly zoom',
      params: {
        dollyAmount: 'Effect strength',
        dollyFocalDepth: 'Focal depth',
        dollyFocalAuto: 'Auto focus',
        dollySpeed: 'Playback speed',
      },
      bipolar: { dollyAmount: { negative: 'Wide', positive: 'Tele' } },
    },
    particles: {
      name: 'Particles',
      params: {
        particleType: 'Type',
        particleCount: 'Count',
        fallSpeed: 'Fall speed',
        windSway: 'Wind sway',
      },
      options: { particleType: ['❄ Snow', '☂ Rain', '🌸 Petals', '✨ Fireflies'] },
    },
  },
};
