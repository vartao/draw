#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');

const sourceDir = path.resolve(process.env.DRAWIO_DATA_DIR || path.join(__dirname, '..', 'data'));
const backupRoot = path.resolve(process.env.DRAWIO_BACKUP_DIR || path.join(path.dirname(sourceDir), 'backups'));
const includeLogs = process.env.DRAWIO_BACKUP_INCLUDE_LOGS === '1';

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_err) {
    return false;
  }
}

function shouldSkip(relativePath) {
  const parts = relativePath.split(path.sep).filter(Boolean);

  if (!includeLogs && parts[0] === 'logs') {
    return true;
  }

  if (parts[0] === 'backups') {
    return true;
  }

  return false;
}

async function copyDataDir(fromDir, toDir, relativePath = '') {
  const stats = {
    bytes: 0,
    files: 0,
    directories: 0
  };

  const entries = await fs.readdir(fromDir, { withFileTypes: true });

  await fs.mkdir(toDir, { recursive: true });

  for (const entry of entries) {
    const nextRelativePath = path.join(relativePath, entry.name);

    if (shouldSkip(nextRelativePath)) {
      continue;
    }

    const fromPath = path.join(fromDir, entry.name);
    const toPath = path.join(toDir, entry.name);

    if (entry.isDirectory()) {
      const childStats = await copyDataDir(fromPath, toPath, nextRelativePath);
      stats.bytes += childStats.bytes;
      stats.files += childStats.files;
      stats.directories += childStats.directories + 1;
    } else if (entry.isFile()) {
      const fileStat = await fs.stat(fromPath);
      await fs.copyFile(fromPath, toPath);
      stats.bytes += fileStat.size;
      stats.files += 1;
    }
  }

  return stats;
}

async function main() {
  if (!(await pathExists(sourceDir))) {
    throw new Error(`Data directory does not exist: ${sourceDir}`);
  }

  await fs.mkdir(backupRoot, { recursive: true });

  const targetDir = path.join(backupRoot, `company-drawio-data-${timestamp()}`);
  await fs.mkdir(targetDir, { recursive: true });

  const stats = await copyDataDir(sourceDir, targetDir);
  const manifest = {
    createdAt: new Date().toISOString(),
    source: sourceDir,
    target: targetDir,
    includeLogs,
    ...stats
  };

  await fs.writeFile(path.join(targetDir, 'backup-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
