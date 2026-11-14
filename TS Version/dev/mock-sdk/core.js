import { DatabaseSync } from 'node:sqlite';
export const sqlite = new DatabaseSync(':memory:');
export const registry = [];
