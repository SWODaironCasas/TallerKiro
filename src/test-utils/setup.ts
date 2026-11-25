import { afterEach } from 'vitest';
import { restoreTestEnvironment } from './index.js';

afterEach(() => {
  restoreTestEnvironment();
});
