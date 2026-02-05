import { useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { openPinterest } from './openPinterest'
import Editor from './Editor.jsx'

export default function App() {
  useEffect(() => {
    let unlisten

    listen('search-pinterest', e => {
      const { text } = e.payload
      openPinterest(text)
    }).then(fn => {
      unlisten = fn
    })

    return () => {
      if (unlisten) unlisten()
    }
  }, [])

  return <Editor />
}