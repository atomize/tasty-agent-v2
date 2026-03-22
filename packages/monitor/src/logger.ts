type LogLevel = 'debug' | 'info' | 'warn' | 'error'

let outputMode: 'dashboard' | 'pipe' | 'file' = 'dashboard'

export function setOutputMode(mode: 'dashboard' | 'pipe' | 'file') {
  outputMode = mode
}

function write(level: LogLevel, ...args: unknown[]) {
  const ts = new Date().toISOString()
  const prefix = `[${ts}] [${level.toUpperCase()}]`

  if (outputMode === 'pipe') {
    process.stderr.write(`${prefix} ${args.map(String).join(' ')}\n`)
  } else {
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
    fn(prefix, ...args)
  }
}

export const log = {
  debug: (...args: unknown[]) => write('debug', ...args),
  info: (...args: unknown[]) => write('info', ...args),
  warn: (...args: unknown[]) => write('warn', ...args),
  error: (...args: unknown[]) => write('error', ...args),
}
