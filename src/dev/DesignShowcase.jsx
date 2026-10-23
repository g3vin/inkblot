/**
 * DesignShowcase.jsx — every token and primitive on one page. Dev only.
 *
 * Open the dev server with `?design` (http://localhost:5173/?design). Use it to check a
 * change to src/styles or src/ui in both themes before it ships, and as the visual
 * companion to docs/DESIGN.md.
 */
import { useMemo, useRef, useState } from 'react'
import { ACCENT_PRESETS, INKS, TRAY_INKS, inkVar } from '../lib/palette'
import { setAccentAttribute, setThemeAttribute, setTrayAttribute } from '../lib/theme'
import { useCommands } from '../lib/commands'
import {
  AppIcon, Mark, Wordmark,
  Breadcrumb, Button, Card, Checkbox, CommandPalette, Dialog, EmptyState, FadeScrim, Field, FloatingActionButton,
  FloatingCapsule, FloatingToolbar, FormRow, Icon, IconButton, Inlay, InlaySlot, InkPicker, InkWheel, Input, Kbd, Menu, MenuItem,
  MenuLabel, MenuSeparator, MoreMenu, Panel, PanelActions, PanelBody, PanelHeader, Popover, ScopeMenu, Section, Segmented, popUpMenu,
  SelectMenu, Stepper, Tabs, Tag, TextArea, Toggle, ToolbarSeparator,
} from '../ui'
import NavSheet from '../ui/NavSheet.jsx'
import { ToolbarDockContext } from '../ui/layer'
import { ICONS } from '../ui/icons'
import '../components/search/ProjectSearch.css'
import '../components/Toolbar.css'
import '../components/toolbar/Toolbar.customize.css'
import './DesignShowcase.css'

const SURFACES = ['--app-bg', '--surface-1', '--surface-2', '--surface-float', '--surface-sunken']
const TEXTS = ['--text-primary', '--text-secondary', '--text-muted', '--text-subtle', '--text-placeholder']
const SPACES = ['--space-1', '--space-2', '--space-3', '--space-4', '--space-6', '--space-8', '--space-12']
const RADII = ['--radius-sm', '--radius-md', '--radius-lg', '--radius-pill']

/** The dynamic toolbar (DESIGN.md §6): a choice opens in place, a form takes the toolbar. */
function DockDemo() {
  const [whole, setWhole] = useState(null)
  const rowRef = useRef(null)
  const colourRef = useRef(null)
  const voiceRef = useRef(null)
  const [open, setOpen] = useState(null)
  const dock = useMemo(() => (whole ? {
    whole,
    owns: (anchor) => Boolean(rowRef.current?.contains(anchor)),
    inlineFor: (anchor) => anchor.closest('.tb-slot')?.querySelector(':scope > .tb-dock-inline') ?? null,
    watch: () => () => {},
  } : null), [whole])
  const toggle = (which) => setOpen((was) => (was === which ? null : which))
  return (
    <ToolbarDockContext.Provider value={dock}>
      <div ref={setWhole} className="toolbar-wrapper ds-dock-demo">
        <div ref={rowRef} className="toolbar tb-row">
          <div className="tb-slot">
            <div className="toolbar-group">
              <button ref={colourRef} type="button" aria-label="Card colour" onClick={() => toggle('colour')}><Icon name="palette" /></button>
            </div>
            <div className="tb-dock-inline" />
          </div>
          <div className="tb-slot">
            <div className="toolbar-group">
              <button ref={voiceRef} type="button" aria-label="Read aloud" onClick={() => toggle('voice')}><Icon name="read-aloud" /></button>
            </div>
            <div className="tb-dock-inline" />
          </div>
        </div>
        <Popover open={open === 'colour'} anchorRef={colourRef} onClose={() => setOpen(null)} eyebrow="Card colour">
          <InkPicker label="Card colour" value={null} inks={['red', 'blue', 'green']} onChange={() => setOpen(null)} />
        </Popover>
        <Popover open={open === 'voice'} anchorRef={voiceRef} onClose={() => setOpen(null)} eyebrow="Read aloud">
          <Field label="Voice"><SelectMenu label="Voice" value="heart" onChange={() => {}} options={[{ value: 'heart', label: 'Heart' }, { value: 'river', label: 'River' }]} /></Field>
          <Button variant="filled">Read</Button>
        </Popover>
      </div>
    </ToolbarDockContext.Provider>
  )
}

function ShowcaseSection({ title, children }) {
  return (
    <section className="ds-section">
      <h2 className="ib-eyebrow ds-section-title">{title}</h2>
      {children}
    </section>
  )
}

export default function DesignShowcase() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || 'dark')
  const [accent, setAccent] = useState(document.documentElement.dataset.accent || 'blue')
  const [tray, setTray] = useState(document.documentElement.dataset.tray || 'blue')
  const [ink, setInk] = useState('amber')
  const [fill, setFill] = useState(null)
  const [pinColor, setPinColor] = useState(null)
  const [segment, setSegment] = useState('prose')
  const [dsScope, setDsScope] = useState('document')
  const [dsView, setDsView] = useState('today')
  const [navSheet, setNavSheet] = useState(false)
  const [navPage, setNavPage] = useState('a')
  const [trim, setTrim] = useState('6x9')
  const [size, setSize] = useState(12)
  const [tab, setTab] = useState('notes')
  const [check, setCheck] = useState(true)
  const [on, setOn] = useState(false)
  const [dialog, setDialog] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [menu, setMenu] = useState(false)
  const [popover, setPopover] = useState(false)
  const [panel, setPanel] = useState(true)
  const [inlaid, setInlaid] = useState('inlay')
  const menuRef = useRef(null)
  const popRef = useRef(null)

  useCommands(() => [
    { id: 'ds.dialog', section: 'Showcase', title: 'Open a dialog', icon: 'info', run: () => setDialog(true) },
    { id: 'ds.sheet', section: 'Showcase', title: 'Open a medium dialog', icon: 'sidebar', run: () => setSheet(true) },
    { id: 'ds.theme', section: 'View', title: 'Toggle theme', icon: 'moon', shortcut: '⌘⇧L', run: () => switchTheme(theme === 'dark' ? 'light' : 'dark') },
  ], [theme])

  const switchTheme = (next) => { setThemeAttribute(next); setTheme(next) }
  const switchAccent = (next) => { setAccentAttribute(next); setAccent(next) }
  const switchTray = (next) => { setTrayAttribute(next); setTray(next) }

  return (
    <div className="ds">
      <header className="ds-topbar">
        <FadeScrim height={64} />
        <div className="ds-topbar-inner">
          <span className="ds-wordmark"><Wordmark height={26} /></span>
          <span className="ib-meta">design language · v1</span>
          <span className="ds-spacer" />
          <Segmented label="Theme" value={theme} onChange={switchTheme}
            options={[{ value: 'light', label: 'Paper' }, { value: 'dark', label: 'Ink' }]} />
          <Button onClick={() => window.dispatchEvent(new CustomEvent('inkblot:command-palette'))}>
            Commands <Kbd>⌘K</Kbd>
          </Button>
          <IconButton icon="sidebar" label={panel ? 'Hide panel' : 'Show panel'} aria-pressed={panel} filled={panel} onClick={() => setPanel(!panel)} />
        </div>
      </header>

      <main className="ds-main">
        <div className="ds-doc ib-prose">
          <p className="ib-eyebrow">Chapter one</p>
          <h1 className="ds-doc-title">The document is the room</h1>
          <p>
            The page fills the window. Tools float above it, and step aside when they are not
            wanted. Scroll this text up under the bar at the top and watch it dissolve rather
            than hit a line: that is the fade scrim, and it is the one pattern every piece of
            chrome that sits over the document uses.
          </p>
          <p>
            Literata carries the writer&rsquo;s words; Inter carries the tools; Courier Prime is kept
            for small typewritten marks &mdash; an eyebrow, a word count, a date &mdash; the studio&rsquo;s
            signature, never its voice.
          </p>
        </div>

        <ShowcaseSection title="Brand · mark, wordmark, app icon">
          <div className="ds-row ds-brand">
            <div className="ds-brand-tile"><Mark size={96} /></div>
            <div className="ds-brand-tile"><Wordmark height={44} /></div>
            <AppIcon size={96} />
            <AppIcon size={32} />
            <AppIcon size={16} />
          </div>
        </ShowcaseSection>

        <ShowcaseSection title="Colour · ink palette">
          <div className="ds-swatches">
            {INKS.map((entry) => (
              <div key={entry.id} className="ds-swatch">
                <span className="ds-chip" style={{ background: inkVar(entry.id) }} />
                <span className="ds-swatch-name">{entry.label}</span>
                <code className="ib-meta">--ink-{entry.id}</code>
              </div>
            ))}
          </div>
        </ShowcaseSection>

        <ShowcaseSection title="Colour · surfaces & text">
          <div className="ds-swatches">
            {SURFACES.map((token) => (
              <div key={token} className="ds-swatch">
                <span className="ds-chip ds-chip--outlined" style={{ background: `var(${token})` }} />
                <code className="ib-meta">{token}</code>
              </div>
            ))}
          </div>
          <div className="ds-texts">
            {TEXTS.map((token) => (
              <p key={token} style={{ color: `var(${token})` }}>The quick brown fox <code className="ib-meta">{token}</code></p>
            ))}
          </div>
        </ShowcaseSection>

        <ShowcaseSection title="Accent">
          <InkPicker label="Accent" value={accent} onChange={switchAccent} inks={ACCENT_PRESETS.map((p) => p.id)} showLabels />
        </ShowcaseSection>

        <ShowcaseSection title="Window (tray)">
          <InkPicker label="Window colour" value={tray} onChange={switchTray} inks={TRAY_INKS} showLabels />
          {/* The tray with a docked sidebar's text on it, the document card, and a sidebar
              hovering over the card, veiled. */}
          <div className="ds-tray ib-tray">
            <div className="ds-tray-dock">
              <p className="ib-eyebrow">Docked</p>
              <p style={{ color: 'var(--text-muted)' }}>Muted text on the tray</p>
            </div>
            <div className="ds-tray-card">
              <p className="ib-meta">The document card</p>
            </div>
            <div className="ds-tray-veil ib-tray is-veiled">
              <p className="ib-eyebrow">Hovering</p>
            </div>
          </div>
        </ShowcaseSection>

        <ShowcaseSection title="Typography">
          <p className="ib-display">Display — Inter 26</p>
          <p className="ib-title">Title — Inter 16 semibold</p>
          <p className="ib-body">Body — Inter 13. Plain, warm and short: “Add a note”, not “Create annotation”.</p>
          <p className="ib-hint">Hint — Inter 11, muted. Explains what a setting does.</p>
          <p className="ib-eyebrow">Eyebrow — Inter 11 bold caps</p>
          <p className="ib-meta">1,204 words · 6 min read · Saved 5:32 PM</p>
          <p className="ib-prose ds-prose-sample">Prose — Literata. It was a bright cold day in April, and the clocks were striking thirteen.</p>
        </ShowcaseSection>

        <ShowcaseSection title="Buttons">
          <div className="ds-row">
            <Button variant="filled">New document</Button>
            <Button variant="tinted">Tinted</Button>
            <Button>Plain</Button>
            <Button variant="destructive">Delete</Button>
            <Button disabled>Disabled</Button>
            <Button variant="filled" size="toolbar">Toolbar size</Button>
          </div>
          <div className="ds-row">
            <IconButton icon="bold" label="Bold" />
            <IconButton icon="italic" label="Italic" aria-pressed filled />
            <IconButton icon="note" label="Add note" display="iconAndLabel" />
            <IconButton icon="more" label="More" size="circle" />
          </div>
        </ShowcaseSection>

        <ShowcaseSection title="Form controls">
          <div className="ds-grid">
            <Field label="Title" hint="Shown on the title page." htmlFor="ds-title">
              <Input id="ds-title" placeholder="Untitled" />
            </Field>
            <Field label="Search" htmlFor="ds-search">
              <Input id="ds-search" icon="search" placeholder="Search the project" />
            </Field>

            <Field label="Note" htmlFor="ds-note" error="Notes can’t be empty.">
              <TextArea id="ds-note" placeholder="Write a note…" />
            </Field>
          </div>
          <div className="ds-row">
            <Breadcrumb label="Where this map is" onSelect={() => {}} items={[
              { id: 'group', label: 'Local Group' },
              { id: 'galaxy', label: 'Milky Way' },
              { id: 'system', label: 'Sol', icon: 'orbit' },
              { id: 'world', label: 'Earth', icon: 'world' },
            ]} />
          </div>
          <div className="ds-row">
            <Checkbox label="Number chapters" checked={check} onChange={setCheck} />
            <Segmented label="Format" value={segment} onChange={setSegment}
              options={[{ value: 'prose', label: 'Prose' }, { value: 'screenplay', label: 'Screenplay' }, { value: 'stage', label: 'Stage play' }]} />
          </div>
          <div className="ds-inspector">
            <Section id="ds-section" title="Page">
              <FormRow label="Trim size">
                <SelectMenu label="Trim size" value={trim} onChange={setTrim} options={[{ value: '6x9', label: '6 × 9 in (trade)' }, { value: 'a5', label: 'A5' }]} />
              </FormRow>
              <FormRow label="Font size"><Stepper label="Font size" value={size} onChange={setSize} min={8} max={24} unit="pt" /></FormRow>
              <FormRow label="Typewriter scrolling"><Toggle label="Typewriter scrolling" checked={on} onChange={setOn} /></FormRow>
            </Section>
          </div>
        </ShowcaseSection>

        <ShowcaseSection title="Ink wheel">
          {/* Press a dot: the inks bloom round it. Swipe the middle dot onto one to swap,
              let go to take it; swipe back to undo. */}
          <div className="ds-row">
            <InkWheel label="Note colour" value={ink} onChange={setInk} />
            <InkWheel
              label="Cell fill"
              value={fill}
              none={{ label: 'No fill' }}
              onChange={setFill}
              as={IconButton}
              triggerProps={{ icon: 'cell-fill', label: 'Cell fill', filled: Boolean(fill) }}
            />
            <InkWheel label="Pin colour" value={pinColor} none={{ label: 'Default', color: inkVar('rust') }} onChange={setPinColor} />
          </div>
        </ShowcaseSection>

        <ShowcaseSection title="Menus, popovers, dialogs">
          <div className="ds-row">
            <Button ref={menuRef} variant="tinted" onClick={() => setMenu(!menu)}>More <Icon name="chevron-down" /></Button>
            <Menu open={menu} onClose={() => setMenu(false)} anchorRef={menuRef} label="More">
              <MenuLabel>Note</MenuLabel>
              <MenuItem icon="pin" shortcut="⌘P">Pin note</MenuItem>
              <MenuItem icon="copy">Duplicate</MenuItem>
              <MenuItem checked>Show in margin</MenuItem>
              <MenuSeparator />
              <MenuItem icon="delete" danger>Delete note</MenuItem>
            </Menu>
            <Button ref={popRef} variant="tinted" onClick={() => setPopover(!popover)}><Icon name="palette" /> Folder colour</Button>
            <Popover open={popover} onClose={() => setPopover(false)} anchorRef={popRef} eyebrow="Folder colour" aria-label="Folder colour">
              <InkPicker label="Folder colour" value={ink} onChange={setInk} />
            </Popover>
            <Button variant="tinted" onClick={(event) => popUpMenu(event, [
              { text: 'Sort', items: [{ text: 'By name', checked: true }, { text: 'By date', checked: false }] },
              { separator: true },
              { text: 'New folder…', accelerator: 'CmdOrCtrl+Shift+N' },
            ])}>A button’s menu <Icon name="chevron-down" /></Button>
            <Button variant="tinted" onClick={() => setDialog(true)}>Open a small decision</Button>
            <Button variant="tinted" onClick={() => setSheet(true)}>Open a medium dialog</Button>
          </div>
        </ShowcaseSection>

        <ShowcaseSection title="Cards, tags, empty state">
          <div className="ds-grid">
            {['amber', 'blue', 'green'].map((id) => (
              <Card key={id} ink={id} interactive>
                <p className="ib-meta">Note · 5:32 PM</p>
                <p className="ib-prose ds-card-text">“Is this too on the nose?”</p>
                <Tag ink={id}>{id}</Tag>
              </Card>
            ))}
            <Card>
              <EmptyState icon="note" title="No notes yet." hint="Select some text and press ⌥⌘N to leave yourself a note." />
            </Card>
          </div>
        </ShowcaseSection>

        <ShowcaseSection title="Tabs">
          <Tabs label="Inspector" value={tab} onChange={setTab}
            tabs={[{ value: 'notes', label: 'Notes', icon: 'note' }, { value: 'history', label: 'History', icon: 'history' }, { value: 'workbench', label: 'Workbench', icon: 'hammer' }]} />
        </ShowcaseSection>

        <ShowcaseSection title="The dynamic toolbar">
          <DockDemo />
        </ShowcaseSection>

        <ShowcaseSection title="Floating chrome (glass on iOS)">
          <div className="ds-row ds-floating-demo">
            {/* A strip of buttons is --size-toolbar; a readout --size-circle (DESIGN.md §7). */}
            <FloatingToolbar label="Formatting">
              <IconButton icon="bold" label="Bold" size="capsule" />
              <IconButton icon="italic" label="Italic" size="capsule" />
              <IconButton icon="underline" label="Underline" size="capsule" />
              <ToolbarSeparator />
              <IconButton icon="note" label="Add note" size="capsule" />
              <IconButton icon="more" label="More" size="capsule" />
            </FloatingToolbar>
            <FloatingActionButton icon="add" label="New note" />
            <FloatingCapsule><span className="ib-meta">1,204 words</span></FloatingCapsule>
          </div>
        </ShowcaseSection>

        <ShowcaseSection title="Inspector panel · on the tray">
          {/* The panel anatomy (DESIGN.md §6): the eyebrow with the scope and ⋯ beside it,
              at most one view switch, then sections straight on the tray. Nothing in a
              band or a box; the selected row is lifted onto paper. */}
          <div className="ds-inspector ib-tray ib-sheet">
            <div className="ds-inspector-head">
              <span className="ib-eyebrow">Stats</span>
              <PanelActions>
                <ScopeMenu label="Count" value={dsScope} onChange={setDsScope} options={[{ value: 'document', label: 'This document' }, { value: 'project', label: 'This project', hint: 'Novel' }, { value: 'all', label: 'Everything' }]} />
                <MoreMenu label="More stats options"><MenuItem icon="target">Goals…</MenuItem><MenuItem icon="timer">Timer routines…</MenuItem></MoreMenu>
              </PanelActions>
            </div>
            <Segmented label="Show" value={dsView} onChange={setDsView} stretch options={[{ value: 'today', label: 'Today' }, { value: 'history', label: 'History' }, { value: 'insights', label: 'Insights' }]} />
            <Section id="ds-inspector-attach" title="Attach the selection" help="timeline.attach" accessory={<Button variant="tinted">Attach</Button>}>
              <FormRow label="To"><SelectMenu label="Event" value="new" onChange={() => {}} options={[{ value: 'new', label: 'A new event' }]} /></FormRow>
              <FormRow label="Number documents in the file tree"><Toggle label="Number documents" checked onChange={() => {}} /></FormRow>
              <FormRow label="Subtitle" stacked><Input placeholder="In which…" /></FormRow>
              <Button>Choose a front…</Button>
            </Section>
            <Section id="ds-inspector-empty" title="This session">
              <EmptyState compact title="No session yet." hint="Start typing to begin one." />
            </Section>
            <div className="ds-inspector-rows">
              <div className="ds-lifted">Chapter one</div>
              <div>Chapter two</div>
            </div>
          </div>
          <Button onClick={() => setNavSheet(true)}>Open a NavSheet (Settings, Help)</Button>
        </ShowcaseSection>

        <ShowcaseSection title="Inlay · bare on a panel">
          <div className="ds-inlay-sheet ib-sheet">
            {[['At rest', ''], ['Focused (the glyph inked)', 'ds-inked'], ['Lifted out (hidden in place)', 'ds-lifted']].map(([caption, state]) => (
              <div key={caption} className="ds-inlay-state">
                <InlaySlot className="ds-panel-footer">
                  <Inlay round><IconButton icon="add" label="Add note" size="circle" /></Inlay>
                  <Inlay className={['ds-filter', state].filter(Boolean).join(' ')}>
                    <Icon name="filter" /><input aria-label="Filter notes" placeholder="Filter" tabIndex={-1} />
                  </Inlay>
                </InlaySlot>
                <p className="ib-meta">{caption}</p>
              </div>
            ))}
          </div>
        </ShowcaseSection>

        <ShowcaseSection title="Project search · the left sidebar's foot">
          <div className="ds-search">
            <div className="project-search-card">
              <label className="project-search-field">
                <Icon name="search" size={20} className="project-search-field-icon" />
                <input className="project-search-input" aria-label="Search" defaultValue="ferry" tabIndex={-1} />
                <IconButton icon="close" label="Clear search" size="capsule" className="project-search-clear" />
              </label>
              <div className="project-search-body">
                {[
                  ['In this document', [['text-cursor', 'The ferry left at dawn.', null]]],
                  ['Documents', [['document', 'Ferry crossing', null], ['canvas', 'Plot', 'ferry to the island']]],
                  ['Notes', [['note', 'ferry', 'Check the ferry timetable']]],
                ].map(([title, rows], sectionIndex) => (
                  <div key={title} className="project-search-section">
                    <div className="project-search-section-title"><span className="ib-eyebrow">{title}</span></div>
                    {rows.map(([icon, label, preview], rowIndex) => (
                      <div key={label} className={`project-search-row${sectionIndex === 1 && rowIndex === 0 ? ' is-selected' : ''}`}>
                        <Icon name={icon} size={20} className="project-search-row-icon" />
                        <span className="project-search-row-text">
                          <span className="project-search-row-title">{label}</span>
                          {preview ? <span className="project-search-row-preview">{preview}</span> : null}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div className="ds-inlay-sheet ib-sheet">
              <InlaySlot className="ds-search-foot">
                <Inlay round><IconButton icon="add" label="New…" size="circle" /></Inlay>
                <Inlay round><IconButton icon="search" label="Search" size="circle" /></Inlay>
              </InlaySlot>
              <p className="ib-meta">The foot: + outside, search inside</p>
            </div>
          </div>
        </ShowcaseSection>

        <ShowcaseSection title="Icons · Phosphor Light / Fill">
          <div className="ds-icons">
            {Object.keys(ICONS).sort().map((name) => (
              <div key={name} className="ds-icon" title={name}>
                <Icon name={name} size={20} />
                <span className="ib-meta">{name}</span>
              </div>
            ))}
          </div>
        </ShowcaseSection>

        <ShowcaseSection title="Space & radius">
          <div className="ds-row ds-align-end">
            {SPACES.map((token) => (
              <div key={token} className="ds-space">
                <span style={{ width: `var(${token})`, height: `var(${token})` }} />
                <code className="ib-meta">{token}</code>
              </div>
            ))}
          </div>
          <div className="ds-row">
            {RADII.map((token) => (
              <div key={token} className="ds-radius" style={{ borderRadius: `var(${token})` }}>
                <code className="ib-meta">{token}</code>
              </div>
            ))}
          </div>
        </ShowcaseSection>
      </main>

      <Panel open={panel} label="Inspector" width={280} style={{ top: 60 }}>
        <PanelHeader title="Notes" actions={<><IconButton icon="add" label="Add note" size="circle" /><IconButton icon="close" label="Hide panel" size="circle" onClick={() => setPanel(false)} /></>} />
        <PanelBody>
          <Card ink="amber"><p className="ib-meta">Chapter one</p><p className="ib-prose ds-card-text">Tools float; the page stays.</p></Card>
          <EmptyState icon="history" title="No versions yet." hint="Name a version to keep it forever." />
          <Segmented label="Panel controls" value={inlaid} onChange={setInlaid}
            options={[{ value: 'inlay', label: 'Inlaid' }, { value: 'capsule', label: 'Floating' }]} />
        </PanelBody>
        {inlaid === 'inlay' ? (
          <InlaySlot className="ds-panel-footer">
            <Inlay round><IconButton icon="add" label="Add note" size="circle" /></Inlay>
            <Inlay className="ds-filter"><Icon name="filter" /><input aria-label="Filter notes" placeholder="Filter" /></Inlay>
          </InlaySlot>
        ) : (
          <div className="ds-panel-footer">
            <IconButton icon="add" label="Add note" size="circle" className="floating-capsule" />
            <div className="ds-filter floating-capsule"><Icon name="filter" /><input aria-label="Filter notes" placeholder="Filter" /></div>
          </div>
        )}
      </Panel>

      {/* A small dialog: its two footer buttons share the width, and Cancel is its way out. */}
      <Dialog open={dialog} onClose={() => setDialog(false)} size="small" eyebrow="Document" title="Delete this chapter?"
        description="It moves to the archive, where you can restore it for 30 days."
        footer={<><Button onClick={() => setDialog(false)}>Cancel</Button><Button variant="destructive" onClick={() => setDialog(false)}>Delete</Button></>}>
        <Checkbox label="Also delete its notes" checked={check} onChange={setCheck} />
      </Dialog>
      {/* A medium dialog with a leading utility; Done closes it, so no ×. */}
      <Dialog open={sheet} onClose={() => setSheet(false)} size="medium" eyebrow="Typeset" title="Page setup"
        footer={<><Button>Restore defaults</Button><span className="ib-dialog-footer-spacer" /><Button variant="filled" onClick={() => setSheet(false)}>Done</Button></>}>
        <FormRow label="Trim size">
          <SelectMenu label="Trim size" value={trim} onChange={setTrim} options={[{ value: '6x9', label: '6 × 9 in' }, { value: 'a5', label: 'A5' }]} />
        </FormRow>
      </Dialog>
      {navSheet ? (
        <NavSheet title="Help" items={[{ id: 'a', title: 'Using help', group: 'Getting around' }, { id: 'b', title: 'Sidebars', group: 'Getting around' }, { id: 'c', title: 'Accent colour', group: 'Settings' }]} value={navPage} onChange={setNavPage} onClose={() => setNavSheet(false)}>
          <p className="ib-eyebrow">A page</p>
          <h3 className="ib-title">The page that is chosen on the left</h3>
        </NavSheet>
      ) : null}
      <CommandPalette />
    </div>
  )
}
