import {
  createConnection,
  ErrorCodes,
  ProposedFeatures,
  ResponseError,
  TextDocumentSyncKind,
  TextDocuments,
} from 'vscode-languageserver/node'
import { TextDocument } from 'vscode-languageserver-textdocument'

import { completions, definition, diagnostics, rename, renameTarget } from './features'

const CONTRACT = 'architect.md'

const connection = createConnection(ProposedFeatures.all)
const documents = new TextDocuments(TextDocument)

function contractText(uri: string): string | undefined {
  if (decodeURIComponent(uri).split(/[/\\]/).pop()?.toLowerCase() !== CONTRACT) return undefined
  return documents.get(uri)?.getText()
}

connection.onInitialize(() => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Incremental,
    completionProvider: { triggerCharacters: ['-', '>', ' '] },
    definitionProvider: true,
    renameProvider: { prepareProvider: true },
  },
}))

documents.onDidChangeContent((e) => {
  const text = contractText(e.document.uri)
  connection.sendDiagnostics({ uri: e.document.uri, diagnostics: text === undefined ? [] : diagnostics(text) })
})
documents.onDidClose((e) => connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] }))

connection.onCompletion((params) => {
  const text = contractText(params.textDocument.uri)
  return text === undefined ? [] : completions(text, params.position)
})

connection.onDefinition((params) => {
  const text = contractText(params.textDocument.uri)
  if (text === undefined) return null

  const range = definition(text, params.position)
  return range ? { uri: params.textDocument.uri, range } : null
})

connection.onPrepareRename((params) => {
  const text = contractText(params.textDocument.uri)
  if (text === undefined) return null

  const target = renameTarget(text, params.position)
  return target ?? null
})

connection.onRenameRequest((params) => {
  const text = contractText(params.textDocument.uri)
  if (text === undefined) return null

  const result = rename(text, params.position, params.newName)
  if ('error' in result) return new ResponseError(ErrorCodes.InvalidRequest, result.error)

  return { changes: { [params.textDocument.uri]: result.edits } }
})

documents.listen(connection)
connection.listen()
