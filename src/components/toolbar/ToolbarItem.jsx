/** One toolbar item by id: a spacer, or the item's component from the registry. */
import { FLEXIBLE_SPACE, MORE, SPACE, toolbarItem } from '../../lib/chromeLayout'
import { TOOLBAR_COMPONENTS } from './registry'

export default function ToolbarItem({ id, ctx }) {
  if (id === SPACE) return <span className="tb-space" aria-hidden="true" />
  if (id === FLEXIBLE_SPACE) return <span className="tb-flexible-space" aria-hidden="true" />
  if (id === MORE) return <span className="tb-more-marker" aria-hidden="true">More »</span>
  const spec = toolbarItem(id)
  const Component = TOOLBAR_COMPONENTS[id]
  if (!spec || !Component) return null
  return <Component ctx={ctx} spec={spec} />
}
