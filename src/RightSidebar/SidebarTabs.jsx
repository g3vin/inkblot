export default function SidebarTabs({ tab, setTab }) {
  return (
    <div className="sidebar-tabs">
      <button
        className={tab === 'workbench' ? 'active' : ''}
        onClick={() => setTab('workbench')}
      >
        WORKBENCH
      </button>

      <button
        className={tab === 'notes' ? 'active' : ''}
        onClick={() => setTab('notes')}
      >
        NOTES
      </button>

      <button
        className={tab === 'history' ? 'active' : ''}
        onClick={() => setTab('history')}
      >
        HISTORY
      </button>
    </div>
  )
}