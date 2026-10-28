import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import App from "./App";
import Login from "./components/Login";
import { ApiError, postJson, requestJson, setUnauthorizedHandler } from "./api";
import type { User } from "./types";

interface AppConfig {
  googleClientId: string | null;
  authReady: boolean;
  missing: string[];
}

/** Shows the login page until the server confirms a valid session, then renders the app. */
export default function AuthGate() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await requestJson<AppConfig>("/api/config");
        setConfig(cfg);
        if (cfg.authReady) {
          const me = await requestJson<{ user: User | null }>("/api/auth/me");
          setUser(me.user);
        }
      } catch (err: any) {
        setFatal(err?.message || "Could not reach the server.");
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  const handleCredential = useCallback(async (credential: string) => {
    setLoginError(null);
    try {
      const { user } = await postJson<{ user: User }>("/api/auth/google", { credential });
      setUser(user);
    } catch (err) {
      setLoginError(err instanceof ApiError ? err.message : "Sign-in failed. Please try again.");
    }
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await postJson("/api/auth/logout", {});
    } finally {
      window.google?.accounts?.id?.disableAutoSelect?.();
      setUser(null);
    }
  }, []);

  if (checking) {
    return (
      <div className="flex h-full items-center justify-center bg-[#fafaf9]">
        <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (fatal || !config?.authReady) {
    return (
      <div className="flex min-h-full items-center justify-center bg-[#fafaf9] px-4 font-sans">
        <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          <p className="flex items-center gap-2 font-semibold">
            <AlertCircle className="h-4 w-4" /> Sign-in isn't set up yet
          </p>
          <p className="mt-2 leading-relaxed">
            {fatal ??
              `The server is missing: ${config?.missing.join(", ")}. Add these environment variables (see the README, "Environment variables") and redeploy.`}
          </p>
        </div>
      </div>
    );
  }

  if (!user) return <Login clientId={config.googleClientId as string} onCredential={handleCredential} error={loginError} />;

  return <App key={user.id} user={user} onLogout={handleLogout} />;
}
