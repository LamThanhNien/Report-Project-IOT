import { useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { MoreVertical } from "lucide-react";
import { cn } from "../../lib/cn";

export interface ActionDropdownItem {
  id?: string; label?: ReactNode; icon?: ReactNode;
  onClick?: (event: MouseEvent<HTMLElement>, helpers: { close: () => void }) => void;
  to?: string; href?: string; target?: string; rel?: string;
  variant?: "default" | "danger" | "separator"; danger?: boolean;
  disabled?: boolean; hidden?: boolean; title?: string; className?: string;
  separatorBefore?: boolean; separatorAfter?: boolean; closeOnClick?: boolean;
}
interface Props {
  items?: (ActionDropdownItem | null | undefined | false)[];
  triggerSize?: "sm" | "md"; triggerAriaLabel?: string; triggerTitle?: string;
  triggerClassName?: string; menuWidth?: string; menuClassName?: string;
  disabled?: boolean;
}

/** Portal menu keeps row actions visible outside scrolling tables. */
export function ActionDropdown({ items = [], triggerSize = "sm", triggerAriaLabel = "Actions", triggerTitle, triggerClassName, menuWidth = "w-44", menuClassName, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const visible = items.filter((item): item is ActionDropdownItem => Boolean(item && !item.hidden));
  function close() { setOpen(false); trigger.current?.focus(); }

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      if (!trigger.current || !menu.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const box = menu.current.getBoundingClientRect();
      setPosition({
        left: Math.max(8, Math.min(anchor.right - box.width, window.innerWidth - box.width - 8)),
        top: Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - box.height - 8)),
      });
    };
    update();
    const frame = requestAnimationFrame(() => menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus());
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const node = event.target as Node;
      if (!menu.current?.contains(node) && !trigger.current?.contains(node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  return <>
    <button ref={trigger} type="button" disabled={disabled || !visible.length} aria-label={triggerAriaLabel} title={triggerTitle} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      className={cn("btn-ghost shrink-0 p-0", triggerSize === "sm" ? "h-7 w-7" : "h-8 w-8", triggerClassName)}
      onClick={(event) => { event.stopPropagation(); setOpen(value => !value); }}
      onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); } }}>
      <MoreVertical className="h-4 w-4" />
    </button>
    {open && createPortal(<div ref={menu} id={menuId} role="menu" aria-label={triggerAriaLabel} style={{ position: "fixed", ...position }}
      className={cn("z-50 max-h-[calc(100dvh-16px)] max-w-[calc(100vw-16px)] overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-border dark:bg-surface-elevated", menuWidth, menuClassName)}
      onClick={event => event.stopPropagation()}
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
        if (event.key === "Tab") { setOpen(false); return; }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const entries = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
        const index = entries.indexOf(document.activeElement as HTMLElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? entries.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + entries.length) % entries.length;
        entries[next]?.focus();
      }}>
      {visible.map((item, index) => {
        if (item.variant === "separator") return <div key={item.id ?? index} role="separator" className="my-1 border-t border-slate-200 dark:border-border" />;
        const className = cn("flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40", item.danger || item.variant === "danger" ? "text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10" : "text-slate-700 hover:bg-slate-100 dark:text-text-secondary dark:hover:bg-surface-muted", item.className);
        const action = (event: MouseEvent<HTMLElement>) => {
          if (item.disabled) { event.preventDefault(); return; }
          item.onClick?.(event, { close });
          if (item.closeOnClick !== false) close();
        };
        const content = <>{item.icon}<span>{item.label}</span></>;
        const shared = { role: "menuitem", title: item.title, className, onClick: action, tabIndex: -1 };
        return <div key={item.id ?? index}>
          {item.separatorBefore && <div role="separator" className="my-1 border-t border-border" />}
          {item.to && !item.disabled ? <Link {...shared} to={item.to} target={item.target} rel={item.rel}>{content}</Link>
            : item.href && !item.disabled ? <a {...shared} href={item.href} target={item.target} rel={item.rel ?? (item.target === "_blank" ? "noopener noreferrer" : undefined)}>{content}</a>
              : <button {...shared} type="button" disabled={item.disabled}>{content}</button>}
          {item.separatorAfter && <div role="separator" className="my-1 border-t border-border" />}
        </div>;
      })}
    </div>, document.body)}
  </>;
}
