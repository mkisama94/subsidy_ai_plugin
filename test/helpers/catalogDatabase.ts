import { readFileSync } from 'node:fs';
import { documentDatabase } from './documentDatabase';
export function catalogDatabase() {
  const result=documentDatabase();
  result.sqlite.exec(readFileSync(new URL('../../migrations/0005_mhlw_discovery_catalog.sql',import.meta.url),'utf8'));
  result.sqlite.exec(readFileSync(new URL('../../migrations/0006_discovery_release_activation.sql',import.meta.url),'utf8'));
  return result;
}
