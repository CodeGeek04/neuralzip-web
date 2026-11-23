import '../src/style.css';
import { asset } from '../lib/paths';

export const metadata = {
  title: 'Neuralzip · Fold your text. Keep every byte.',
  description: 'Model-based, lossless text compression. Train a tiny model, download one archive and restore every original byte. Files stay on your device.',
  icons: { icon: asset('favicon.svg') },
  openGraph: { title: 'Neuralzip', description: 'Your text, packed into a model. Every byte comes back.' },
};

export default function RootLayout({ children }) {
  return <html lang="en"><body><a className="skip-link" href="#workspace">Skip to the tool</a>{children}</body></html>;
}
