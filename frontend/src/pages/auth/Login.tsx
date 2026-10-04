import { type FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Boxes, Lock, Mail, AlertTriangle, Eye, EyeOff,
  ChevronDown, Cpu, Wifi, Activity, Shield,
} from "lucide-react";
import { ADMIN_ROLE, TENANT_ROLES, useAuth } from "../../contexts/AuthContext";
import { LanguageSwitcher } from "../../components/layout/LanguageSwitcher";
import { apiBaseUrl } from "../../services/apiClient";
import { cn } from "../../lib/cn";
import { getDemoCredentials } from "../../lib/demoAccounts";

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

const DEMO_CREDENTIALS = import.meta.env.DEV ? getDemoCredentials(import.meta.env, true) : [];

export function Login() {
  const { t } = useTranslation(["auth", "common"]);
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [showPwd, setShowPwd]     = useState(false);
  const [demoOpen, setDemoOpen]   = useState(DEMO_CREDENTIALS.length > 0);
  const [error, setError]         = useState<string | null>(
    searchParams.get("session") === "expired"
      ? t("auth:err_session_expired", "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.")
      : null,
  );
  const [submitting, setSubmitting] = useState(false);

  const demoStats = [
    { icon: Cpu,      label: t("auth:demo_devices", "Thiết bị demo"),   value: "0",  color: "text-emerald-400" },
    { icon: Activity, label: t("auth:stat_automation", "Automation"),    value: "0",        color: "text-amber-400"   },
    { icon: Wifi,     label: t("auth:demo_telemetry", "Nhiệt độ / độ ẩm"),      value: "0",        color: "text-sky-400"     },
    { icon: Shield,   label: t("auth:demo_accounts", "Tài khoản demo"),             value: "3",   color: "text-violet-400"  },
  ];

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const userInfo = await login(email, password);
      const nextPath = TENANT_ROLES.includes(userInfo.role)
        ? "/client/dashboard"
        : userInfo.role === ADMIN_ROLE
          ? "/console"
          : "/";
      navigate(nextPath, { replace: true });
    } catch (err: unknown) {
      let msg = t("auth:err_login_failed", "Đăng nhập thất bại");
      if (err instanceof Error) {
        const raw = err.message;
        if (raw.includes("401") || raw.includes("Invalid email or password")) {
          msg = t("auth:err_invalid_credentials", "Email hoặc mật khẩu không đúng. Vui lòng kiểm tra lại.");
        } else if (raw.includes("403") || raw.includes("Account is disabled") || raw.includes("Tenant is disabled")) {
          msg = t("auth:err_account_disabled", "Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.");
        } else if (raw.includes("429") || raw.includes("Rate limit")) {
          msg = t("auth:err_rate_limit", "Bạn đã đăng nhập quá nhiều lần. Vui lòng thử lại sau.");
        } else if (raw.includes("timed out") || raw.includes("408")) {
          msg = t("auth:err_timeout", "Kết nối quá hạn. Vui lòng kiểm tra mạng và thử lại.");
        } else {
          msg = raw;
        }
      }
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex bg-slate-950 overflow-hidden">

      {/* ── Left panel ──────────────────────────────────────────── */}
      <div className="hidden lg:flex flex-col justify-between w-[52%] relative p-12 overflow-hidden
                      bg-gradient-to-br from-slate-900 via-[#0f1f3d] to-slate-950">

        {/* Decorative blur orbs */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-24 -left-24 h-96 w-96 rounded-full bg-brand-600/20 blur-3xl" />
          <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-sky-500/10 blur-3xl" />
          <div className="absolute top-1/2 left-1/3 h-64 w-64 rounded-full bg-violet-600/10 blur-3xl" />
        </div>

        {/* Subtle grid overlay */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.8) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.8) 1px,transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        {/* Logo */}
        <div className="relative flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shadow-lg shadow-slate-950/30">
            <Boxes className="h-5 w-5" />
          </div>
          <div>
            <div className="font-bold text-white text-xl tracking-tight">AIFOM</div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500">
              Edge Fleet Operations
            </div>
          </div>
        </div>

        {/* Hero text */}
        <div className="relative space-y-6">
          <div>
            <h2 className="text-4xl font-bold text-white leading-tight">
              {t("auth:left_hero_title_1", "Quản trị thiết bị IoT")}<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-400 to-sky-400">
                {t("auth:left_hero_title_2", "thế hệ mới")}
              </span>
            </h2>
            <p className="text-slate-400 mt-4 text-sm leading-relaxed max-w-md">
              {t("auth:left_hero_desc", "Đăng ký nhiều thiết bị ESP32, theo dõi online/offline, gửi lệnh, tự động hóa và cập nhật firmware từ xa.")}
            </p>
          </div>

          <p className="text-xs text-slate-500">{t("auth:demo_scenario", "Workspace demo chỉ có tài khoản và dự án. Kết nối thiết bị thật để nhận telemetry và sử dụng Automation.")}</p>
          {/* Demo scenario, not live system statistics */}
          <div className="grid grid-cols-2 gap-3">
            {demoStats.map(({ icon: Icon, label, value, color }) => (
              <div
                key={label}
                className="rounded-xl bg-white/5 border border-white/8 backdrop-blur-sm px-4 py-3 flex items-center gap-3"
              >
                <div className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0">
                  <Icon className={cn("h-4 w-4", color)} />
                </div>
                <div>
                  <div className={cn("text-base font-semibold leading-tight", color)}>{value}</div>
                  <div className="text-[11px] text-slate-500">{label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Feature pills */}
          <div className="flex flex-wrap gap-2">
            {["ESP32", "MQTT", "Firmware OTA", "Automation"].map((f) => (
              <span
                key={f}
                className="px-3 py-1 rounded-full text-[11px] font-medium bg-white/5 border border-white/10 text-slate-400"
              >
                {f}
              </span>
            ))}
          </div>
        </div>

        <div className="relative text-[11px] text-slate-600">
          © AIFOM · Đồ án tốt nghiệp
        </div>
      </div>

      {/* ── Right panel (form) ──────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12 relative">
        <div className="absolute top-4 right-4 z-20">
          <LanguageSwitcher />
        </div>

        {/* Mobile bg orbs */}
        <div className="lg:hidden pointer-events-none absolute inset-0">
          <div className="absolute -top-20 -right-20 h-64 w-64 rounded-full bg-brand-600/15 blur-3xl" />
          <div className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-sky-600/10 blur-3xl" />
        </div>

        <div className="relative w-full max-w-md">

          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2.5 mb-8">
            <div className="h-9 w-9 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
              <Boxes className="h-4 w-4" />
            </div>
            <span className="font-bold text-white text-lg">AIFOM</span>
          </div>

          {/* Heading */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-white">{t("auth:login_heading", "Chào mừng trở lại")}</h1>
            <p className="text-slate-400 text-sm mt-1">
              {t("auth:login_subheading", "Đăng nhập để tiếp tục quản lý fleet IoT của bạn")}
            </p>
          </div>

          <div className="mb-6 -mt-4 text-sm text-slate-500">
            {t("auth:no_workspace_question", "Chưa có workspace?")}{" "}
            <Link to="/register" className="font-semibold text-brand-300 hover:text-brand-200">
              {t("auth:register_tenant_link", "Đăng ký Tenant")}
            </Link>
          </div>

          {/* Social login */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <SocialButton icon={<GoogleIcon className="h-4 w-4" />} label="Google" comingSoonLabel={t("auth:coming_soon", "Sắp ra mắt")} />
            <SocialButton icon={<GitHubIcon className="h-4 w-4 text-slate-300" />} label="GitHub" comingSoonLabel={t("auth:coming_soon", "Sắp ra mắt")} />
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 h-px bg-slate-800" />
            <span className="text-xs text-slate-500 whitespace-nowrap">{t("auth:or_login_email", "Hoặc đăng nhập bằng email")}</span>
            <div className="flex-1 h-px bg-slate-800" />
          </div>

          {/* Error */}
          {error && (
            <div className="mb-5 p-3 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                {t("auth:email_label", "Địa chỉ email")}
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-600" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="w-full h-11 pl-10 pr-4 rounded-lg bg-slate-900 border border-slate-800
                             text-sm text-slate-100 placeholder:text-slate-700
                             focus:border-primary focus:ring-2 focus:ring-[var(--color-ring)] focus:outline-none
                             transition-colors"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                {t("auth:password_label", "Mật khẩu")}
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-600" />
                <input
                  type={showPwd ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full h-11 pl-10 pr-10 rounded-lg bg-slate-900 border border-slate-800
                             text-sm text-slate-100 placeholder:text-slate-700
                             focus:border-primary focus:ring-2 focus:ring-[var(--color-ring)] focus:outline-none
                             transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-300 transition-colors"
                  tabIndex={-1}
                >
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary w-full h-11"
            >
              {submitting ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  {t("auth:signing_in", "Đang đăng nhập…")}
                </>
              ) : (
                t("auth:sign_in_btn", "Đăng nhập")
              )}
            </button>
          </form>

          {import.meta.env.DEV && DEMO_CREDENTIALS.length === 0 && (
            <p className="mt-5 text-xs text-slate-400">{t("auth:demo_unconfigured", "Chưa có tài khoản demo. Chạy run-aifom.bat seed-demo để tạo dữ liệu và tài khoản test.")}</p>
          )}
          {/* Demo credentials (collapsible) */}
          {DEMO_CREDENTIALS.length > 0 && (
          <div className="mt-6 rounded-lg border border-slate-800 overflow-hidden">
            <button
              type="button"
              onClick={() => setDemoOpen((o) => !o)}
              className="w-full flex items-center justify-between px-4 py-3 text-xs text-slate-500 hover:text-slate-300 hover:bg-slate-900/50 transition-colors"
            >
              <span className="font-medium">{t("auth:demo_accounts", "Tài khoản demo")}</span>
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform", demoOpen && "rotate-180")}
              />
            </button>
            {demoOpen && (
              <div className="px-4 pb-4 space-y-2 bg-slate-900/30">
                {DEMO_CREDENTIALS.map((credential) => (
                  <DemoCredential
                    key={credential.role}
                    role={credential.role}
                    email={credential.email}
                    password={credential.passwordLabel}
                    color={credential.color}
                    useLabel={t("auth:use_demo", "Dùng")}
                    onUse={() => {
                      setEmail(credential.email);
                      if (credential.passwordValue) {
                        setPassword(credential.passwordValue);
                      }
                    }}
                  />
                ))}
                <p className="text-xs text-slate-500">{t("auth:demo_scope", "Admin quản trị nền tảng; Tenant Owner quản lý dữ liệu demo; Viewer chỉ đọc. Nút Dùng điền email và mật khẩu.")}</p>
                <div className="pt-1 text-[10px] text-slate-600">
                  API: <span className="font-mono">{apiBaseUrl}</span>
                </div>
              </div>
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ───────────────────────────────────────── */

function SocialButton({ icon, label, comingSoonLabel }: { icon: React.ReactNode; label: string; comingSoonLabel?: string }) {
  return (
    <div className="relative group">
      <button
        type="button"
        disabled
        className="w-full h-11 rounded-lg border border-slate-800 bg-slate-900
                   flex items-center justify-center gap-2.5
                   text-sm text-slate-400 font-medium
                   disabled:opacity-50 disabled:cursor-not-allowed
                   hover:border-slate-700 hover:bg-slate-800/60
                   transition-colors"
      >
        {icon}
        {label}
      </button>
      {/* Tooltip */}
      <div className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2
                      px-2.5 py-1.5 rounded-md bg-slate-800 border border-slate-700
                      text-[11px] text-slate-300 whitespace-nowrap shadow-lg
                      opacity-0 group-hover:opacity-100 transition-opacity z-10">
        {comingSoonLabel || "Sắp ra mắt"}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
      </div>
    </div>
  );
}

function DemoCredential({
  role, email, password, color, useLabel, onUse,
}: {
  role: string;
  email: string;
  password: string;
  color: "sky" | "emerald" | "amber";
  useLabel?: string;
  onUse: () => void;
}) {
  const accent = color === "sky"
    ? "text-sky-400 bg-sky-400/10 border-sky-400/20"
    : color === "amber"
      ? "text-amber-400 bg-amber-400/10 border-amber-400/20"
      : "text-emerald-400 bg-emerald-400/10 border-emerald-400/20";

  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex-1 min-w-0">
        <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded border", accent)}>
          {role}
        </span>
        <div className="mt-1 font-mono text-[11px] text-slate-400 truncate">{email}</div>
        <div className="font-mono text-[11px] text-slate-600">{password}</div>
      </div>
      <button
        type="button"
        onClick={onUse}
        className="flex-shrink-0 px-2.5 py-1 rounded text-[11px] font-medium
                   bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white
                   transition-colors"
      >
        {useLabel || "Dùng"}
      </button>
    </div>
  );
}
