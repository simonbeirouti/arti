import { resolve } from 'node:path';
import { createBackup, restoreBackup } from './backup-library';

if (process.argv[2] === 'restore') {
  const source = process.argv[3];
  const destination = process.argv[4];

  if (!source || !destination) throw new Error('Usage: pnpm backup restore <backup-directory> <new-data-directory>');

  await restoreBackup(resolve(source), resolve(destination));
  console.log('Backup restored to a new directory. Agent credentials will be regenerated on startup.');
} else {
  const destination = process.argv[2];

  if (!destination) throw new Error('Usage: pnpm backup <new-backup-directory>; stop the server first');

  await createBackup(resolve(process.env.ARTI_DATA_ROOT ?? '.arti'), resolve(destination));
  console.log('Private backup created with integrity manifest. Keep it outside public hosting.');
}
