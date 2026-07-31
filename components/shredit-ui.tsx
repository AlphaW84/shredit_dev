"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Moon,
  RefreshCw,
  Sparkles,
  Sun,
  Trash2,
} from "lucide-react";
import {
  assertWebCryptoCapability,
  buildShareUrl,
  createPayloadDigest,
  decryptNote,
  encryptNote,
  generatePassword,
  normalizePassword,
  parseNoteLocation,
  passwordCodePointLength,
  randomBase64Url,
  solvePowChallenge,
  utf8ByteLength,
  MAX_NOTE_PLAINTEXT_BYTES,
  type PowChallenge,
} from "@/lib/client-crypto";
import { Copy as CopyType, Locale, messages } from "@/lib/messages";
import type { PublicRuntimeConfig } from "@/lib/public-config";
import { useTheme } from "@/lib/theme-provider";

type Expiry = "1h" | "24h" | "7d" | "30d" | "never";

type ComposerErrorKey =
  | "antiAbuseExpired"
  | "antiAbuseUnavailable"
  | "cryptoUnavailable"
  | "generic"
  | "passwordRequirements"
  | "serviceUnavailable"
  | "storageFull"
  | "tooLarge"
  | "tooManyAttempts";

type OpenErrorKey =
  | "cryptoUnavailable"
  | "serviceUnavailable"
  | "tooManyAttempts"
  | "wrongPassword";

function useCopy(locale: Locale) {
  return messages[locale] as CopyType;
}

export function LanguageMenu({
  locale,
  onChange,
}: {
  locale: Locale;
  onChange: (locale: Locale) => void;
}) {
  const copy = useCopy(locale);
  return (
    <div className="language-menu" role="group" aria-label={copy.navLanguage}>
      <button
        className={
          locale === "en" ? "language-option selected" : "language-option"
        }
        type="button"
        aria-pressed={locale === "en"}
        title={copy.languageEnglish}
        lang="en"
        onClick={() => onChange("en")}
      >
        EN
      </button>
      <button
        className={
          locale === "zh-CN" ? "language-option selected" : "language-option"
        }
        type="button"
        aria-pressed={locale === "zh-CN"}
        title={copy.languageChinese}
        lang="zh-CN"
        onClick={() => onChange("zh-CN")}
      >
        中文
      </button>
    </div>
  );
}

export function ThemeToggle({ locale }: { locale: Locale }) {
  const copy = useCopy(locale);
  const { theme, toggleTheme } = useTheme();
  const light = theme === "light";
  const label = light ? copy.themeUseDark : copy.themeUseLight;

  return (
    <button
      className="icon-button theme-toggle"
      type="button"
      role="switch"
      aria-label={copy.themeLabel}
      aria-checked={light}
      title={label}
      onClick={toggleTheme}
    >
      {light ? (
        <Moon size={17} aria-hidden="true" />
      ) : (
        <Sun size={17} aria-hidden="true" />
      )}
    </button>
  );
}

export function CopyButton({
  value,
  label,
  copiedLabel,
  errorLabel = label,
  onCopied,
  onError,
}: {
  value: string;
  label: string;
  copiedLabel: string;
  errorLabel?: string;
  onCopied?: () => void;
  onError?: () => void;
}) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  async function copy() {
    try {
      await copyTextToClipboard(value);
      setState("copied");
      onCopied?.();
      window.setTimeout(() => setState("idle"), 1800);
    } catch {
      setState("error");
      onError?.();
      window.setTimeout(() => setState("idle"), 2200);
    }
  }
  const activeLabel =
    state === "copied" ? copiedLabel : state === "error" ? errorLabel : label;
  return (
    <button
      className="icon-button"
      type="button"
      aria-label={activeLabel}
      title={activeLabel}
      onClick={copy}
    >
      {state === "copied" ? (
        <Check size={18} aria-hidden="true" />
      ) : state === "error" ? (
        <AlertTriangle size={18} aria-hidden="true" />
      ) : (
        <Copy size={18} aria-hidden="true" />
      )}
      <span className="sr-only" aria-live="polite">
        {activeLabel}
      </span>
    </button>
  );
}

export async function copyTextToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  try {
    textarea.value = value;
    textarea.setAttribute("readonly", "true");
    textarea.className = "clipboard-proxy";
    document.body.appendChild(textarea);
    textarea.select();
    if (!document.execCommand("copy")) throw new Error("clipboard-denied");
  } finally {
    textarea.remove();
  }
}

export function ByteCounter({
  value,
  locale,
}: {
  value: string;
  locale: Locale;
}) {
  const copy = useCopy(locale);
  const used = utf8ByteLength(value);
  const state =
    used > MAX_NOTE_PLAINTEXT_BYTES
      ? "over"
      : used > MAX_NOTE_PLAINTEXT_BYTES * 0.9
        ? "near"
        : "normal";
  return (
    <div className={`byte-counter ${state}`} aria-live="polite">
      <span>{copy.bytes(used, MAX_NOTE_PLAINTEXT_BYTES)}</span>
      <span>{copy.byteUnit}</span>
    </div>
  );
}

export function ExpirySelect({
  locale,
  value,
  onChange,
  disabled = false,
}: {
  locale: Locale;
  value: Expiry;
  onChange: (value: Expiry) => void;
  disabled?: boolean;
}) {
  const copy = useCopy(locale);
  const options = Object.keys(copy.expiry) as Expiry[];
  const compactLabels: Record<Expiry, string> = {
    "1h": locale === "zh-CN" ? "1时" : "1h",
    "24h": locale === "zh-CN" ? "24时" : "24h",
    "7d": locale === "zh-CN" ? "7天" : "7d",
    "30d": locale === "zh-CN" ? "30天" : "30d",
    never: locale === "zh-CN" ? "永久" : "Never",
  };

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (
      ![
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
      ].includes(event.key)
    )
      return;
    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? options.length - 1
          : event.key === "ArrowRight" || event.key === "ArrowDown"
            ? (index + 1) % options.length
            : (index - 1 + options.length) % options.length;
    const next = options[nextIndex];
    onChange(next);
    document.getElementById(`expiry-${next}`)?.focus();
  }

  return (
    <div className="select-row">
      <span id="expiry-label" className="sr-only">
        {copy.expiration}
      </span>
      <div
        className="segmented-control"
        role="radiogroup"
        aria-labelledby="expiry-label"
      >
        {options.map((option, index) => (
          <button
            id={`expiry-${option}`}
            key={option}
            className={option === value ? "segment selected" : "segment"}
            type="button"
            role="radio"
            aria-checked={option === value}
            aria-label={copy.expiry[option]}
            title={copy.expiry[option]}
            tabIndex={option === value ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {compactLabels[option]}
          </button>
        ))}
      </div>
    </div>
  );
}

function ErrorNotice({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="notice notice-error" role="alert">
      <AlertTriangle size={17} aria-hidden="true" />
      <span>{children}</span>
      {action}
    </div>
  );
}

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
};

function TurnstileWidget({
  siteKey,
  onToken,
}: {
  siteKey: string;
  onToken: (token: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let widgetId: string | undefined;
    let cancelled = false;
    const getApi = () =>
      (window as unknown as { turnstile?: TurnstileApi }).turnstile;
    const render = () => {
      const api = getApi();
      if (cancelled || !api || !containerRef.current || widgetId) return;
      widgetId = api.render(containerRef.current, {
        sitekey: siteKey,
        action: "shredit-create",
        callback: (token: string) => onToken(token),
        "expired-callback": () => onToken(""),
        "error-callback": () => onToken(""),
        size: "flexible",
        theme: "dark",
      });
    };

    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-shredit-turnstile="true"]',
    );
    if (getApi()) {
      render();
    } else if (existing) {
      existing.addEventListener("load", render, { once: true });
    } else {
      const script = document.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.dataset.shreditTurnstile = "true";
      script.addEventListener("load", render, { once: true });
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      if (widgetId) getApi()?.remove(widgetId);
      existing?.removeEventListener("load", render);
      onToken("");
    };
  }, [siteKey, onToken]);

  return <div className="turnstile-widget" ref={containerRef} />;
}

export function PasswordControl({
  locale,
  enabled,
  value,
  onChange,
  onGenerate,
  disabled = false,
}: {
  locale: Locale;
  enabled: boolean;
  value: string;
  onChange: (value: string) => void;
  onGenerate: () => void;
  disabled?: boolean;
}) {
  const copy = useCopy(locale);
  const [visible, setVisible] = useState(false);
  const length = passwordCodePointLength(normalizePassword(value));
  const invalid = enabled && (length < 8 || length > 128);
  return (
    <div
      className={`password-control ${!enabled || disabled ? "disabled" : ""}`}
    >
      <div className="field-heading">
        <label htmlFor="note-password">{copy.passwordOptional}</label>
        <span>{enabled ? `${length}/128` : ""}</span>
      </div>
      <div className="password-row">
        <div className="input-with-icon">
          <KeyRound size={17} aria-hidden="true" />
          <input
            id="note-password"
            name="password"
            type={visible ? "text" : "password"}
            autoComplete="new-password"
            disabled={!enabled || disabled}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={copy.passwordPlaceholder}
            aria-invalid={invalid}
            aria-describedby={invalid ? "password-error" : undefined}
          />
          <button
            className="inline-icon-button"
            type="button"
            disabled={!enabled || disabled}
            aria-label={visible ? copy.hidePassword : copy.showPassword}
            title={visible ? copy.hidePassword : copy.showPassword}
            onClick={() => setVisible((state) => !state)}
          >
            {visible ? (
              <EyeOff size={17} aria-hidden="true" />
            ) : (
              <Eye size={17} aria-hidden="true" />
            )}
          </button>
        </div>
        <button
          className="icon-button generate-button"
          type="button"
          disabled={!enabled || disabled}
          aria-label={copy.generatePassword}
          title={copy.generatePassword}
          onClick={onGenerate}
        >
          <Sparkles size={17} aria-hidden="true" />
          <span className="sr-only">{copy.generatePassword}</span>
        </button>
      </div>
      {invalid && (
        <p id="password-error" className="field-error">
          {copy.passwordRequirements}
        </p>
      )}
    </div>
  );
}

export function GeneratedPasswordField({
  locale,
  value,
}: {
  locale: Locale;
  value: string;
}) {
  const copy = useCopy(locale);
  const [visible, setVisible] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const visibilityLabel = visible ? copy.hidePassword : copy.showPassword;
  return (
    <div className="share-block">
      <div className="share-row">
        <div className="share-content">
          <span className="share-label">{copy.passwordOptional}</span>
          <code aria-label={visible ? undefined : copy.passwordHidden}>
            {visible ? value : "••••••••••••"}
          </code>
        </div>
        <div className="share-actions">
          <button
            className="icon-button"
            type="button"
            aria-label={visibilityLabel}
            title={visibilityLabel}
            onClick={() => setVisible((state) => !state)}
          >
            {visible ? (
              <EyeOff size={17} aria-hidden="true" />
            ) : (
              <Eye size={17} aria-hidden="true" />
            )}
            <span className="sr-only">{visibilityLabel}</span>
          </button>
          <CopyButton
            value={value}
            label={copy.copyPassword}
            copiedLabel={copy.passwordCopied}
            errorLabel={copy.copyFailed}
            onCopied={() => setCopyError(false)}
            onError={() => setCopyError(true)}
          />
        </div>
      </div>
      {copyError && (
        <p className="copy-error" role="status">
          {copy.copyFailed}
        </p>
      )}
    </div>
  );
}

export type PreparedRequest = {
  body: Record<string, unknown>;
  idempotencyKey: string;
  id: string;
  key: string;
  password?: string;
  antiAbuseRefreshRequired?: boolean;
};
type AntiAbusePolicy = {
  surface: "clearnet" | "onion";
  turnstileRequired: boolean;
  turnstileSiteKey?: string;
  powRequired: boolean;
};

export type PreparedRequestFailureAction =
  "preserve" | "refresh-proof" | "regenerate";

export function classifyPreparedRequestFailure(
  status: number | "network",
  code?: string,
): PreparedRequestFailureAction {
  if (status === "network") return "refresh-proof";
  if (status === 409 && code === "NOTE_ID_CONFLICT") return "regenerate";
  if (
    (status === 403 && code === "ANTI_ABUSE_FAILED") ||
    status === 429 ||
    status === 503 ||
    status === 507
  )
    return "refresh-proof";
  return "preserve";
}

export function preparedRequestAfterCreateFailure(
  request: PreparedRequest,
  status: number | "network",
  code?: string,
) {
  const action = classifyPreparedRequestFailure(status, code);
  if (action === "regenerate") return null;
  if (action === "refresh-proof")
    return preparedRequestForAntiAbuseRefresh(request);
  return request;
}

export function preparedRequestForAntiAbuseRefresh(
  request: PreparedRequest,
): PreparedRequest {
  const { turnstileToken: _turnstileToken, pow: _pow, ...body } = request.body;
  return { ...request, body, antiAbuseRefreshRequired: true };
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

export async function postOpenNoteAfterCryptoPreflight(
  noteId: string,
  password: string,
  fetcher: Fetcher = fetch,
) {
  await assertWebCryptoCapability();
  return fetcher(`/api/v1/notes/${noteId}/open`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      password ? { password: normalizePassword(password) } : {},
    ),
    cache: "no-store",
  });
}

type CreationResult = {
  clearnetLink: string;
  onionLink?: string;
  password?: string;
  expiresAt: string | null;
};

export function NoteComposer({
  locale,
  publicConfig,
}: {
  locale: Locale;
  publicConfig: PublicRuntimeConfig;
}) {
  const copy = useCopy(locale);
  const [text, setText] = useState("");
  const [expiry, setExpiry] = useState<Expiry>("7d");
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<
    | "idle"
    | "encrypting"
    | "pow"
    | "creating"
    | "uncertain"
    | "success"
    | "error"
  >("idle");
  const [errorKey, setErrorKey] = useState<ComposerErrorKey | null>(null);
  const [prepared, setPrepared] = useState<PreparedRequest | null>(null);
  const [result, setResult] = useState<CreationResult | null>(null);
  const [antiAbusePolicy, setAntiAbusePolicy] =
    useState<AntiAbusePolicy | null>(null);
  const [antiAbuseError, setAntiAbuseError] = useState(false);
  const [antiAbusePolicyAttempt, setAntiAbusePolicyAttempt] = useState(0);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileEpoch, setTurnstileEpoch] = useState(0);
  const [powAttempts, setPowAttempts] = useState(0);
  const [cryptoAvailable, setCryptoAvailable] = useState<boolean | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const error = errorKey ? copy[errorKey] : "";

  useEffect(() => {
    let cancelled = false;
    assertWebCryptoCapability()
      .then(() => {
        if (!cancelled) setCryptoAvailable(true);
      })
      .catch(() => {
        if (!cancelled) setCryptoAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setAntiAbuseError(false);
    fetch("/api/v1/anti-abuse/policy", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("policy-unavailable");
        const policy = (await response.json()) as AntiAbusePolicy;
        if (
          !["clearnet", "onion"].includes(policy.surface) ||
          typeof policy.turnstileRequired !== "boolean" ||
          typeof policy.powRequired !== "boolean" ||
          (policy.turnstileRequired && !policy.turnstileSiteKey)
        )
          throw new Error("policy-invalid");
        if (!cancelled) {
          setAntiAbusePolicy(policy);
          setAntiAbuseError(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAntiAbusePolicy(null);
          setAntiAbuseError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [antiAbusePolicyAttempt]);

  const antiAbuseReady = Boolean(
    antiAbusePolicy &&
    (!antiAbusePolicy.turnstileRequired || turnstileToken) &&
    !antiAbuseError,
  );
  const canSubmit =
    utf8ByteLength(text) <= MAX_NOTE_PLAINTEXT_BYTES &&
    text.length > 0 &&
    (!passwordEnabled ||
      (passwordCodePointLength(normalizePassword(password)) >= 8 &&
        passwordCodePointLength(normalizePassword(password)) <= 128)) &&
    cryptoAvailable === true &&
    antiAbuseReady;
  const statusText =
    status === "encrypting"
      ? copy.encrypting
      : status === "pow"
        ? `${copy.powWorking}${powAttempts ? ` ${powAttempts.toLocaleString(locale)}` : ""}`
        : status === "creating"
          ? copy.checking
          : status === "uncertain"
            ? copy.uncertainBody
            : "";
  const encryptionStatus =
    cryptoAvailable === true
      ? copy.encryptionReady
      : cryptoAvailable === false
        ? copy.encryptionUnavailableStatus
        : copy.encryptionChecking;
  const encryptionTone =
    cryptoAvailable === true
      ? "success"
      : cryptoAvailable === false
        ? "danger"
        : "pending";

  async function attachAntiAbuseProof(
    request: PreparedRequest,
  ): Promise<PreparedRequest> {
    if (!antiAbusePolicy) throw new Error("antiAbuseUnavailable");
    const body: Record<string, unknown> = { ...request.body };
    delete body.turnstileToken;
    delete body.pow;
    if (antiAbusePolicy.turnstileRequired) {
      if (!turnstileToken) throw new Error("antiAbuseUnavailable");
      body.turnstileToken = turnstileToken;
    }

    if (antiAbusePolicy.powRequired) {
      setStatus("pow");
      setPowAttempts(0);
      const payloadDigest = await createPayloadDigest({
        surface: antiAbusePolicy.surface,
        id: request.id,
        protocolVersion: 1,
        iv: String(body.iv),
        ciphertext: String(body.ciphertext),
        expiresIn: body.expiresIn as Expiry,
      });
      const challengeResponse = await fetch(
        "/api/v1/anti-abuse/pow-challenge",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ surface: "onion", payloadDigest }),
          cache: "no-store",
        },
      );
      if (!challengeResponse.ok) throw new Error("antiAbuseUnavailable");
      const challenge = (await challengeResponse.json()) as PowChallenge;
      if (challenge.payloadDigest !== payloadDigest)
        throw new Error("antiAbuseUnavailable");
      const nonce = await solvePowChallenge(challenge, setPowAttempts);
      body.pow = { challenge: JSON.stringify(challenge), nonce };
    }
    return { ...request, body, antiAbuseRefreshRequired: false };
  }

  async function prepareRequest(): Promise<PreparedRequest> {
    if (!antiAbusePolicy) throw new Error("antiAbuseUnavailable");
    const id = randomBase64Url(24);
    const encrypted = await encryptNote(id, text);
    const normalizedPassword = passwordEnabled
      ? normalizePassword(password)
      : undefined;
    return attachAntiAbuseProof({
      idempotencyKey: randomBase64Url(24),
      id,
      key: encrypted.key,
      password: normalizedPassword,
      body: {
        id,
        protocolVersion: 1,
        iv: encrypted.iv,
        ciphertext: encrypted.ciphertext,
        expiresIn: expiry,
        ...(normalizedPassword ? { password: normalizedPassword } : {}),
      },
    });
  }

  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    setErrorKey(null);
    if (status === "success") return;
    if (!prepared && !canSubmit) {
      if (!text) setErrorKey("generic");
      else if (utf8ByteLength(text) > MAX_NOTE_PLAINTEXT_BYTES)
        setErrorKey("tooLarge");
      else setErrorKey("passwordRequirements");
      return;
    }
    let request = prepared;
    let createPostStarted = false;
    try {
      if (!request) {
        setStatus("encrypting");
        request = await prepareRequest();
        setPrepared(request);
      } else if (request.antiAbuseRefreshRequired) {
        request = await attachAntiAbuseProof(request);
        setPrepared(request);
      }
      let response: Response;
      let payload: {
        id?: string;
        expiresAt?: string | null;
        error?: { code?: string };
      } | null;
      let collisionRetries = 0;
      while (true) {
        setStatus("creating");
        createPostStarted = true;
        response = await fetch("/api/v1/notes", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": request.idempotencyKey,
          },
          body: JSON.stringify(request.body),
          cache: "no-store",
        });
        createPostStarted = false;
        payload = await response.json().catch(() => null);
        const failureAction = classifyPreparedRequestFailure(
          response.status,
          payload?.error?.code,
        );
        if (
          !response.ok &&
          failureAction === "regenerate" &&
          collisionRetries === 0
        ) {
          collisionRetries += 1;
          setPrepared(null);
          setStatus("encrypting");
          request = await prepareRequest();
          setPrepared(request);
          continue;
        }
        break;
      }
      if (!response.ok) {
        const code = payload?.error?.code;
        const failureAction = classifyPreparedRequestFailure(
          response.status,
          code,
        );
        setPrepared(
          preparedRequestAfterCreateFailure(request, response.status, code),
        );
        if (failureAction === "refresh-proof") {
          setTurnstileToken("");
          setTurnstileEpoch((value) => value + 1);
        }
        if (response.status === 403 && code === "ANTI_ABUSE_FAILED") {
          throw new Error("antiAbuseExpired");
        }
        if (response.status === 507 || code === "STORAGE_FULL")
          throw new Error("storageFull");
        if (response.status === 503) throw new Error("serviceUnavailable");
        if (response.status === 429) throw new Error("tooManyAttempts");
        throw new Error("generic");
      }
      if (
        payload?.id !== request.id ||
        (payload.expiresAt !== null && typeof payload.expiresAt !== "string")
      ) {
        throw new Error("generic");
      }
      const expiresAt = payload?.expiresAt ?? null;
      setResult({
        clearnetLink: buildShareUrl(
          publicConfig.clearnetUrl,
          request.id,
          request.key,
        ),
        onionLink: publicConfig.onionUrl
          ? buildShareUrl(publicConfig.onionUrl, request.id, request.key)
          : undefined,
        password: request.password,
        expiresAt,
      });
      setStatus("success");
      setPrepared(null);
    } catch (caught) {
      if (
        caught instanceof Error &&
        (caught.message === "crypto-unavailable" ||
          caught.message === "malformed-payload")
      ) {
        setErrorKey("cryptoUnavailable");
        setStatus("error");
        return;
      }
      if (
        caught instanceof TypeError ||
        (caught instanceof Error &&
          /Failed to fetch|NetworkError|network/i.test(caught.message))
      ) {
        if (createPostStarted && request) {
          setPrepared(preparedRequestAfterCreateFailure(request, "network"));
          setTurnstileToken("");
          setTurnstileEpoch((value) => value + 1);
          setErrorKey(null);
          setStatus("uncertain");
        } else {
          setErrorKey("antiAbuseUnavailable");
          setStatus("error");
        }
        return;
      }
      const errorCode = caught instanceof Error ? caught.message : "generic";
      setErrorKey(
        [
          "antiAbuseExpired",
          "antiAbuseUnavailable",
          "generic",
          "serviceUnavailable",
          "storageFull",
          "tooManyAttempts",
        ].includes(errorCode)
          ? (errorCode as ComposerErrorKey)
          : "generic",
      );
      setStatus("error");
    }
  }

  function startOver() {
    setPrepared(null);
    setStatus("idle");
    setErrorKey(null);
    setTurnstileToken("");
    setTurnstileEpoch((value) => value + 1);
    setPowAttempts(0);
  }

  if (result)
    return (
      <CreateResult
        locale={locale}
        result={result}
        onCreateAnother={() => {
          setResult(null);
          setStatus("idle");
          setText("");
          setPassword("");
          setPasswordEnabled(false);
          setPrepared(null);
          setTurnstileToken("");
          setPowAttempts(0);
        }}
      />
    );

  const noteIsOverLimit = utf8ByteLength(text) > MAX_NOTE_PLAINTEXT_BYTES;
  const requestLocked = prepared !== null;

  return (
    <section
      className="task-panel composer-panel"
      aria-labelledby="create-title"
    >
      <p className="sr-only">{copy.brandSlogan}</p>
      <div className="workspace-main">
        <div className="composer-main">
          <div className="workspace-bar">
            <div className="workspace-bar-group">
              <span className="workspace-label">{copy.composeLabel}</span>
              <span className="workspace-divider" aria-hidden="true" />
              <span>{copy.createPlainText} · UTF-8</span>
            </div>
            <div
              className={`workspace-encryption ${encryptionTone}`}
              aria-live="polite"
            >
              <span
                className={`status-dot ${encryptionTone}`}
                aria-hidden="true"
              />
              <span>{encryptionStatus}</span>
            </div>
          </div>

          <div className="editor-area">
            <div className="editor-heading">
              <div>
                <h1 id="create-title" className="sr-only">
                  {copy.createTitle}
                </h1>
                <label htmlFor="note-text" className="sr-only">
                  {copy.noteLabel}
                </label>
              </div>
            </div>
            <textarea
              id="note-text"
              name="note"
              value={text}
              disabled={requestLocked}
              onChange={(event) => setText(event.target.value)}
              placeholder={copy.notePlaceholder}
              spellCheck={false}
              aria-describedby={
                noteIsOverLimit ? "byte-count note-error" : "byte-count"
              }
              aria-invalid={noteIsOverLimit}
            />
            <div className="editor-meter" id="byte-count">
              <ByteCounter locale={locale} value={text} />
              <span className="editor-limit">{copy.maxSize}</span>
            </div>
            {noteIsOverLimit && (
              <p id="note-error" className="field-error editor-error">
                {copy.tooLarge}
              </p>
            )}
          </div>
        </div>

        <form
          ref={formRef}
          className="workspace-rail composer-form"
          onSubmit={submit}
          noValidate
        >
          <section className="rail-section rail-expiry">
            <div className="rail-heading">
              <span className="rail-index">01</span>
              <h2>{copy.expiration}</h2>
            </div>
            <ExpirySelect
              locale={locale}
              value={expiry}
              onChange={setExpiry}
              disabled={requestLocked}
            />
            <p className="rail-help">{copy.expiryHelp}</p>
          </section>

          <section className="rail-section rail-access">
            <div className="rail-heading">
              <span className="rail-index">02</span>
              <h2>{copy.passwordOptional}</h2>
              <span className="rail-optional">{copy.optionalLabel}</span>
              <button
                id="password-toggle"
                className={`toggle ${passwordEnabled ? "on" : ""}`}
                type="button"
                role="switch"
                aria-label={copy.passwordToggle}
                aria-checked={passwordEnabled}
                disabled={requestLocked}
                onClick={() => {
                  setPasswordEnabled((state) => !state);
                  setPassword("");
                }}
              >
                <span />
              </button>
            </div>
            {passwordEnabled ? (
              <PasswordControl
                locale={locale}
                enabled
                value={password}
                disabled={requestLocked || cryptoAvailable !== true}
                onChange={setPassword}
                onGenerate={() => {
                  setPasswordEnabled(true);
                  setPassword(generatePassword());
                }}
              />
            ) : (
              <p className="rail-help access-help">{copy.passwordToggle}</p>
            )}
          </section>

          <section className="rail-section rail-status">
            <div className="rail-heading">
              <span className="rail-index">03</span>
              <h2>{copy.statusLabel}</h2>
            </div>
            <ul className="status-list">
              <li className={`status-${encryptionTone}`}>
                {cryptoAvailable === false ? (
                  <AlertTriangle size={14} aria-hidden="true" />
                ) : cryptoAvailable === null ? (
                  <RefreshCw size={14} className="spin" aria-hidden="true" />
                ) : (
                  <Check size={14} aria-hidden="true" />
                )}
                <span>
                  {cryptoAvailable === false
                    ? copy.cryptoUnavailable
                    : cryptoAvailable === null
                      ? copy.encryptionChecking
                      : copy.createEncryption}
                </span>
              </li>
              <li className="status-success">
                <Check size={14} aria-hidden="true" />
                <span>{copy.brandSupporting}</span>
              </li>
              <li className="status-success">
                <Check size={14} aria-hidden="true" />
                <span>{copy.homeNoTracking}</span>
              </li>
            </ul>
            <div className="anti-abuse-slot" aria-live="polite">
              {!antiAbusePolicy && !antiAbuseError && (
                <span>{copy.checking}</span>
              )}
              {antiAbuseError && (
                <ErrorNotice
                  action={
                    <button
                      className="icon-button notice-action"
                      type="button"
                      aria-label={copy.retryPolicy}
                      title={copy.retryPolicy}
                      onClick={() =>
                        setAntiAbusePolicyAttempt((attempt) => attempt + 1)
                      }
                    >
                      <RefreshCw size={17} aria-hidden="true" />
                    </button>
                  }
                >
                  {copy.antiAbuseUnavailable}
                </ErrorNotice>
              )}
              {antiAbusePolicy?.turnstileRequired &&
                antiAbusePolicy.turnstileSiteKey && (
                  <TurnstileWidget
                    key={turnstileEpoch}
                    siteKey={antiAbusePolicy.turnstileSiteKey}
                    onToken={setTurnstileToken}
                  />
                )}
              {antiAbusePolicy && !antiAbusePolicy.turnstileRequired && (
                <span className="anti-abuse-ready">
                  <span className="status-dot" aria-hidden="true" />
                  {antiAbusePolicy.powRequired
                    ? copy.powWorking
                    : copy.antiAbuseReady}
                </span>
              )}
            </div>
          </section>

          <div className="rail-feedback">
            {cryptoAvailable === false && (
              <ErrorNotice>{copy.cryptoUnavailable}</ErrorNotice>
            )}
            {error && <ErrorNotice>{error}</ErrorNotice>}
            {statusText && (
              <div className="notice notice-progress" aria-live="polite">
                <RefreshCw size={17} className="spin" aria-hidden="true" />
                <span>{statusText}</span>
              </div>
            )}
            {status === "uncertain" && (
              <div className="uncertain-box">
                <div>
                  <strong>{copy.uncertainTitle}</strong>
                  <p>{copy.uncertainBody}</p>
                </div>
                <div className="uncertain-actions">
                  <button
                    className="outline-button"
                    type="button"
                    onClick={() => submit()}
                    disabled={Boolean(
                      prepared?.antiAbuseRefreshRequired &&
                      antiAbusePolicy?.turnstileRequired &&
                      !turnstileToken,
                    )}
                  >
                    <RefreshCw size={16} aria-hidden="true" />
                    {copy.retry}
                  </button>
                  <button
                    className="text-button"
                    type="button"
                    onClick={startOver}
                  >
                    {copy.startOver}
                  </button>
                </div>
              </div>
            )}
            {status === "error" && prepared && (
              <button
                className="text-button prepared-reset"
                type="button"
                onClick={startOver}
              >
                {copy.startOver}
              </button>
            )}
          </div>

          <div className="rail-action">
            <button
              className="primary-button"
              type="submit"
              disabled={
                status === "encrypting" ||
                status === "pow" ||
                status === "creating" ||
                status === "uncertain" ||
                Boolean(
                  prepared?.antiAbuseRefreshRequired &&
                  antiAbusePolicy?.turnstileRequired &&
                  !turnstileToken,
                ) ||
                (!prepared && !canSubmit)
              }
            >
              <span>
                {status === "creating"
                  ? copy.submitting
                  : prepared
                    ? copy.retry
                    : copy.submit}
              </span>
              <ArrowRight
                className="button-arrow"
                size={18}
                aria-hidden="true"
              />
            </button>
          </div>
        </form>
      </div>

      <div className="workspace-privacy">
        <strong>{copy.anonymous}</strong>
        <span>{copy.torFootnote}</span>
      </div>
    </section>
  );
}

function ShareLinkRow({
  label,
  value,
  locale,
}: {
  label: string;
  value: string;
  locale: Locale;
}) {
  const copy = useCopy(locale);
  const [copyError, setCopyError] = useState(false);
  return (
    <div className="share-block">
      <div className="share-row">
        <div className="share-content">
          <span className="share-label">{label}</span>
          <code>{value}</code>
        </div>
        <CopyButton
          value={value}
          label={copy.copyLink}
          copiedLabel={copy.linkCopied}
          errorLabel={copy.copyFailed}
          onCopied={() => setCopyError(false)}
          onError={() => setCopyError(true)}
        />
      </div>
      {copyError && (
        <p className="copy-error" role="status">
          {copy.copyFailed}
        </p>
      )}
    </div>
  );
}

export function CreateResult({
  locale,
  result,
  onCreateAnother,
}: {
  locale: Locale;
  result: CreationResult;
  onCreateAnother: () => void;
}) {
  const copy = useCopy(locale);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const expiryText = result.expiresAt
    ? copy.expiryConfirmation(
        new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(result.expiresAt)),
      )
    : copy.neverExpiryConfirmation;
  return (
    <section className="task-panel result-panel" aria-labelledby="result-title">
      <p className="sr-only" role="status" aria-live="polite">
        {copy.resultTitle}
      </p>
      <div className="workspace-main">
        <div className="result-main">
          <div className="workspace-bar">
            <div className="workspace-bar-group">
              <span className="workspace-label">{copy.resultTitle}</span>
              <span className="workspace-divider" aria-hidden="true" />
              <span>{copy.sourceAudit}</span>
            </div>
            <span className="workspace-encryption success-text">
              <span className="status-dot" aria-hidden="true" />
              {copy.readyStatus}
            </span>
          </div>
          <div className="result-content">
            <div className="result-status">
              <div className="success-mark" aria-hidden="true">
                <Check size={20} />
              </div>
              <div>
                <p className="eyebrow">{copy.brandSupporting}</p>
                <h1 id="result-title" ref={headingRef} tabIndex={-1}>
                  {copy.resultTitle}
                </h1>
              </div>
            </div>
            <p className="result-lede">{copy.fragmentWarning}</p>
            <div className="share-stack">
              <ShareLinkRow
                label={copy.clearnetLinkLabel}
                value={result.clearnetLink}
                locale={locale}
              />
              {result.onionLink && (
                <ShareLinkRow
                  label={copy.onionLinkLabel}
                  value={result.onionLink}
                  locale={locale}
                />
              )}
              {result.password && (
                <GeneratedPasswordField
                  locale={locale}
                  value={result.password}
                />
              )}
            </div>
            {result.onionLink && (
              <p className="result-detail">{copy.onionSameNote}</p>
            )}
          </div>
        </div>

        <aside className="workspace-rail result-rail">
          <section className="rail-section result-summary">
            <div className="rail-heading">
              <span className="rail-index">01</span>
              <h2>{copy.statusLabel}</h2>
            </div>
            <dl className="result-details">
              <div>
                <dt>{copy.expiration}</dt>
                <dd>{expiryText}</dd>
              </div>
              <div>
                <dt>{copy.passwordOptional}</dt>
                <dd>
                  {result.password ? copy.passwordRequired : copy.optionalLabel}
                </dd>
              </div>
              <div>
                <dt>{copy.createPlainText}</dt>
                <dd>AES-256-GCM</dd>
              </div>
            </dl>
          </section>
          <section className="rail-section result-caution">
            <div className="rail-heading">
              <span className="rail-index">02</span>
              <h2>{copy.openingWarning}</h2>
            </div>
            <p>{copy.fragmentWarning}</p>
            {result.password && (
              <div className="notice notice-warning">
                <AlertTriangle size={17} aria-hidden="true" />
                <span>
                  {copy.separateChannel} {copy.keepPassword}
                </span>
              </div>
            )}
          </section>
          <div className="rail-action result-actions">
            <button
              className="outline-button"
              type="button"
              onClick={onCreateAnother}
            >
              <RefreshCw size={16} aria-hidden="true" />
              {copy.createAnother}
            </button>
            <a className="text-link" href={result.clearnetLink}>
              {copy.openCreatedNote}
              <ExternalLink size={15} aria-hidden="true" />
            </a>
          </div>
        </aside>
      </div>
      <div className="workspace-privacy">
        <strong>{copy.anonymous}</strong>
        <span>{copy.torFootnote}</span>
      </div>
    </section>
  );
}

export function UnavailableNoteState({
  locale,
  decryptFailure = false,
  invalidLink = false,
}: {
  locale: Locale;
  decryptFailure?: boolean;
  invalidLink?: boolean;
}) {
  const copy = useCopy(locale);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  return (
    <section
      className="task-panel lifecycle-panel unavailable-panel"
      aria-labelledby="unavailable-title"
    >
      <div className="workspace-bar">
        <div className="workspace-bar-group">
          <span className="workspace-label">{copy.noteKicker}</span>
          <span className="workspace-divider" aria-hidden="true" />
          <span>{copy.unavailableTitle}</span>
        </div>
      </div>
      <div className="lifecycle-content unavailable-content">
        <div className="unavailable-icon" aria-hidden="true">
          <Trash2 size={22} />
        </div>
        <h1 id="unavailable-title" ref={headingRef} tabIndex={-1}>
          {invalidLink ? copy.invalidLink : copy.unavailableTitle}
        </h1>
        {!invalidLink && (
          <p>{decryptFailure ? copy.decryptFailure : copy.unavailableBody}</p>
        )}
        <a className="primary-button link-button" href="/">
          <span>{copy.newNote}</span>
          <ArrowRight className="button-arrow" size={18} aria-hidden="true" />
        </a>
      </div>
      <div className="workspace-privacy">
        <strong>{copy.anonymous}</strong>
        <span>{copy.torFootnote}</span>
      </div>
    </section>
  );
}

export function NoteViewer({ locale, text }: { locale: Locale; text: string }) {
  const copy = useCopy(locale);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => headingRef.current?.focus(), []);
  return (
    <section
      className="task-panel lifecycle-panel viewer-panel"
      aria-labelledby="viewer-title"
    >
      <div className="workspace-bar viewer-bar">
        <div className="workspace-bar-group">
          <span className="workspace-label">{copy.viewerTitle}</span>
          <span className="workspace-divider" aria-hidden="true" />
          <span>{copy.createEncryption}</span>
        </div>
        <span className="destroyed-status">
          <Trash2 size={14} aria-hidden="true" />
          {copy.removed}
        </span>
      </div>
      <div className="viewer-content">
        <h1 id="viewer-title" ref={headingRef} tabIndex={-1}>
          {copy.viewerTitle}
        </h1>
        <div className="viewer-banner">
          <Check size={15} aria-hidden="true" />
          {copy.removed}
        </div>
        <div className="note-viewer">{text}</div>
      </div>
      <div className="viewer-actions">
        <CopyButton
          value={text}
          label={copy.copyNote}
          copiedLabel={copy.noteCopied}
          errorLabel={copy.copyFailed}
          onCopied={() => setCopyError(false)}
          onError={() => setCopyError(true)}
        />
        <span className="removed-line">{copy.brandSupporting}</span>
      </div>
      {copyError && (
        <p className="field-error" role="status">
          {copy.copyFailed}
        </p>
      )}
      <div className="workspace-privacy">
        <strong>{copy.anonymous}</strong>
        <span>{copy.torFootnote}</span>
      </div>
    </section>
  );
}

export function OpenNoteGate({ locale }: { locale: Locale }) {
  const copy = useCopy(locale);
  const [state, setState] = useState<
    | "loading"
    | "meta-error"
    | "invalid"
    | "ready"
    | "opening"
    | "wrong"
    | "transport"
    | "unavailable"
    | "viewer"
    | "decrypt-failure"
  >("loading");
  const [password, setPassword] = useState("");
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [errorKey, setErrorKey] = useState<OpenErrorKey | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const error = errorKey ? copy[errorKey] : "";

  async function getMeta(
    id: string,
  ): Promise<
    | { kind: "ready"; requiresPassword: boolean }
    | { kind: "unavailable" }
    | { kind: "retry" }
  > {
    try {
      const response = await fetch(`/api/v1/notes/${id}/meta`, {
        cache: "no-store",
      });
      if (response.status === 404) return { kind: "unavailable" };
      if (!response.ok) return { kind: "retry" };
      const payload = (await response.json()) as { requiresPassword?: unknown };
      return typeof payload.requiresPassword === "boolean"
        ? { kind: "ready", requiresPassword: payload.requiresPassword }
        : { kind: "retry" };
    } catch {
      return { kind: "retry" };
    }
  }

  async function loadMeta(id: string) {
    setState("loading");
    const meta = await getMeta(id);
    if (meta.kind === "ready") {
      setRequiresPassword(meta.requiresPassword);
      setState("ready");
    } else {
      setState(meta.kind === "unavailable" ? "unavailable" : "meta-error");
    }
  }

  useEffect(() => {
    const parsed = parseNoteLocation(
      window.location.pathname,
      window.location.search,
      window.location.hash,
    );
    if (!parsed) {
      setState("invalid");
      return;
    }
    setNoteId(parsed.id);
    setKey(parsed.key);
    void loadMeta(parsed.id);
  }, []);

  useEffect(() => {
    if ((state === "unavailable" || state === "decrypt-failure") && noteId) {
      window.history.replaceState(null, "", `/n/${noteId}`);
      setKey(null);
    }
  }, [state, noteId]);

  useEffect(() => {
    if (state === "ready" || state === "wrong") {
      if (requiresPassword) passwordRef.current?.focus();
      else headingRef.current?.focus();
    }
  }, [state, requiresPassword]);

  async function open(event: React.FormEvent) {
    event.preventDefault();
    if (!noteId || !key) return;
    setErrorKey(null);
    setState("opening");
    let consumed = false;
    try {
      const response = await postOpenNoteAfterCryptoPreflight(noteId, password);
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 429) {
          setState(requiresPassword ? "wrong" : "transport");
          setErrorKey("tooManyAttempts");
          return;
        }
        if (response.status === 503) {
          setState("transport");
          setErrorKey("serviceUnavailable");
          return;
        }
        if (response.status === 404 && requiresPassword) {
          const meta = await getMeta(noteId);
          if (meta.kind === "ready" && meta.requiresPassword) {
            setState("wrong");
            setErrorKey("wrongPassword");
            return;
          }
          if (meta.kind === "retry") {
            setState("transport");
            setErrorKey("serviceUnavailable");
            return;
          }
        }
        setState("unavailable");
        return;
      }
      consumed = true;
      if (
        payload?.protocolVersion !== 1 ||
        payload?.id !== noteId ||
        typeof payload?.iv !== "string" ||
        typeof payload?.ciphertext !== "string"
      ) {
        throw new Error("consumed-invalid-payload");
      }
      const plaintext = await decryptNote(
        noteId,
        key,
        payload.iv,
        payload.ciphertext,
      );
      window.history.replaceState(null, "", `/n/${noteId}`);
      setKey(null);
      setPassword("");
      setNoteText(plaintext);
      setState("viewer");
    } catch (caught) {
      if (consumed) {
        window.history.replaceState(null, "", `/n/${noteId}`);
        setKey(null);
        setPassword("");
        setState("decrypt-failure");
      } else {
        setState("transport");
        setErrorKey(
          caught instanceof Error && caught.message === "crypto-unavailable"
            ? "cryptoUnavailable"
            : "serviceUnavailable",
        );
      }
    }
  }

  if (state === "invalid")
    return <UnavailableNoteState locale={locale} invalidLink />;
  if (state === "unavailable" || state === "decrypt-failure")
    return (
      <UnavailableNoteState
        locale={locale}
        decryptFailure={state === "decrypt-failure"}
      />
    );
  if (state === "viewer") return <NoteViewer locale={locale} text={noteText} />;
  const waiting = state === "loading";
  const headerStatusTone =
    state === "ready"
      ? "success"
      : state === "loading" || state === "opening"
        ? "pending"
        : "danger";
  const headerStatusText =
    state === "loading"
      ? copy.checking
      : state === "opening"
        ? copy.opening
        : headerStatusTone === "danger"
          ? copy.attentionRequired
          : copy.readyBody;
  const passwordLength = passwordCodePointLength(normalizePassword(password));
  const passwordValid =
    !requiresPassword || (passwordLength >= 8 && passwordLength <= 128);
  const passwordLengthInvalid =
    requiresPassword && passwordLength > 0 && !passwordValid;
  const passwordDescription = requiresPassword
    ? ["open-password-requirements", error ? "open-error" : null]
        .filter(Boolean)
        .join(" ")
    : undefined;
  return (
    <section
      className="task-panel lifecycle-panel gate-panel"
      aria-labelledby="gate-title"
    >
      <div className="workspace-bar">
        <div className="workspace-bar-group">
          <span className="workspace-label">{copy.noteKicker}</span>
          <span className="workspace-divider" aria-hidden="true" />
          <span>{copy.brandSupporting}</span>
        </div>
        <span className={`workspace-encryption ${headerStatusTone}`}>
          <span
            className={`status-dot ${headerStatusTone}`}
            aria-hidden="true"
          />
          <span>{headerStatusText}</span>
        </span>
      </div>
      <div className="lifecycle-content gate-content">
        <div className="gate-icon" aria-hidden="true">
          {requiresPassword ? <LockKeyhole size={22} /> : <Eye size={22} />}
        </div>
        <p className="eyebrow">{copy.noteKicker}</p>
        <h1 id="gate-title" ref={headingRef} tabIndex={-1}>
          {copy.readyTitle}
        </h1>
        <p className="gate-warning">
          <AlertTriangle size={17} aria-hidden="true" />
          {copy.openingWarning}
        </p>
        <p className="gate-body">{copy.readyBody}</p>
        {waiting && (
          <div className="notice notice-progress">
            <RefreshCw size={17} className="spin" aria-hidden="true" />
            <span>{copy.checking}</span>
          </div>
        )}
        {state === "meta-error" && (
          <div className="gate-form">
            <ErrorNotice>{copy.serviceUnavailable}</ErrorNotice>
            {noteId && (
              <button
                className="outline-button"
                type="button"
                onClick={() => void loadMeta(noteId)}
              >
                <RefreshCw size={16} aria-hidden="true" />
                {copy.retryOpen}
              </button>
            )}
          </div>
        )}
        {!waiting && state !== "meta-error" && (
          <form className="gate-form" onSubmit={open}>
            {requiresPassword && (
              <>
                <label htmlFor="open-password">{copy.enterPassword}</label>
                <input
                  ref={passwordRef}
                  id="open-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={copy.passwordPlaceholder}
                  aria-invalid={state === "wrong" || passwordLengthInvalid}
                  aria-describedby={passwordDescription}
                />
                <p
                  id="open-password-requirements"
                  className={
                    passwordLengthInvalid ? "field-error" : "field-hint"
                  }
                >
                  {copy.passwordRequirements}
                </p>
              </>
            )}
            {error && (
              <div id="open-error">
                <ErrorNotice>{error}</ErrorNotice>
              </div>
            )}
            <button
              className="primary-button"
              type="submit"
              disabled={state === "opening" || !passwordValid}
            >
              <span>
                {state === "opening"
                  ? copy.opening
                  : state === "transport"
                    ? copy.retryOpen
                    : copy.open}
              </span>
              <ArrowRight
                className="button-arrow"
                size={18}
                aria-hidden="true"
              />
            </button>
          </form>
        )}
      </div>
      <div className="workspace-privacy">
        <strong>{copy.anonymous}</strong>
        <span>{copy.torFootnote}</span>
      </div>
    </section>
  );
}

export function TorLink({
  locale,
  onionUrl,
}: {
  locale: Locale;
  onionUrl?: string;
}) {
  const copy = useCopy(locale);
  if (!onionUrl) return null;
  return (
    <div className="tor-link">
      <div>
        <span className="eyebrow">{copy.torMirror}</span>
        <strong>{copy.torClaim}</strong>
        <p>{copy.torFootnote}</p>
      </div>
      <a
        className="icon-button"
        href={onionUrl}
        target="_blank"
        rel="noreferrer"
        aria-label={copy.torClaim}
        title={copy.torClaim}
      >
        <ExternalLink size={17} aria-hidden="true" />
      </a>
    </div>
  );
}

export function BuildInfoFooter({
  locale,
  publicConfig,
}: {
  locale: Locale;
  publicConfig: PublicRuntimeConfig;
}) {
  const copy = useCopy(locale);
  const { commit, repositoryUrl, onionUrl } = publicConfig;
  const commitIsSafe = /^[a-f0-9]{7,64}$/iu.test(commit);
  const commitLabel = commit.slice(0, 12);
  const commitAccessibleLabel = copy.footerCommit.replace("{hash}", commit);
  return (
    <footer className="site-footer">
      <div className="footer-main">
        <div className="footer-identity">
          <div className="footer-brand">
            <span className="brand-wordmark">
              shredit<span className="brand-dot">.</span>
            </span>
            {repositoryUrl && (
              <span className="footer-version">{copy.sourceAudit}</span>
            )}
          </div>
          <div className="footer-meta">
            <span>{copy.footerLicense}</span>
            {repositoryUrl && commitIsSafe && (
              <>
                <span>·</span>
                <a
                  href={`${repositoryUrl}/commit/${commit}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={commitAccessibleLabel}
                  title={commit}
                >
                  {commitLabel}
                </a>
              </>
            )}
          </div>
        </div>
        <nav className="footer-links" aria-label={copy.footerNavigation}>
          <a href="/privacy">{copy.footerPrivacy}</a>
          <a href="/security">{copy.footerSecurity}</a>
          <a href="/terms">{copy.footerTerms}</a>
          <a href="/abuse">{copy.footerAbuse}</a>
          {onionUrl && (
            <a href={onionUrl} target="_blank" rel="noreferrer">
              {copy.torMirror} <ExternalLink size={14} aria-hidden="true" />
            </a>
          )}
          {repositoryUrl && (
            <a href={repositoryUrl} target="_blank" rel="noreferrer">
              {copy.navSource} <ExternalLink size={14} aria-hidden="true" />
            </a>
          )}
        </nav>
      </div>
    </footer>
  );
}

export function ShreditShell({
  children,
  locale,
  onLocaleChange,
  publicConfig,
}: {
  children: React.ReactNode;
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  publicConfig: PublicRuntimeConfig;
}) {
  const copy = useCopy(locale);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return (
    <div className="site-shell">
      <a className="skip-link" href="#main-content">
        {copy.skipToContent}
      </a>
      <header className="site-header">
        <a href="/" className="brand-lockup">
          <span className="brand-symbol" aria-hidden="true">
            <Trash2 size={17} />
          </span>
          <span className="brand-copy">
            <span className="brand-wordmark">Shredit</span>
            <span className="brand-slogan">/ {copy.brandSlogan}</span>
          </span>
        </a>
        <div className="header-actions">
          {publicConfig.repositoryUrl && (
            <a
              className="header-source"
              href={publicConfig.repositoryUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={copy.navSource}
              title={copy.navSource}
            >
              <span>{copy.navSource}</span>
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          )}
          <ThemeToggle locale={locale} />
          <LanguageMenu locale={locale} onChange={onLocaleChange} />
        </div>
      </header>
      {children}
      <BuildInfoFooter locale={locale} publicConfig={publicConfig} />
    </div>
  );
}
