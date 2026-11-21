/**
 * The 3D knowledge constellation, in plain three.js (no React, no post-
 * processing). Loaded lazily, so pages that don't show it never download three.
 *
 * Budget, so mid-range phones stay smooth: one instanced draw call for all
 * stars, one for all threads, a few for guides and nebulae. Per-frame work on
 * the CPU is O(stars) only while a ripple or camera flight is running.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { rippleHops, STATE_LABEL, type ConstellationModel, type ConstellationNode } from "@progresso/core/constellation/client";
import { starLook, unitLabel, type Palette, type StarLook } from "../appearance";
import { NEBULA_FRAG, NEBULA_VERT, SHOCK_FRAG, SKY_FRAG, SKY_VERT, STAR_FRAG, STAR_VERT, THREAD_FRAG, THREAD_VERT } from "./shaders";

export interface SceneStats {
  fps: number;
  avgFps: number;
  pixelRatio: number;
  frames: number;
  renderer: string;
  stars: number;
  threadVertices: number;
}

export type LabelKind = "subject" | "unit" | "root" | "focus" | "hover";

export interface SceneOptions {
  embedded: boolean;
  reducedMotion: boolean;
  palette: Palette;
  labelLayer: HTMLElement;
  labelClass: Record<LabelKind, string>;
  onSelect(id: string | null): void;
  onActivate?(): void;
  onStats?(s: SceneStats): void;
  onDegrade?(reason: "slow" | "context-lost"): void;
}

export interface RippleRequest {
  roots: string[];
  to: ConstellationModel;
}

const SEGMENTS = 14;
const HOP_SECONDS = 0.42;
const ROOT_STAGGER = 0.7;
const FLY_MS = 950;
const tmp = new THREE.Vector3();

const pos3 = (n: { x: number; y: number; h: number }, out = new THREE.Vector3()) => out.set(n.x, n.h, n.y);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const sameLook = (a: StarLook, b: StarLook) =>
  a.color === b.color && a.size === b.size && a.bright === b.bright && a.kind === b.kind && a.tint === b.tint;
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

interface Label {
  key: string;
  kind: LabelKind;
  el: HTMLElement;
  world: THREE.Vector3;
  priority: number;
  w: number;
  h: number;
  text: string;
}

interface Flight {
  start: number;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  fromSph: THREE.Spherical;
  toSph: THREE.Spherical;
}

interface RippleRun {
  start: number;
  roots: number[];
  arrival: Float32Array; // seconds after start, Infinity if not reached
  from: StarLook[];
  to: StarLook[];
  toModel: ConstellationModel;
  end: number;
  shocks: { mesh: THREE.Mesh; start: number; radius: number }[];
}

export class ConstellationScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly clock = new THREE.Clock();
  private readonly opts: SceneOptions;
  private readonly container: HTMLElement;
  private model!: ConstellationModel;
  private index = new Map<string, number>();

  private starGeo?: THREE.InstancedBufferGeometry;
  private starMat: THREE.ShaderMaterial;
  private stars?: THREE.Mesh;
  private iColor!: THREE.InstancedBufferAttribute;
  private iParams!: THREE.InstancedBufferAttribute;
  private iFx!: THREE.InstancedBufferAttribute;
  private looks: StarLook[] = [];

  private threadGeo?: THREE.BufferGeometry;
  private threadMat: THREE.ShaderMaterial;
  private threads?: THREE.LineSegments;
  private decor = new THREE.Group();

  private labels = new Map<string, Label>();
  private labelsDirty = true;
  private lastCamKey = "";

  private time = 0;
  private raf = 0;
  private visible = true;
  private needsRender = true;
  private flight?: Flight;
  private ripple?: RippleRun;
  private selected: string | null = null;
  private hovered: string | null = null;
  private highlight: Set<number> | null = null;
  private disposed = false;
  private userMoved = false;

  private pixelRatio: number;
  private fpsFrames = 0;
  private fpsStart = 0;
  private fpsHistory: number[] = [];
  private slowWindows = 0;
  private totalFrames = 0;
  private readonly rendererName: string;
  private readonly observers: { disconnect(): void }[] = [];
  private down?: { x: number; y: number; t: number; id: number };

  constructor(container: HTMLElement, model: ConstellationModel, opts: SceneOptions) {
    this.container = container;
    this.opts = opts;
    const dpr = window.devicePixelRatio || 1;
    this.pixelRatio = Math.min(dpr, opts.embedded ? 1.5 : 1.75);
    this.renderer = new THREE.WebGLRenderer({ antialias: dpr < 2, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setClearColor(new THREE.Color(opts.palette.sky0), 1);
    const canvas = this.renderer.domElement;
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.touchAction = opts.embedded ? "pan-y" : "none";
    container.appendChild(canvas);
    const gl = this.renderer.getContext();
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    this.rendererName = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "webgl";

    this.camera = new THREE.PerspectiveCamera(40, 1, 1, 4000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.6;
    this.controls.zoomSpeed = 0.9;
    this.controls.minPolarAngle = 0.08;
    this.controls.maxPolarAngle = 1.42;
    this.controls.screenSpacePanning = true;
    this.controls.enabled = !opts.embedded;
    this.controls.autoRotate = !opts.reducedMotion;
    this.controls.autoRotateSpeed = opts.embedded ? 0.45 : 0.25;
    this.controls.addEventListener("start", () => {
      this.userMoved = true;
      this.flight = undefined;
      this.controls.autoRotate = false;
    });
    this.controls.addEventListener("change", () => (this.needsRender = true));

    this.starMat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: { uTime: { value: 0 }, uMotion: { value: opts.reducedMotion ? 0 : 1 }, uViewH: { value: 800 }, uMinPx: { value: 3 } },
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    this.threadMat = new THREE.ShaderMaterial({
      vertexShader: THREAD_VERT,
      fragmentShader: THREAD_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uMotion: { value: opts.reducedMotion ? 0 : 1 },
        uRipple: { value: -100 },
        uRippleColor: { value: new THREE.Color(opts.palette.ripple) },
      },
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });

    this.scene.add(this.decor);
    this.addSky();
    this.addDust();
    this.setModel(model);
    this.frameHome(0);

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    canvas.addEventListener("webglcontextlost", this.onContextLost);

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.observers.push(ro);
    const io = new IntersectionObserver((entries) => {
      this.visible = entries.some((e) => e.isIntersecting);
      if (this.visible) this.needsRender = true;
    });
    io.observe(container);
    this.observers.push(io);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.resize();
    this.fpsStart = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------ public API

  /** Show a model immediately (no animation). */
  setModel(model: ConstellationModel): void {
    this.model = model;
    this.index = new Map(model.nodes.map((n, i) => [n.id, i]));
    this.looks = model.nodes.map((n) => starLook(n, this.opts.palette));
    this.buildStars();
    this.buildThreads();
    this.buildDecor();
    this.buildLabels();
    if (this.selected && !this.index.has(this.selected)) this.selected = null;
    this.applyHighlight();
    this.needsRender = true;
  }

  /** The chain reaction: light travels out from each mastered root, then the new states settle. */
  playRipple(req: RippleRequest): void {
    this.finishRipple();
    const to = req.to;
    const toLooks = to.nodes.map((n) => starLook(n, this.opts.palette));
    if (this.opts.reducedMotion) {
      this.setModel(to);
      return;
    }
    const roots = req.roots.map((id) => this.index.get(id)).filter((i): i is number => i !== undefined);
    const arrival = new Float32Array(this.model.nodes.length).fill(Infinity);
    roots.forEach((r, k) => {
      for (const [i, hop] of rippleHops(this.model, r)) arrival[i] = Math.min(arrival[i]!, k * ROOT_STAGGER + hop * HOP_SECONDS);
    });
    const lead = this.userMoved && !this.selected ? 0.25 : FLY_MS / 1000 - 0.15;
    // Frame the root and everything it reaches, unless the user is already exploring.
    const reached = [...arrival.keys()].filter((i) => Number.isFinite(arrival[i]!));
    if (!this.userMoved || this.selected) this.flyToNodes(reached, { duration: FLY_MS, keepAngle: true, padding: 1.08 });
    this.selected = null;
    this.highlight = null;
    this.applyHighlight();
    this.opts.onSelect(null);

    // Per-vertex ripple start for every thread the light travels along.
    const hopAttr = this.threadGeo!.getAttribute("aHop") as THREE.BufferAttribute;
    const vertsPerEdge = SEGMENTS * 2;
    this.model.edges.forEach((e, ei) => {
      const a = arrival[e.from]!;
      const b = arrival[e.to]!;
      const value = Number.isFinite(a) && Number.isFinite(b) && b > a ? a / HOP_SECONDS : -1;
      for (let v = 0; v < vertsPerEdge; v++) hopAttr.setX(ei * vertsPerEdge + v, value);
    });
    hopAttr.needsUpdate = true;

    const maxArrival = reached.reduce((m, i) => Math.max(m, arrival[i]!), 0);
    const now = this.time + lead;
    const shocks = roots.map((r, k) => {
      const subject = this.model.subjects.find((s) => s.name === this.model.nodes[r]!.subject);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.ShaderMaterial({
          vertexShader: NEBULA_VERT,
          fragmentShader: SHOCK_FRAG,
          uniforms: { uColor: { value: new THREE.Color(this.opts.palette.ripple) }, uProgress: { value: 0 } },
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      pos3(this.model.nodes[r]!, mesh.position);
      mesh.visible = false;
      this.scene.add(mesh);
      return { mesh, start: now + k * ROOT_STAGGER, radius: (subject?.radius ?? 80) * 1.15 };
    });
    this.ripple = { start: now, roots, arrival, from: this.looks.slice(), to: toLooks, toModel: to, end: now + maxArrival + 1.6, shocks };
    window.setTimeout(() => this.ripple && this.buildLabels(), lead * 1000);
    this.controls.autoRotate = false;
    this.needsRender = true;
  }

  select(id: string | null, fly = true): void {
    this.selected = id;
    const i = id ? this.index.get(id) : undefined;
    if (i === undefined) {
      this.selected = null;
      this.highlight = null;
    } else {
      const n = this.model.nodes[i]!;
      const set = new Set<number>([i, ...n.prerequisites, ...n.dependents]);
      if (n.root_rank !== undefined) {
        this.model.nodes.forEach((m, j) => {
          if (m.root_ids.includes(n.id)) set.add(j);
        });
      }
      this.highlight = set;
      if (fly) {
        this.flyToNodes([...set], { duration: FLY_MS, keepAngle: true, padding: 1.25, maxRadius: 70, minRadius: 22 });
      }
    }
    this.applyHighlight();
    this.buildLabels();
  }

  /** Zoom to the problem area: the roots and the mistakes they explain. */
  showRoots(): void {
    const roots = this.model.nodes.map((n, i) => (n.root_rank !== undefined ? i : -1)).filter((i) => i >= 0);
    let focus = this.model.nodes.map((n, i) => (n.root_ids.length > 0 || n.root_rank !== undefined ? i : -1)).filter((i) => i >= 0);
    if (focus.length === 0) focus = this.model.nodes.map((n, i) => (n.state === "weak" ? i : -1)).filter((i) => i >= 0);
    this.selected = null;
    this.highlight = roots.length > 0 ? new Set(focus) : null;
    this.applyHighlight();
    this.buildLabels();
    if (focus.length === 0) this.frameOverview(FLY_MS);
    else this.flyToNodes(focus, { duration: FLY_MS, keepAngle: false, padding: 1.3, minRadius: 42 });
  }

  overview(): void {
    this.selected = null;
    this.highlight = null;
    this.applyHighlight();
    this.buildLabels();
    this.frameOverview(FLY_MS);
  }

  setReducedMotion(reduced: boolean): void {
    this.opts.reducedMotion = reduced;
    this.starMat.uniforms.uMotion!.value = reduced ? 0 : 1;
    this.threadMat.uniforms.uMotion!.value = reduced ? 0 : 1;
    if (reduced) {
      this.controls.autoRotate = false;
      this.finishRipple();
    }
    this.needsRender = true;
  }

  stats(): SceneStats {
    const avg = this.fpsHistory.length ? this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length : 0;
    return {
      fps: this.fpsHistory[this.fpsHistory.length - 1] ?? 0,
      avgFps: Math.round(avg * 10) / 10,
      pixelRatio: this.pixelRatio,
      frames: this.totalFrames,
      renderer: this.rendererName,
      stars: this.model.nodes.length,
      threadVertices: this.model.edges.length * SEGMENTS * 2,
    };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.observers.forEach((o) => o.disconnect());
    document.removeEventListener("visibilitychange", this.onVisibility);
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    canvas.removeEventListener("pointerup", this.onPointerUp);
    canvas.removeEventListener("pointermove", this.onPointerMove);
    canvas.removeEventListener("pointerleave", this.onPointerLeave);
    canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.renderer.dispose();
    canvas.remove();
    for (const l of this.labels.values()) l.el.remove();
    this.labels.clear();
  }

  // ------------------------------------------------------------------ building

  private buildStars(): void {
    const n = this.model.nodes.length;
    if (!this.starGeo || this.starGeo.instanceCount !== n) {
      if (this.stars) this.scene.remove(this.stars);
      this.starGeo?.dispose();
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
      geo.setIndex([0, 1, 2, 0, 2, 3]);
      geo.instanceCount = n;
      geo.setAttribute("iPos", new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
      this.iColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      this.iParams = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
      this.iFx = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
      this.iColor.setUsage(THREE.DynamicDrawUsage);
      this.iParams.setUsage(THREE.DynamicDrawUsage);
      this.iFx.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute("iColor", this.iColor);
      geo.setAttribute("iParams", this.iParams);
      geo.setAttribute("iFx", this.iFx);
      this.starGeo = geo;
      this.stars = new THREE.Mesh(geo, this.starMat);
      this.stars.frustumCulled = false;
      this.stars.renderOrder = 3;
      this.scene.add(this.stars);
    }
    const iPos = this.starGeo.getAttribute("iPos") as THREE.InstancedBufferAttribute;
    this.model.nodes.forEach((node, i) => {
      iPos.setXYZ(i, node.x, node.h, node.y);
      this.writeLook(i, this.looks[i]!, 0, node);
    });
    iPos.needsUpdate = true;
    this.markStarsDirty();
  }

  private unitColor(unitId: string, out = new THREE.Color()): THREE.Color {
    const u = this.model.units.find((x) => x.id === unitId);
    return out.setHSL((u?.hue ?? 222) / 360, 0.6, 0.66);
  }

  private readonly c1 = new THREE.Color();
  private readonly c2 = new THREE.Color();
  private readonly c3 = new THREE.Color();

  private writeLook(i: number, look: StarLook, flash: number, node = this.model.nodes[i]!): void {
    const c = this.c1.set(look.color);
    if (look.tint > 0) c.lerp(this.unitColor(node.unit_id, this.c2), look.tint);
    this.iColor.setXYZ(i, c.r, c.g, c.b);
    this.iParams.setXYZW(i, look.size, look.bright, look.kind, (i * 0.618) % 1);
    this.iFx.setX(i, flash);
  }

  private markStarsDirty(): void {
    this.iColor.needsUpdate = true;
    this.iParams.needsUpdate = true;
    this.iFx.needsUpdate = true;
  }

  private applyHighlight(): void {
    const n = this.model.nodes.length;
    for (let i = 0; i < n; i++) this.iFx.setY(i, !this.highlight || this.highlight.has(i) ? 1 : 0.34);
    this.iFx.needsUpdate = true;
    this.buildThreadAlpha();
    this.needsRender = true;
  }

  private buildThreads(): void {
    const edges = this.model.edges;
    const vCount = edges.length * SEGMENTS * 2;
    const position = new Float32Array(vCount * 3);
    const color = new Float32Array(vCount * 3);
    const alpha = new Float32Array(vCount);
    const t = new Float32Array(vCount);
    const hop = new Float32Array(vCount).fill(-1);
    const flow = new Float32Array(vCount);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const ctrl = new THREE.Vector3();
    const p = new THREE.Vector3();
    const ca = new THREE.Color();
    const cb = new THREE.Color();
    let v = 0;
    edges.forEach((e) => {
      const from = this.model.nodes[e.from]!;
      const to = this.model.nodes[e.to]!;
      pos3(from, a);
      pos3(to, b);
      const len = a.distanceTo(b);
      ctrl.addVectors(a, b).multiplyScalar(0.5);
      ctrl.y += Math.min(len * 0.22, 16) + 1.5;
      const look = this.edgeLook(e, from, to, ca, cb);
      for (let s = 0; s < SEGMENTS; s++) {
        for (const k of [s, s + 1]) {
          const u = k / SEGMENTS;
          // Quadratic Bézier: threads arch above the disc.
          p.set(0, 0, 0)
            .addScaledVector(a, (1 - u) * (1 - u))
            .addScaledVector(ctrl, 2 * u * (1 - u))
            .addScaledVector(b, u * u);
          position.set([p.x, p.y, p.z], v * 3);
          const c = this.c1.copy(ca).lerp(cb, u);
          color.set([c.r, c.g, c.b], v * 3);
          alpha[v] = look.alpha;
          t[v] = u;
          flow[v] = look.flow;
          v++;
        }
      }
    });
    if (this.threads) this.scene.remove(this.threads);
    this.threadGeo?.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(color, 3));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aT", new THREE.BufferAttribute(t, 1));
    geo.setAttribute("aHop", new THREE.BufferAttribute(hop, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aFlow", new THREE.BufferAttribute(flow, 1));
    this.threadGeo = geo;
    this.threads = new THREE.LineSegments(geo, this.threadMat);
    this.threads.frustumCulled = false;
    this.threads.renderOrder = 2;
    this.scene.add(this.threads);
    this.baseAlpha = alpha.slice();
  }

  private baseAlpha = new Float32Array(0);

  private edgeLook(
    e: ConstellationModel["edges"][number],
    from: ConstellationNode,
    to: ConstellationNode,
    ca: THREE.Color,
    cb: THREE.Color,
  ): { alpha: number; flow: number } {
    const pal = this.opts.palette;
    const fixed = (n: ConstellationNode) => n.state === "mastered" || n.lit;
    if (e.chain && (from.state === "root" || from.state === "weak" || to.state === "weak")) {
      ca.set(from.state === "root" ? pal.root : pal.chain);
      cb.set(pal.chain);
      return { alpha: 0.5, flow: 1 };
    }
    if (fixed(from) && fixed(to)) {
      ca.set(from.state === "mastered" ? pal.mastered : pal.lit);
      cb.set(to.state === "learning" ? pal.learning : pal.lit);
      return { alpha: 0.26, flow: 0 };
    }
    this.unitColor(to.unit_id, ca).lerp(this.c2.set(pal.thread), 0.5);
    cb.copy(ca);
    const warm = from.state === "weak" || to.state === "weak" || from.state === "root" || to.state === "root";
    return { alpha: warm ? 0.22 : 0.12, flow: 0 };
  }

  private buildThreadAlpha(): void {
    if (!this.threadGeo) return;
    const attr = this.threadGeo.getAttribute("aAlpha") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const per = SEGMENTS * 2;
    this.model.edges.forEach((e, ei) => {
      const on = !this.highlight || (this.highlight.has(e.from) && this.highlight.has(e.to));
      const k = this.highlight ? (on ? 2.2 : 0.3) : 1;
      for (let v = 0; v < per; v++) {
        const idx = ei * per + v;
        arr[idx] = Math.min(0.85, this.baseAlpha[idx]! * k);
      }
    });
    attr.needsUpdate = true;
  }

  private buildDecor(): void {
    for (const child of [...this.decor.children]) {
      this.decor.remove(child);
      const m = child as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    const positions: number[] = [];
    const colors: number[] = [];
    const guide = new THREE.Color(this.opts.palette.unassessed).multiplyScalar(0.075);
    const push = (x1: number, y1: number, x2: number, y2: number, c: THREE.Color) => {
      positions.push(x1, 0, y1, x2, 0, y2);
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    };
    for (const s of this.model.subjects) {
      // Dotted ring guides between classes.
      for (const ring of s.rings) {
        const r = ring.outer + 0.8;
        const steps = Math.max(48, Math.round(r * 1.6));
        for (let k = 0; k < steps; k += 2) {
          const a1 = (k / steps) * Math.PI * 2;
          const a2 = ((k + 1) / steps) * Math.PI * 2;
          push(s.center.x + r * Math.cos(a1), s.center.y + r * Math.sin(a1), s.center.x + r * Math.cos(a2), s.center.y + r * Math.sin(a2), guide);
        }
      }
      // Nebula glow.
      const neb = new THREE.Mesh(
        new THREE.PlaneGeometry(s.radius * 2.7, s.radius * 2.7),
        new THREE.ShaderMaterial({
          vertexShader: NEBULA_VERT,
          fragmentShader: NEBULA_FRAG,
          uniforms: {
            uColor: { value: this.unitColor(this.model.units.find((u) => u.subject === s.name)?.id ?? "") },
            uStrength: { value: 0.3 },
          },
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
        }),
      );
      neb.rotation.x = -Math.PI / 2;
      neb.position.set(s.center.x, -3, s.center.y);
      neb.renderOrder = 0;
      this.decor.add(neb);
    }
    // Sector arcs: each unit's cluster is bracketed in its own tint.
    for (const u of this.model.units) {
      if (u.half_width >= Math.PI - 0.01) continue;
      const s = this.model.subjects.find((x) => x.name === u.subject)!;
      const ring = s.rings[u.ring]!;
      const r = ring.outer + 2.6;
      const c = this.unitColor(u.id).multiplyScalar(0.2);
      const a0 = u.angle - u.half_width + 0.02;
      const a1 = u.angle + u.half_width - 0.02;
      const steps = Math.max(6, Math.round((a1 - a0) * r * 0.5));
      for (let k = 0; k < steps; k++) {
        const t1 = a0 + ((a1 - a0) * k) / steps;
        const t2 = a0 + ((a1 - a0) * (k + 1)) / steps;
        push(s.center.x + r * Math.cos(t1), s.center.y + r * Math.sin(t1), s.center.x + r * Math.cos(t2), s.center.y + r * Math.sin(t2), c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const lines = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    );
    lines.renderOrder = 1;
    this.decor.add(lines);
  }

  private skyMat?: THREE.ShaderMaterial;

  private addSky(): void {
    const pal = this.opts.palette;
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        uSky0: { value: new THREE.Color(pal.sky0) },
        uSky1: { value: new THREE.Color(pal.sky1) },
        uSky2: { value: new THREE.Color(pal.sky2) },
        uAspect: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.scene.add(sky);
  }

  private addDust(): void {
    const n = 900;
    const arr = new Float32Array(n * 3);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < n; i++) {
      const r = 450 + rnd() * 900;
      const th = rnd() * Math.PI * 2;
      const ph = Math.acos(2 * rnd() - 1);
      arr.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.7, r * Math.sin(ph) * Math.sin(th)], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    const dust = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 1.6,
        sizeAttenuation: false,
        color: new THREE.Color(this.opts.palette.lit).multiplyScalar(0.5),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    dust.renderOrder = 0;
    this.scene.add(dust);
  }

  // ------------------------------------------------------------------ labels

  private buildLabels(): void {
    const want = new Map<string, Omit<Label, "el" | "w" | "h">>();
    // During a ripple the root labels already say what the root is becoming.
    const m = this.ripple?.toModel ?? this.model;
    for (const s of m.subjects) {
      want.set(`s:${s.name}`, {
        key: `s:${s.name}`,
        kind: "subject",
        world: new THREE.Vector3(s.center.x, 20, s.center.y - s.radius * 0.15),
        priority: 50,
        text: s.name,
      });
    }
    if (!this.opts.embedded) {
      for (const u of m.units) {
        want.set(`u:${u.id}`, {
          key: `u:${u.id}`,
          kind: "unit",
          world: new THREE.Vector3(u.label.x, 0, u.label.y),
          priority: 20 + Math.min(u.concept_count, 20),
          text: unitLabel(u, m.units),
        });
      }
    }
    m.nodes.forEach((n) => {
      if (n.root_rank === undefined) return;
      want.set(`r:${n.id}`, {
        key: `r:${n.id}`,
        kind: "root",
        world: pos3(n),
        priority: 90 - n.root_rank,
        text: `${n.name}|${n.state === "mastered" ? "Mastered" : n.state === "learning" ? "In progress" : `Root gap ${n.root_rank}`}`,
      });
    });
    if (this.highlight && !this.opts.embedded) {
      for (const i of this.highlight) {
        const n = m.nodes[i]!;
        if (n.root_rank !== undefined || n.id === this.selected) continue;
        want.set(`n:${n.id}`, { key: `n:${n.id}`, kind: "unit", world: pos3(n), priority: 30 + n.error_count * 5, text: n.name });
      }
    }
    const sel = this.selected ? m.nodes[this.index.get(this.selected)!] : undefined;
    if (sel) {
      want.delete(`r:${sel.id}`);
      want.set("focus", { key: "focus", kind: "focus", world: pos3(sel), priority: 200, text: `${sel.name}|${STATE_LABEL[sel.state]}` });
    }
    const hov = this.hovered && this.hovered !== this.selected ? m.nodes[this.index.get(this.hovered) ?? -1] : undefined;
    if (hov) {
      want.delete(`r:${hov.id}`);
      want.delete(`n:${hov.id}`);
      want.set("hover", { key: "hover", kind: "hover", world: pos3(hov), priority: 150, text: `${hov.name}|${STATE_LABEL[hov.state]}` });
    }

    for (const [key, l] of this.labels) {
      if (!want.has(key)) {
        l.el.remove();
        this.labels.delete(key);
      }
    }
    for (const w of want.values()) {
      let l = this.labels.get(w.key);
      if (!l || l.kind !== w.kind) {
        l?.el.remove();
        const el = document.createElement("span");
        this.opts.labelLayer.appendChild(el);
        l = { ...w, el, w: 0, h: 0, text: "" };
        this.labels.set(w.key, l);
      }
      l.world = w.world;
      l.priority = w.priority;
      if (l.text !== w.text) {
        const [title, sub] = w.text.split("|");
        l.el.className = `${this.opts.labelClass[w.kind]} ${w.kind === "root" ? (w.text.includes("Mastered") ? "is-mastered" : "") : ""}`;
        l.el.textContent = "";
        const b = document.createElement("span");
        b.textContent = title ?? "";
        l.el.appendChild(b);
        if (sub) {
          const s = document.createElement("small");
          s.textContent = sub;
          l.el.appendChild(s);
        }
        l.text = w.text;
        l.w = l.el.offsetWidth;
        l.h = l.el.offsetHeight;
      }
    }
    this.labelsDirty = true;
    this.needsRender = true;
  }

  private placeLabels(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const placed: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const list = [...this.labels.values()].sort((a, b) => b.priority - a.priority);
    for (const l of list) {
      tmp.copy(l.world).project(this.camera);
      const x = (tmp.x * 0.5 + 0.5) * w;
      const y = (-tmp.y * 0.5 + 0.5) * h;
      const anchoredBelow = l.kind === "root" || l.kind === "focus" || l.kind === "hover" || l.key.startsWith("n:");
      // Keep labels on screen (they stay close to their star).
      const x1 = Math.min(Math.max(x - l.w / 2, 4), Math.max(4, w - l.w - 4));
      const y1 = anchoredBelow ? y + 10 : y - l.h / 2;
      const box = { x1: x1 - 3, y1: y1 - 2, x2: x1 + l.w + 3, y2: y1 + l.h + 2 };
      let show = tmp.z < 1 && x > -40 && x < w + 40 && y > -20 && y < h + 20;
      if (show && l.kind !== "focus" && l.kind !== "hover") {
        show = !placed.some((p) => box.x1 < p.x2 && box.x2 > p.x1 && box.y1 < p.y2 && box.y2 > p.y1);
      }
      if (show) placed.push(box);
      l.el.style.transform = `translate3d(${Math.round(x1)}px, ${Math.round(y1)}px, 0)`;
      l.el.style.opacity = show ? "1" : "0";
    }
  }

  // ------------------------------------------------------------------ camera

  private defaultAngles(): { phi: number; theta: number } {
    const aspect = this.camera.aspect;
    const multi = this.model.subjects.length > 1;
    // Two side-by-side discs are ~3:1 wide; on anything narrower, look along them so they stack.
    if (multi && aspect < 1.1) return { phi: 0.6, theta: Math.PI / 2 - 0.08 };
    return { phi: aspect < 0.9 ? 0.7 : 0.92, theta: 0.12 };
  }

  /** The first view: the whole map, or for the small preview, the problem area. */
  private frameHome(duration: number): void {
    if (!this.opts.embedded) return this.frameOverview(duration);
    const focus = this.model.nodes.map((n, i) => (n.root_ids.length > 0 || n.root_rank !== undefined ? i : -1)).filter((i) => i >= 0);
    if (focus.length === 0) return this.frameOverview(duration);
    const subject = this.model.nodes[focus[0]!]!.subject;
    const sameDisc = focus.filter((i) => this.model.nodes[i]!.subject === subject);
    this.flyToNodes(sameDisc, { duration, keepAngle: false, padding: 1.15, minRadius: 48 });
  }

  private frameOverview(duration: number): void {
    const pts: THREE.Vector3[] = [];
    for (const s of this.model.subjects) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        pts.push(new THREE.Vector3(s.center.x + Math.cos(a) * (s.radius + 4), 0, s.center.y + Math.sin(a) * (s.radius + 4)));
      }
      pts.push(new THREE.Vector3(s.center.x, 22, s.center.y));
    }
    const { phi, theta } = this.defaultAngles();
    this.flyTo(pts, { phi, theta, duration, padding: this.opts.embedded ? 0.98 : 1.04 });
  }

  private flyToNodes(
    idx: number[],
    o: { duration: number; keepAngle: boolean; padding: number; maxRadius?: number; minRadius?: number },
  ): void {
    if (idx.length === 0) return;
    const pts = idx.map((i) => pos3(this.model.nodes[i]!));
    const center = new THREE.Vector3();
    pts.forEach((p) => center.add(p));
    center.divideScalar(pts.length);
    // Never zoom in so far that the area looks empty, nor out so far that it is lost.
    const min = o.minRadius ?? 18;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      pts.push(new THREE.Vector3(center.x + Math.cos(a) * min, center.y, center.z + Math.sin(a) * min));
    }
    let use = pts;
    if (o.maxRadius !== undefined) use = pts.filter((p) => p.distanceTo(center) <= o.maxRadius!);
    const sph = new THREE.Spherical().setFromVector3(tmp.copy(this.camera.position).sub(this.controls.target));
    const def = this.defaultAngles();
    const phi = o.keepAngle ? Math.min(Math.max(sph.phi, 0.35), 1.15) : Math.min(def.phi, 0.8);
    const theta = o.keepAngle ? sph.theta : def.theta;
    this.flyTo(use, { phi, theta, duration: o.duration, padding: o.padding });
  }

  /** Fit points on screen from the given angles (binary search on distance), then fly there. */
  private flyTo(points: THREE.Vector3[], o: { phi: number; theta: number; duration: number; padding: number }): void {
    const box = new THREE.Box3().setFromPoints(points);
    const target = box.getCenter(new THREE.Vector3());
    const cam = this.camera.clone();
    const dir = new THREE.Vector3().setFromSphericalCoords(1, o.phi, o.theta);
    const fits = (d: number) => {
      cam.position.copy(target).addScaledVector(dir, d);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      const lim = 0.9 / o.padding;
      return points.every((p) => {
        tmp.copy(p).project(cam);
        return Math.abs(tmp.x) <= lim && Math.abs(tmp.y) <= lim && tmp.z < 1;
      });
    };
    let lo = 5;
    let hi = 3000;
    for (let k = 0; k < 28; k++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    const toSph = new THREE.Spherical(hi, o.phi, o.theta);
    this.controls.maxDistance = Math.max(this.controls.maxDistance === Infinity ? 0 : this.controls.maxDistance, hi * 2.2);
    this.controls.minDistance = 12;
    if (o.duration <= 0 || this.opts.reducedMotion) {
      this.controls.target.copy(target);
      this.camera.position.copy(target).add(tmp.setFromSpherical(toSph));
      this.camera.lookAt(target);
      this.flight = undefined;
      this.needsRender = true;
      this.labelsDirty = true;
      return;
    }
    const fromSph = new THREE.Spherical().setFromVector3(tmp.copy(this.camera.position).sub(this.controls.target));
    let dTheta = toSph.theta - fromSph.theta;
    dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
    toSph.theta = fromSph.theta + dTheta;
    this.flight = { start: performance.now(), fromTarget: this.controls.target.clone(), toTarget: target, fromSph, toSph };
    this.flightMs = o.duration;
    this.controls.autoRotate = false;
  }

  private flightMs = FLY_MS;

  // ------------------------------------------------------------------ frame loop

  private loop = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (!this.visible || document.hidden) return;
    const animated = !this.opts.reducedMotion;
    if (animated) this.time += dt;
    else if (this.ripple) this.finishRipple();

    if (this.flight) {
      const f = this.flight;
      const t = Math.min(1, (now - f.start) / this.flightMs);
      const e = easeInOut(t);
      this.controls.target.lerpVectors(f.fromTarget, f.toTarget, e);
      const s = new THREE.Spherical(
        f.fromSph.radius + (f.toSph.radius - f.fromSph.radius) * e,
        f.fromSph.phi + (f.toSph.phi - f.fromSph.phi) * e,
        f.fromSph.theta + (f.toSph.theta - f.fromSph.theta) * e,
      );
      this.camera.position.copy(this.controls.target).add(tmp.setFromSpherical(s));
      this.camera.lookAt(this.controls.target);
      if (t >= 1) this.flight = undefined;
      this.needsRender = true;
    }
    if (this.ripple) this.stepRipple();

    const moved = this.controls.update(dt);
    if (moved) this.needsRender = true;
    if (!(animated || this.needsRender)) return;

    this.starMat.uniforms.uTime!.value = this.time;
    this.threadMat.uniforms.uTime!.value = this.time;
    const camKey = this.camera.matrixWorld.elements.map((x) => x.toFixed(3)).join(",");
    if (camKey !== this.lastCamKey || this.labelsDirty) {
      this.lastCamKey = camKey;
      this.labelsDirty = false;
      this.camera.updateMatrixWorld();
      this.placeLabels();
    }
    this.renderer.render(this.scene, this.camera);
    this.needsRender = false;
    this.countFrame(now);
  };

  private stepRipple(): void {
    const r = this.ripple!;
    const el = this.time - r.start;
    this.threadMat.uniforms.uRipple!.value = el / HOP_SECONDS;
    const n = this.model.nodes.length;
    for (let i = 0; i < n; i++) {
      const arr = r.arrival[i]!;
      const from = r.from[i]!;
      const to = r.to[i]!;
      if (!Number.isFinite(arr) && sameLook(from, to)) continue;
      const at = Number.isFinite(arr) ? el - arr : el;
      if (at < 0) continue;
      const k = smooth(at / 0.7);
      const look: StarLook = {
        color: k < 0.5 ? from.color : to.color,
        tint: from.tint + (to.tint - from.tint) * k,
        size: from.size + (to.size - from.size) * k,
        bright: from.bright + (to.bright - from.bright) * k,
        kind: k < 0.5 ? from.kind : to.kind,
      };
      const flash = Number.isFinite(arr) ? Math.exp(-at * 3.2) * (r.roots.includes(i) ? 1.4 : 1) : 0;
      this.writeLookBlend(i, from, to, k, look, flash);
    }
    this.markStarsDirty();
    for (const s of r.shocks) {
      const p = (this.time - s.start) / 2.1;
      s.mesh.visible = p > 0 && p < 1;
      if (s.mesh.visible) {
        s.mesh.scale.setScalar(s.radius);
        (s.mesh.material as THREE.ShaderMaterial).uniforms.uProgress!.value = 1 - Math.pow(1 - p, 2.2);
      }
    }
    if (this.time > r.end) this.finishRipple();
  }

  private writeLookBlend(i: number, from: StarLook, to: StarLook, k: number, look: StarLook, flash: number): void {
    const node = this.model.nodes[i]!;
    const a = this.c1.set(from.color);
    if (from.tint > 0) a.lerp(this.unitColor(node.unit_id, this.c2), from.tint);
    const toNode = this.ripple?.toModel.nodes[i] ?? node;
    const b = this.c3.set(to.color);
    if (to.tint > 0) b.lerp(this.unitColor(toNode.unit_id, this.c2), to.tint);
    a.lerp(b, k);
    this.iColor.setXYZ(i, a.r, a.g, a.b);
    this.iParams.setXYZW(i, look.size, look.bright, look.kind, (i * 0.618) % 1);
    this.iFx.setX(i, flash);
  }

  private finishRipple(): void {
    const r = this.ripple;
    if (!r) return;
    this.ripple = undefined;
    for (const s of r.shocks) {
      this.scene.remove(s.mesh);
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
    }
    this.threadMat.uniforms.uRipple!.value = -100;
    this.setModel(r.toModel);
  }

  private countFrame(now: number): void {
    this.totalFrames++;
    this.fpsFrames++;
    const elapsed = now - this.fpsStart;
    if (elapsed < 1000) return;
    const fps = (this.fpsFrames * 1000) / elapsed;
    this.fpsFrames = 0;
    this.fpsStart = now;
    if (this.opts.reducedMotion) return; // renders on demand: no meaningful frame rate
    this.fpsHistory.push(Math.round(fps * 10) / 10);
    if (this.fpsHistory.length > 8) this.fpsHistory.shift();
    this.opts.onStats?.(this.stats());
    if (this.totalFrames < 30) return; // warm-up (shader compile, first layout)
    // Adapt: first render fewer pixels, then give up on 3D.
    if (fps < 40 && this.pixelRatio > 1) {
      this.pixelRatio = Math.max(1, this.pixelRatio - 0.5);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.resize();
      this.slowWindows = 0;
    } else if (fps < 24) {
      this.slowWindows++;
      if (this.slowWindows >= 3) this.opts.onDegrade?.("slow");
    } else {
      this.slowWindows = Math.max(0, this.slowWindows - 1);
    }
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const aspectChanged = Math.abs(this.camera.aspect - w / h) > 0.2;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.skyMat) this.skyMat.uniforms.uAspect!.value = w / h;
    this.starMat.uniforms.uViewH!.value = h * this.pixelRatio;
    this.starMat.uniforms.uMinPx!.value = 2.6 * this.pixelRatio;
    this.labelsDirty = true;
    this.needsRender = true;
    if (this.opts.embedded) {
      // The preview's caption covers the lower part: centre the stars in the space above it.
      this.camera.setViewOffset(w, h, 0, h * 0.1, w, h);
    }
    if (aspectChanged && !this.userMoved && !this.flight) this.frameHome(0);
  }

  // ------------------------------------------------------------------ input

  /** Nearest star to a screen point, within a touch-friendly radius. */
  private pick(clientX: number, clientY: number, touch: boolean): number | undefined {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const w = rect.width;
    const h = rect.height;
    const scale = (this.camera.projectionMatrix.elements[5]! * h) / 2;
    let best: number | undefined;
    let bestD = Infinity;
    this.model.nodes.forEach((n, i) => {
      pos3(n, tmp);
      const dist = tmp.distanceTo(this.camera.position);
      tmp.project(this.camera);
      if (tmp.z > 1) return;
      const sx = (tmp.x * 0.5 + 0.5) * w;
      const sy = (-tmp.y * 0.5 + 0.5) * h;
      const size = this.looks[i]!.size * (this.looks[i]!.kind === 1 ? 0.35 : 0.6);
      const r = Math.max(touch ? 22 : 12, Math.min(40, (size * scale) / dist));
      const d = Math.hypot(sx - x, sy - y);
      if (d < r && d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
  };

  private onPointerUp = (e: PointerEvent): void => {
    const d = this.down;
    this.down = undefined;
    if (!d || d.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 600) return;
    if (this.opts.embedded) {
      this.opts.onActivate?.();
      return;
    }
    const i = this.pick(e.clientX, e.clientY, e.pointerType !== "mouse");
    const id = i === undefined ? null : this.model.nodes[i]!.id;
    if (id === this.selected && id !== null) return;
    this.select(id, id !== null);
    this.opts.onSelect(id);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType !== "mouse" || this.down) return;
    const i = this.pick(e.clientX, e.clientY, false);
    const id = i === undefined ? null : this.model.nodes[i]!.id;
    this.renderer.domElement.style.cursor = id ? "pointer" : this.opts.embedded ? "pointer" : "grab";
    if (id !== this.hovered) {
      this.hovered = id;
      this.buildLabels();
    }
  };

  private onPointerLeave = (): void => {
    if (this.hovered) {
      this.hovered = null;
      this.buildLabels();
    }
  };

  private onVisibility = (): void => {
    this.clock.getDelta();
    this.fpsStart = performance.now();
    this.fpsFrames = 0;
  };

  private onContextLost = (e: Event): void => {
    e.preventDefault();
    this.opts.onDegrade?.("context-lost");
  };
}
