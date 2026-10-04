import { memo, useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Globe, ChevronDown } from "lucide-react";
import { cn } from "../../lib/cn";

export const LanguageSwitcher = memo(function LanguageSwitcher() {
  const { t, i18n } = useTranslation(["common", "nav"]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentLang = i18n.language?.startsWith("en") ? "en" : "vi";

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSelect(lang: "vi" | "en") {
    i18n.changeLanguage(lang);
    localStorage.setItem("aifom_language", lang);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="btn-ghost h-9 px-2.5 flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-text-primary"
        title={t("common:switch_language", "Đổi ngôn ngữ / Switch Language")}
      >
        <Globe className="h-4 w-4 text-brand-500" />
        <span className="uppercase">{currentLang}</span>
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-36 card py-1 z-50 shadow-lg border border-slate-200 dark:border-border-subtle">
          <button
            type="button"
            onClick={() => handleSelect("vi")}
            className={cn(
              "w-full text-left px-3 py-2 text-xs flex items-center justify-between transition-colors",
              currentLang === "vi"
                ? "bg-slate-100 font-bold text-primary dark:bg-surface-elevated"
                : "hover:bg-slate-50 text-slate-700 dark:text-text-secondary dark:hover:bg-surface-elevated/70",
            )}
          >
            <span className="flex items-center gap-2">
              <span className="text-sm">🇻🇳</span> Tiếng Việt
            </span>
            {currentLang === "vi" && <span className="text-primary text-xs">✓</span>}
          </button>
          <button
            type="button"
            onClick={() => handleSelect("en")}
            className={cn(
              "w-full text-left px-3 py-2 text-xs flex items-center justify-between transition-colors",
              currentLang === "en"
                ? "bg-slate-100 font-bold text-primary dark:bg-surface-elevated"
                : "hover:bg-slate-50 text-slate-700 dark:text-text-secondary dark:hover:bg-surface-elevated/70",
            )}
          >
            <span className="flex items-center gap-2">
              <span className="text-sm">🇬🇧</span> English
            </span>
            {currentLang === "en" && <span className="text-primary text-xs">✓</span>}
          </button>
        </div>
      )}
    </div>
  );
});
