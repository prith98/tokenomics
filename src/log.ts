import { pino } from 'pino';
import { config } from './config.js';

export const log = pino({
  level: config.logLevel,
  transport:
    process.env.NODE_ENV === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, singleLine: true } },
});
