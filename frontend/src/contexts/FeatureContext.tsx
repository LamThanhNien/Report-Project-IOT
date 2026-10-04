import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { getClientFeatures } from "../services/clientApi";
import type { FeatureKey, FeatureMap } from "../types";

interface FeatureContextValue {
  features: FeatureMap | null;
  loading: boolean;
  /** true once the first feature-flag fetch (success or failure) has completed for the current role */
  featuresReady: boolean;
  hasFeature: (key: FeatureKey) => boolean;
  reloadFeatures: () => void;
}

const FeatureContext = createContext<FeatureContextValue | null>(null);

const TENANT_ROLES = ["tenant_owner", "viewer"];

export function FeatureProvider({
  children,
  role,
}: {
  children: React.ReactNode;
  role: string | null;
}) {
  const [features, setFeatures] = useState<FeatureMap | null>(null);
  const [loading, setLoading] = useState(false);
  // featuresReady starts false; becomes true after the first successful/failed fetch for a tenant role.
  // Stays false for null/non-tenant roles so feature-gated pages show a loading state
  // rather than a false "disabled" screen while features are in flight.
  const [featuresReady, setFeaturesReady] = useState(false);

  const load = useCallback(() => {
    // Reset ready state on every (re)load so stale features are never shown.
    setFeaturesReady(false);
    if (!role || !TENANT_ROLES.includes(role)) {
      setFeatures(null);
      setLoading(false);
      // Non-tenant/unauthenticated: nothing to fetch, stay not-ready.
      // ProtectedRoute/ClientRoute handles redirects before any feature-gated page renders.
      return;
    }
    setLoading(true);
    getClientFeatures()
      .then(setFeatures)
      .catch(() => setFeatures(null))
      .finally(() => {
        setLoading(false);
        setFeaturesReady(true);
      });
  }, [role]);

  useEffect(() => {
    load();
  }, [load]);

  const hasFeature = useCallback(
    (key: FeatureKey): boolean => {
      // Admins always have all features; they never reach ClientRoute pages anyway.
      if (role === "admin") return true;
      if (!role || !TENANT_ROLES.includes(role)) return false;
      if (!features) return false;
      return features[key] === true;
    },
    [features, role],
  );

  return (
    <FeatureContext.Provider value={{ features, loading, featuresReady, hasFeature, reloadFeatures: load }}>
      {children}
    </FeatureContext.Provider>
  );
}

export function useFeature(): FeatureContextValue {
  const ctx = useContext(FeatureContext);
  if (!ctx) throw new Error("useFeature must be inside FeatureProvider");
  return ctx;
}
