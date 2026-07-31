import {
  cp,
  lstat,
  mkdir,
  readdir,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function isDirectory(candidate) {
  try {
    return (await stat(candidate)).isDirectory();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function replaceDirectory(source, destination, required) {
  await rm(destination, { force: true, recursive: true });
  if (!(await isDirectory(source))) {
    if (required)
      throw new Error(
        `Required standalone asset directory is missing: ${source}`,
      );
    return false;
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { force: true, recursive: true });
  return true;
}

function isPathInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

async function collectSymbolicLinks(directory, links = []) {
  for (const entry of await readdir(directory)) {
    const candidate = path.join(directory, entry);
    const metadata = await lstat(candidate);
    if (metadata.isSymbolicLink()) {
      links.push(candidate);
    } else if (metadata.isDirectory()) {
      await collectSymbolicLinks(candidate, links);
    }
  }
  return links;
}

export async function verifyStandaloneIsolation(standalone) {
  const root = path.resolve(standalone);
  const links = await collectSymbolicLinks(root);
  for (const link of links) {
    const resolvedTarget = await realpath(link);
    if (!isPathInside(root, resolvedTarget)) {
      throw new Error(
        `Standalone link escapes the artifact: ${link} -> ${resolvedTarget}`,
      );
    }
  }
  return links.length;
}

export async function prepareStandalone(projectRoot = process.cwd()) {
  const root = path.resolve(projectRoot);
  const standalone = path.join(root, ".next", "standalone");
  if (!(await isDirectory(standalone))) {
    throw new Error(`Next.js standalone output is missing: ${standalone}`);
  }

  await replaceDirectory(
    path.join(root, ".next", "static"),
    path.join(standalone, ".next", "static"),
    true,
  );
  const copiedPublic = await replaceDirectory(
    path.join(root, "public"),
    path.join(standalone, "public"),
    false,
  );
  const verifiedLinks = await verifyStandaloneIsolation(standalone);

  return { copiedPublic, standalone, verifiedLinks };
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;
if (invokedPath === import.meta.url) {
  prepareStandalone()
    .then(({ copiedPublic, standalone, verifiedLinks }) => {
      process.stdout.write(
        `Prepared standalone assets at ${standalone}${copiedPublic ? " with public files" : ""}; verified ${verifiedLinks} internal link(s).\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
