type Level = 'info' | 'warn' | 'error';

function write(level: Level, message: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({ at: new Date().toISOString(), level, message, ...fields });
  if (level === 'info') {
    process.stdout.write(`${line}\n`);
  } else {
    process.stderr.write(`${line}\n`);
  }
}

export const log = {
  info: (message: string, fields: Record<string, unknown> = {}) => write('info', message, fields),
  warn: (message: string, fields: Record<string, unknown> = {}) => write('warn', message, fields),
  error: (message: string, fields: Record<string, unknown> = {}) => write('error', message, fields),
};
