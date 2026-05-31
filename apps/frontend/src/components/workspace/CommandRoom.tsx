import { useCallback, useState } from 'react'
import { useIssue } from '@/hooks/use-kanban'
import { ChatArea } from '@/components/issue-detail/ChatArea'

interface Props {
  roomIssueId: string
  projectId: string
}

export default function CommandRoom({ roomIssueId, projectId }: Props) {
  const { data: issue } = useIssue(projectId, roomIssueId)
  const [showDiff, setShowDiff] = useState(false)

  const onToggleDiff = useCallback(() => setShowDiff(v => !v), [])
  const onCloseDiff = useCallback(() => setShowDiff(false), [])

  if (!issue) return <div className="p-4 text-gray-500">Room not found</div>
  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b text-sm font-medium flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-green-500" />
        {issue.title}
      </div>
      <div className="flex-1 overflow-hidden">
        <ChatArea
          projectId={projectId}
          issueId={roomIssueId}
          showDiff={showDiff}
          diffWidth={400}
          onToggleDiff={onToggleDiff}
          onDiffWidthChange={() => {}}
          onCloseDiff={onCloseDiff}
          fileBrowserWidth={300}
          onFileBrowserWidthChange={() => {}}
          hideTitleBar
        />
      </div>
    </div>
  )
}
