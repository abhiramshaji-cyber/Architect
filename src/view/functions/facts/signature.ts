import type { Param, Signature } from '../../../../shared/types'

function paramText(param: Param): string {
  const typed = param.type === undefined ? '' : `: ${param.type}`
  const valued = param.value === undefined ? '' : ` = ${param.value}`
  return `${param.rest ? '...' : ''}${param.name}${param.optional ? '?' : ''}${typed}${valued}`
}

export function signatureText(signature: Signature | undefined): string {
  if (signature === undefined) return ''
  const generics = signature.generics === undefined ? '' : `<${signature.generics}>`
  const returns = signature.returns === undefined ? '' : `: ${signature.returns}`
  return `${generics}(${signature.params.map(paramText).join(', ')})${returns}`
}
