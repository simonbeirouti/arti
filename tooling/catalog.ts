import { loadCatalogue, validateCatalogue } from '../apps/knowledge/src/catalog';

const catalogue = await loadCatalogue(process.cwd());

await validateCatalogue(process.cwd(), catalogue);

console.log(`Catalogue valid: ${catalogue.capabilities.length} capabilities, ${catalogue.workflows.length} workflows, ${catalogue.guides.length} canonical guides.`);
