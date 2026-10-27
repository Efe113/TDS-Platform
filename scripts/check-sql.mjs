import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIRS = ['supabase/migrations', 'supabase/seeds', 'supabase/scripts']
const SQL_KEYWORD_IN_STRING = /\b(insert into|create or replace|drop function|grant execute|declare|select id into|returning id into)\b/i
const DOLLAR_TAG = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$$/

const ASSIGNMENT_START = /^[A-Za-z_][\w$]*(\.[A-Za-z_][\w$]*)*\s*:=/
const SUBQUERY_CLAUSES = new Set(['from', 'where', 'group', 'having', 'join', 'limit', 'offset'])
// Parentheses that legitimately contain clause keywords without being subqueries: SQL's own
// trim/substring/overlay/extract forms take a FROM, and aggregate FILTER clauses take a WHERE.
const CLAUSE_OK_PAREN = new Set(['trim', 'substring', 'overlay', 'extract', 'position', 'filter', 'group', 'placing'])
// Words that make the *next* clause keyword legal anywhere: ordered-set aggregates (`within group`)
// and window functions (`over (partition by ...)`, `order by`).
const CLAUSE_AFTER_WORD = new Set(['within', 'over', 'partition'])

/**
 * Two ways a parenthesis can go wrong while still balancing out overall, both of which the
 * dashboard then rejects:
 *
 *  - `v_x := ... coalesce((select ...), 'none')` written so that ')' closes the subquery one
 *    argument early: the subquery's own FROM/WHERE ends up inside the *function call* parentheses.
 *    A clause keyword is only legal at depth > 0 when the parenthesis directly around it opened a
 *    subquery, i.e. `(select`. That is checked here for every depth.
 *  - `v_x := ... from ...` at depth 0: an assignment is not SQL, so no clause belongs there.
 *
 * 'order' is deliberately not checked: aggregate calls legitimately contain `order by` inside
 * their own parentheses, as in string_agg(x, chr(10) order by y).
 */
function lintAssignments(file, sql, problems) {
  let index = 0
  let line = 1
  let statement = ''
  let statementLine = 1
  let topClause = null
  let afterOpenParen = false
  let lastWord = ''
  let reportedB = false
  // For every open parenthesis: whether the first word inside it was SELECT.
  let stack = []

  const flush = () => {
    if (topClause !== null && ASSIGNMENT_START.test(statement.trim())) {
      problems.push(
        `${file}: line ${topClause.line}: SQL clause "${topClause.word}" at parenthesis depth ${topClause.depth} inside an assignment - a parenthesis closes too early`
      )
    }
    statement = ''
    statementLine = line
    topClause = null
    afterOpenParen = false
    reportedB = false
    stack = []
  }

  while (index < sql.length) {
    const char = sql[index]

    if (char === '\n') {
      line += 1
      index += 1
      statement += ' '
      continue
    }

    if (sql.startsWith('--', index)) {
      const end = sql.indexOf('\n', index)
      index = end === -1 ? sql.length : end
      continue
    }

    if (char === "'") {
      index += 1
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          index += 2
          continue
        }
        if (sql[index] === "'") {
          index += 1
          break
        }
        if (sql[index] === '\n') line += 1
        index += 1
      }
      statement += "''"
      afterOpenParen = false
      continue
    }

    if (char === '$') {
      const end = sql.indexOf('$', index + 1)
      const candidate = end === -1 ? null : sql.slice(index, end + 1)
      if (candidate && DOLLAR_TAG.test(candidate)) {
        index += candidate.length
        statement += ' '
        afterOpenParen = false
        continue
      }
    }

    if (char === '(') {
      stack.push({ subquery: false, clauseOk: CLAUSE_OK_PAREN.has(lastWord) })
      afterOpenParen = true
      statement += char
      index += 1
      continue
    }

    if (char === ')') {
      if (stack.length === 0) problems.push(`${file}: line ${line}: extra ')'`)
      else stack.pop()
      afterOpenParen = false
      statement += char
      index += 1
      continue
    }

    if (char === ';' && stack.length === 0) {
      index += 1
      flush()
      continue
    }

    if (/[A-Za-z_]/.test(char)) {
      let word = ''
      while (index < sql.length && /[\w$]/.test(sql[index])) {
        word += sql[index]
        index += 1
      }
      const lower = word.toLowerCase()
      const top = stack[stack.length - 1]
      const previous = lastWord
      if (lower === 'select' && afterOpenParen && top) top.subquery = true
      lastWord = lower
      if (SUBQUERY_CLAUSES.has(lower)) {
        // `percentile_cont(0.5) within group (order by ...)` and `count(*) over (partition by ...)`
        // put a clause keyword inside a call's parentheses legally, because the keyword itself starts
        // SQL's own aggregate/window syntax rather than a stray query clause.
        const afterClauseKeyword = CLAUSE_AFTER_WORD.has(previous)
        // `x is distinct from y` (and its NOT form) is an operator expression, not a query clause, so
        // it belongs inside a call's parentheses legitimately.
        const operatorUse = lower === 'from' && previous === 'distinct'
        if (stack.length > 0 && !(top && top.subquery) && !(top && top.clauseOk) && !afterClauseKeyword && !operatorUse) {
          // Always a syntax error, whoever the enclosing statement is: the clause is inside a
          // function call's parentheses, which cannot hold a query.
          if (!reportedB) {
            reportedB = true
            problems.push(
              `${file}: line ${line}: SQL clause "${lower}" at parenthesis depth ${stack.length} is inside a function call, not a subquery - a parenthesis closes too early`
            )
          }
        } else if (stack.length === 0 && topClause === null && statement.trim().length > 0) {
          topClause = { word: lower, depth: 0, line }
        }
      }
      afterOpenParen = false
      statement += ` ${word}`
      continue
    }

    statement += char
    // Whitespace between '(' and SELECT is normal formatting and must not forget the marker.
    if (!/\s/.test(char)) afterOpenParen = false
    index += 1
  }

  flush()
}

/**
 * plpgsql resolves variable names when the function first *runs*, so a typo like
 * `v_detail = pg_exception_detail` with no `v_detail text;` declaration applies to the database
 * happily and only fails on the next call. Every function in this repository follows the
 * v_/p_ prefix convention, so names can be collected from declare blocks and signatures and any
 * unknown token in a body reported here, before the file is delivered.
 */
function lintDeclaredNames(file, sql, problems) {
  const declared = new Set()
  const bodies = []

  for (const match of sql.matchAll(/\$(\w*)\$([\s\S]*?)\$\1\$/g)) {
    bodies.push(match[2])
    const declareBlock = /\bdeclare\b([\s\S]*?)\bbegin\b/i.exec(match[2])
    if (!declareBlock) continue
    for (const line of declareBlock[1].split('\n')) {
      const name = /^\s*([a-zA-Z_][\w]*)\s+[a-zA-Z]/.exec(line)
      if (name) declared.add(name[1].toLowerCase())
    }
  }

  for (const param of sql.matchAll(/\b([pv]_[A-Za-z0-9_]+)\s+[a-zA-Z]/g)) declared.add(param[1].toLowerCase())

  for (const body of bodies) {
    let index = 0
    let line = 1
    while (index < body.length) {
      const char = body[index]
      if (char === '\n') {
        line += 1
        index += 1
        continue
      }
      if (body.startsWith('--', index)) {
        const end = body.indexOf('\n', index)
        index = end === -1 ? body.length : end
        continue
      }
      if (char === "'") {
        index += 1
        while (index < body.length) {
          if (body[index] === "'" && body[index + 1] === "'") {
            index += 2
            continue
          }
          if (body[index] === "'") {
            index += 1
            break
          }
          if (body[index] === '\n') line += 1
          index += 1
        }
        continue
      }
      if (/[a-zA-Z_]/.test(char)) {
        let word = ''
        const wordLine = line
        while (index < body.length && /[\w$]/.test(body[index])) {
          word += body[index]
          index += 1
        }
        if (/^[pv]_/i.test(word) && !declared.has(word.toLowerCase())) {
          problems.push(`${file}: line ${wordLine}: variable "${word}" is used but never declared in this file`)
        }
        continue
      }
      index += 1
    }
  }
}

/**
 * A generated migration once shipped `as $` / `$;` instead of `as $$` / `$$;`. Postgres reads the whole
 * body as one unterminated string and reports a syntax error many lines later ("at or near \"with\""),
 * which is a miserable thing to debug in a dashboard. The quote walker cannot see it because a lone `$`
 * is not a tag, so the two corruption signatures are checked directly.
 */
function lintDollarBlocks(file, sql, problems) {
  sql.split(/\r?\n/).forEach((text, i) => {
    const line = text.trim()
    if (line === 'as $' || line === 'do $' || line.endsWith(' as $') || line.endsWith(' do $')) {
      problems.push(`${file}: line ${i + 1}: collapsed dollar quote "${line}" - an opener needs two $ on each side`)
    }
    if (line === '$;') {
      problems.push(`${file}: line ${i + 1}: "$;" does not close anything - write "$$;"`)
    }
    // The same generator bug leaves `$1` where a capture group failed to substitute. Postgres reads
    // that as a parameter placeholder, so the body is only rejected when the function is first called.
    const stray = /\$\d+/.exec(text)
    if (stray) {
      problems.push(`${file}: line ${i + 1}: stray "${stray[0]}" - a substitution that never happened`)
    }
  })
}

/**
 * Postgres reads a block comment as inert, and apostrophes inside it are prose: "the campaign's
 * earning sheet". The quote walkers below have no idea what a comment is, so such an apostrophe opens
 * a string that runs to the next quote in the file, and the report then claims the migration contains
 * SQL it does not contain. Block comments are blanked here, outside dollar-quoted bodies, and blanked
 * with spaces so every line number stays honest for the messages that follow.
 *
 * Bodies are copied verbatim on purpose. Inside `$$ ... $$` an apostrophe is already the function's
 * own text, and the walker has always handled that by suppressing reports while a tag is open;
 * changing it here would move a rule nobody asked to move.
 */
function blankBlockComments(source) {
  const out = []
  let index = 0
  let depth = 0
  let tag = null

  while (index < source.length) {
    const rest = source.slice(index)

    if (tag !== null) {
      const close = rest.indexOf(tag)
      if (close === -1) {
        out.push(rest)
        break
      }
      out.push(rest.slice(0, close + tag.length))
      index += close + tag.length
      tag = null
      continue
    }

    const open = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest)
    if (open) {
      tag = open[0]
      out.push(tag)
      index += tag.length
      continue
    }

    // A line comment is inert too, and the walkers already skip it, so it is copied as written.
    if (rest.startsWith('--')) {
      const end = source.indexOf('\n', index)
      const stop = end === -1 ? source.length : end
      out.push(source.slice(index, stop))
      index = stop
      continue
    }

    if (rest.startsWith('/*')) {
      depth += 1
      out.push('  ')
      index += 2
      continue
    }

    if (rest.startsWith('*/') && depth > 0) {
      depth -= 1
      out.push('  ')
      index += 2
      continue
    }

    if (depth > 0) {
      if (rest.startsWith('\n')) {
        out.push('\n')
        index += 1
        continue
      }
      out.push(' ')
      index += 1
      continue
    }

    if (source[index] === "'") {
      const end = source.indexOf("'", index + 1)
      const stop = end === -1 ? source.length : end + 1
      out.push(source.slice(index, stop))
      index = stop
      continue
    }

    out.push(source[index])
    index += 1
  }

  return out.join('')
}

const files = DIRS.filter((dir) => existsSync(dir)).flatMap((dir) =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => join(dir, name))
)

const problems = []

for (const file of files) {
  const sql = blankBlockComments(readFileSync(file, 'utf8'))
  const swallowed = []
  let index = 0
  let line = 1
  let openTag = null

  while (index < sql.length) {
    const char = sql[index]

    if (char === '\n') {
      line += 1
      index += 1
      continue
    }

    // A line comment is inert whether it sits in the script or inside a dollar-quoted body, so
    // an apostrophe in prose ("the gateway's claims") must not be read as the start of a string.
    if (sql.startsWith('--', index)) {
      const end = sql.indexOf('\n', index)
      index = end === -1 ? sql.length : end
      continue
    }

    if (char === '$') {
      const end = sql.indexOf('$', index + 1)
      const candidate = end === -1 ? null : sql.slice(index, end + 1)
      if (candidate && DOLLAR_TAG.test(candidate)) {
        if (openTag === null) openTag = candidate
        else if (openTag === candidate) openTag = null
        index += candidate.length
        continue
      }
    }

    if (char === "'") {
      const startLine = line
      index += 1
      let value = ''
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          value += "'"
          index += 2
          continue
        }
        if (sql[index] === "'") {
          index += 1
          break
        }
        if (sql[index] === '\n') line += 1
        value += sql[index]
        index += 1
      }
      // Outside a dollar-quoted body, a string literal holding SQL means a quote opened too early.
      if (openTag === null && SQL_KEYWORD_IN_STRING.test(value)) {
        swallowed.push(`line ${startLine}: '${value.slice(0, 70).replace(/\s+/g, ' ')}…'`)
      }
      continue
    }

    index += 1
  }

  if (openTag !== null) problems.push(`${file}: unterminated dollar quote ${openTag}`)
  if (swallowed.length > 0) problems.push(`${file}: SQL text inside a string literal\n    ${swallowed.join('\n    ')}`)
  lintAssignments(file, sql, problems)
  lintDeclaredNames(file, sql, problems)
  lintDollarBlocks(file, sql, problems)
}

console.log(`checked ${files.length} sql files`)
if (problems.length > 0) {
  console.log('PROBLEMS:\n  ' + problems.join('\n  '))
  process.exit(1)
}
console.log('no swallowed-string or unbalanced-quote issues')
