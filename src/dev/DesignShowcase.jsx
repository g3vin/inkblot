/**
 * DesignShowcase.jsx — every token and primitive on one page. Dev only.
 *
 * Open the dev server with `?design` (http://localhost:5173/?design). Use it to check a
 * change to src/styles or src/ui in both themes before it ships, and as the visual
 * companion to docs/DESIGN.md.
 */
import { useRef, useState } from 'react'
import { ACCENT_PRESETS, INKS, inkVar } from '../lib/palette'
import { applyAccentAttribute, applyThemeAttribute } from '../lib/theme'
import { useCommands } from '../lib/commands'
import {
  Button, Card, Checkbox, CommandPalette, Dialog, EmptyState, FadeScrim, Field, FloatingActionButton,
  FloatingToolbar, Icon, IconButton, InkPicker, Input, Kbd, Menu, MenuItem, MenuLabel, MenuSeparator,
  Panel, PanelBody, PanelHeader, Popover, SegmentedControl, Select, Sheet, Switch, Tabs, Tag, TextArea,
  ToolbarSeparator,
} from '../ui'
import { ICONS } from '../ui/icons'
import './DesignShowcase.css'

const SURFACES = ['--app-bg', '--surface-1', '--surface-2', '--surface-float', '--surface-sunken']
const TEXTS = ['--text-primary', '--text-secondary', '--text-muted', '--text-subtle', '--text-placeholder']
const SPACES = ['--space-1', '--space-2', '--space-3', '--space-4', '--space-6', '--space-8', '--space-12']
const RADII = ['--radius-sm', '--radius-md', '--radius-lg', '--radius-pill']

function Section({ title, children }) {
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
  const [ink, setInk] = useState('amber')
  const [segment, setSegment] = useState('prose')
  const [tab, setTab] = useState('notes')
  const [check, setCheck] = useState(true)
  const [on, setOn] = useState(false)
  const [dialog, setDialog] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [menu, setMenu] = useState(false)
  const [popover, setPopover] = useState(false)
  const [panel, setPanel] = useState(true)
  const menuRef = useRef(null)
  const popRef = useRef(null)

  useCommands(() => [
    { id: 'ds.dialog', section: 'Showcase', title: 'Open a dialog', icon: 'info', run: () => setDialog(true) },
    { id: 'ds.sheet', section: 'Showcase', title: 'Open a sheet', icon: 'sidebar', run: () => setSheet(true) },
    { id: 'ds.theme', section: 'View', title: 'Toggle theme', icon: 'moon', shortcut: '⌘⇧L', run: () => switchTheme(theme === 'dark' ? 'light' : 'dark') },
  ], [theme])

  const switchTheme = (next) => { applyThemeAttribute(next); setTheme(next) }
  const switchAccent = (next) => { applyAccentAttribute(next); setAccent(next) }

  return (
    <div className="ds">
      <header className="ds-topbar">
        <FadeScrim height={64} />
        <div className="ds-topbar-inner">
          <span className="ds-wordmark">inkblot</span>
          <span className="ib-meta">design language · v1</span>
          <span className="ds-spacer" />
          <SegmentedControl size="sm" label="Theme" value={theme} onChange={switchTheme}
            options={[{ value: 'light', label: 'Paper', icon: 'sun' }, { value: 'dark', label: 'Ink', icon: 'moon' }]} />
          <Button size="sm" variant="ghost" icon="command" onClick={() => window.dispatchEvent(new CustomEvent('inkblot:command-palette'))}>
            Commands <Kbd>⌘K</Kbd>
          </Button>
          <IconButton icon="sidebar" label={panel ? 'Hide panel' : 'Show panel'} active={panel} onClick={() => setPanel(!panel)} />
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

        <Section title="Colour · ink palette">
          <div className="ds-swatches">
            {INKS.map((entry) => (
              <div key={entry.id} className="ds-swatch">
                <span className="ds-chip" style={{ background: inkVar(entry.id) }} />
                <span className="ds-swatch-name">{entry.label}</span>
                <code className="ib-meta">--ink-{entry.id}</code>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Colour · surfaces & text">
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
        </Section>

        <Section title="Accent">
          <InkPicker label="Accent" value={accent} onChange={switchAccent} inks={ACCENT_PRESETS.map((p) => p.id)} showLabels />
        </Section>

        <Section title="Typography">
          <p className="ib-display">Display — Inter 26</p>
          <p className="ib-title">Title — Inter 16 semibold</p>
          <p className="ib-body">Body — Inter 13. Plain, warm and short: “Add a note”, not “Create annotation”.</p>
          <p className="ib-hint">Hint — Inter 11, muted. Explains what a setting does.</p>
          <p className="ib-eyebrow">Eyebrow — Courier Prime 11 caps</p>
          <p className="ib-meta">1,204 words · 6 min read · Saved 5:32 PM</p>
          <p className="ib-prose ds-prose-sample">Prose — Literata. It was a bright cold day in April, and the clocks were striking thirteen.</p>
        </Section>

        <Section title="Buttons">
          <div className="ds-row">
            <Button variant="primary" icon="add">New document</Button>
            <Button>Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger" icon="delete">Delete</Button>
            <Button disabled>Disabled</Button>
            <Button size="sm" icon="export">Small</Button>
          </div>
          <div className="ds-row">
            <IconButton icon="bold" label="Bold" shortcut="⌘B" />
            <IconButton icon="italic" label="Italic" shortcut="⌘I" active />
            <IconButton icon="note" label="Add note" />
            <IconButton icon="more" label="More" size="sm" />
          </div>
        </Section>

        <Section title="Form controls">
          <div className="ds-grid">
            <Field label="Title" hint="Shown on the title page." htmlFor="ds-title">
              <Input id="ds-title" placeholder="Untitled" />
            </Field>
            <Field label="Search" htmlFor="ds-search">
              <Input id="ds-search" icon="search" placeholder="Search the project" />
            </Field>
            <Field label="Trim size" htmlFor="ds-trim">
              <Select id="ds-trim" options={[{ value: '6x9', label: '6 × 9 in (trade)' }, { value: 'a5', label: 'A5' }]} />
            </Field>
            <Field label="Note" htmlFor="ds-note" error="Notes can’t be empty.">
              <TextArea id="ds-note" placeholder="Write a note…" />
            </Field>
          </div>
          <div className="ds-row">
            <Checkbox label="Number chapters" checked={check} onChange={setCheck} />
            <Switch label="Typewriter scrolling" checked={on} onChange={setOn} />
            <SegmentedControl label="Format" value={segment} onChange={setSegment}
              options={[{ value: 'prose', label: 'Prose' }, { value: 'screenplay', label: 'Screenplay' }, { value: 'stage', label: 'Stage play' }]} />
          </div>
        </Section>

        <Section title="Menus, popovers, dialogs">
          <div className="ds-row">
            <Button ref={menuRef} iconAfter="chevron-down" onClick={() => setMenu(!menu)}>More</Button>
            <Menu open={menu} onClose={() => setMenu(false)} anchorRef={menuRef} label="More">
              <MenuLabel>Note</MenuLabel>
              <MenuItem icon="pin" shortcut="⌘P">Pin note</MenuItem>
              <MenuItem icon="copy">Duplicate</MenuItem>
              <MenuItem checked>Show in margin</MenuItem>
              <MenuSeparator />
              <MenuItem icon="delete" danger>Delete note</MenuItem>
            </Menu>
            <Button ref={popRef} icon="palette" onClick={() => setPopover(!popover)}>Note colour</Button>
            <Popover open={popover} onClose={() => setPopover(false)} anchorRef={popRef} label="Note colour">
              <p className="ib-eyebrow ds-pop-label">Note colour</p>
              <InkPicker label="Note colour" value={ink} onChange={setInk} />
            </Popover>
            <Button onClick={() => setDialog(true)}>Open dialog</Button>
            <Button onClick={() => setSheet(true)}>Open sheet</Button>
          </div>
        </Section>

        <Section title="Cards, tags, empty state">
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
        </Section>

        <Section title="Tabs">
          <Tabs label="Inspector" value={tab} onChange={setTab}
            tabs={[{ value: 'notes', label: 'Notes', icon: 'note' }, { value: 'history', label: 'History', icon: 'history' }, { value: 'workbench', label: 'Workbench', icon: 'hammer' }]} />
        </Section>

        <Section title="Floating chrome (glass on iOS)">
          <div className="ds-row ds-floating-demo">
            <FloatingToolbar label="Formatting">
              <IconButton icon="bold" label="Bold" size="sm" />
              <IconButton icon="italic" label="Italic" size="sm" />
              <IconButton icon="underline" label="Underline" size="sm" />
              <ToolbarSeparator />
              <IconButton icon="note" label="Add note" size="sm" />
              <IconButton icon="more" label="More" size="sm" />
            </FloatingToolbar>
            <FloatingActionButton icon="add" label="New note" />
          </div>
        </Section>

        <Section title="Icons · Phosphor Light / Fill">
          <div className="ds-icons">
            {Object.keys(ICONS).sort().map((name) => (
              <div key={name} className="ds-icon" title={name}>
                <Icon name={name} size={20} />
                <span className="ib-meta">{name}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Space & radius">
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
        </Section>
      </main>

      <Panel open={panel} label="Inspector" width={280} style={{ top: 60 }}>
        <PanelHeader title="Notes" actions={<><IconButton icon="add" label="Add note" size="sm" /><IconButton icon="close" label="Hide panel" size="sm" onClick={() => setPanel(false)} /></>} />
        <PanelBody>
          <Card ink="amber"><p className="ib-meta">Chapter one</p><p className="ib-prose ds-card-text">Tools float; the page stays.</p></Card>
          <EmptyState icon="history" title="No versions yet." hint="Name a version to keep it forever." />
        </PanelBody>
      </Panel>

      <Dialog open={dialog} onClose={() => setDialog(false)} eyebrow="Document" title="Delete this chapter?"
        description="It moves to the archive, where you can restore it for 30 days."
        footer={<><Button variant="ghost" onClick={() => setDialog(false)}>Cancel</Button><Button variant="danger" onClick={() => setDialog(false)}>Delete</Button></>}>
        <Checkbox label="Also delete its notes" checked={check} onChange={setCheck} />
      </Dialog>
      <Sheet open={sheet} onClose={() => setSheet(false)} eyebrow="Print layout" title="Page setup"
        footer={<Button variant="primary" onClick={() => setSheet(false)}>Done</Button>}>
        <Field label="Trim size" htmlFor="ds-sheet-trim"><Select id="ds-sheet-trim" options={[{ value: '6x9', label: '6 × 9 in' }]} /></Field>
      </Sheet>
      <CommandPalette />
    </div>
  )
}
