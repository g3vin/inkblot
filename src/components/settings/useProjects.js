/** The projects there are, by name, for a picker. */
import { useEffect, useState } from 'react'
import { listProjects } from '../../lib/FileSystem'

export default function useProjects() {
  const [projects, setProjects] = useState([])
  useEffect(() => {
    let live = true
    listProjects().then((list) => {
      if (live) setProjects((list ?? []).map((project) => (typeof project === 'string' ? project : project.name)).filter(Boolean))
    }).catch(() => {})
    return () => { live = false }
  }, [])
  return projects
}
