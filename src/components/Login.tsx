import { useEffect, useRef, useState } from "react";
import { AlertCircle, BookOpen, Loader2 } from "lucide-react";

declare global {
  interface Window {
    google?: any;
  }
}

let gsiLoader: Promise<void> | null = null;
function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!gsiLoader) {
    gsiLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => {
        gsiLoader = null;
        reject(new Error("Could not load Google sign-in. Check your connection and refresh."));
      };
      document.head.appendChild(script);
    });
  }
  return gsiLoader;
}

interface LoginProps {
  clientId: string;
  onCredential: (credential: string) => Promise<void>;
  error?: string | null;
}

export default function Login({ clientId, onCredential, error }: LoginProps) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const callbackRef = useRef(onCredential);
  callbackRef.current = onCredential;

  useEffect(() => {
    let cancelled = false;
    loadGoogleScript()
      .then(() => {
        if (cancelled || !buttonRef.current) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: async (resp: { credential?: string }) => {
            if (!resp.credential) return;
            setBusy(true);
            try {
              await callbackRef.current(resp.credential);
            } finally {
              setBusy(false);
            }
          },
        });
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: "outline",
          size: "large",
          shape: "pill",
          text: "continue_with",
          width: 280,
        });
      })
      .catch((err) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const message = error || loadError;

  return (
    <div className="flex min-h-full items-center justify-center bg-[#fafaf9] px-4 py-10 font-sans">
      <div className="rise w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-900 text-white">
          <BookOpen className="h-6 w-6" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-stone-900">PDF Chat</h1>
        <p className="mt-2 text-sm leading-relaxed text-stone-500">
          Sign in to chat with your PDFs. Your documents and conversations are saved to your account.
        </p>

        <div className="mt-7 flex min-h-[44px] items-center justify-center">
          {busy ? (
            <span className="flex items-center gap-2 text-sm text-stone-500">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-600" /> Signing you in…
            </span>
          ) : (
            <div ref={buttonRef} />
          )}
        </div>

        {message && (
          <div className="mt-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-left text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{message}</p>
          </div>
        )}

        <p className="mt-6 text-xs leading-relaxed text-stone-400">
          Opening this from WhatsApp or Instagram? Open the link in Chrome or Safari if Google sign-in doesn't appear.
        </p>
      </div>
    </div>
  );
}
