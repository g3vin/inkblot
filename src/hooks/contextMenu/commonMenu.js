/**
 * commonMenu.js — copy/paste and split-view actions offered everywhere.
 */
export async function commonMenu(ctx) {
  const {
    MenuItem,
    PredefinedMenuItem,
    currentDoc,
    e,
    fileItem,
    items,
    secondaryDoc,
    setCurrentDoc,
    setSecondaryDoc,
    setSplitView,
    splitView,
  } = ctx
  items.push(
    await PredefinedMenuItem.new({ item: 'Copy' }),
    await PredefinedMenuItem.new({ item: 'Paste' })
  )

  if (splitView) {
    const inPrimaryPane = !!e.target.closest('.primary-pane')
    const inSecondaryPane = !!e.target.closest('.secondary-pane')

    let docToClose = null
    if (fileItem) {
      docToClose = fileItem.getAttribute('data-filename')
    } else if (inSecondaryPane) {
      docToClose = secondaryDoc
    } else if (inPrimaryPane) {
      docToClose = currentDoc
    }

    items.push(
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await MenuItem.new({
        text: 'Close document',
        action: () => {
          if (docToClose && docToClose === secondaryDoc) {
            setSecondaryDoc?.(null)
            setSplitView?.(null)
            return
          }

          if (docToClose && docToClose === currentDoc) {
            if (secondaryDoc) {
              setCurrentDoc?.(secondaryDoc)
            }
            setSecondaryDoc?.(null)
            setSplitView?.(null)
          }
        },
      })
    )
  }

  return undefined
}
