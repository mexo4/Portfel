This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Production Database

The app uses standard PostgreSQL through `DATABASE_URL`.

For local development, create `portfel-inwestora/.env.local` and add:

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require"
# Optional when the provider uses a private CA chain:
POSTGRES_CA_CERT_PATH="C:\\path\\to\\postgres-ca.pem"
```

On Netlify, add the same `DATABASE_URL` value in Site configuration -> Environment variables for the required deploy contexts. If the provider uses a private CA chain, add `POSTGRES_CA_CERT_BASE64` with the Base64-encoded CA PEM; the application verifies both the certificate and hostname. The app creates required tables automatically on first database access.

## Google OAuth

Create a Google OAuth 2.0 Web application and configure these authorized redirect URIs:

```text
https://mexo.com.pl/api/auth/oauth/google/callback
http://localhost:3000/api/auth/oauth/google/callback
```

Add the following server-side variables locally in `.env.local` and in Vercel for the required environments:

```bash
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

The application requests only `openid`, `email`, and `profile`. Never expose the client secret with a `NEXT_PUBLIC_` prefix.

### Netlify

Google OAuth routes are Next.js server routes, which Netlify runs as Functions. Set both variables in Netlify's site environment variables for the **Production** deploy context with a scope that includes **Functions** (and **Builds** when using scoped variables). Trigger a new production deploy after changing them. Do not define these secrets in `netlify.toml`: Netlify does not expose variables from that file to Functions at runtime.
