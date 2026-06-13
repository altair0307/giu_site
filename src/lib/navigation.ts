export function safeInternalPath(raw: string | null | undefined, fallback = "/") {
  const value = String(raw ?? "").trim();

  if (!value.startsWith("/")) {
    return fallback;
  }

  try {
    const base = new URL("https://internal.invalid");
    const target = new URL(value, base);

    if (target.origin !== base.origin) {
      return fallback;
    }

    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}

export function safeAdminPath(raw: string | null | undefined, fallback = "/admin") {
  const target = safeInternalPath(raw, fallback);
  const pathname = target.split(/[?#]/, 1)[0];

  return pathname === "/admin" || pathname.startsWith("/admin/") ? target : fallback;
}
