export type SecurityHeader = { key: string; value: string };

export const getSecurityHeaders = (isProduction: boolean): SecurityHeader[] => {
  const headers: SecurityHeader[] = [
    { key: "Content-Security-Policy-Report-Only", value: [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self' https://accounts.google.com",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
      "style-src 'self' 'unsafe-inline' https:",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https:",
      "connect-src 'self' https: wss:",
      "frame-src 'self' https://accounts.google.com https:",
    ].join("; ") },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ];
  if (isProduction) headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000" });
  return headers;
};
