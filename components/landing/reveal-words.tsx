import { Children, Fragment, isValidElement, cloneElement, type ReactElement, type ReactNode } from "react";

/**
 * Titulares que entran palabra a palabra (6-oct-2026). Parte los textos en
 * <span class="lc-w" style="--i"> conservando <em> y demás nodos; el gesto lo
 * da LandingMotion (data-reveal="words" → data-revealed) y el CSS escalona
 * 45 ms por palabra con tope. Sin JS: todo visible. Servidor: puro.
 */
let counter = 0;

function split(node: ReactNode): ReactNode {
  if (typeof node === "string") {
    return node.split(/(\s+)/).map((part, k) =>
      part.trim() ? <span key={`${counter}-${k}`} className="lc-w" style={{ "--i": String(counter++) } as React.CSSProperties}>{part}</span> : part,
    );
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    const el = node as ReactElement<{ children?: ReactNode }>;
    return cloneElement(el, undefined, split(el.props.children));
  }
  if (Array.isArray(node)) return node.map((child, k) => <Fragment key={k}>{split(child)}</Fragment>);
  return node;
}

export function RevealWords({ children }: { children: ReactNode }) {
  counter = 0;
  return <>{Children.map(children, split)}</>;
}
