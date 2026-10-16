import * as path from 'path';

export type LinkResolution = {
  status: 'resolved' | 'ambiguous' | 'missing';
  targetPath?: string;
  candidates: string[];
};

export function resolveWikilinkTarget(files: readonly string[], sourcePath: string, rawTarget: string): LinkResolution {
  const target = rawTarget.trim().replace(/\\/g, '/');
  if (!target || target.includes('#')) {
    return { status: 'missing', candidates: [] };
  }

  const explicitPath = target.includes('/') || target.startsWith('/');
  let matches: string[];

  if (explicitPath) {
    const cleanTarget = target.replace(/^\/+/, '');
    const sourceDirectory = path.posix.dirname(sourcePath);
    const possibleBases = target.startsWith('/')
      ? [cleanTarget]
      : [normalizeRelativePath(path.posix.join(sourceDirectory, cleanTarget)), normalizeRelativePath(cleanTarget)];
    const possiblePaths = new Set<string>();
    for (const base of possibleBases) {
      possiblePaths.add(base);
      possiblePaths.add(`${base}.md`);
      possiblePaths.add(`${base}.markdown`);
    }
    matches = files.filter((file) => possiblePaths.has(file));
    const firstBaseMatches = possibleBases.map((base) => matches.filter((file) => file === base || file === `${base}.md` || file === `${base}.markdown`)).find((set) => set.length > 0);
    if (firstBaseMatches?.length) {
      matches = firstBaseMatches;
    }
  } else {
    const exactMatches = files.filter((file) => {
      const basename = path.posix.basename(file);
      return normalizeText(basename) === normalizeText(target);
    });

    const markdownMatches = files.filter((file) => {
      const basename = path.posix.basename(file);
      return isMarkdownFile(file) && normalizeText(stripMarkdownExtension(basename)) === normalizeText(target);
    });
    matches = exactMatches.length > 0 ? exactMatches : markdownMatches;

    const sameDirectory = matches.filter((file) => path.posix.dirname(file) === path.posix.dirname(sourcePath));
    if (sameDirectory.length > 0) {
      matches = sameDirectory;
    }
  }

  matches = [...new Set(matches)].sort((left, right) => left.localeCompare(right));
  if (matches.length === 1) {
    return { status: 'resolved', targetPath: matches[0], candidates: matches };
  }
  if (matches.length > 1) {
    return { status: 'ambiguous', candidates: matches };
  }
  return { status: 'missing', candidates: [] };
}

export function normalizeRelativePath(value: string): string {
  return path.posix.normalize(value.replace(/\\/g, '/')).replace(/^\.\//, '');
}

export function normalizeText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US');
}

export function isMarkdownFile(relativePath: string): boolean {
  return /\.(md|markdown)$/i.test(relativePath);
}

export function stripMarkdownExtension(value: string): string {
  return value.replace(/\.(md|markdown)$/i, '');
}
