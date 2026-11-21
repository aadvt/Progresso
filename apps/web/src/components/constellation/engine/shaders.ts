/**
 * GLSL for the constellation. Everything glows with additive blending, so
 * there is no post-processing (bloom would be too heavy for mid-range phones).
 */

/** Stars: one instanced, camera-facing quad per concept. */
export const STAR_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iColor;
attribute vec4 iParams; // size, brightness, kind (0 plain, 1 root, 2 mastered), phase
attribute vec2 iFx;     // flash 0..1, dim multiplier
uniform float uTime;
uniform float uMotion;
uniform float uViewH;
uniform float uMinPx;
varying vec2 vUv;
varying vec3 vColor;
varying float vBright;
varying float vKind;
varying float vPhase;
varying float vFlash;
varying float vDim;

void main() {
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float size = iParams.x;
  if (iParams.z > 0.5 && iParams.z < 1.5) size *= 1.0 + 0.07 * sin(uTime * 2.1 + iParams.w * 6.28) * uMotion;
  size *= 1.0 + iFx.x * 1.6;
  float px = size * projectionMatrix[1][1] * uViewH * 0.5 / max(-mv.z, 0.001);
  // Keep far stars visible: never smaller than uMinPx on screen.
  if (px < uMinPx) size *= uMinPx / max(px, 0.0001);
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy;
  vColor = iColor;
  vBright = iParams.y;
  vKind = iParams.z;
  vPhase = iParams.w;
  vFlash = iFx.x;
  vDim = iFx.y;
}
`;

export const STAR_FRAG = /* glsl */ `
uniform float uTime;
uniform float uMotion;
varying vec2 vUv;
varying vec3 vColor;
varying float vBright;
varying float vKind;
varying float vPhase;
varying float vFlash;
varying float vDim;

void main() {
  float d = length(vUv);
  if (d > 1.0) discard;
  bool isRoot = vKind > 0.5 && vKind < 1.5;
  bool isMastered = vKind > 1.5;
  float coreR = isRoot ? 0.085 : 0.17;
  float core = smoothstep(coreR, coreR * 0.25, d);
  float glow = exp(-d * d * (isRoot ? 22.0 : 6.5));
  // Gentle twinkle so the sky feels alive (off with reduced motion).
  float tw = 1.0 + 0.12 * sin(uTime * (1.1 + vPhase) + vPhase * 40.0) * uMotion;
  float wide = isRoot ? exp(-d * d * 5.0) * 0.35 : 0.0;
  float ring = 0.0;
  if (isRoot) {
    // Sonar rings: the root is the source of the problem.
    float t1 = fract(uTime * 0.38 + vPhase);
    float t2 = fract(uTime * 0.38 + vPhase + 0.5);
    float r1 = smoothstep(0.03, 0.0, abs(d - (0.12 + t1 * 0.85))) * (1.0 - t1);
    float r2 = smoothstep(0.03, 0.0, abs(d - (0.12 + t2 * 0.85))) * (1.0 - t2);
    float still = smoothstep(0.02, 0.0, abs(d - 0.42)) * 0.55;
    ring = mix(still, (r1 + r2) * 0.9, uMotion);
  } else if (isMastered) {
    ring = smoothstep(0.03, 0.0, abs(d - 0.55)) * 0.35;
  }
  vec3 col = vColor * (glow * 0.95 * tw + wide + ring) * vBright;
  col += mix(vColor, vec3(1.0), 0.7) * core * min(vBright * 1.25, 1.4);
  col += vec3(1.0, 0.96, 0.86) * vFlash * (exp(-d * d * 4.0) * 1.1);
  col *= vDim;
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Threads: curved prerequisite lines with a flowing glow on root → mistake chains and the ripple. */
export const THREAD_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aAlpha;
attribute float aT;
attribute float aHop;
attribute float aFlow;
varying vec3 vColor;
varying float vAlpha;
varying float vT;
varying float vHop;
varying float vFlow;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vT = aT;
  vHop = aHop;
  vFlow = aFlow;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const THREAD_FRAG = /* glsl */ `
uniform float uTime;
uniform float uMotion;
uniform float uRipple;
uniform vec3 uRippleColor;
varying vec3 vColor;
varying float vAlpha;
varying float vT;
varying float vHop;
varying float vFlow;
void main() {
  // Light flows from the root (t = 0) towards the mistakes it causes.
  float flow = vFlow * pow(0.5 + 0.5 * sin((vT * 3.0 - uTime * 0.9) * 6.2831), 5.0) * uMotion;
  vec3 col = vColor * (vAlpha + flow * 0.8);
  if (vHop > -0.5) {
    float head = uRipple - vHop;
    float pulse = exp(-pow((vT - head) * 5.0, 2.0)) * step(-0.25, head) * step(head, 1.25);
    float lit = step(vT, head);
    col += uRippleColor * (pulse * 1.7 + lit * 0.3);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Soft nebula under each subject disc. */
export const NEBULA_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const NEBULA_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
varying vec2 vUv;
void main() {
  float d = length(vUv);
  float a = pow(max(1.0 - d, 0.0), 2.2) * uStrength + exp(-d * d * 30.0) * uStrength * 0.6;
  gl_FragColor = vec4(uColor * a, 1.0);
}
`;

/** Shockwave ring on the disc when a root is mastered. */
export const SHOCK_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uProgress;
varying vec2 vUv;
void main() {
  float d = length(vUv);
  float r = uProgress;
  float band = smoothstep(0.06, 0.0, abs(d - r)) * (1.0 - uProgress);
  float fill = smoothstep(r, 0.0, d) * 0.12 * (1.0 - uProgress);
  gl_FragColor = vec4(uColor * (band * 1.2 + fill), 1.0);
}
`;

/** Full-screen sky gradient, drawn first (the canvas is opaque so additive glow works everywhere). */
export const SKY_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.9999, 1.0);
}
`;

export const SKY_FRAG = /* glsl */ `
uniform vec3 uSky0;
uniform vec3 uSky1;
uniform vec3 uSky2;
uniform float uAspect;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - vec2(0.5, 0.52)) * vec2(uAspect, 1.0);
  float d = length(p) * 1.25;
  vec3 col = mix(uSky2, uSky1, smoothstep(0.0, 0.55, d));
  col = mix(col, uSky0, smoothstep(0.5, 1.2, d));
  gl_FragColor = vec4(col, 1.0);
}
`;
