export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '');
export const asset = path => `${BASE_PATH}/${path.replace(/^\//, '')}`;
export const VERSION = '0.3.0';
export const WHEEL = `neurzip-${VERSION}-py3-none-any.whl`;
export const SOURCE = `neurzip-${VERSION}.tar.gz`;
export const LIBRARY_REPO = 'https://github.com/CodeGeek04/neurzip';
export const WEBSITE_REPO = 'https://github.com/CodeGeek04/neurzip-web';
