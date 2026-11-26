import ts from 'typescript'

export const GD_KEYWORDS: ReadonlySet<string> = new Set([
  '_',
  'if', 'elif', 'else', 'for', 'while', 'match', 'when', 'break', 'continue', 'pass', 'return',
  'class', 'class_name', 'extends', 'is', 'in', 'as', 'self', 'super', 'signal', 'func',
  'static', 'const', 'enum', 'var', 'breakpoint', 'preload', 'await', 'yield', 'assert',
  'void', 'PI', 'TAU', 'INF', 'NAN', 'and', 'or', 'not', 'true', 'false', 'null',
  // Common Godot built-in functions/types/Object methods/singletons that collide with JS variable names
  'RT', 'get', 'set', 'call', 'free', 'new', 'duplicate', 'connect', 'Input', 'Time', 'OS', 'Engine', 'JSON',
  'str', 'int', 'float', 'bool', 'range', 'load', 'print', 'len', 'min', 'max', 'abs', 'sign',
  'round', 'floor', 'ceil', 'clamp', 'lerp', 'sqrt', 'sin', 'cos', 'tan', 'atan2', 'exp', 'pow',
  'Vector2', 'Vector3', 'Color', 'Array', 'Dictionary', 'String', 'Node', 'Object', 'Resource', 'Callable', 'Variant', 'Rect2'
])

export function safeIdent(name: string): string {
  return GD_KEYWORDS.has(name) ? '_v_' + name : name
}

export function gdString(value: string): string {
  return JSON.stringify(value)
}

export function isAssignmentOp(kind: ts.SyntaxKind): boolean {
  return kind === ts.SyntaxKind.EqualsToken ||
    kind === ts.SyntaxKind.PlusEqualsToken ||
    kind === ts.SyntaxKind.MinusEqualsToken ||
    kind === ts.SyntaxKind.AsteriskEqualsToken ||
    kind === ts.SyntaxKind.AsteriskAsteriskEqualsToken ||
    kind === ts.SyntaxKind.SlashEqualsToken ||
    kind === ts.SyntaxKind.PercentEqualsToken ||
    kind === ts.SyntaxKind.BarEqualsToken ||
    kind === ts.SyntaxKind.AmpersandEqualsToken ||
    kind === ts.SyntaxKind.CaretEqualsToken ||
    kind === ts.SyntaxKind.LessThanLessThanEqualsToken ||
    kind === ts.SyntaxKind.GreaterThanGreaterThanEqualsToken ||
    kind === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken ||
    kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken ||
    kind === ts.SyntaxKind.BarBarEqualsToken ||
    kind === ts.SyntaxKind.QuestionQuestionEqualsToken
}

export function unwrapTs(expr: ts.Expression): ts.Expression {
  while (ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr) || ts.isNonNullExpression(expr) || ts.isTypeAssertionExpression(expr)) {
    expr = expr.expression
  }
  return expr
}

export function collectBindingNames(name: ts.BindingName, out: Set<string>): void {
  if (ts.isIdentifier(name)) out.add(name.text)
  else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const el of name.elements) {
      if (ts.isBindingElement(el)) collectBindingNames(el.name, out)
    }
  }
}

export function bindingContainsName(name: ts.BindingName, symbol: string): boolean {
  if (ts.isIdentifier(name)) return name.text === symbol
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    return name.elements.some(el => ts.isBindingElement(el) && bindingContainsName(el.name, symbol))
  }
  return false
}

export function containsOwnThis(node: ts.Node): boolean {
  if (node.kind === ts.SyntaxKind.ThisKeyword) return true
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isObjectLiteralExpression(node)) return false
  let found = false
  ts.forEachChild(node, c => { if (!found && containsOwnThis(c)) found = true })
  return found
}

export function switchHasOuterContinue(node: ts.Node): boolean {
  if (ts.isContinueStatement(node)) return true
  if (ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node) ||
    ts.isWhileStatement(node) || ts.isDoStatement(node) ||
    ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node)) {
    return false
  }
  let found = false
  ts.forEachChild(node, c => { if (!found && switchHasOuterContinue(c)) found = true })
  return found
}

/**
 * Collect variable names that need a 1-element `[val]` box in GDScript 4 because
 * they are captured by an inner closure AND mutated (in either the outer or inner scope),
 * OR are local functions referenced inside their own body (recursion).
 */
export function findBoxedVars(root: ts.Node): Set<string> {
  const boxed = new Set<string>()
  type Scope = { decls: Set<string>; localFuncs: Set<string>; captured: Set<string>; mutated: Set<string> }
  const scopeOf = new Map<ts.Node, Scope>()

  function isFuncBoundary(node: ts.Node) {
    return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node)
  }

  // Pass 1: collect all declarations per function scope (order-independent!).
  function pass1(node: ts.Node, current: Scope) {
    if (isFuncBoundary(node)) {
      if (ts.isFunctionDeclaration(node) && node.name && current !== rootScope) {
        current.decls.add(node.name.text)
        current.localFuncs.add(node.name.text)
      }
      const next: Scope = { decls: new Set(), localFuncs: new Set(), captured: new Set(), mutated: new Set() }
      scopeOf.set(node, next)
      if (ts.isFunctionLike(node)) {
        for (const p of node.parameters) collectBindingNames(p.name, next.decls)
      }
      ts.forEachChild(node, c => pass1(c, next))
      return
    }
    if (ts.isVariableDeclaration(node)) {
      collectBindingNames(node.name, current.decls)
      if (current !== rootScope && ts.isIdentifier(node.name) && node.initializer) {
        let init = node.initializer
        while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          current.localFuncs.add(node.name.text)
        }
      }
    }
    ts.forEachChild(node, c => pass1(c, current))
  }

  const rootScope: Scope = { decls: new Set(), localFuncs: new Set(), captured: new Set(), mutated: new Set() }
  scopeOf.set(root, rootScope)
  ts.forEachChild(root, c => pass1(c, rootScope))

  // Pass 2: record mutations and cross-scope captures (reads or writes from inner functions).
  const stack: Scope[] = [rootScope]
  function markRef(name: string, isMut: boolean) {
    const inner = stack[stack.length - 1]
    for (let i = stack.length - 1; i >= 1; i--) {
      if (stack[i].decls.has(name)) {
        if (isMut) stack[i].mutated.add(name)
        if (stack[i] !== inner) stack[i].captured.add(name)
        return
      }
    }
  }
  function isRefIdentifier(node: ts.Identifier): boolean {
    const p = node.parent
    if (!p) return false
    if (ts.isPropertyAccessExpression(p) && p.name === node) return false
    if (ts.isPropertyAssignment(p) && p.name === node) return false
    if (ts.isMethodDeclaration(p) && p.name === node) return false
    if (ts.isGetAccessorDeclaration(p) && p.name === node) return false
    if (ts.isVariableDeclaration(p) && p.name === node) return false
    if (ts.isParameter(p) && p.name === node) return false
    if (ts.isFunctionDeclaration(p) && p.name === node) return false
    if (ts.isBindingElement(p) && (p.name === node || p.propertyName === node)) return false
    if (ts.isTypeNode(p) || ts.isTypeReferenceNode(p)) return false
    return true
  }
  function pass2(node: ts.Node) {
    if (isFuncBoundary(node)) {
      const sc = scopeOf.get(node)
      if (sc) {
        stack.push(sc)
        ts.forEachChild(node, pass2)
        stack.pop()
      }
      return
    }
    if (ts.isBinaryExpression(node) && isAssignmentOp(node.operatorToken.kind)) {
      if (ts.isIdentifier(node.left)) markRef(node.left.text, true)
    } else if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) {
      if (ts.isIdentifier(node.operand)) markRef(node.operand.text, true)
    } else if ((ts.isForOfStatement(node) || ts.isForInStatement(node)) && ts.isIdentifier(node.initializer)) {
      markRef(node.initializer.text, true)
    } else if (ts.isIdentifier(node) && isRefIdentifier(node)) {
      markRef(node.text, false)
    }
    ts.forEachChild(node, pass2)
  }
  ts.forEachChild(root, pass2)

  for (const [node, sc] of scopeOf) {
    if (node === root) continue
    for (const name of sc.captured) {
      if (sc.mutated.has(name) || sc.localFuncs.has(name)) boxed.add(name)
    }
  }
  return boxed
}

export interface ModuleImportBinding {
  readonly resPath: string
  readonly exportName: string
}

export interface ExportAlias {
  readonly local: string
  readonly alias: string
}

export interface ModuleAnalysis {
  readonly boxedVars: ReadonlySet<string>
  readonly topFuncs: ReadonlySet<string>
  readonly topVars: ReadonlySet<string>
  readonly exportAliases: readonly ExportAlias[]
  readonly importedBindings: ReadonlyMap<string, ModuleImportBinding>
}

export type ImportResolver = (specifier: string, exportedName: string) => ModuleImportBinding

/** Analyze top-level module bindings, imports, export aliases, and closure-boxed variables in a single pure pass. */
export function analyzeModule(sf: ts.SourceFile, resolveImport?: ImportResolver): ModuleAnalysis {
  const boxedVars = findBoxedVars(sf)
  const topFuncs = new Set<string>()
  const topVars = new Set<string>()
  const exportAliases: ExportAlias[] = []
  const importedBindings = new Map<string, ModuleImportBinding>()

  const resolveBinding = (specifier: string, imported: string): ModuleImportBinding => (
    resolveImport
      ? resolveImport(specifier, imported)
      : { resPath: specifier.replace(/\.ts$/, '.gd'), exportName: imported }
  )

  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      topFuncs.add(stmt.name.text)
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) collectBindingNames(decl.name, topVars)
    } else if (ts.isExportDeclaration(stmt) && !stmt.isTypeOnly && !stmt.moduleSpecifier && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const el of stmt.exportClause.elements) {
        if (el.isTypeOnly || !el.propertyName) continue
        if (el.propertyName.text !== el.name.text) {
          exportAliases.push({ local: el.propertyName.text, alias: el.name.text })
          topVars.add(el.name.text)
        }
      }
    } else if (ts.isExportDeclaration(stmt) && !stmt.isTypeOnly && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      const specifier = stmt.moduleSpecifier.text
      for (const el of stmt.exportClause.elements) {
        if (el.isTypeOnly) continue
        const imported = (el.propertyName ?? el.name).text
        const local = el.name.text
        importedBindings.set(local, resolveBinding(specifier, imported))
        topVars.add(local)
      }
    } else if (ts.isImportDeclaration(stmt)) {
      if (stmt.importClause?.isTypeOnly) continue
      if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue
      const specifier = stmt.moduleSpecifier.text
      const bindings = stmt.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          if (el.isTypeOnly) continue
          const imported = (el.propertyName ?? el.name).text
          const local = el.name.text
          importedBindings.set(local, resolveBinding(specifier, imported))
          topVars.add(local)
        }
      }
    }
  }

  return { boxedVars, topFuncs, topVars, exportAliases, importedBindings }
}
