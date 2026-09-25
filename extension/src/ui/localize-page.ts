/** Side effect only: translate the page's static markup (see kit.ts for why it runs first). */
import { localize } from '../i18n.ts';

localize(document);
