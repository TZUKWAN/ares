/** Reproducible test dependencies. Overrides remain explicit for host parity runs. */
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(import.meta.url);
process.env.ARES_PLAYWRIGHT_PACKAGE||=require.resolve('playwright');
process.env.ARES_REACT_TEST_MODULES||=join(root,'node_modules');
process.env.PLAYWRIGHT_BROWSERS_PATH||=join(root,'.cache','playwright');
