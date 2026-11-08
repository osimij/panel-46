// The assistant's light. Panel stays grayscale; color shows up only while the assistant
// is working, as a soft iridescent swell rising from behind the composer (after two saves
// in the library: an AI spreadsheet whose glow sweeps up from the prompt, and a journal
// app whose aurora rises from the bottom edge while it writes).

import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "./api.ts";

export type GlowState = "idle" | "work" | "write";

const VERT = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_level;
uniform float u_kick;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
  return v;
}
// A soft spectral palette: butter, rose, violet, periwinkle, aqua.
vec3 tone(float h) { return 0.62 + 0.38 * cos(6.28318 * (h + vec3(0.0, 0.33, 0.67))); }

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float t = u_time * 0.11;
  vec2 q = vec2(fbm(vec2(uv.x * 1.4, uv.y * 1.1 - t)), fbm(vec2(uv.x * 1.4 + 5.2, uv.y * 1.1 + t * 0.8)));
  float n = fbm(vec2(uv.x * 1.8, uv.y * 1.3) + q * 1.7 + vec2(t * 0.4, -t));
  // The swell's crest: higher as the level rises, with a liquid, uneven edge.
  float crest = 0.1 + 0.62 * u_level + 0.25 * u_kick + (n - 0.5) * 0.42;
  float body = smoothstep(crest, crest - 0.6, uv.y);
  // Brighter toward the middle, so it reads as light coming from behind the composer.
  float centre = 1.0 - pow(abs(uv.x - 0.5) * 1.55, 2.2);
  float a = clamp(body * (0.45 + 0.75 * n) * (0.55 + 0.45 * centre), 0.0, 1.0) * clamp(u_level * 1.15 + u_kick * 0.6, 0.0, 1.0);
  vec3 col = tone(uv.x * 0.5 + n * 0.75 + t * 0.6 + uv.y * 0.2);
  gl_FragColor = vec4(col * a, a);
}`;

const TARGET: Record<GlowState, number> = { idle: 0, work: 0.62, write: 0.24 };

export function Glow({ state }: { state: GlowState }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const want = useRef(state);
  const kick = useRef(0);
  const wake = useRef<() => void>(() => {});

  useEffect(() => {
    // Starting work sends one swell up from the composer before it settles.
    if (want.current === "idle" && state !== "idle") kick.current = 1;
    want.current = state;
    wake.current();
  }, [state]);

  useEffect(() => {
    const el = canvas.current!;
    if (prefersReducedMotion()) return;
    const gl = el.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
    if (!gl) return;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    const uRes = u("u_res"), uTime = u("u_time"), uLevel = u("u_level"), uKick = u("u_kick");

    // Half resolution: it's all soft light, and the browser's scaling blurs it further.
    const size = () => {
      const r = el.getBoundingClientRect();
      el.width = Math.max(2, Math.round(r.width * 0.5));
      el.height = Math.max(2, Math.round(r.height * 0.5));
      gl.viewport(0, 0, el.width, el.height);
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);

    let level = 0;
    let raf = 0;
    let running = false;
    let last = performance.now();
    const t0 = last;
    const frame = (now: number) => {
      const dt = Math.min(50, now - last) / 1000;
      last = now;
      const target = TARGET[want.current];
      // Rises quicker than it fades: it answers at once, and leaves slowly.
      level += (target - level) * (1 - Math.exp(-dt * (target > level ? 3.2 : 1.4)));
      kick.current *= Math.exp(-dt * 1.6);
      gl.uniform2f(uRes, el.width, el.height);
      gl.uniform1f(uTime, (now - t0) / 1000);
      gl.uniform1f(uLevel, level);
      gl.uniform1f(uKick, kick.current);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (target === 0 && level < 0.004 && kick.current < 0.01) {
        running = false;
        gl.clear(gl.COLOR_BUFFER_BIT);
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    wake.current = () => {
      if (running || (TARGET[want.current] === 0 && level < 0.004)) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    wake.current();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return <canvas ref={canvas} className={`glow glow-${state}`} aria-hidden />;
}

/**
 * The assistant's mark: a small drop of light. Gray and still at rest, like the rest of
 * Panel; it takes on color and turns when hovered or while the assistant works.
 */
export function Mark({ size = 20, active = false }: { size?: number; active?: boolean }) {
  return (
    <span className={`mark ${active ? "active" : ""}`} style={{ width: size, height: size }} aria-hidden>
      <i className="mark-a" />
      <i className="mark-b" />
      <i className="mark-c" />
    </span>
  );
}
