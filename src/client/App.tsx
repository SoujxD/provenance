import type { ReactElement } from 'react';
import { useStore } from './store';
import { Shell, Toasts, Tour, RoleSwitcher } from './components/shell';
import { TraceDrawer } from './components/trace';
import { Overview } from './views/overview';
import { Findings } from './views/findings';
import { AreaList, AreaPage } from './views/areas';
import { Documents } from './views/documents';
import { Adjustments } from './views/adjustments';
import { Versions, Depreciation, Carryovers, Payments, Prior, Completeness } from './views/records';
import { Timeline, Filing, Notice, Rollforward } from './views/season';
import { People, Admin, Portal } from './views/firm';

export function App() {
  const { view, packet, route, actor } = useStore();
  if (!view || !packet) return <div className="empty" style={{ paddingTop: '30vh' }}>Loading the workpaper…</div>;
  const page = route[0]?.split('?')[0] || 'overview';
  if (view.viewer?.kind === 'client') {
    return (
      <>
        <header className="topbar"><div className="brand"><span className="brand-mark">M</span><span>Miraflores client portal</span></div><span className="spacer" /><RoleSwitcher /></header>
        <Portal />
        <Toasts />
      </>
    );
  }
  const views: Record<string, ReactElement> = {
    overview: <Overview />, findings: <Findings />, areas: route[1] ? <AreaPage id={route[1]} key={route[1]} /> : <AreaList />, documents: <Documents />, adjustments: <Adjustments />,
    versions: <Versions />, depreciation: <Depreciation />, carryovers: <Carryovers />, payments: <Payments />, prior: <Prior />, completeness: <Completeness />,
    timeline: <Timeline />, filing: <Filing />, notice: <Notice />, rollforward: <Rollforward />, people: <People />, admin: <Admin />, portal: <Portal />,
  };
  return (
    <>
      <Shell>{views[page] ?? <Overview />}</Shell>
      <TraceDrawer />
      <Toasts />
      <Tour key={actor === 'st-04' ? 'm' : 'x'} />
    </>
  );
}
