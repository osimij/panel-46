// The assistant's light. Panel stays nearly grayscale, and so does this: while the assistant
// works, the conversation card is lit from below, inside its own bottom edge (just above the
// composer). It is a glow, not a fog and not an outline: a few pools of light sit on the bottom
// edge, each brightest on the edge and falling off smoothly into the card.
//
// It is alive in the three ways the designer asked for:
//   depth: each pool swells up into the card and sinks back at its own pace;
//   width: each pool widens and narrows;
//   shape: the pools wander along the edge and cross each other, so the outline of the light
//          never repeats. When one reaches a corner, the light wraps round it and climbs that side.
//
// Most pools are white falling to gray; two are a brown bronze, so a little warmth passes through.
// The edge itself carries a hairline of warm white, brightest under the pools.
// In the light theme the same light is a pale gray and tan tint, since white would vanish on a light card.
//
// The composer sits just under that edge, so it catches the light (part "field"): its top edge
// and a little of its face are lit by the very same pools, at the same moment, only dimmer and
// shallower. Bright where a pool stands above it, bronze under a bronze pool, dark where the
// edge above is dark. Both parts read one clock, so they can never drift apart.

import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "./api.ts";

export type GlowState = "idle" | "work" | "write";

const VERT = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float; // time runs on for as long as the assistant works
#else
precision mediump float;
#endif
uniform vec2 u_res;     // the canvas, in its own pixels
uniform float u_scale;  // CSS pixels per canvas pixel
uniform float u_radius; // the card's bottom corners, in CSS pixels
uniform float u_time;
uniform float u_level;
uniform float u_kick;
uniform float u_dark;
uniform float u_part;   // 0: the card, lit along its bottom edge. 1: the composer under it, catching that light on its top edge.

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// Distance to the edge of a box with rounded corners (negative inside).
float box(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// One pool of light on the bottom edge, seen from x (0 to 1 across the card): centred on c, w wide.
float pool(float x, float c, float w) {
  float k = (x - c) / w;
  return exp(-k * k);
}

// The five pools, seen from x: how much white light and how much bronze light stands there.
// Each pool has its own slow rhythm for where it is, how wide it is and how strong it is; the
// rhythms never line up, so the light never loops. Three are white, two are bronze.
vec2 pools(float x, float t) {
  float w1 = (0.60 + 0.40 * sin(t * 0.83 + 4.0)) * pool(x, 0.28 + 0.26 * sin(t * 0.47 + 0.3) + 0.08 * sin(t * 1.13 + 2.0), 0.26 + 0.10 * sin(t * 0.71 + 1.0));
  float w2 = (0.60 + 0.40 * sin(t * 0.67 + 1.2)) * pool(x, 0.72 + 0.24 * sin(t * 0.39 + 2.1) + 0.07 * sin(t * 1.27 + 0.4), 0.30 + 0.11 * sin(t * 0.59 + 3.0));
  float w3 = (0.50 + 0.50 * sin(t * 0.89 + 0.9)) * pool(x, 0.50 + 0.46 * sin(t * 0.57 + 3.3), 0.13 + 0.05 * sin(t * 1.21 + 2.2));
  float b1 = (0.55 + 0.45 * sin(t * 0.51 + 2.6)) * pool(x, 0.50 + 0.40 * sin(t * 0.31 + 4.2), 0.34 + 0.12 * sin(t * 0.43 + 0.7));
  float b2 = (0.50 + 0.50 * sin(t * 1.09 + 5.0)) * pool(x, 0.50 + 0.46 * sin(t * 0.73 + 1.1), 0.15 + 0.05 * sin(t * 0.97));
  return vec2(w1 + w2 + 0.8 * w3, b1 + 0.9 * b2);
}
// How much light stands at a point of the edge, 0 to 1; it eases off as pools pile up.
float stand(vec2 l) { return 1.0 - exp(-(l.x + l.y) * 0.8); }
// How bronze it is there, 0 to 1.
float bronze(vec2 l) { return 0.8 * l.y / (l.x + l.y + 0.15); }
// Light leaving an edge: d is how far in from it, depth how far it reaches, m how much stands
// there. A hot part hugging the edge and a softer body falling off into the card.
float shine(float d, float depth, float m) {
  return (exp(-d / (depth * 0.24)) * 0.55 + exp(-d / depth) * 0.26) * (0.36 + 0.64 * m);
}

void main() {
  vec2 size = u_res * u_scale;
  vec2 px = gl_FragCoord.xy * u_scale; // CSS pixels, 0 at the bottom
  float t = u_time * 1.3;
  float field = step(0.5, u_part);
  // How far this point is from the lit edge: the card's bottom, or the composer's top.
  float e = mix(px.y, size.y - px.y, field);
  // The composer only gives back part of the light, and it doesn't reach as far into it.
  float reach = mix(1.0, 0.46, field);
  float gain = mix(1.0, 0.8, field);
  float on = clamp(u_level * 1.5 + u_kick * 0.6, 0.0, 1.0);
  float strength = (0.45 + 0.9 * u_level + 0.6 * u_kick) * reach; // taller while working, lower while writing, tallest as it starts

  // What stands at this point along the edge, and at its two ends (the corners).
  vec2 here = pools(px.x / size.x, t), left = pools(0.0, t), right = pools(1.0, t);
  float m = stand(here), mL = stand(left), mR = stand(right);

  // The lit edge: the whole of it glows a little, and under a pool it stands much taller.
  float gB = shine(e, (13.0 + 112.0 * m * sqrt(m)) * strength, m);
  // The two sides: a pool that has reached a corner wraps round it and runs along that side,
  // thinner than on the lit edge and fading with distance. The three are added, as light adds,
  // so they melt into each other at the corners with no seam.
  float upL = exp(-e / ((26.0 + 170.0 * mL) * strength));
  float upR = exp(-e / ((26.0 + 170.0 * mR) * strength));
  float gL = shine(px.x, (8.0 + 46.0 * mL * sqrt(mL)) * strength, mL) * upL;
  float gR = shine(size.x - px.x, (8.0 + 46.0 * mR * sqrt(mR)) * strength, mR) * upR;
  float glow = gB + gL + gR;

  // The hairline on the edge itself, following the rounded corners (the far edge is out of
  // reach). Brightest under the pools; along the sides it fades as their light does.
  float d = max(-box(px - vec2(size.x * 0.5, size.y * mix(1.5, -0.5, field)), vec2(size.x * 0.5, size.y * 1.5), u_radius), 0.0);
  float nearL = smoothstep(-24.0, 24.0, e - px.x), nearR = smoothstep(-24.0, 24.0, e - (size.x - px.x));
  float mEdge = mix(mix(m, mL, nearL * step(px.x, size.x * 0.5)), mR, nearR * step(size.x * 0.5, px.x));
  float upEdge = mix(mix(1.0, upL, nearL * step(px.x, size.x * 0.5)), upR, nearR * step(size.x * 0.5, px.x));
  float line = exp(-d / 1.3) * (0.35 + 0.55 * mEdge) * upEdge;

  float breathe = 0.9 + 0.1 * sin(t * 1.1);
  // It fades out well before the canvas's far edge, so it never ends in a line.
  float a = (line + glow) * gain * on * breathe * smoothstep(size.y, size.y * 0.55, e);
  // A grain too fine to see, so the soft falloff never shows steps on a dark card.
  a = clamp(a + (hash(gl_FragCoord.xy) - 0.5) * (2.0 / 255.0) * step(0.004, a), 0.0, 1.0);

  // Gray-white light, turning bronze where a bronze pool is the one shining; warm white on the
  // edge. On a light card, a soft gray and a tan that tint it instead, kept pale so it reads as
  // warmth on the card and not as dirt.
  float warm = (gB * bronze(here) + gL * bronze(left) + gR * bronze(right)) / (glow + 0.001);
  float hot = clamp(line * 1.4 + glow * 0.5, 0.0, 1.0);
  vec3 col = u_dark > 0.5
    ? mix(mix(vec3(0.80, 0.80, 0.82), vec3(0.80, 0.52, 0.29), warm), vec3(1.0, 0.98, 0.94), hot)
    : mix(mix(vec3(0.78, 0.78, 0.79), vec3(0.84, 0.68, 0.52), warm), vec3(0.66, 0.60, 0.54), hot);
  gl_FragColor = vec4(col * a, a);
}`;

const TARGET: Record<GlowState, number> = { idle: 0, work: 0.62, write: 0.24 };
// One clock for the card's light and the composer's reflection of it, so the pools are in the
// same place in both at every moment.
const T0 = performance.now();

/** `part` "card" is the light along the conversation card's bottom edge; "field" is the composer catching it. */
export function Glow({ state, part = "card" }: { state: GlowState; part?: "card" | "field" }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const want = useRef(state);
  const kick = useRef(0);
  const wake = useRef<() => void>(() => {});

  useEffect(() => {
    // Starting work sends one brighter swell up the edges before it settles.
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
    const uRes = u("u_res"), uScale = u("u_scale"), uRadius = u("u_radius"), uTime = u("u_time"), uLevel = u("u_level"), uKick = u("u_kick"), uDark = u("u_dark"), uPart = u("u_part");

    // Full resolution (up to 2x): the rim on the edge is a hairline, and it would blur at half.
    // The corners follow those of the card (or composer) it is drawn in; a smoothed corner curves in tighter than its
    // radius says, so the light's corner is drawn a little tighter too, to stay inside it.
    let scale = 1;
    let radius = 24;
    const size = () => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      el.width = Math.max(2, Math.round(r.width * dpr));
      el.height = Math.max(2, Math.round(r.height * dpr));
      scale = 1 / dpr;
      const card = el.parentElement ? getComputedStyle(el.parentElement) : null;
      const smoothed = card ? !["", "round"].includes(card.getPropertyValue("corner-shape").trim()) : false;
      radius = (parseFloat(card?.borderBottomLeftRadius ?? "") || 24) * (smoothed ? 0.75 : 1);
      gl.viewport(0, 0, el.width, el.height);
    };
    const dark = matchMedia("(prefers-color-scheme: dark)");
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);

    let level = 0;
    let raf = 0;
    let running = false;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(50, now - last) / 1000;
      last = now;
      const target = TARGET[want.current];
      // Rises quicker than it fades: it answers at once, and leaves slowly.
      level += (target - level) * (1 - Math.exp(-dt * (target > level ? 3.2 : 1.4)));
      kick.current *= Math.exp(-dt * 1.6);
      gl.uniform2f(uRes, el.width, el.height);
      gl.uniform1f(uScale, scale);
      gl.uniform1f(uRadius, radius);
      gl.uniform1f(uDark, dark.matches ? 1 : 0);
      gl.uniform1f(uTime, (now - T0) / 1000);
      gl.uniform1f(uPart, part === "field" ? 1 : 0);
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

  return <canvas ref={canvas} className={`glow glow-${part} glow-${state}`} aria-hidden />;
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
