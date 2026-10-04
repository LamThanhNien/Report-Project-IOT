import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  getMe,
  login as apiLogin,
  logout as apiLogout,
  registerTenantOwner as apiRegisterTenantOwner,
  refreshAccessToken,
  updateMe as apiUpdateMe,
} from "../services/authApi";
import type { RegisterRequest, UserRead } from "../services/authApi";
import { debugLogger } from "../lib/debugLogger";
import {
  ApiError,
  AUTH_SESSION_EXPIRED_EVENT,
  AUTH_SESSION_REFRESHED_EVENT,
  REFRESH_TOKEN_KEY,
  TOKEN_KEY,
  isNetworkError,
} from "../services/apiClient";
import { updateClientUser } from "../services/clientApi";
import { queryClient } from "../lib/queryClient";
import { clearTelemetryCache } from "../lib/telemetryCache";

const COOKIE_SESSION = "cookie-session";

/** Max retry attempts for transient network errors during auth bootstrap. */
const AUTH_RETRY_MAX = 3;
/** Base delay (ms) before first retry — doubled each attempt (exponential backoff). */
const AUTH_RETRY_BASE_MS = 500;

export const ADMIN_ROLE = "admin";
export const TENANT_ROLES = ["tenant_owner", "viewer"];
export function isSupportedRole(role: string): boolean {
  return role === ADMIN_ROLE || TENANT_ROLES.includes(role);
}

function validateSessionUser(userData: UserRead): UserRead {
  if (!isSupportedRole(userData.role) || userData.is_active === false) {
    throw new ApiError("This account cannot access the application.", 401, null);
  }
  return userData;
}

interface AuthContextValue {
  user: UserRead | null;
  token: string | null;
  loading: boolean;
  isAdmin: boolean;
  isTenantUser: boolean;
  login: (email: string, password: string) => Promise<UserRead>;
  registerTenantOwner: (payload: RegisterRequest) => Promise<UserRead>;
  updateProfile: (payload: { full_name: string | null }) => Promise<UserRead>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function tenantUserToUserRead(tenantUser: UserRead): UserRead {
  return {
    id: tenantUser.id,
    email: tenantUser.email,
    full_name: tenantUser.full_name,
    role: tenantUser.role,
    is_active: tenantUser.is_active,
    permissions: tenantUser.permissions,
    tenant_id: tenantUser.tenant_id,
    created_at: tenantUser.created_at,
  };
}

function persistTokens(_accessToken?: string | null, _refreshToken?: string | null): string {
  // Authentication is cookie-only. Remove tokens left by older frontend builds
  // so injected scripts cannot recover long-lived credentials from storage.
  clearStoredTokens();
  return COOKIE_SESSION;
}

function clearStoredTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserRead | null>(null);
  const [loading, setLoading] = useState(true);
  const restoredRef = useRef(false);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    setLoading(true);

    async function restoreSession(): Promise<void> {
      for (let attempt = 0; attempt <= AUTH_RETRY_MAX; attempt++) {
        try {
          const userData = validateSessionUser(await getMe());
          setUser(userData);
          clearStoredTokens();
          setToken(COOKIE_SESSION);
          debugLogger.auth("success", "session", "cookie session restored");
          return;
        } catch (getMeErr) {
          if (!isNetworkError(getMeErr)) {
            try {
              const { access_token, refresh_token, user: refreshedUser } = await refreshAccessToken();
              const userData = validateSessionUser(refreshedUser ?? await getMe());
              const restoredToken = persistTokens(access_token, refresh_token);
              setUser(userData);
              setToken(restoredToken);
              debugLogger.auth("success", "session", "cookie session refreshed on restore");
              return;
            } catch (refreshErr) {
              if (!isNetworkError(refreshErr)) {
                debugLogger.auth("failed", "session", "cookie session expired or invalid");
                clearStoredTokens();
                setToken(null);
                setUser(null);
                return;
              }
              debugLogger.auth("attempt", "session", `refresh network error — retrying (${attempt + 1}/${AUTH_RETRY_MAX + 1})`);
            }
          } else {
            debugLogger.auth("attempt", "session", `getMe network error — retrying (${attempt + 1}/${AUTH_RETRY_MAX + 1})`);
          }
          if (attempt < AUTH_RETRY_MAX) {
            const delay = AUTH_RETRY_BASE_MS * Math.pow(2, attempt) + Math.random() * 200;
            await new Promise((r) => setTimeout(r, delay));
          }
        }
      }
      debugLogger.auth("failed", "session", "API unreachable after retries — showing login");
      clearStoredTokens();
      setToken(null);
      setUser(null);
    }

    void restoreSession().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    function handleSessionExpired(): void {
      debugLogger.auth("failed", "session", "session expired");
      clearStoredTokens();
      queryClient.clear();
      setToken(null);
      setUser(null);
    }

    function handleSessionRefreshed(): void {
      clearStoredTokens();
      setToken(COOKIE_SESSION);
    }

    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    window.addEventListener(AUTH_SESSION_REFRESHED_EVENT, handleSessionRefreshed);
    return () => {
      window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
      window.removeEventListener(AUTH_SESSION_REFRESHED_EVENT, handleSessionRefreshed);
    };
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<UserRead> => {
    debugLogger.auth("attempt", email);
    try {
      const { access_token, refresh_token, user: userFromLogin } = await apiLogin(email, password);
      const userData = validateSessionUser(userFromLogin ?? await getMe());
      const restoredToken = persistTokens(access_token, refresh_token);
      queryClient.clear();
      setToken(restoredToken);
      setUser(userData);
      debugLogger.auth("success", email);
      return userData;
    } catch (err) {
      clearStoredTokens();
      queryClient.clear();
      setToken(null);
      setUser(null);
      debugLogger.auth("failed", email, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, []);

  const registerTenantOwner = useCallback(async (payload: RegisterRequest): Promise<UserRead> => {
    debugLogger.auth("attempt", payload.owner_email);
    try {
      const { access_token, refresh_token, user: userFromRegister } = await apiRegisterTenantOwner(payload);
      const userData = validateSessionUser(userFromRegister ?? await getMe());
      const restoredToken = persistTokens(access_token, refresh_token);
      queryClient.clear();
      setToken(restoredToken);
      setUser(userData);
      debugLogger.auth("success", payload.owner_email);
      return userData;
    } catch (err) {
      debugLogger.auth("failed", payload.owner_email, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, []);

  const updateProfile = useCallback(async (payload: { full_name: string | null }): Promise<UserRead> => {
    if (user?.id && user.role === "tenant_owner") {
      const tenantUser = await updateClientUser(user.id, payload);
      const userData = validateSessionUser(tenantUserToUserRead(tenantUser));
      setUser(userData);
      queryClient.setQueryData(["auth-me"], userData);
      return userData;
    }

    const userData = await apiUpdateMe(payload).catch(async (err) => {
      if (
        !(err instanceof ApiError)
        || err.status !== 405
        || !user?.id
        || !TENANT_ROLES.includes(user.role)
      ) {
        throw err;
      }

      const tenantUser = await updateClientUser(user.id, payload);
      return tenantUserToUserRead(tenantUser);
    });
    validateSessionUser(userData);
    setUser(userData);
    queryClient.setQueryData(["auth-me"], userData);
    return userData;
  }, [user?.id, user?.role]);

  const logout = useCallback(() => {
    debugLogger.auth("logout");
    void apiLogout().catch((err) => {
      debugLogger.auth("failed", "logout", err instanceof Error ? err.message : String(err));
    });
    clearStoredTokens();
    clearTelemetryCache();
    localStorage.removeItem("aifom_tenant_disabled");
    queryClient.clear();
    setToken(null);
    setUser(null);
  }, []);

  const isAdmin = user?.role === ADMIN_ROLE;
  const isTenantUser = !!(user && TENANT_ROLES.includes(user.role));

  return (
    <AuthContext.Provider value={{ user, token, loading, isAdmin, isTenantUser, login, registerTenantOwner, updateProfile, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
