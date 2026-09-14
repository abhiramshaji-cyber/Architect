import { useState } from 'react'
import type { McpBridgeInfo } from '../shared/types'

type Block = { label: string; where: string; snippet: string }

function buildBlocks(bridgePath: string): Block[] {
  return [
    {
      label: 'Claude Code',
      where: 'run in any terminal, once',
      snippet: `claude mcp add --scope user architect -- node ${bridgePath}`,
    },
    {
      label: 'Claude Desktop',
      where: 'merge into claude_desktop_config.json, then restart it',
      snippet: `{
  "mcpServers": {
    "architect": {
      "command": "node",
      "args": ["${bridgePath}"]
    }
  }
}`,
    },
    {
      label: 'Codex',
      where: 'append to ~/.codex/config.toml',
      snippet: `[mcp_servers.architect]
command = "node"
args = ["${bridgePath}"]`,
    },
  ]
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => setCopied(false))
  }

  return (
    <button className="mcp-copy" onClick={copy}>
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

export default function ConnectMcpPanel({
  bridge,
  onClose,
}: {
  bridge: McpBridgeInfo | null
  onClose: () => void
}) {
  return (
    <div className="mcp-overlay" onClick={onClose}>
      <div className="mcp-panel" onClick={(e) => e.stopPropagation()}>
        <div className="mcp-header">
          <h2>Connect MCP</h2>
          <button className="mcp-close" onClick={onClose}>
            ×
          </button>
        </div>

        {!bridge ? (
          <p className="mcp-loading">Locating bridge...</p>
        ) : !bridge.exists ? (
          <div className="mcp-missing">
            <p>Bridge not found at:</p>
            <code className="mcp-path">{bridge.path}</code>
            <p>Run <code>npm run install:local</code> first, then reopen this panel.</p>
          </div>
        ) : (
          <div className="mcp-blocks">
            {buildBlocks(bridge.path).map((block) => (
              <div className="mcp-block" key={block.label}>
                <div className="mcp-block-head">
                  <span>{block.label}</span>
                  <CopyButton text={block.snippet} />
                </div>
                <p className="mcp-where">{block.where}</p>
                <pre className="mcp-snippet">{block.snippet}</pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
