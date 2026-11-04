/**
 * DetailsPanel — the inspector's Details tab: the fields a writer gives the document in
 * view beyond its words (lib/documentFields.ts). Its point of view, chosen from the
 * project's characters, and, for a story entry (a character, a place, a writer's own
 * list), the other names it answers to, which name tags find in the text, and whether
 * it is tagged even where its name reads as an ordinary word (lib/nameContext.ts).
 */
import { useState } from 'react'
import { Button, EmptyState, FormRow, Input, Section, SelectMenu, Tag, Toggle } from '../../ui'
import IconButton from '../../ui/IconButton.jsx'
import { getDocDisplayName } from '../../lib/docKind'
import { cleanAliases, setDocumentField, useDocumentFields } from '../../lib/documentFields'
import { useCharacterEntries, useStoryEntries } from '../../lib/storyEntries'
import './DetailsPanel.css'

const NO_POV = ''

function PointOfView({ docPath, pov }) {
  const characters = useCharacterEntries()
  const known = characters.some((entry) => entry.path === pov)
  const options = [
    { value: NO_POV, label: 'None' },
    ...characters.filter((entry) => entry.path !== docPath).map((entry) => ({ value: entry.path, label: entry.name })),
    ...(pov && !known ? [{ value: pov, label: `${getDocDisplayName(pov)} (missing)` }] : []),
  ]
  return (
    <Section id="details.pov" title="Point of view">
      {characters.length || pov ? (
        <FormRow label="Told by" htmlFor="details-pov">
          <SelectMenu
            id="details-pov"
            label="Point of view"
            value={pov || NO_POV}
            options={options}
            onChange={(value) => void setDocumentField(docPath, 'pov', value || null)}
          />
        </FormRow>
      ) : (
        <EmptyState compact title="No characters yet." hint="Documents in a Characters folder can be chosen here." />
      )}
    </Section>
  )
}

function OtherNames({ entry }) {
  const [draft, setDraft] = useState('')
  const aliases = entry.aliases
  const save = (next) => void setDocumentField(entry.path, 'aliases', cleanAliases(next))
  const add = () => {
    const alias = draft.trim()
    if (!alias) return
    save([...aliases, alias])
    setDraft('')
  }
  return (
    <Section id="details.aliases" title="Also called">
      <p className="ib-hint details-hint">{`Name tags find ${entry.name} by these names too.`}</p>
      {aliases.length ? (
        <ul className="details-aliases">
          {aliases.map((alias) => (
            <li key={alias} className="details-alias">
              <Tag ink={entry.ink}>{alias}</Tag>
              <IconButton icon="delete" label={`Remove ${alias}`} onClick={() => save(aliases.filter((other) => other !== alias))} />
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="details-alias-add"
        onSubmit={(event) => {
          event.preventDefault()
          add()
        }}
      >
        <Input size="sm" value={draft} placeholder="A nickname or short name" aria-label="Add another name" onChange={(event) => setDraft(event.target.value)} />
        <Button type="submit" disabled={!draft.trim()}>Add</Button>
      </form>
      <FormRow label="Always tag" htmlFor="details-always-tag">
        <Toggle
          id="details-always-tag"
          label="Always tag"
          checked={entry.alwaysTag}
          onChange={(checked) => void setDocumentField(entry.path, 'alwaysTag', checked || null)}
        />
      </FormRow>
      <p className="ib-hint details-hint">{`Even where ${entry.name} reads as an ordinary word, as “Will” does in “Will you come?”`}</p>
    </Section>
  )
}

export default function DetailsPanel({ docPath }) {
  const fields = useDocumentFields()
  const entries = useStoryEntries()
  if (!docPath) {
    return (
      <div className="details-panel">
        <EmptyState title="No document open." hint="Open a document to see its details." />
      </div>
    )
  }
  const entry = entries.find((item) => item.path === docPath)
  return (
    <div className="details-panel">
      <div className="details-body">
        <PointOfView docPath={docPath} pov={fields[docPath]?.pov} />
        {entry ? <OtherNames entry={entry} /> : null}
      </div>
    </div>
  )
}
