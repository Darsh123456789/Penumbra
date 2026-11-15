import { useEffect, useState } from 'react';
import MissionBoard from './MissionBoard';
import { AILab, Dispersion, PlanB, Rim, Trust } from './Views';

const TABS = [
  ['board', 'Mission Board'], ['cloud', 'Landing cloud'], ['planb', 'Plan B + Why?'],
  ['trust', 'Trust'], ['ai', 'AI Lab'], ['rim', 'Stand on the rim'],
] as const;
type Tab = typeof TABS[number][0];

export default function App() {
  const [tab, setTab] = useState<Tab>(() => (location.hash.slice(1) as Tab) || 'board');
  useEffect(() => { location.hash = tab; window.scrollTo(0, 0); }, [tab]);
  return (<>
    <header className="top">
      <div className="brand">
        <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12" fill="none" stroke="#F5B841" strokeWidth="2" /><path d="M14 2a12 12 0 0 1 0 24z" fill="#F5B841" /></svg>
        <div style={{ display: 'flex', flexDirection: 'column' }}><b>PENUMBRA</b><span className="small mute">Slip-proof lunar landing navigator</span></div>
      </div>
      <nav className="tabs" aria-label="Sections">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} aria-current={tab === k}>{l}</button>)}</nav>
      <span className="mono small mute" style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '6px 10px' }}>NASA LOLA · JPL SPICE DE440 · validated vs JPL Horizons</span>
    </header>
    <main>
      {tab === 'board' && <MissionBoard />}
      {tab === 'cloud' && <Dispersion />}
      {tab === 'planb' && <PlanB />}
      {tab === 'trust' && <Trust />}
      {tab === 'ai' && <AILab />}
      {tab === 'rim' && <Rim />}
    </main>
    <footer>
      PENUMBRA · NASA Space Apps Challenge 2026 · Lunar Landing Site Navigator. Terrain: NASA LRO LOLA (PGDA 78, 90). Ephemeris: NASA/JPL NAIF SPICE DE440, checked against JPL Horizons.
      Lander presets are generic and editable, not models of real spacecraft. Every number on this site is produced by the open-source pipeline at <a href="https://github.com/Darsh123456789/penumbra">github.com/Darsh123456789/penumbra</a>; panels whose results are not finished say so.
    </footer>
  </>);
}
