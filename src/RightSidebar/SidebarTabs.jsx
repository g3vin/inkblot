import SFIcon from '../SFIcon'

export default function SidebarTabs({ tab, setTab }) {
  return (
    <div className="sidebar-tabs">
      <button
        className={tab === 'search' ? 'active' : ''}
        onClick={() => setTab('search')}
        aria-label="Search"
        title="Search"
      >
        <SFIcon name="magnifyingglass.circle" filled={tab === 'search'} />
      </button>

      <button
        className={tab === 'clipboard' ? 'active' : ''}
        onClick={() => setTab('clipboard')}
        aria-label="Clipboard"
        title="Clipboard"
      >
        <SFIcon name="doc.on.clipboard" filled={tab === 'clipboard'} />
      </button>

      <button
        className={tab === 'workbench' ? 'active' : ''}
        onClick={() => setTab('workbench')}
        aria-label="Workbench"
        title="Workbench"
      >
        <SFIcon name="hammer" filled={tab === 'workbench'} />
      </button>

      <button
        className={tab === 'notes' ? 'active' : ''}
        onClick={() => setTab('notes')}
        aria-label="Notes"
        title="Notes"
      >
        <SFIcon name="doc.text" filled={tab === 'notes'} />
      </button>

      <button
        className={tab === 'history' ? 'active' : ''}
        onClick={() => setTab('history')}
        aria-label="History"
        title="History"
      >
        <SFIcon name="clock" filled={tab === 'history'} />
      </button>
    </div>
  )
}
