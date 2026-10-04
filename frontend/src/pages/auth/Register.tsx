import { type FormEvent, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle, ArrowRight, Boxes, Building2, Eye, EyeOff,
  Lock, Mail, User, Cpu, Shield
} from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { LanguageSwitcher } from "../../components/layout/LanguageSwitcher";
import { cn } from "../../lib/cn";

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

export function Register() {
  const { t } = useTranslation(["auth", "common"]);
  const { registerTenantOwner } = useAuth();
  const navigate = useNavigate();
  const [tenantName, setTenantName] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const effectiveSlug = useMemo(() => tenantSlug || slugify(tenantName), [tenantName, tenantSlug]);

  const featureGrid = [
    { icon: Building2, label: t("auth:val_isolated_env", "Môi trường biệt lập"), value: "Tenant Workspace", color: "text-brand-400" },
    { icon: Shield, label: t("auth:val_bi_security", "Bảo mật hai chiều"), value: "Read/Write Protected", color: "text-emerald-400" },
    { icon: Lock, label: t("auth:val_access_protect", "Bảo vệ truy cập"), value: "No Public Admin", color: "text-amber-400" },
    { icon: Cpu, label: t("auth:val_firmware_mgmt", "Quản lý firmware"), value: "ESP32 OTA Ready", color: "text-sky-400" },
  ];

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(t("auth:err_password_too_short", "Mật khẩu cần tối thiểu 8 ký tự."));
      return;
    }
    setSubmitting(true);
    try {
      // Đăng ký public chỉ tạo tài khoản Tenant Owner
      await registerTenantOwner({
        tenant_name: tenantName,
        tenant_slug: effectiveSlug || null,
        owner_email: email,
        owner_password: password,
        owner_full_name: fullName || null,
      });
      navigate("/client/dashboard", { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("auth:err_register_failed", "Đăng ký thất bại"));
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
        <Link to="/" className="relative flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shadow-lg shadow-slate-950/30">
            <Boxes className="h-5 w-5" />
          </div>
          <div>
            <div className="font-bold text-white text-xl tracking-tight">AIFOM</div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500">
              Edge Fleet Operations
            </div>
          </div>
        </Link>

        {/* Hero text */}
        <div className="relative space-y-6">
          <div>
            <h2 className="text-4xl font-bold text-white leading-tight">
              {t("auth:left_reg_title_1", "Tạo workspace tenant")}<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-400 to-sky-400">
                {t("auth:left_reg_title_2", "quản lý fleet IoT")}
              </span>
            </h2>
            <p className="text-slate-400 mt-4 text-sm leading-relaxed max-w-md">
              {t("auth:left_reg_desc", "Đăng ký public chỉ tạo tài khoản Tenant Owner. Các thao tác thiết bị, OTA, MQTT và dashboard vẫn yêu cầu đăng nhập.")}
            </p>
          </div>

          {/* Features grid */}
          <div className="grid grid-cols-2 gap-3">
            {featureGrid.map(({ icon: Icon, label, value, color }) => (
              <div
                key={label}
                className="rounded-xl bg-white/5 border border-white/8 backdrop-blur-sm px-4 py-3 flex items-center gap-3"
              >
                <div className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0">
                  <Icon className={cn("h-4 w-4", color)} />
                </div>
                <div>
                  <div className="text-sm font-semibold leading-tight text-white">{value}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Feature pills */}
          <div className="flex flex-wrap gap-2">
            {["ESP32", "MQTT", "Secure OTA", "Automation"].map((f) => (
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
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12 relative overflow-y-auto max-h-screen">
        <div className="absolute top-4 right-4 z-20">
          <LanguageSwitcher />
        </div>

        {/* Mobile bg orbs */}
        <div className="lg:hidden pointer-events-none absolute inset-0">
          <div className="absolute -top-20 -right-20 h-64 w-64 rounded-full bg-brand-600/15 blur-3xl" />
          <div className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-sky-600/10 blur-3xl" />
        </div>

        <div className="relative w-full max-w-md py-8">

          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2.5 mb-8">
            <div className="h-9 w-9 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
              <Boxes className="h-4 w-4" />
            </div>
            <span className="font-bold text-white text-lg">AIFOM</span>
          </div>

          {/* Heading */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-white">{t("auth:register_heading", "Đăng ký Tenant Workspace")}</h1>
            <p className="text-slate-400 text-sm mt-1">
              {t("auth:register_subheading", "Workspace mới sẽ được tạo ở gói Trial nếu hệ thống có plan Trial")}
            </p>
          </div>

          <div className="mb-6 text-sm text-slate-500">
            {t("auth:already_have_account", "Đã có tài khoản?")}{" "}
            <Link to="/login" className="font-semibold text-brand-300 hover:text-brand-200">
              {t("auth:sign_in_link", "Đăng nhập")}
            </Link>
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
            {/* Tên workspace */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                {t("auth:workspace_name_label", "Tên workspace")}
              </label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-600" />
                <input
                  required
                  value={tenantName}
                  onChange={(e) => setTenantName(e.target.value)}
                  placeholder="Greenhouse Lab"
                  className="w-full h-11 pl-10 pr-4 rounded-lg bg-slate-900 border border-slate-800
                             text-sm text-slate-100 placeholder:text-slate-700
                             focus:border-primary focus:ring-2 focus:ring-[var(--color-ring)] focus:outline-none
                             transition-colors"
                />
              </div>
            </div>

            {/* Slug workspace */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                {t("auth:workspace_slug_label", "Slug workspace")}
              </label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-600" />
                <input
                  value={tenantSlug || effectiveSlug}
                  onChange={(e) => setTenantSlug(slugify(e.target.value))}
                  placeholder="greenhouse-lab"
                  className="w-full h-11 pl-10 pr-4 rounded-lg bg-slate-900 border border-slate-800
                             text-sm text-slate-100 placeholder:text-slate-700 font-mono
                             focus:border-primary focus:ring-2 focus:ring-[var(--color-ring)] focus:outline-none
                             transition-colors"
                />
              </div>
            </div>

            {/* Họ tên */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                {t("auth:full_name_label", "Họ tên")}
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-600" />
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Nguyễn Văn A"
                  className="w-full h-11 pl-10 pr-4 rounded-lg bg-slate-900 border border-slate-800
                             text-sm text-slate-100 placeholder:text-slate-700
                             focus:border-primary focus:ring-2 focus:ring-[var(--color-ring)] focus:outline-none
                             transition-colors"
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                {t("auth:login_email_label", "Email đăng nhập")}
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-600" />
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="owner@company.com"
                  autoComplete="email"
                  className="w-full h-11 pl-10 pr-4 rounded-lg bg-slate-900 border border-slate-800
                             text-sm text-slate-100 placeholder:text-slate-700
                             focus:border-primary focus:ring-2 focus:ring-[var(--color-ring)] focus:outline-none
                             transition-colors"
                />
              </div>
            </div>

            {/* Mật khẩu */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                {t("auth:password_label", "Mật khẩu")}
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-600" />
                <input
                  required
                  type={showPwd ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("auth:min_password_placeholder", "Tối thiểu 8 ký tự")}
                  autoComplete="new-password"
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
              disabled={submitting || !tenantName || !email || !password}
              className="btn-primary w-full h-11"
            >
              {submitting ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  {t("auth:creating_workspace", "Đang tạo workspace…")}
                </>
              ) : (
                <>
                  {t("auth:create_workspace_btn", "Tạo workspace")}
                  <ArrowRight className="h-4 w-4 ml-1 flex-shrink-0" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
