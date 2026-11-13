import ts from 'typescript'

function propertyName(name: ts.PropertyName | ts.BindingName): string | undefined {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  if (ts.isComputedPropertyName(name)) {
    const inner = name.expression
    if (ts.isStringLiteral(inner) || ts.isNumericLiteral(inner)) return inner.text
    return undefined
  }
  return undefined
}

function isFunctionValue(node: ts.Node | undefined): boolean {
  return node !== undefined && (ts.isArrowFunction(node) || ts.isFunctionExpression(node))
}

export function declaredName(node: ts.Node, owner: string): string | undefined {
  const prefix = owner ? `${owner}.` : ''

  if (ts.isFunctionDeclaration(node)) return (ts.isModuleBlock(node.parent) ? prefix : '') + (node.name?.text ?? 'default')
  if (ts.isConstructorDeclaration(node)) return `${owner || 'default'}.constructor`

  if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
    const name = propertyName(node.name)
    return name === undefined ? undefined : prefix + name
  }

  if (ts.isPropertyDeclaration(node) && isFunctionValue(node.initializer)) {
    const name = propertyName(node.name)
    return name === undefined ? undefined : prefix + name
  }

  if (ts.isPropertyAssignment(node) && isFunctionValue(node.initializer)) {
    const name = propertyName(node.name)
    return name === undefined ? undefined : prefix + name
  }

  if (ts.isVariableDeclaration(node) && isFunctionValue(node.initializer)) {
    const name = propertyName(node.name)
    return name === undefined ? undefined : name
  }

  if (ts.isExportAssignment(node) && isFunctionValue(node.expression)) return 'default'

  return undefined
}

function isTransparent(node: ts.Node): boolean {
  return (
    ts.isObjectLiteralExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node)
  )
}

export function ownerFor(node: ts.Node, owner: string): string {
  if (ts.isClassDeclaration(node) && node.name === undefined) return 'default'
  if (ts.isClassLike(node)) return node.name?.text ?? owner
  if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name) && !(node.flags & ts.NodeFlags.GlobalAugmentation)) {
    return owner ? `${owner}.${node.name.text}` : node.name.text
  }
  if (ts.isModuleBlock(node)) return owner
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text
  if (ts.isExportAssignment(node)) return 'default'
  if (isTransparent(node)) return owner

  if (ts.isPropertyAssignment(node)) {
    const name = propertyName(node.name)
    if (name === undefined) return ''
    return owner ? `${owner}.${name}` : name
  }

  return ''
}
