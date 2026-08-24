// Tiny DOM helper — keeps the vanilla views readable without a framework.

/** A mounted screen. `destroy` tears down any store subscriptions. */
export interface View {
  el: HTMLElement;
  destroy?: () => void;
}

type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, unknown> | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = String(v);
      else if (k === "text") node.textContent = String(v);
      else if (k === "html") node.innerHTML = String(v);
      else if (k.startsWith("on") && typeof v === "function") {
        node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k === "style" && typeof v === "object") {
        Object.assign(node.style, v as object);
      } else if (v === true) {
        node.setAttribute(k, "");
      } else {
        node.setAttribute(k, String(v));
      }
    }
  }
  append(node, children);
  return node;
}

function append(node: Node, children: Child[]) {
  for (const c of children) {
    if (c == null || c === false) continue;
    node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Build an inline SVG icon from raw path markup. */
export function icon(paths: string, size = 24): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.innerHTML = paths;
  return svg;
}

export const initials = (name: string): string =>
  (name.trim().slice(0, 1) || "?").toUpperCase();
