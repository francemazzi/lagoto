import { inventory } from '../runtime/integrations.js';
console.log(JSON.stringify(await inventory(), null, 2));
