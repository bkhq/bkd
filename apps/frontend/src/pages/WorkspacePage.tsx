import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useIssueTree, useWorkspace, useWorkspaceProjects } from '@/hooks/use-kanban'
import { useIsMobile } from '@/hooks/use-mobile'
import GanttChart from '@/components/workspace/GanttChart'
import CommandRoom from '@/components/workspace/CommandRoom'

export default function WorkspacePage() {
  const { wid } = useParams<{ wid: string }>()
  const { data: workspace, isLoading } = useWorkspace(wid!)
  const { data: projects } = useWorkspaceProjects(wid!)
  const firstProjectId = projects?.[0]?.id
  const { data: issues } = useIssueTree(firstProjectId!)
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null)
  const isMobile = useIsMobile()

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  const handleIssueClick = (issueId: string) => setActiveRoomId(issueId)

  if (isMobile && activeRoomId && firstProjectId) {
    return (
      <div className="h-[calc(100vh-48px)] flex flex-col">
        <div className="flex items-center gap-2 p-3 border-b">
          <button onClick={() => setActiveRoomId(null)} className="text-blue-600">&larr; Back</button>
          <span className="text-sm font-medium">
            @
            {activeRoomId}
          </span>
        </div>
        <div className="flex-1 overflow-hidden">
          <CommandRoom roomIssueId={activeRoomId} projectId={firstProjectId} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-48px)]">
      <div className="flex-1 overflow-y-auto p-6">
        <h2 className="text-lg font-bold mb-4">{workspace?.name}</h2>
        {issues ? (
          <GanttChart issues={issues} onIssueClick={handleIssueClick} />
        ) : (
          <p className="text-gray-500">No issues yet. Create a project and add issues.</p>
        )}
      </div>
      {activeRoomId && firstProjectId && (
        <div className="w-96 border-l">
          <CommandRoom roomIssueId={activeRoomId} projectId={firstProjectId} />
        </div>
      )}
    </div>
  )
}
