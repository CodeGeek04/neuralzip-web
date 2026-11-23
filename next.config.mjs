const rawBase = process.env.NEXT_PUBLIC_BASE_PATH || '';
const basePath = rawBase ? '/' + rawBase.replace(/^\/+|\/+$/g, '') : '';

export default {
  output: 'export',
  trailingSlash: true,
  basePath,
  images: { unoptimized: true },
  poweredByHeader: false,
};
