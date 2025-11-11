// Logger utility - exports a default logger instance
import { Logger } from '../services/Logger';

// Create a default logger instance for general use
const defaultLogger = new Logger('App');

export default defaultLogger;
export { Logger };
