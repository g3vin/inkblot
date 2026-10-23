/**
 * HelpSheet — Help…: every help topic (lib/help.ts), laid out as Settings is. It opens
 * on the topic a right-click asked about, and the writer can read on from there:
 * related topics at the foot, the rest in the list, a filter above it.
 */
import { useEffect, useMemo, useState } from 'react'
import { Button, EmptyState, Input } from '../../ui'
import NavSheet from '../../ui/NavSheet.jsx'
import { HELP_TOPICS, helpTopic, OPEN_HELP_EVENT } from '../../lib/help'
import { useCommands } from '../../lib/commands'
import './HelpSheet.css'

const matches = (topic, words) => words.every((word) => (
  topic.title.toLowerCase().includes(word) || topic.body.some((paragraph) => paragraph.toLowerCase().includes(word))
))

export default function HelpSheet() {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState(HELP_TOPICS[0].id)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    const show = (event) => {
      const asked = helpTopic(event.detail?.topic)
      if (asked) setCurrent(asked.id)
      setFilter('')
      setOpen(true)
    }
    window.addEventListener(OPEN_HELP_EVENT, show)
    return () => window.removeEventListener(OPEN_HELP_EVENT, show)
  }, [])

  useCommands(() => [{
    id: 'help.open',
    section: 'App',
    title: 'Help…',
    icon: 'help',
    keywords: ['how do i', 'explain', 'what is', 'guide', 'manual'],
    run: () => { setFilter(''); setOpen(true) },
  }], [])

  const shown = useMemo(() => {
    const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return words.length ? HELP_TOPICS.filter((topic) => matches(topic, words)) : HELP_TOPICS
  }, [filter])

  if (!open) return null
  const topic = helpTopic(current) ?? HELP_TOPICS[0]
  const items = shown.map(({ id, title, section }) => ({ id, title, group: section }))

  return (
    <NavSheet
      title="Help"
      label="Help topics"
      items={items}
      value={topic.id}
      onChange={setCurrent}
      onClose={() => setOpen(false)}
      className="help-sheet"
      aside={(
        <Input
          size="sm"
          icon="search"
          aria-label="Filter help topics"
          placeholder="Filter topics"
          value={filter}
          onChange={(event) => {
            const next = event.target.value
            setFilter(next)
            const words = next.trim().toLowerCase().split(/\s+/).filter(Boolean)
            const first = HELP_TOPICS.find((candidate) => matches(candidate, words))
            if (first && !matches(topic, words)) setCurrent(first.id)
          }}
        />
      )}
    >
      {items.length ? (
        <article className="help-topic" data-topic={topic.id}>
          <p className="ib-eyebrow">{topic.section}</p>
          <h3 className="ib-title help-topic-title">{topic.title}</h3>
          {topic.body.map((paragraph) => <p key={paragraph} className="ib-body help-topic-body">{paragraph}</p>)}
          {topic.related?.length ? (
            <div className="help-related">
              <p className="ib-eyebrow">See also</p>
              <div className="help-related-links">
                {topic.related.map((id) => helpTopic(id)).filter(Boolean).map((related) => (
                  <Button key={related.id} variant="plain" onClick={() => setCurrent(related.id)}>{related.title}</Button>
                ))}
              </div>
            </div>
          ) : null}
        </article>
      ) : (
        <EmptyState icon="help" title="No topics match." hint="Try fewer words, or clear the filter to see every topic." />
      )}
    </NavSheet>
  )
}
