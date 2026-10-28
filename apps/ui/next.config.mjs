/** @type {import('next').NextConfig} */
if (process.env.NEXT_PUBLIC_APP_TOKEN) {
  throw new Error(
    'SECURITY VIOLATION: NEXT_PUBLIC_APP_TOKEN must never be set in environment. ' +
    'The master APP_TOKEN is a server-side/OS-protected secret and must never be exposed to browser JavaScript.'
  );
}
delete process.env.NEXT_PUBLIC_APP_TOKEN;

const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true
};

export default nextConfig;
