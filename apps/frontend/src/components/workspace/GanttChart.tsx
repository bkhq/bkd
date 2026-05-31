interface TreeIssue {
  id: string
  title: string
  statusId: string
  sessionStatus?: string | null
  issueNumber: number
  children: TreeIssue[]
}

function statusColor(status: string): string {
  if (status === 'done') return 'bg-green-500'
  if (status === 'failed') return 'bg-red-500'
  if (status === 'working') return 'bg-blue-500'
  return 'bg-gray-300'
}

function GanttRow({ issue, depth, onClick }: { issue: TreeIssue, depth: number, onClick: (id: string) => void }) {
  const pct = issue.statusId === 'done' ? 100 : issue.statusId === 'working' ? 40 : 0
  return (
    <>
      <div
        className="flex items-center gap-2 py-1 cursor-pointer hover:bg-gray-100 rounded px-2"
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        onClick={() => onClick(issue.id)}
      >
        <span className={`w-2 h-2 rounded-full ${statusColor(issue.sessionStatus || 'todo')}`} />
        <span className="text-sm truncate flex-1">
          @
          {issue.id}
          {' '}
          {issue.title}
        </span>
        <span className="text-xs text-gray-400 w-10 text-right">{issue.statusId}</span>
        <div className="w-16 h-1.5 bg-gray-200 rounded overflow-hidden">
          <div className={`h-full rounded ${statusColor(issue.sessionStatus || 'todo')}`} style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs text-gray-500 w-8 text-right">
          {pct}
          %
        </span>
      </div>
      {issue.children?.map(c => <GanttRow key={c.id} issue={c} depth={depth + 1} onClick={onClick} />)}
    </>
  )
}

export default function GanttChart({ issues, onIssueClick }: { issues: TreeIssue[], onIssueClick: (id: string) => void }) {
  return (
    <div className="overflow-y-auto">
      <h3 className="text-xs text-gray-500 uppercase mb-3">
        Progress ·
        {issues.length}
        {' '}
        root issues
      </h3>
      {issues.map(i => <GanttRow key={i.id} issue={i} depth={0} onClick={onIssueClick} />)}
    </div>
  )
}
