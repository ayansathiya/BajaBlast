import { useEffect, useRef } from 'react';

interface Props {
  /** Bump this to fire a burst. Any change triggers one; 0 fires nothing. */
  trigger: number;
  /** Honours the Reduced motion setting — no burst, ever. */
  enabled?: boolean;
  onDone?: () => void;
}

const COLORS = ['#00F5D4', '#FF5C72', '#FFFFFF', '#7DE8DC', '#FFB3BE'];

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  w: number;
  h: number;
  color: string;
  life: number;
}

/**
 * A confetti burst, written out rather than pulled from a library.
 *
 * Two reasons: the kiosk loads over file:// in production with no CDN
 * reachable, and this is ~70 lines against a dependency that would be an
 * order of magnitude more code for the same three seconds of paper.
 *
 * Physics deliberately kept dumb: gravity, drag, a bit of spin. The canvas
 * sits above everything and ignores pointer events, so nothing underneath
 * stops working mid-celebration.
 */
export function Confetti({ trigger, enabled = true, onDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number>();

  useEffect(() => {
    if (!trigger || !enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Two side cannons rather than a top-down drizzle — it reads as a
    // celebration instead of weather.
    const pieces: Piece[] = [];
    for (const [originX, direction] of [
      [0, 1],
      [width, -1],
    ] as const) {
      for (let i = 0; i < 70; i++) {
        const angle = (Math.random() * 50 + 20) * (Math.PI / 180);
        const speed = 12 + Math.random() * 14;
        pieces.push({
          x: originX,
          y: height * (0.62 + Math.random() * 0.2),
          vx: Math.cos(angle) * speed * direction,
          vy: -Math.sin(angle) * speed,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.4,
          w: 6 + Math.random() * 7,
          h: 3 + Math.random() * 5,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          life: 1,
        });
      }
    }

    let running = true;
    function tick() {
      if (!running || !ctx) return;
      ctx.clearRect(0, 0, width, height);
      let alive = 0;

      for (const p of pieces) {
        p.vy += 0.42; // gravity
        p.vx *= 0.99; // drag
        p.vy *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        if (p.y > height * 0.72) p.life -= 0.016; // fade once it's fallen past the middle
        if (p.life <= 0 || p.y > height + 40) continue;
        alive++;

        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }

      if (alive > 0) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, width, height);
        onDone?.();
      }
    }

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      running = false;
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      ctx.clearRect(0, 0, width, height);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, enabled]);

  return <canvas ref={canvasRef} className="confetti-canvas" aria-hidden />;
}
