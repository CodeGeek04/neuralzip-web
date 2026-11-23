import { Header, Footer } from '../components/Chrome';
import Workbench from '../components/Workbench';
import Install from '../components/Install';

export default function Page() {
  return <><Header/><main>
    <section className="intro page-width" aria-labelledby="page-title">
      <h1 id="page-title">Lossless neural text compression.</h1>
      <p className="intro-description">Compress a text file or restore the exact original. Everything runs in your browser.</p>
    </section>
    <Workbench/>
    <Install/>
  </main><Footer/></>;
}
