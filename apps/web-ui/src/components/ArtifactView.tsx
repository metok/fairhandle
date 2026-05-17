import Markdown from 'react-markdown'
import type { Artifact, ClauseStatus } from '../lib/api.js'

const STATUS_BG: Record<ClauseStatus, string> = {
  agreed: 'bg-green-50 border-green-200',
  open: 'bg-yellow-50 border-yellow-200',
  contested: 'bg-red-50 border-red-200',
}

const STATUS_PILL: Record<ClauseStatus, string> = {
  agreed: 'bg-green-100 text-green-800',
  open: 'bg-yellow-100 text-yellow-800',
  contested: 'bg-red-100 text-red-800',
}

export function ArtifactView({ artifact }: { artifact: Artifact | null }) {
  if (!artifact) {
    return <div className="p-6 text-gray-500">No consolidated artifact yet.</div>
  }
  return (
    <div className="space-y-6 p-6">
      <div className="prose prose-sm max-w-none rounded border border-gray-200 bg-white p-4">
        <Markdown>{artifact.markdown || '*(empty draft)*'}</Markdown>
      </div>

      {artifact.overlay.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Clauses</h3>
          <ul className="space-y-2">
            {artifact.overlay.map((c, i) => (
              <li key={i} className={`rounded border p-3 ${STATUS_BG[c.status]}`}>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm">{c.clause_type}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">{c.criticality_default}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_PILL[c.status]}`}>
                      {c.status}
                    </span>
                  </span>
                </div>
                <p className="mt-1 text-sm text-gray-700">
                  {artifact.markdown.slice(c.span.start, c.span.end) || '(no text)'}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {artifact.open_issues.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Open issues</h3>
          <ul className="list-inside list-disc space-y-1 text-sm text-gray-700">
            {artifact.open_issues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {artifact.changelog && (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-gray-700">Changelog</h3>
          <p className="text-sm text-gray-600">{artifact.changelog}</p>
        </div>
      )}

      <p className="text-xs text-gray-400">artifact version {artifact.version}</p>
    </div>
  )
}
