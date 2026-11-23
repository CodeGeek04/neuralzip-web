import '../src/style.css';
import { asset } from '../lib/paths';

const title = 'Neuralzip · Lossless neural text compression';
const description = 'Compress text with a tiny neural model. Restore every original byte. Open source, with a playground that runs entirely in your browser.';
const socialImage = {
  url: asset('social/neuralzip-card-v1.png'),
  width: 1200,
  height: 630,
  type: 'image/png',
  alt: 'Neuralzip. Neural compression. Every byte back. Open source and runs in your browser.',
};

export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://neuralzip-web.vercel.app'),
  title,
  description,
  icons: { icon: asset('favicon.svg') },
  openGraph: {
    type: 'website',
    siteName: 'Neuralzip',
    locale: 'en_US',
    title,
    description,
    images: [socialImage],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: [{ url: socialImage.url, alt: socialImage.alt }],
  },
};

export default function RootLayout({ children }) {
  return <html lang="en"><body><a className="skip-link" href="#workspace">Skip to the tool</a>{children}</body></html>;
}
