"use client";

/**
 * Parallax del hero (6-oct-2026): al bajar, la foto de fondo se acerca y la
 * maqueta sube más despacio que la página; el texto se adelanta y se funde.
 * `useTransform` en forma de función (con rangos, Chrome deja mal el valor final). Sin JS y con
 * reduced-motion no se mueve nada.
 */
import { useRef, type ReactNode } from "react";
import { LazyMotion, domAnimation, m, useReducedMotion, useScroll, useTransform } from "framer-motion";

const ramp = (v: number, a: number, b: number) => Math.min(1, Math.max(0, (v - a) / (b - a)));

export function HeroParallax({ bg, copy, mock, className }: { bg: ReactNode; copy: ReactNode; mock: ReactNode; className: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const bgScale = useTransform(scrollYProgress, (v) => 1.06 + 0.14 * ramp(v, 0, 1));
  const bgY = useTransform(scrollYProgress, (v) => `${14 * ramp(v, 0, 1)}%`);
  const copyY = useTransform(scrollYProgress, (v) => -90 * ramp(v, 0, 1));
  const copyOpacity = useTransform(scrollYProgress, (v) => 1 - ramp(v, 0.15, 0.7));
  const mockY = useTransform(scrollYProgress, (v) => -40 * ramp(v, 0, 1));
  const still = Boolean(reduce);
  return (
    <LazyMotion features={domAnimation}>
    <div ref={ref} className={className}>
      <m.div className="lc-hero-bg" aria-hidden="true" style={still ? undefined : { scale: bgScale, y: bgY }}>
        {bg}
      </m.div>
      <div className="lc-hero-inner">
        <m.div className="lc-hero-copy" style={still ? undefined : { y: copyY, opacity: copyOpacity }}>
          {copy}
        </m.div>
        <m.div className="lc-hero-mock ll-enter-phone" aria-hidden="true" style={still ? undefined : { y: mockY }}>
          {mock}
        </m.div>
      </div>
    </div>
    </LazyMotion>
  );
}
