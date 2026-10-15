"use client";

// Real-time 3D bottle (three 0.186.1): the opaque white 100 ml PE bottle (PB-100, Ø45.8 × 85.7 mm)
// with the numbered label drawn on a canvas texture. Auto-rotates slowly, drag to turn; both stop
// under prefers-reduced-motion. Rendered only on the client; the page keeps a static fallback
// until the scene is ready. Exposes an imperative handle so ScrollFX can swap the label (01→02→03)
// and add a scroll-driven rotation while the bottle stays pinned.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export type Bottle3DHandle = {
  setLabel: (num: string, name: string) => void;
  setScrollRotation: (rad: number) => void;
};

type Props = { num: string; name: string; sub?: string; className?: string; tilt?: number; scale?: number };

// Fonts of the label's text runs. drawLabel and the font preload share them, so every face the
// canvas uses is loaded before the texture is rasterised (a canvas never re-renders on its own
// when a web font arrives later).
const LABEL_FONT = {
  word: "700 46px 'Helvetica Neue', Helvetica, Arial, 'Noto Sans TC', sans-serif",
  num: "700 250px 'Helvetica Neue', Helvetica, Arial, sans-serif",
  name: "700 58px 'Noto Sans TC', 'PingFang TC', sans-serif",
  sub: "700 26px 'Noto Sans TC', 'Helvetica Neue', sans-serif",
  side: "400 18px 'Noto Sans TC', sans-serif",
};
const SIDE_LINES = ["食用方法 · 以標示為準", "保存方式 · 以標示為準", "DN-PB · 60 顆膠囊"];

function labelRuns(num: string, name: string, sub: string): [string, string][] {
  return [
    [LABEL_FONT.word, "Dr.Nature"],
    [LABEL_FONT.num, num],
    [LABEL_FONT.name, name],
    [LABEL_FONT.sub, sub],
    [LABEL_FONT.side, SIDE_LINES.join("")],
  ];
}

/** True when every face the label needs is already loaded (FontFaceSet.check). */
function labelFontsReady(runs: [string, string][]) {
  try {
    return runs.every(([font, text]) => document.fonts.check(font, text));
  } catch {
    return true;
  }
}

/** Loads the faces for these runs (Google Fonts serves unicode-range subsets, so the text matters). */
function loadLabelFonts(runs: [string, string][]) {
  try {
    return Promise.all(runs.map(([font, text]) => document.fonts.load(font, text))).then(
      () => true,
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
}

const within = <T,>(p: Promise<T>, ms: number, fallback: T) =>
  Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);

// WebGL 2 pre-check, the same test as three's capabilities/WebGL.js isWebGL2Available(), run once
// per page. Without it three logs console errors before the static fallback takes over. The probe
// context is released right away so it does not count toward the browser's context limit.
let webgl2: boolean | undefined;
function hasWebGL2() {
  if (webgl2 === undefined) {
    try {
      const gl = window.WebGL2RenderingContext ? document.createElement("canvas").getContext("webgl2") : null;
      webgl2 = !!gl;
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      webgl2 = false;
    }
  }
  return webgl2;
}

function drawLabel(num: string, name: string, sub: string) {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 1024;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fcfcfa";
  g.fillRect(0, 0, c.width, c.height);
  const x0 = 310;
  const w = 404;
  g.fillStyle = "#151515";
  g.textBaseline = "top";
  g.font = LABEL_FONT.word;
  g.fillText("Dr", x0, 150);
  const drW = g.measureText("Dr").width;
  g.fillStyle = "#d7261b";
  g.fillText(".", x0 + drW, 150);
  const dotW = g.measureText(".").width;
  g.fillStyle = "#151515";
  g.fillText("Nature", x0 + drW + dotW, 150);
  g.font = LABEL_FONT.num;
  g.fillText(num, x0 - 8, 300);
  g.font = LABEL_FONT.name;
  g.fillText(name, x0, 580);
  g.fillRect(x0, 668, w, 3);
  g.font = LABEL_FONT.sub;
  g.fillText(sub, x0, 690);
  g.fillStyle = "#d7261b";
  g.fillRect(x0 + w - 18, 696, 18, 18);
  g.fillStyle = "#8a8a86";
  g.font = LABEL_FONT.side;
  SIDE_LINES.forEach((t, i) => g.fillText(t, 790, 420 + i * 30));
  return c;
}

export const Bottle3D = forwardRef<Bottle3DHandle, Props>(function Bottle3D(
  { num, name, sub = "60 顆膠囊 · DAILY FLORA", className = "stage3d", tilt = 0, scale = 1 },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<Bottle3DHandle>({ setLabel: () => {}, setScrollRotation: () => {} });
  const [ready, setReady] = useState(false);
  // The last label / scroll turn asked for, kept for a scene that starts later (three loads lazily,
  // so ScrollFX may already be at step 02 when the 03 stage's bottle comes up).
  const wanted = useRef<{ label?: { num: string; name: string }; rot?: number }>({});
  useImperativeHandle(ref, () => ({
    setLabel: (n, m) => {
      wanted.current.label = { num: n, name: m };
      api.current.setLabel(n, m);
    },
    setScrollRotation: (r) => {
      wanted.current.rot = r;
      api.current.setScrollRotation(r);
    },
  }));

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let cleanup = () => {};
    const start = async () => {
      if (!hasWebGL2()) return; // the static fallback stays
      // The label waits for its fonts (at most 3 s, then the fallback face; it is redrawn once
      // the faces arrive) while three loads in parallel.
      const first = wanted.current.label ?? { num, name };
      const firstRuns = labelRuns(first.num, first.name, sub);
      const firstFonts = loadLabelFonts(firstRuns);
      const THREE = await import("three");
      await within(firstFonts, 3000, false);
      if (disposed) return;
      // Auto-rotation follows prefers-reduced-motion live (dragging always works).
      const reduceQuery = matchMedia("(prefers-reduced-motion: reduce)");
      let reduce = reduceQuery.matches;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      el.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
      camera.position.set(0, 0.6, 9.2);
      camera.lookAt(0, 0, 0);
      scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d7d0, 1.4));
      const key = new THREE.DirectionalLight(0xffffff, 1.6);
      key.position.set(3, 5, 4);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xffffff, 0.5);
      fill.position.set(-4, 2, 2);
      scene.add(fill);

      const group = new THREE.Group();
      const r = 1.0;
      const h = 1.87;
      const white = new THREE.MeshStandardMaterial({ color: 0xf4f3ef, roughness: 0.55, metalness: 0.02 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 72, 1, false), white);
      body.position.y = -0.3;
      group.add(body);
      const shoulder = new THREE.Mesh(new THREE.SphereGeometry(r, 72, 24, 0, Math.PI * 2, 0, Math.PI / 2), white);
      shoulder.scale.set(1, 0.22, 1);
      shoulder.position.y = -0.3 + h / 2;
      group.add(shoulder);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.18, 48), white);
      neck.position.y = -0.3 + h / 2 + 0.2;
      group.add(neck);
      const capMat = new THREE.MeshStandardMaterial({ color: 0xf7f6f2, roughness: 0.7 });
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.74, 0.74, 0.42, 96), capMat);
      cap.position.y = -0.3 + h / 2 + 0.5;
      group.add(cap);
      const rib = new THREE.BoxGeometry(0.03, 0.4, 0.06);
      const ribMat = new THREE.MeshStandardMaterial({ color: 0xe6e5e0, roughness: 0.8 });
      for (let i = 0; i < 56; i++) {
        const m = new THREE.Mesh(rib, ribMat);
        const a = (i / 56) * Math.PI * 2;
        m.position.set(Math.cos(a) * 0.745, cap.position.y, Math.sin(a) * 0.745);
        m.rotation.y = -a;
        group.add(m);
      }
      // The label shown now; setLabel swaps it, a late font redraws it.
      let shown = first;
      let drawnWithFonts = false;
      let labelSeq = 0;
      const makeTexture = () => {
        drawnWithFonts = labelFontsReady(labelRuns(shown.num, shown.name, sub));
        if (process.env.NODE_ENV !== "production") el.dataset.labelFont = String(drawnWithFonts);
        const t = new THREE.CanvasTexture(drawLabel(shown.num, shown.name, sub));
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        return t;
      };
      let tex = makeTexture();
      const labelMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
      const label = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.004, r + 0.004, h * 0.62, 96, 1, true), labelMat);
      label.position.y = -0.3 - 0.08;
      label.rotation.y = Math.PI / 2 + 0.9;
      group.add(label);
      const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(1.35, 48),
        new THREE.MeshBasicMaterial({ color: 0x151515, transparent: true, opacity: 0.16 }),
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = -0.3 - h / 2 - 0.01;
      shadow.scale.set(1, 0.55, 1);
      group.add(shadow);
      group.rotation.z = tilt;
      group.scale.setScalar(scale);
      scene.add(group);

      let rot = 0.35;
      let scrollRot = wanted.current.rot ?? 0;
      let dragging = false;
      let lastX = 0;
      let vel = 0;
      let raf = 0;
      let last = performance.now();
      let needsFrame = true;
      let lost = false; // WebGL context lost: no frames until it is restored
      let visible = true; // only an on-screen bottle runs its loop (see the observer below)
      const tick = (t: number) => {
        const dt = Math.min(0.05, (t - last) / 1000);
        last = t;
        if (!dragging) {
          if (!reduce) rot += 0.25 * dt;
          vel *= 0.92;
          rot += vel;
        }
        group.rotation.y = rot + scrollRot;
        renderer.render(scene, camera);
        el.dataset.frame = String(renderer.info.render.frame); // probes: off-screen bottles stay still
        needsFrame = visible && !lost && (!reduce || dragging || Math.abs(vel) > 0.0005);
        if (needsFrame) raf = requestAnimationFrame(tick);
      };
      const kick = () => {
        if (!needsFrame && !lost && visible) {
          needsFrame = true;
          last = performance.now();
          raf = requestAnimationFrame(tick);
        }
      };
      const repaint = () => {
        const old = tex;
        tex = makeTexture();
        labelMat.map = tex;
        labelMat.needsUpdate = true;
        old.dispose();
        kick();
      };
      // Drawn before its faces arrived (timeout, slow network): redraw once they have loaded.
      if (!drawnWithFonts) {
        document.fonts.ready.then(() => {
          if (!disposed && !drawnWithFonts) repaint();
        });
      }
      api.current = {
        setLabel: (n, m) => {
          shown = { num: n, name: m };
          const seq = ++labelSeq;
          const runs = labelRuns(n, m, sub);
          if (labelFontsReady(runs)) return repaint();
          // New glyphs (another unicode-range subset): load them first, keep the old label meanwhile.
          within(loadLabelFonts(runs), 3000, false).then(() => {
            if (!disposed && seq === labelSeq) repaint();
          });
        },
        setScrollRotation: (rad) => {
          scrollRot = rad;
          kick();
        },
      };
      // A step change that arrived while the fonts or three were still loading.
      const w = wanted.current.label;
      if (w && (w.num !== shown.num || w.name !== shown.name)) api.current.setLabel(w.num, w.name);

      const onDown = (e: PointerEvent) => {
        dragging = true;
        lastX = e.clientX;
        el.setPointerCapture(e.pointerId);
        kick();
      };
      const onMove = (e: PointerEvent) => {
        if (!dragging) return;
        const dx = e.clientX - lastX;
        lastX = e.clientX;
        vel = dx * 0.01;
        rot += vel;
      };
      const onUp = () => {
        dragging = false;
      };
      el.addEventListener("pointerdown", onDown);
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);

      const resize = () => {
        const s = el.clientWidth;
        renderer.setSize(s, s, false);
        renderer.domElement.style.width = "100%";
        renderer.domElement.style.height = "100%";
        kick();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(el);
      // Context lost after startup (GPU reset, too many contexts): show the static slot again and
      // stop the loop; three restores its own state, then the loop restarts.
      const canvas = renderer.domElement;
      const onLost = () => {
        lost = true;
        cancelAnimationFrame(raf);
        needsFrame = false;
        setReady(false);
      };
      const onRestored = () => {
        lost = false;
        setReady(true);
        kick();
      };
      canvas.addEventListener("webglcontextlost", onLost);
      canvas.addEventListener("webglcontextrestored", onRestored);
      // Off-screen bottles stop rendering (three continuous loops would keep the GPU busy while
      // the visitor reads 05/06); the loop restarts when the host scrolls back in.
      const onScreen =
        "IntersectionObserver" in window
          ? new IntersectionObserver((entries) => {
              const now = entries[entries.length - 1].isIntersecting;
              if (now === visible) return;
              visible = now;
              if (now) kick();
            })
          : null;
      onScreen?.observe(el);
      const onReduceChange = () => {
        reduce = reduceQuery.matches;
        kick();
      };
      reduceQuery.addEventListener("change", onReduceChange);
      raf = requestAnimationFrame(tick);
      setReady(true);
      cleanup = () => {
        onScreen?.disconnect();
        reduceQuery.removeEventListener("change", onReduceChange);
        canvas.removeEventListener("webglcontextlost", onLost);
        canvas.removeEventListener("webglcontextrestored", onRestored);
        cancelAnimationFrame(raf);
        ro.disconnect();
        el.removeEventListener("pointerdown", onDown);
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
        renderer.dispose();
        tex.dispose();
        renderer.domElement.remove();
        api.current = { setLabel: () => {}, setScrollRotation: () => {} };
      };
    };
    const run = () =>
      start().catch(() => {
        /* WebGL unavailable: the static fallback stays visible */
      });
    // three (~185 KB gzip) is fetched only when the stage comes within 300px of the viewport; the
    // hero's bottle is on screen at load and starts at once, the 03/04 bottles when scrolled near.
    let near: IntersectionObserver | null = null;
    if ("IntersectionObserver" in window) {
      near = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          near?.disconnect();
          run();
        },
        { rootMargin: "300px" },
      );
      near.observe(el);
    } else run();
    return () => {
      disposed = true;
      near?.disconnect();
      cleanup();
    };
    // The label is swapped through the handle; props only seed the first texture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub, tilt, scale]);

  return (
    <div ref={host} className={className} style={{ touchAction: "pan-y", cursor: "grab" }} aria-label={`${name} 3D 瓶身`} role="img">
      {!ready && (
        <div className="slot" style={{ position: "absolute", inset: "12% 20%", border: "none", background: "transparent" }}>
          <span>
            <span className="ico" />
            {num} {name}
          </span>
        </div>
      )}
    </div>
  );
});
