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
  g.font = "700 46px 'Helvetica Neue', Helvetica, Arial, 'Noto Sans TC', sans-serif";
  g.fillText("Dr", x0, 150);
  const drW = g.measureText("Dr").width;
  g.fillStyle = "#d7261b";
  g.fillText(".", x0 + drW, 150);
  const dotW = g.measureText(".").width;
  g.fillStyle = "#151515";
  g.fillText("Nature", x0 + drW + dotW, 150);
  g.font = "700 250px 'Helvetica Neue', Helvetica, Arial, sans-serif";
  g.fillText(num, x0 - 8, 300);
  g.font = "700 58px 'Noto Sans TC', 'PingFang TC', sans-serif";
  g.fillText(name, x0, 580);
  g.fillRect(x0, 668, w, 3);
  g.font = "700 26px 'Noto Sans TC', 'Helvetica Neue', sans-serif";
  g.fillText(sub, x0, 690);
  g.fillStyle = "#d7261b";
  g.fillRect(x0 + w - 18, 696, 18, 18);
  g.fillStyle = "#8a8a86";
  g.font = "400 18px 'Noto Sans TC', sans-serif";
  ["食用方法 · 以標示為準", "保存方式 · 以標示為準", "DN-PB · 60 顆膠囊"].forEach((t, i) => g.fillText(t, 790, 420 + i * 30));
  return c;
}

export const Bottle3D = forwardRef<Bottle3DHandle, Props>(function Bottle3D(
  { num, name, sub = "60 顆膠囊 · DAILY FLORA", className = "stage3d", tilt = 0, scale = 1 },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<Bottle3DHandle>({ setLabel: () => {}, setScrollRotation: () => {} });
  const [ready, setReady] = useState(false);
  useImperativeHandle(ref, () => ({
    setLabel: (n, m) => api.current.setLabel(n, m),
    setScrollRotation: (r) => api.current.setScrollRotation(r),
  }));

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const THREE = await import("three");
      if (disposed) return;
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
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
      let tex = new THREE.CanvasTexture(drawLabel(num, name, sub));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
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
      let scrollRot = 0;
      let dragging = false;
      let lastX = 0;
      let vel = 0;
      let raf = 0;
      let last = performance.now();
      let needsFrame = true;
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
        needsFrame = !reduce || dragging || Math.abs(vel) > 0.0005;
        if (needsFrame) raf = requestAnimationFrame(tick);
      };
      const kick = () => {
        if (!needsFrame) {
          needsFrame = true;
          last = performance.now();
          raf = requestAnimationFrame(tick);
        }
      };
      api.current = {
        setLabel: (n, m) => {
          const old = tex;
          tex = new THREE.CanvasTexture(drawLabel(n, m, sub));
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 4;
          labelMat.map = tex;
          labelMat.needsUpdate = true;
          old.dispose();
          kick();
        },
        setScrollRotation: (rad) => {
          scrollRot = rad;
          kick();
        },
      };

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
      raf = requestAnimationFrame(tick);
      setReady(true);
      cleanup = () => {
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
    })().catch(() => {
      /* WebGL unavailable: the static fallback stays visible */
    });
    return () => {
      disposed = true;
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
