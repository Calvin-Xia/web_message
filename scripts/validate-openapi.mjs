import SwaggerParser from '@apidevtools/swagger-parser';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const openApiPath = join(projectRoot, 'docs', 'openapi.yaml');
const document = await SwaggerParser.validate(openApiPath);
const operationCount = Object.values(document.paths).reduce((total, pathItem) => (
  total + Object.keys(pathItem).filter((key) => (
    ['get', 'post', 'patch', 'put', 'delete'].includes(key)
  )).length
), 0);

console.log(`OpenAPI ${document.openapi} validated: ${operationCount} operations`);
