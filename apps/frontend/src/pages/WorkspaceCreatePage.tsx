import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCreateWorkspace } from '@/hooks/use-kanban'

export default function WorkspaceCreatePage() {
  const navigate = useNavigate()
  const createWs = useCreateWorkspace()
  const [name, setName] = useState('')
  const [reposText, setReposText] = useState('')
  const [description, setDescription] = useState('')

  const handleSubmit = async () => {
    const repos = reposText.split('\n').filter(Boolean).map((line) => {
      const [role, url, defaultBranch] = line.split('|').map(s => s.trim())
      return { role: role || '', url: url || '', defaultBranch: defaultBranch || 'main' }
    })
    const ws = await createWs.mutateAsync({ name, description: description || undefined, repos })
    navigate(`/workspace/${ws.id}`)
  }

  return (
    <div className="max-w-lg mx-auto p-6">
      <h1 className="text-xl font-bold mb-6">New Workspace</h1>
      <label className="block text-sm text-gray-500 mb-1">Name</label>
      <input value={name} onChange={e => setName(e.target.value)} className="w-full p-2 border rounded mb-4" />
      <label className="block text-sm text-gray-500 mb-1">Description</label>
      <textarea value={description} onChange={e => setDescription(e.target.value)} className="w-full p-2 border rounded mb-4 text-sm" rows={2} />
      <label className="block text-sm text-gray-500 mb-1">Repos</label>
      <textarea
        value={reposText}
        onChange={e => setReposText(e.target.value)}
        className="w-full p-2 border rounded mb-4 font-mono text-sm"
        rows={4}
        placeholder="backend | git@github.com:org/backend.git | main&#10;frontend | git@github.com:org/frontend.git | main"
      />
      <div className="flex gap-3">
        <button onClick={() => navigate(-1)} className="flex-1 p-2 border rounded">Cancel</button>
        <button onClick={handleSubmit} disabled={!name || createWs.isPending} className="flex-1 p-2 bg-blue-600 text-white rounded disabled:opacity-50">
          {createWs.isPending ? '...' : 'Create'}
        </button>
      </div>
    </div>
  )
}
