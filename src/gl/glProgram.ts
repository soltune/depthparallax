/**
 * WebGL2 シェーダー / プログラムのコンパイル共通ヘルパ（compile → link → detach → delete）。
 * attrib の固定 location は `attribs` 引数で（`bindAttribLocation` をリンク前に呼ぶ）、
 * 失敗時のエラー識別は `label` 引数で各呼び出し元を区別する。
 */

/** シェーダーをコンパイルする。 失敗時はソースを添えて throw（呼び出し元は new 時に握る）。 */
export function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
  label = '',
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('createShader failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '(no log)';
    gl.deleteShader(shader);
    const prefix = label ? `${label}: ` : '';
    throw new Error(`${prefix}shader compile failed: ${log}\n--- source ---\n${source}`);
  }
  return shader;
}

/**
 * 頂点 / フラグメントシェーダーをリンクしてプログラムを作る。
 * @param attribs `{ 属性名: location }` をリンク前に `bindAttribLocation` する（任意）
 */
export function linkProgram(
  gl: WebGL2RenderingContext,
  vs: WebGLShader,
  fs: WebGLShader,
  attribs?: Record<string, number>,
  label = '',
): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('createProgram failed');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  if (attribs) {
    for (const [name, loc] of Object.entries(attribs)) {
      gl.bindAttribLocation(program, loc, name);
    }
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? '(no log)';
    gl.deleteProgram(program);
    const prefix = label ? `${label}: ` : '';
    throw new Error(`${prefix}program link failed: ${log}`);
  }
  return program;
}

/**
 * ソース文字列からプログラムを構築する（compile → link → detach → delete）。
 * shader オブジェクトはリンク後不要なので detach + delete して GPU リソースを解放する。
 */
export function buildProgram(
  gl: WebGL2RenderingContext,
  vsSrc: string,
  fsSrc: string,
  attribs?: Record<string, number>,
  label = '',
): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc, label);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc, label);
  const program = linkProgram(gl, vs, fs, attribs, label);
  gl.detachShader(program, vs);
  gl.detachShader(program, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return program;
}
